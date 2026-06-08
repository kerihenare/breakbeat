# Slice 7 — Extract + Classify: Design Spec & Plan

**Bead:** `aglow-ti2.7` · **Date:** 2026-06-08 · Self-directed. Builds on 1–6.

## Purpose
Replace the no-op Classify with a real **two-pass** stage. **Pass 1** classifies every included Result on its **title + snippet** with **Claude Haiku** (structured outputs, closed enums) — assigning a Content Type and backstopping own_channel/aggregator/ecommerce — cheap triage that drops obvious exclusions before paying to extract. **Tavily Extract** then pulls page content for **Pass-1 survivors only** (LLM-excluded Results are never extracted). **Pass 2** re-classifies those survivors on the full extracted text, overwriting type/confidence and able to newly exclude. The Pass-1 verdict is the floor: a failed Extract or Pass 2 keeps it, so nothing regresses to unclassified. Both passes share the same prompt/identity + **negative-match domains** context. Classify failures → Warning, Results left unclassified (nullable).

> **Ordering note (2026-06-08):** This supersedes the original extract-*before*-classify design. Extract now runs *between* the two classify passes so it touches survivors only — fewer Extract calls (cost down) at the price of a second Haiku pass (accuracy up on full text). See Decision 6.

## Ports & adapters
- `domain/ports/content-extractor.port.ts`: `ContentExtractor { extract(urls: string[]): Promise<Map<string,string>>; isConfigured() }` (URL → extracted text).
- `domain/ports/classifier.port.ts`: `ClassifyInput {id,title,url,sourceDomain,content}`, `ClassifyVerdict {id, contentType: ContentType, exclude: "none"|"own_channel"|"ecommerce_review"|"aggregator", confidence: Confidence}`; `Classifier { classify(inputs, identity): Promise<ClassifyVerdict[]>; isConfigured() }`.
- `domain/services/classify-prompt.ts` (pure, ported from v1): `buildClassifyPrompt(inputs, identity)` (+ negative-match context), `RESPONSE_SCHEMA`/enums (id now **string**), `CLASSIFY_MODEL="claude-haiku-4-5"`, `CLASSIFY_CAP=400`, `CLASSIFY_CHUNK_SIZE=50`, `validateResultIds(sent,received)`.
- `infrastructure/tavily/tavily-extractor.ts`: `@tavily/core` `.extract`; degrade w/o `TAVILY_API_KEY`; best-effort per batch (errors → empty map).
- `infrastructure/anthropic/haiku-classifier.ts`: `@anthropic-ai/sdk` beta structured outputs; builds prompt via the domain service; parses + returns verdicts; degrade w/o `ANTHROPIC_API_KEY`.

