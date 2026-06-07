# Slice 2 — Domain core + persistence: Implementation Plan

> Execute task-by-task; TDD for the pure domain logic. Builds on Slice 1.

**Goal:** Framework-free `jobs` domain (entities, VOs, ports, ported pure logic) + Drizzle/postgres.js repository adapters + migration for `jobs`/`results`/`warnings`.

**Reference:** spec `docs/superpowers/specs/2026-06-08-slice-2-domain-design.md`; v1 source on `main` (`git show main:src/...`).

## Task 1 — Value objects & status (pure, tested)
- `domain/job-status.ts`: `JobStatus` union; `TERMINAL_STATES`; `LEGAL_EDGES`; `isTerminal`, `canTransition(from,to)`, `assertTransition(from,to)` (throws `illegal transition: a → b`). Port table from `main:src/jobs/queue.ts`.
- `domain/content-type.ts`: `ContentType` union (`news|trade_publication|blog_post|press_release|social_post|newsletter|podcast|other`).
- `domain/exclusion.ts`: `ExclusionCode = own_channel|aggregator|ecommerce_review|out_of_window|duplicate`; `Exclusion = { code; detail: string|null }`.
- `domain/warning.ts`: `Warning = { message: string }`.
- `domain/window.ts`: `SearchWindow = { start: string; end: string }` (ISO date); `computeWindow(now: Date): SearchWindow` — end = `now` date-only UTC, start = end minus 36 months (`setUTCMonth(m-36)`).
- **Tests:** `job-status.spec.ts` (legal edges, illegal throws, terminality), `window.spec.ts` (a fixed date → expected start/end).

## Task 2 — Pure services (ported + tested)
- `domain/services/normalize.ts`: copy `main:src/filter/normalize.ts` verbatim (already pure: `normalizeHost/Url/Title/Handle`, `matchesHandlePrefix`). Port `main:src/filter/normalize.test.ts` → `normalize.spec.ts` (jest `describe/it`).
- `domain/services/heuristics.ts`: port `heuristicExclusion` + constants (`REVIEW_DOMAINS`, `ECOMMERCE_PATH_SEGMENTS`, `ECOMMERCE_TITLE_PATTERNS`, `AGGREGATOR_BLOCKLIST` — inline the blocklist here as domain data). Replace `ResultLike`/`ResolvedIdentity` imports with local domain types. Drop `applyHeuristics` (DB loop → Slice 6). Port the relevant pure tests from `main:src/filter/heuristics.test.ts`.
- `domain/services/collapse.ts`: PURE refactor of v1 `collapse` — signature `collapse(rows: CollapseInput[]): CollapseDecision[]` where `CollapseInput = {id,title,publishedDate:string|null}` and `CollapseDecision = {loserId, winnerId}`. Same algorithm (≥25 char titles, group by normalized title, 14-day anchor-on-earliest dated clustering, undated join rules). No DB. Port collapse tests as pure decision assertions.

## Task 3 — Entities & ports
- `domain/result.ts`: `Result` class — fields (id, jobId, url, normalizedUrl, title, sourceDomain, publishedDate, status, exclusion, contentType, confidence, sentiment); `exclude(code, detail)` sets status excluded (no-op/throws if already excluded? born included, exclude is idempotent-guarded). Factory `Result.create(...)`.
- `domain/job.ts`: `Job` class — fields (id, companyName, homepageUrl, status, window, provenance, warnings[], createdAt); `transitionTo(status)` via `assertTransition`; `addWarning(msg)`; getter `isTerminal`.
- `domain/resolved-identity.ts`: `ResolvedIdentity = { name; domains: string[]; handles: string[]; window: SearchWindow; provenance: 'url_provided'|'heuristic'|'llm'|'none'; negativeMatches: string[] }`.
- `domain/ports/clock.port.ts`: `interface Clock { now(): Date }` + token.
- `domain/ports/id-generator.port.ts`: `interface IdGenerator { next(): string }` + token.
- `domain/ports/job-repository.port.ts`: `interface JobRepository { save(job): Promise<void>; findById(id): Promise<Job|null>; }` + token.
- `domain/ports/result-repository.port.ts`: `interface ResultRepository { insertIfNew(result): Promise<boolean>; findIncludedByJob(jobId): Promise<Result[]>; markExcluded(id, exclusion): Promise<void>; }` + token.

## Task 4 — Persistence (Drizzle) + migration
- `infrastructure/persistence/schema.ts`: drizzle `jobs` (uuid pk, company_name, homepage_url, status, window_start, window_end, provenance, error, created_at), `results` (uuid pk, job_id fk, url, normalized_url, title, source_domain, published_date, status, exclusion_code, exclusion_detail, content_type, confidence, sentiment, created_at; `unique(job_id, normalized_url)`), `warnings` (uuid pk, job_id fk, message, created_at). Remove `app_meta` (replace the Slice-1 baseline schema).
- `infrastructure/clock.ts` (`SystemClock`), `infrastructure/id-generator.ts` (`UuidGenerator` via `randomUUID`).
- `infrastructure/persistence/job.repository.ts`, `result.repository.ts`: Drizzle adapters mapping rows ↔ entities; `insertIfNew` uses `onConflictDoNothing` on the unique key and returns whether a row was inserted.
- `jobs.module.ts`: provide ports → adapters (Clock, IdGenerator, JobRepository, ResultRepository), export them. Import into `CoreModule` or keep module-scoped (export from JobsModule; AppModule/WorkerModule import JobsModule).
- Run `pnpm db:generate` → new migration; `pnpm db:migrate` against live Postgres.

## Task 5 — Verify
- `grep -rE "@nestjs|drizzle|postgres" src/modules/jobs/domain` → no matches (domain purity).
- `pnpm test` (ported pure-logic suites green), `pnpm lint`, `tsc --noEmit`, `pnpm build`.
- Live: bring up compose Postgres, migrate, and a small throwaway script or repo test round-trips a Job + Result (insert, dedup conflict, mark excluded, fetch). Tear down.

## Self-review
Covers spec §2 (layout), §3 (all decisions), §4 (ported tests). No placeholders. Type names consistent: `Exclusion`, `CollapseDecision{loserId,winnerId}`, `ResolvedIdentity`, port tokens.
