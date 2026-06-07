# Breakbeat (aglow) — Re-architecture Write-up

**Approach, trade-offs, and next steps for the re-platformed Breakbeat.**

## What changed and why

The v1 Breakbeat was a deliberately minimal single-process Express + `node:sqlite` + Nunjucks/HTMX-polling app — the right call for the original time-boxed exercise. The `aglow` re-architecture keeps v1's domain model and product intent verbatim (see `CONTEXT.md`, `PRODUCT.md`) and re-platforms it onto a **production-shaped stack** to demonstrate real background-job architecture, a clean hexagonal seam, and a richer resolution/search pipeline.

**Stack:** NestJS (HTTP + BullMQ worker) · BullMQ + Redis · Postgres (Drizzle/postgres.js) · Server-Sent Events · HTMX + Lit + Tailwind v4 · Bugsink (errors) + VictoriaLogs (logs) · Docker Compose. **Styles:** DDD, Hexagonal (ports/adapters), Vertical-Slice.

**Pipeline change:** Resolve now uses **BrandFetch** (Brand Search disambiguation + Brand API profile), a **Google** context search, and BrandFetch-derived **negative matches**, instead of v1's Tavily-heuristic homepage cascade + HTML scrape. Classify now pulls page content with **Tavily Extract** before the Haiku pass, instead of classifying on snippet alone.

## How it was built

Nine **tracer-bullet vertical slices** under epic `aglow-ti2`, each through one disciplined loop:

> spec (Superpowers) → self-grill (`/grill-me`) → plan (Superpowers) → self-grill → implement (TDD) → CodeRabbit until no blocking issues → PR → merge.

1. **Foundation** — Docker Compose, NestJS HTTP+worker, typed config, pino→VictoriaLogs, Sentry→Bugsink, health, migrations.
2. **Domain core** — framework-free Job/Result/Resolved-Identity/Exclusion/Warning/Collapse + ports + Postgres adapters; ported v1 pure logic with tests.
3. **Tracer bullet** — submit → BullMQ → worker (stub stages) → SSE status → grouped results.
4. **Resolve** — BrandFetch identity + brand selection + Google context + negative matches.
5. **Search** — Tavily 18-query strategy + insert-time dedup.
6. **Filter + Collapse** — heuristic Exclusions + title Collapse.
7. **Extract + Classify** — Tavily Extract + Claude Haiku.
8. **The Clipping Desk UI** — Tailwind v4 brand, split layout, Lit components, mocked sentiment.
9. **Deliverables** — this write-up, README, transcript, doc reconciliation.

Each slice's spec and plan are in `docs/superpowers/`; each is a reviewable PR.

## Key decisions & trade-offs

- **Compile, not type-strip.** NestJS needs decorators + DI, so the v1 "erasable syntax only" rule is retired (reconciled in `CLAUDE.md`). Cost: a build step; benefit: the framework's idioms and a real port/adapter structure.
- **Graceful degradation everywhere.** Every external service (BrandFetch, Tavily, Google, Anthropic, VictoriaLogs, Bugsink) sits behind a port and degrades to a **Warning** when its key is absent — the reviewable list is the Job's purpose, so a partial signal still ships. A keyless clone boots and runs end-to-end.
- **DB is the source of truth; pub/sub is a nudge.** SSE re-reads job state on each Redis event, so a missed message self-heals on the next event or page reload — domain state is never serialised through the channel.
- **Snippet/extract quality is classification quality.** We spend on Tavily `advanced` + Extract because the classifier reads text, not pages; classify failure is a Warning (results stay unclassified), never a Job failure.
- **Validate external data at the boundary.** DB text columns and API responses are parsed/zod-validated before entering the domain — no unchecked `as`.
- **Sentiment is mocked** — deterministic, isolated in one helper, removable without disturbing the layout; a real pass is a drop-in.
- **Honest verification.** Where live API keys were unavailable, the degraded paths were verified and reported as such; the UI was confirmed with Playwright screenshots; nothing was claimed as passing without evidence.

## Next steps

- Job cancellation + retry; boot-time sweep of interrupted jobs; resume from the last completed stage.
- A real sentiment pass.
- Semantic (embedding) dedup beyond exact-title Collapse.
- Result virtualization past the ~300-item ceiling.
- Auth + multi-tenant; CI/CD (out of scope for the local exercise).
- Reconcile this brand inheritance against Breakbeat's own shipped tokens (re-run `/impeccable document`).