## ClassifyStage (application)
`ClassifyStage.run(job)`:
1. If classifier unconfigured → Warning (“classification not configured — results left unclassified”); return. `included = findIncludedByJob` (cap at `CLASSIFY_CAP`; if more, Warning “classified first 400”); empty → return.
2. **Pass 1 (snippet):** build `ClassifyInput[]` with `content = snippet ?? null`; `classifyBatch` (chunk `CLASSIFY_CHUNK_SIZE` → `Promise.allSettled(classifier.classify)` → verdicts-by-id + failed-chunk count). *No verdicts applied yet* (merge once at the end).
3. **Survivors** = `included` whose Pass-1 verdict is `exclude:"none"` *or* has no verdict (a Pass-1 miss still gets a Pass-2 chance). LLM-excluded Results are never extracted.
4. **Extract:** extractor unconfigured → Warning (“…classified on snippets only”), empty map. Else, survivors present → `extract(survivorUrls)` (best-effort) → content map.
5. **Pass 2 (full text):** survivors with non-empty extracted content → `classifyBatch` on that content. Skipped (no extra LLM call) when no survivor has content.
6. **Merge once:** for each `included` Result, take the Pass-2 verdict if present else the Pass-1 verdict; apply exactly once — `exclude!=="none"` → `markExcluded(id,{code,detail:"LLM"})`, else `markClassified(id, contentType, confidence)`. A failed Extract/Pass-2 leaves the Pass-1 verdict standing (never regresses to unclassified).
7. **Warnings:** Pass-1 chunk failures → “…classification batches failed”; Pass-2 chunk failures → “…refinement batches failed — kept the snippet classification”; otherwise any Result with no verdict → “N result(s) were not classified”. None of these fail the Job (the list is the Job's purpose). Rogue/missing ids reconciled by `validateResultIds` semantics (verdicts keyed by id; unknown ids simply never match a Result).

## Pipeline & live phases
Replace the `classifying` no-op with `await this.classify.run(job, reportPhase)` (save+publish around). This is the last pipeline stage before `finalize`.

Because Classify is the heaviest stage (two LLM passes plus network Extract), its three internal steps surface as their own **live SSE phases** so the status chip shows real progress: **Classifying** (Pass 1, snippet triage) → **Extracting** (Tavily Extract of survivors) → **Refining** (Pass 2, full-text re-classify). `PipelineService` enters `classifying`, then passes `reportPhase = (status) => this.enter(job, status)` into the stage; the stage calls it at the two boundaries — `extracting` only when the extractor is configured and there are survivors, `refining` only when a survivor has extracted content. State-machine edges (`job-status.ts`) gain `classifying→extracting→refining→{done,done_with_warnings,failed}` plus short-circuits (`classifying→done`, `extracting→done`) for the degraded paths where a sub-phase is skipped. `status` is plain `text` — no migration. The Lit `bb-job-status` chip gains `Extracting`/`Refining` labels (running animation applies to all non-terminal states).

## Decisions
1. **Classify failure is a Warning, not a Job failure** (CONTEXT.md): a total classify failure still yields the reviewable list, just untyped. Only Search all-fail fails the Job.
2. **`exclude_detail="LLM"`** records the catcher (closed vocab only; never free text from the model — no prompt-injection echo channel). No reasoning field.
3. **String ids** (UUIDs) in the schema; `validateResultIds` reconciles sent/received.
4. **Extract degrades to snippet**; classify still runs on title+snippet when Extract is unavailable (Pass 1 *is* the snippet classification, so an Extract-less Job is just Pass 1).
5. **Negative-match domains** added to the prompt as “other companies to disambiguate against”.
6. **Two passes, Extract in the middle.** Extract is the expensive call (one network fetch + parse per URL); classifying on snippets first lets us extract only the Results that survived triage, and re-classifying on full text recovers the accuracy a snippet can't give. The trade is a second Haiku pass over survivors — accepted, because Extract cost scales with result volume while the Pass-2 LLM cost is bounded by survivors (always ≤ included) and Haiku is cheap. Pass 1 is also the graceful-degradation floor when Extract or Pass 2 fails.

## Testing
- `classify-prompt.spec.ts`: prompt includes identity + negative matches + each input; `validateResultIds` (valid/rogue/missing/dupes).
- `classify-stage.spec.ts` (mocked extractor+classifier+repo): Pass-1 content_type via `markClassified`; LLM `exclude` → `markExcluded(...,"LLM")`; **Extract requested for survivors only, never Pass-1 exclusions**; **Pass 2 overwrites the Pass-1 verdict exactly once** (single write per Result); Extract-empty or Pass-2 failure **keeps the Pass-1 verdict** (no second LLM call when no survivor has content); extractor unconfigured → “snippets only” Warning + Pass 1 only; classifier unconfigured → Warning + no calls; Pass-2 chunk failure → “refinement batches” Warning; missing id → Warning + stays unclassified.
- Anthropic/Tavily-extract adapters: degrade without keys (unit, mocked).

## Acceptance
Pipeline runs Resolve→Search→Filter→**Classify**→terminal. With keys: results typed, LLM backstops exclusions. Without: Warning + unclassified + completes. lint+tests+build green; degraded path live-verified. **Live Anthropic/Tavily needs keys.**

## Out of scope
UI (Slice 8), deliverables (9).
