# Slice 5 — Search stage: Plan

> Spec: `docs/superpowers/specs/2026-06-08-slice-5-search-design.md`. Builds on 1–4.

## Task 1 — Deps + neutral query types
- `pnpm add @tavily/core`.
- `domain/services/search-queries.ts`: neutral `SearchTopic = "news"|"general"`, `SearchOptions {topic, searchDepth:"advanced", maxResults, startDate?, endDate?, timeRange?, excludeDomains}`, `SearchQuery {query, options}`; `buildSearchQueries(identity)` (port v1 18-query logic + `addMonths`); reuse `AGGREGATOR_BLOCKLIST` from `heuristics.ts`. excludeDomains adds negative-match domains.

## Task 2 — Port + adapter
- `domain/ports/search-provider.port.ts`: `SearchHit`, `SearchProvider {search(q):Promise<SearchHit[]>; isConfigured()}` + token `SEARCH_PROVIDER`.
- `infrastructure/tavily/tavily-search.ts`: `TavilySearch implements SearchProvider`; `@tavily/core`; map SearchOptions→TavilySearchOptions; map results→SearchHit (sourceDomain from URL host; publishedDate ||null); degrade w/o `TAVILY_API_KEY` (isConfigured=false, search→[]).

## Task 3 — SearchStage
- `application/search-stage.ts`: `SearchStage.run(job)`. Identity = `job.resolvedIdentity` (or throw→caught). If `!provider.isConfigured()` → `job.addWarning("search not configured — no results fetched")`; return. Else queries=buildSearchQueries(identity); `Promise.allSettled(queries.map(q=>provider.search(q)))`; for fulfilled, insert each hit (`new Result(ids.next(), job.id, url, normalizeUrl(url), title, sourceDomain, publishedDate)`, `insertIfNew`); count failures; failed>0 → Warning; succeeded===0 → throw.

## Task 4 — Resolve negative matches → domains
- `resolve-stage.ts` `collectNegativeMatches`: return `c.domain` (was `c.name`); update `resolve-stage.spec.ts` to expect the domain.

## Task 5 — Pipeline + wiring
- `pipeline.service.ts`: remove STUB_HITS + insert/filter/classify stubs; run resolve → searching: `await this.search.run(job)` (save+publish around it) → filtering (no-op transition) → classifying (no-op transition) → finalize. Inject SearchStage.
- `jobs.module.ts`: bind `SEARCH_PROVIDER`→TavilySearch; provide SearchStage.

## Task 6 — Tests + verify
- `search-queries.spec.ts` (18, groups, slices, excludeDomains). `search-stage.spec.ts` (mock provider+repo+ids: inserts, dedup, partial/all-fail, unconfigured). lint/tsc/test/build. Live: no Tavily key → Warning + empty + done_with_warnings; pipeline runs to terminal.
