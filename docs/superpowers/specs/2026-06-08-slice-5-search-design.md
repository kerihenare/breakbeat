# Slice 5 — Search stage: Design Spec

**Bead:** `aglow-ti2.5` · **Date:** 2026-06-08 · Self-directed. Builds on 1–4.

## Purpose
Replace the stub Search with a real **Tavily** stage. Build the query set from the Resolved Identity (excluding own domains, own-social hosts, the aggregator blocklist, **and the negative-match companies' domains**), fire concurrently, and insert each hit with **insert-time URL dedup** (the `UNIQUE(job_id, normalized_url)` constraint from Slice 2). Per-query failure → Warning; all-fail → Job `failed`. Filter/Classify become **no-op transitions** until Slices 6–7 (results stay `included` + unclassified).

## Query strategy (ported from v1, pure)
`buildSearchQueries(identity)` → **18** queries in three groups:
- **7 per-content-type**: `{name} news`, `{name} press release` (`topic:news`, date-bounded); `{name} {podcast interview|blog post|newsletter|trade publication|social media}` (`topic:general`, `timeRange:year`).
- **6 time-sliced**: news + press release across three 12-month slices tiling `[windowStart, windowEnd]` (`topic:news`, slice date bounds).
- **5 angle**: `{name} {funding|acquisition|leadership interview|partnership|lawsuit OR controversy}` (`topic:general`).
All use `searchDepth:advanced`, `maxResults:20`, and `excludeDomains` = own domains + own social hosts + `AGGREGATOR_BLOCKLIST` + negative-match domains (deduped, order-preserved). The domain layer uses a **neutral `SearchQuery`/`SearchOptions`** type; the Tavily adapter maps to `TavilySearchOptions` (keeps domain Tavily-free).

## Ports & adapters
- `domain/ports/search-provider.port.ts`: `SearchHit {url,title,content,sourceDomain,publishedDate}`; `interface SearchProvider { search(q): Promise<SearchHit[]>; isConfigured() }`.
- `domain/services/search-queries.ts`: pure `buildSearchQueries(identity)` + `AGGREGATOR_BLOCKLIST` (reuse the one in heuristics) + `addMonths`.
- `infrastructure/tavily/tavily-search.ts`: `@tavily/core`; maps SearchQuery→Tavily options; returns SearchHit[]; degrade without `TAVILY_API_KEY`.
- `application/search-stage.ts`: `SearchStage.run(job)` — if provider unconfigured → Warning + return; else build queries, `Promise.allSettled` over `provider.search`, insert each hit via `ResultRepository.insertIfNew` (skips dups), count failures; some fail → Warning (`N/18 queries failed`); all fail → throw (pipeline → `failed`).

## Negative matches
Slice 4 stored negative matches as candidate **names**; refine to candidate **domains** (search needs `excludeDomains`; classification in Slice 7 still gets useful negative context). One-line change in `ResolveStage.collectNegativeMatches` (+ its test).

## Pipeline
`PipelineService`: real `ResolveStage` (Slice 4) → real `SearchStage` (this slice) → Filter (no-op transition) → Classify (no-op transition) → finalize. Remove the Slice-3 STUB_HITS/insert/filter/classify helpers.

## Decisions
1. **Domain stays Tavily-free** via a neutral SearchQuery type; the adapter owns the Tavily mapping.
2. **Dedup at insert** via the existing unique constraint (`insertIfNew` returns false on conflict) — no dedup stage.
3. **Unconfigured ≠ failure**: no key → Warning + zero results + Job completes (`done_with_warnings`); only *configured-but-all-queries-failed* fails the Job.
4. **Negative matches → domains** for search exclusion.
5. Keyless clones now show empty results (honest); UI mock data is Slice 8 (DESIGN-BRIEF §10).

## Testing
- `buildSearchQueries`: exactly 18; group composition; date slices tile the window; excludeDomains includes own domains + social hosts + aggregators + negative domains, deduped.
- `SearchStage` (mocked provider + repo): inserts hits, dedups, partial-failure Warning, all-fail throws, unconfigured → Warning + no calls.
- Tavily adapter: maps options + parses hits (mock fetch/client); degrade without key.

## Acceptance
- With `TAVILY_API_KEY`: real results inserted, dups collapse, partial failures warn. Without: Warning + empty + completes. Pipeline runs Resolve→Search→(noop)→(noop)→terminal. lint+tests+build green; degraded path live-verified. **Live Tavily needs a key — reported honestly.**

## Out of scope
Heuristic Filter + Collapse (Slice 6), Extract + Classify (Slice 7), UI (8).
