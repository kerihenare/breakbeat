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

## Slice 10 additions: Verify, Brand Context, and search backstop

**Verify stage.** A new pipeline stage runs between Filter and Classify (`verifying` Job status). It judges each still-included Result against the Resolved Identity's Brand Context on title, snippet, and URL — no Extract, no full-page fetch. High-confidence mismatch → Excluded as `off_topic` (`exclusion_detail = "LLM"`, same convention as the Classify backstop). Softer judgements stay included and are marked `verification_status = "uncertain"`, surfaced in the Clipping Desk as a quiet "may not be about this company" note. A clear match → `verified`. Unconfigured or missing brand context records a Warning and is a no-op; the stage never fails the Job. The `off_topic` code joins the closed Exclusion set; `verification_status` is nullable on every Result (NULL = Verify didn't run, not a stored "unverified" value).

**Brand Context.** BrandFetch now returns `description`, `industry`, and `aliases` alongside the identity data, composed from the Brand API profile (there is no separate Brand Context endpoint). These fields are stored on the Resolved Identity and consumed by both Verify and Classify. Absence — missing key or brand not found — records a Warning; the Job proceeds without them.

**Anthropic web-search backstop.** Search now runs Tavily queries in parallel with an Anthropic `web_search` tool pass: a few broad natural-language queries fire by default, and the full Angle Query set is added only when Tavily returns fewer than a configured hit threshold. One `ANTHROPIC_API_KEY` covers classification, verification, and this backstop — three signals, one key.

**Cost note.** The backstop fires 1–3 `web_search` tool calls under normal conditions and mirrors the full angle set only when Tavily is thin, so incremental cost is small in the typical case. The Verify stage adds one Claude Haiku pass over snippets per Result, capped at `VERIFY_CAP = 400` Results — comparable to a single Classify batch.

## Next steps

- Job cancellation + retry; boot-time sweep of interrupted jobs; resume from the last completed stage.
- A real sentiment pass.
- Semantic (embedding) dedup beyond exact-title Collapse.
- Result virtualization past the ~300-item ceiling.
- Auth + multi-tenant; CI/CD (out of scope for the local exercise).
- Reconcile this brand inheritance against Breakbeat's own shipped tokens (re-run `/impeccable document`).
