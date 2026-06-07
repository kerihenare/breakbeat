# Slice 2 — Domain core + persistence: Design Spec

**Bead:** `aglow-ti2.2` (epic `aglow-ti2`)
**Date:** 2026-06-08
**Authoring mode:** Self-directed (user delegated all decisions). Builds on the Slice 1 foundation; conventions there are assumed.

## 1. Purpose
Establish the **framework-free domain layer** for the CONTEXT.md model (Job, Result, Resolved Identity, Exclusion, Warning, Content Type, Collapse), with **ports** (repositories, clock, id) owned by the domain and **Postgres adapters** behind them, plus migrations. Port the v1 pure logic (URL/title normalisation, the job state machine, heuristic exclusion, Collapse) — refactored to be **pure** (no DB) — with their tests. No HTTP/queue/pipeline wiring (those are Slices 3–7).

## 2. Where it lives
A `jobs` bounded-context module is the core. Job is the aggregate root; Result belongs to a Job. Pure domain services (normalisation, heuristics, collapse, window, state machine) live in `jobs/domain` and are imported by later pipeline slices.

```
src/modules/jobs/
  domain/
    job.ts                 # Job entity + factory; holds status, window, provenance, warnings
    job-status.ts          # status union, TERMINAL_STATES, LEGAL_EDGES, isTerminal/canTransition/assertTransition
    result.ts              # Result entity; born `included`, soft Exclusion is the only transition
    exclusion.ts           # ExclusionCode closed set + Exclusion value object
    content-type.ts        # ContentType union (+ 'other'); null = unclassified at terminal
    resolved-identity.ts   # VO: name, domains[], handles[], window, provenance, negativeMatches[]
    warning.ts             # Warning value object
    window.ts              # SearchWindow VO + computeWindow(now) → 36 months back, date-only UTC
    services/
      normalize.ts         # normalizeHost/Url/Title/Handle + matchesHandlePrefix (ported verbatim — already pure)
      heuristics.ts        # heuristicExclusion(result, identity, windowStart) + blocklists (pure; DB loop removed)
      collapse.ts          # collapse(rows) → CollapseDecision[] (pure refactor; returns winner/loser, no DB)
    ports/
      job-repository.port.ts
      result-repository.port.ts
      clock.port.ts
      id-generator.port.ts
  infrastructure/
    persistence/
      schema.ts            # drizzle: jobs, results, warnings (replaces the app_meta baseline)
      job.repository.ts    # drizzle adapter → JobRepository
      result.repository.ts # drizzle adapter → ResultRepository
    clock.ts               # system Clock adapter
    id-generator.ts        # randomUUID adapter
  jobs.module.ts           # binds ports → adapters
```

## 3. Decisions
1. **Pure-first refactor.** v1's `applyHeuristics`/`collapse`/`transition` mixed logic with SQLite. The domain keeps only the **pure** core: `heuristicExclusion(result, identity, windowStart) → Exclusion | null`, `collapse(rows) → CollapseDecision[]`, `assertTransition(from, to)`. The DB read/write loops become adapter/application concerns in Slices 6. This is the hexagonal payoff and is fully unit-testable.
2. **Identifiers.** Job and Result use **UUID** primary keys (public-safe for URLs/SSE, queue-friendly). The Collapse duplicate detail stores the winner's `resultId`; the cosmetic "#N" from CONTEXT.md is a UI concern (Slice 8).
3. **Soft Exclusion.** Result is born `included`; Exclusion (`{code, detail}`) is the only status transition. Closed code set: `own_channel | aggregator | ecommerce_review | out_of_window | duplicate`. `content_type` is nullable (null = unclassified).
4. **State machine** is a pure table (`LEGAL_EDGES`, `TERMINAL_STATES`) ported from v1; `assertTransition` throws on illegal edges. The Job entity exposes `transitionTo(status)` using it; persistence is the repo's job.
5. **Ports & adapters.** `JobRepository`/`ResultRepository` interfaces in domain; Drizzle/postgres.js adapters in infrastructure mapping rows ↔ domain objects (no ORM types leak into domain). `Clock` and `IdGenerator` ports make window/id deterministic in tests.
6. **Schema.** New `jobs`, `results`, `warnings` tables via a Drizzle migration that also drops the Slice-1 `app_meta` baseline. `results` carries `UNIQUE(job_id, normalized_url)` (insert-time URL dedup, used in Slice 5) and the soft-exclusion columns. `sentiment` column included (nullable) for the mocked UI gauge (Slice 8).
7. **Negative matches** (similarly-named companies from BrandFetch, Slice 4) are modelled on `ResolvedIdentity.negativeMatches: string[]` now (populated later), so Search/Classify can consume them without a model change.

## 4. Testing (TDD, ported)
Port v1 tests as domain unit tests, adapted to the pure signatures: URL normalisation (tracking-param stripping, sort, trailing slash), title normalisation + outlet-suffix stripping (the `Acme - The Real Story` and TechCrunch/Yahoo cases), `matchesHandlePrefix` boundaries, state-machine legal/illegal edges + terminality, `heuristicExclusion` codes (own_channel/aggregator/ecommerce_review/out_of_window, dateless kept), Collapse guards (≥25 chars, 14-day anchor-on-earliest, undated join rules). Repository adapters are exercised against the live Postgres in the acceptance run, not unit tests.

## 5. Acceptance
- Domain layer imports nothing from `@nestjs/*`, drizzle, or postgres (verified by inspection/grep).
- Migration creates `jobs`/`results`/`warnings`, drops `app_meta`; `pnpm db:migrate` applies cleanly.
- Repos round-trip a Job + Results against live Postgres (insert, fetch, soft-exclude, dedup constraint rejects duplicate normalized_url).
- All ported pure-logic tests pass; lint + typecheck + build green.

## 6. Out of scope (owning slice)
Pipeline orchestration / applying heuristics+collapse to stored rows (Slice 6); search insert (Slice 5); resolve/BrandFetch population of identity (Slice 4); HTTP/SSE/UI (Slices 3, 8).
