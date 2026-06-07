# Slice 4 — Resolve stage: Design Spec

**Bead:** `aglow-ti2.4` · **Date:** 2026-06-08 · Self-directed. Builds on Slices 1–3.

## 1. Purpose
Replace the stub Resolve with a real one built on **BrandFetch** + a **Google context** search:
1. **Brand Search** (sync, on submit) lets the user **pick the correct brand** when they gave a name without a URL (disambiguation). A URL short-circuits selection (the URL *is* the disambiguator, per PRODUCT.md).
2. **Brand API** (background Resolve) fetches the selected brand's profile → **Resolved Identity** (name, own domains, social handles).
3. **Google search** `"{name}" "{domain}" -site:{domain}` gathers extra company context.
4. **Brand Search** for similarly-named companies → **negative matches** (stored on the identity for Search/Classify to suppress false positives).
Search/Filter/Classify stay stubbed (Slices 5–7).

## 2. Submit flow (sync disambiguation)
- `GET /` — form: company name + optional homepage URL.
- `POST /jobs`:
  - **URL given** → no selection needed: create Job with the URL's host as the chosen domain, enqueue.
  - **Name only** → call Brand Search; render a **candidate list** (name · domain · logo) via HTMX into the form area; the user picks one.
  - **Name only, BrandFetch unavailable / no key / no candidates** → proceed degraded (create Job, name-only), record the choice as “no domain”.
- `POST /jobs/select` — user picks a candidate `{ companyName, domain }` → create Job with that domain, enqueue. (Plain-form fallback works without JS: the candidate list is a set of submit buttons.)

## 3. Resolve stage (background, replaces stub)
`ResolveStage.run(job)`:
1. Determine the chosen domain (from job.homepageUrl host, or the selected candidate domain stored on the job; may be null for degraded name-only).
2. If a domain exists → **Brand API**(domain) → profile: collect own domain(s) + social handle URLs (`links` of type twitter/linkedin/…). On failure → Warning, degrade.
3. **Google context**: run `"{name}" "{domain}" -site:{domain}` → keep the top snippet titles/URLs as lightweight context (stored as a short context note for the Classify prompt later; not a hard dependency). On failure → Warning.
4. **Negative matches**: Brand Search(name) again → other candidates whose domain ≠ chosen → their names/domains become `negativeMatches`. On failure → Warning (empty list).
5. Build `ResolvedIdentity { name, domains, handles, window, provenance, negativeMatches }` and **persist** it on the Job; set `provenance` (`url_provided` if URL/selection had a domain, else `none`); record a Warning when degraded (“no homepage identified — own-channel exclusion is LLM-only”).

## 4. Ports & adapters (hexagonal)
```
domain/ports/brand-directory.port.ts   # search(query)->BrandCandidate[]; fetchProfile(domain)->BrandProfile|null
domain/ports/web-context.port.ts        # search(query, limit)->ContextHit[]
domain/resolve/resolve-stage.ts         # pure-ish orchestration (ports injected)
infrastructure/brandfetch/brandfetch-client.ts  # Brand Search + Brand API (zod-validated), degrade w/o key
infrastructure/google/google-context.ts          # Custom Search JSON API (zod-validated), degrade w/o key
```
- **BrandFetch**: Search `GET https://api.brandfetch.io/v2/search/{q}?c={CLIENT_ID}`; Brand `GET https://api.brandfetch.io/v2/brands/{domain}` with `Authorization: Bearer {API_KEY}`. Responses zod-parsed; network/parse errors → caught, surfaced as a degraded result (never throw out of the stage). No key → the adapter reports “unconfigured” so the stage degrades with a Warning.
- **Google context**: Custom Search JSON API `GET https://www.googleapis.com/customsearch/v1?key={GOOGLE_API_KEY}&cx={GOOGLE_CX}&q=...`. Same degrade-without-key behaviour. New optional env: `GOOGLE_API_KEY`, `GOOGLE_CX`.

## 5. Persistence
Add to `jobs`: `chosen_domain text`, `resolved_domains jsonb`, `resolved_handles jsonb`, `negative_matches jsonb`, `context_note text` (all nullable). A migration adds them. `JobRepository.save/findById` round-trip the resolved identity; a `JobRepository.setChosenDomain` (or carry it in `save`) persists the selection. The `Job` entity gains an optional `resolvedIdentity` it can hold + `attachResolvedIdentity(...)`.

## 6. Decisions
1. **Selection only for name-only input.** A URL is the disambiguator; selection UI would be noise when the domain is known. BrandFetch-down degrades to name-only — never blocks submission.
2. **External data is zod-validated** at the adapter boundary (typescript-guidelines); unknown shapes/network errors degrade to a Warning, never crash the Job. Result quality > availability of any single signal.
3. **Per-stage replacement:** `PipelineService` now calls a real `ResolveStage`; Search/Filter/Classify remain stub methods on the service until their slices. Stages get a small common shape so each later slice swaps one in.
4. **Negative matches modelled already** (Slice 2) — now populated; consumed in Slices 5/7.
5. **Google context is best-effort enrichment**, not a gate; stored as a short note for the future Classify prompt.
6. **Secrets** (`BRANDFETCH_*`, `GOOGLE_*`) never reach the client; SSRF/again-not-applicable (we call known API hosts only).

## 7. Testing
- BrandFetch client: zod parse of a sample Search + Brand response; degrade (no key → unconfigured; HTTP error → caught). Google client similarly.
- `ResolveStage`: with mocked ports — happy path (domain → identity with domains/handles/negatives), degraded (no domain → Warning, provenance `none`), partial failures (Brand API throws → Warning, proceeds).
- Persistence round-trip of resolved identity (live Postgres acceptance).

## 8. Acceptance
- Name-only submit shows brand candidates (or degrades cleanly); URL submit skips selection.
- Resolve populates domains/handles/negativeMatches when keys present; without keys the Job still completes with explanatory Warnings.
- Pipeline runs real Resolve then stub Search/Filter/Classify to a terminal state. lint+tests+build green; degraded path live-verified (no keys → Warning, completes). **Live BrandFetch/Google verification requires keys — reported honestly.**

## 9. Out of scope
Real Search/Filter/Classify (5–7), Clipping Desk UI (8). The homepage HTML scrape fallback from v1 (handles via raw HTML) is **superseded** by BrandFetch profile links; a name-only no-BrandFetch job resolves degraded (LLM backstop owns own-channel then).
