# Slice 4 — Resolve stage: Implementation Plan

> Builds on Slices 1–3. Spec: `docs/superpowers/specs/2026-06-08-slice-4-resolve-design.md`.

## Task 1 — Config + schema
- `env.schema.ts`: add optional `GOOGLE_API_KEY`, `GOOGLE_CX` (+ to OPTIONAL_INTEGRATIONS, `.env.example`).
- `schema.ts`: add nullable `chosenDomain text`, `resolvedDomains jsonb`, `resolvedHandles jsonb`, `negativeMatches jsonb`, `contextNote text` to `jobs`. `pnpm db:generate` (non-interactive — single new migration, no rename prompt).

## Task 2 — Domain
- `Job`: add `chosenDomain: string | null` (constructor state) + `resolvedIdentity: ResolvedIdentity | null` + `attachResolvedIdentity(ri)`. `findById`/`save` round-trip the new columns.
- `domain/ports/brand-directory.port.ts`: `BrandCandidate {name, domain, iconUrl?}`, `BrandProfile {name, domain, handles: string[]}`; `interface BrandDirectory { search(query): Promise<BrandCandidate[]>; fetchProfile(domain): Promise<BrandProfile | null>; isConfigured(): boolean }` + token.
- `domain/ports/web-context.port.ts`: `ContextHit {title, url}`; `interface WebContext { search(query, limit): Promise<ContextHit[]>; isConfigured(): boolean }` + token.

## Task 3 — Adapters (zod-validated, degrade w/o key)
- `infrastructure/brandfetch/brandfetch-client.ts`: `BrandfetchClient implements BrandDirectory`. `search` → `GET /v2/search/{q}?c={clientId}`; `fetchProfile` → `GET /v2/brands/{domain}` Bearer apiKey; zod schemas; try/catch → `[]`/`null`; `isConfigured` = keys present. Handles = profile `links` whose `name` ∈ {twitter,linkedin,facebook,instagram,youtube,github}.
- `infrastructure/google/google-context.ts`: `GoogleContext implements WebContext` via Custom Search JSON API; zod; degrade.

## Task 4 — ResolveStage (application)
- `application/resolve-stage.ts`: `ResolveStage.run(job): Promise<void>` (ports: BrandDirectory, WebContext, JobRepository). Compute domain (`job.chosenDomain ?? host(job.homepageUrl)`); if domain → `fetchProfile` (handles/domains) else degrade+Warning; Google `"{name}" "{domain}" -site:{domain}` → contextNote (best-effort, Warning on fail); `search(name)` → negativeMatches (candidates with domain ≠ chosen); build + `attachResolvedIdentity`; set provenance; `jobRepo.save`. Never throws (stage failures → Warnings).

## Task 5 — Pipeline refactor + submit flow
- `pipeline.service.ts`: replace stub `resolving` step with `await this.resolve.run(job)` then reload; keep stub search/filter/classify. (Inject ResolveStage.)
- `SubmitJob`: accept optional `chosenDomain`; persist on Job.
- `jobs.controller.ts`: `POST /jobs` — if URL given → submit (chosenDomain = host(url)); else if name only → `brandDirectory.search(name)` and render `_brand_candidates.njk` (degrade → submit directly). Add `POST /jobs/select` → submit with `{companyName, chosenDomain}`. New partial `_brand_candidates.njk` (form buttons posting to /jobs/select).

## Task 6 — Wiring + tests
- `jobs.module.ts`: bind `BRAND_DIRECTORY`→BrandfetchClient, `WEB_CONTEXT`→GoogleContext; provide ResolveStage; inject ResolveStage into PipelineService.
- Tests: brandfetch zod parse + degrade; google parse + degrade; ResolveStage happy/degraded/partial (mocked ports).

## Task 7 — Verify
- lint/tsc/test/build. Live (no keys): submit name-only → degrades to name-only job + Warning, completes; URL submit → resolve uses host, completes. Persisted identity round-trips. Report that live BrandFetch/Google needs keys.
