# Slice 6 — Filter + Collapse: Design Spec & Plan

**Bead:** `aglow-ti2.6` · **Date:** 2026-06-08 · Self-directed. Builds on 1–5.

## Purpose
Replace the no-op Filter transition with a real `FilterStage` that applies the **pure domain logic already written in Slice 2** — `heuristicExclusion` then `collapse` — to the stored Results, persisting soft Exclusions. No new domain logic; this is orchestration + wiring.

## FilterStage (application)
`FilterStage.run(job)`:
1. `windowStart = new Date(job.window.start)`; `identity = job.resolvedIdentity ?? { name: job.companyName, domains: [], handles: [], window: job.window, provenance: "none", negativeMatches: [] }` (so aggregator/ecommerce/out-of-window still apply even if Resolve degraded).
2. Heuristics: `findIncludedByJob`; for each, `heuristicExclusion({url,title,sourceDomain,publishedDate}, identity, windowStart)`; if non-null → `markExcluded(id, exclusion)`.
3. Collapse: reload `findIncludedByJob` (heuristics changed the set); `collapse(rows.map(r=>({id,title,publishedDate})))` → decisions; for each, `markExcluded(loserId, {code:"duplicate", detail:"of #"+winnerId})`.

Order matters (heuristics before collapse, collapse over still-included only) — exactly the v1/CONTEXT.md contract. Idempotent-ish: an already-excluded row isn't returned by `findIncludedByJob`, so it never competes in Collapse.

## Pipeline
Replace the `filtering` no-op with `await this.filter.run(job)` (save+publish around it). Classify stays no-op (Slice 7).

## Decisions
1. **Reuse Slice-2 pure logic** (`heuristicExclusion`, `collapse`) verbatim — already unit-tested; this slice only persists their decisions.
2. **Degraded identity fallback** so Filter still does useful work when Resolve found no domains.
3. **Collapse detail** = `of #<winnerId>` (UUID); the cosmetic "#N" is a Slice-8 UI concern.

## Testing
`filter-stage.spec.ts` (mocked `ResultRepository`): heuristic exclusion marks an own-domain/aggregator/out-of-window row; a duplicate-title pair collapses to one (loser marked `duplicate`); dateless/short titles handled (delegates to the tested pure fns — assert the orchestration calls `markExcluded` with the right codes).

## Acceptance
Pipeline runs Resolve→Search→**Filter**→(noop Classify)→terminal; heuristics + collapse persist exclusions. lint+tests+build green; live-verified that a job completes with the Filter stage active (own-channel/aggregator rows excluded when present).

## Out of scope
Extract + Classify (Slice 7), UI (8).
