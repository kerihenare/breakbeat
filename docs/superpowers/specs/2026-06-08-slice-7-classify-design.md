# Slice 7 — Extract + Classify: Design Spec & Plan

**Bead:** `aglow-ti2.7` · **Date:** 2026-06-08 · Self-directed. Builds on 1–6.

## Purpose
Replace the no-op Classify with a real stage: **Tavily Extract** pulls page content for each surviving Result, then **Claude Haiku** (structured outputs, closed enums) assigns one Content Type and backstops own_channel/aggregator/ecommerce, using extracted content + Resolved Identity + **negative-match domains** as context. Extract failures degrade to the search snippet; classify failures → Warning, Results left unclassified (nullable).

## Ports & adapters
- `domain/ports/content-extractor.port.ts`: `ContentExtractor { extract(urls: string[]): Promise<Map<string,string>>; isConfigured() }` (URL → extracted text).
- `domain/ports/classifier.port.ts`: `ClassifyInput {id,title,url,sourceDomain,content}`, `ClassifyVerdict {id, contentType: ContentType, exclude: "none"|"own_channel"|"ecommerce_review"|"aggregator", confidence: Confidence}`; `Classifier { classify(inputs, identity): Promise<ClassifyVerdict[]>; isConfigured() }`.
- `domain/services/classify-prompt.ts` (pure, ported from v1): `buildClassifyPrompt(inputs, identity)` (+ negative-match context), `RESPONSE_SCHEMA`/enums (id now **string**), `CLASSIFY_MODEL="claude-haiku-4-5"`, `CLASSIFY_CAP=400`, `CLASSIFY_CHUNK_SIZE=50`, `validateResultIds(sent,received)`.
- `infrastructure/tavily/tavily-extractor.ts`: `@tavily/core` `.extract`; degrade w/o `TAVILY_API_KEY`; best-effort per batch (errors → empty map).
- `infrastructure/anthropic/haiku-classifier.ts`: `@anthropic-ai/sdk` beta structured outputs; builds prompt via the domain service; parses + returns verdicts; degrade w/o `ANTHROPIC_API_KEY`.

## ClassifyStage (application)
`ClassifyStage.run(job)`:
1. `included = findIncludedByJob` (cap at `CLASSIFY_CAP`; if more, Warning “classified first 400”). If classifier unconfigured → Warning (“classification not configured — results left unclassified”); return.
2. Extract: if extractor configured, `extract(urls)` (chunked, best-effort) → content map; else empty.
3. Build `ClassifyInput[]` (content = extracted ?? result snippet ?? null).
4. Chunk into `CLASSIFY_CHUNK_SIZE`; `Promise.allSettled(chunks.map(c => classifier.classify(c, identity)))`.
5. Apply per verdict: `exclude!=="none"` → `markExcluded(id,{code:exclude,detail:"LLM"})`; else `markClassified(id, contentType, confidence)`. `validateResultIds` → `missing` ids stay unclassified + Warning; rogue ids ignored. Failed chunk → Warning; all chunks fail → Warning (results unclassified, **not** a Job failure — the list is the Job's purpose).

## Pipeline
Replace `classifying` no-op with `await this.classify.run(job)` (save+publish around). This is the last pipeline stage before `finalize`.

## Decisions
1. **Classify failure is a Warning, not a Job failure** (CONTEXT.md): a total classify failure still yields the reviewable list, just untyped. Only Search all-fail fails the Job.
2. **`exclude_detail="LLM"`** records the catcher (closed vocab only; never free text from the model — no prompt-injection echo channel). No reasoning field.
3. **String ids** (UUIDs) in the schema; `validateResultIds` reconciles sent/received.
4. **Extract degrades to snippet**; classify still runs on title+snippet when Extract is unavailable (snippet quality = classification quality, per the spec).
5. **Negative-match domains** added to the prompt as “other companies to disambiguate against”.

## Testing
- `classify-prompt.spec.ts`: prompt includes identity + negative matches + each input; `validateResultIds` (valid/rogue/missing/dupes).
- `classify-stage.spec.ts` (mocked extractor+classifier+repo): applies content_type via `markClassified`; LLM `exclude` → `markExcluded(...,"LLM")`; unconfigured → Warning + no calls; chunk failure → Warning; missing id → Warning + stays unclassified.
- Anthropic/Tavily-extract adapters: degrade without keys (unit, mocked).

## Acceptance
Pipeline runs Resolve→Search→Filter→**Classify**→terminal. With keys: results typed, LLM backstops exclusions. Without: Warning + unclassified + completes. lint+tests+build green; degraded path live-verified. **Live Anthropic/Tavily needs keys.**

## Out of scope
UI (Slice 8), deliverables (9).
