# Breakbeat

Breakbeat finds third-party content about a company from the **last 36 months** and presents it as a reviewable, classified list. Give it a company name and/or homepage URL; a background job resolves the brand, searches the web, filters noise, and classifies what's left — you watch the coverage assemble live and review it grouped by type, every item carrying its source.

## How it works

A submitted company becomes a **Job** that moves through a state machine, run by a background worker:

1. **Resolve** — disambiguate the brand with **BrandFetch** (Brand Search lets you pick the right company when you gave only a name; a URL skips that), fetch its profile (own domains + social handles) via the **Brand API**, gather extra context with a **Google** search, and capture similarly-named brands as **negative matches**.
2. **Search** — fan out 18 **Tavily** queries (per-content-type + time-sliced news/PR + angle queries) built from the resolved identity, excluding own channels, aggregators, and the negative-match domains. Exact-duplicate URLs collapse at insert.
3. **Filter** — deterministic soft Exclusions (own channel / aggregator / ecommerce-review / out-of-window), then Collapse near-duplicate titles to the earliest copy.
4. **Classify** — **Tavily Extract** pulls page content per surviving result, then **Claude Haiku** (structured outputs) assigns a Content Type and backstops missed exclusions.

The page streams status over **Server-Sent Events**; results render grouped by editorial weight with a collapsed excluded audit section. Nothing is deleted — exclusion is a soft, reasoned transition you can inspect.

## Architecture

- **NestJS** with two processes — HTTP app + BullMQ **worker** — over one module graph.
- **BullMQ + Redis** for the background Job queue; cross-process status via Redis pub/sub feeding SSE.
- **Postgres** (Drizzle / postgres.js) for Jobs + Results; insert-time URL dedup via a unique constraint.
- **HTMX** for the primary flows + **Lit** Web Components for the richer widgets (status chip, filter tabs, sentiment gauge), on a **Tailwind v4** theme inherited from the Drumbeat brand ("The Clipping Desk").
- **Bugsink** (errors, Sentry-protocol) + **VictoriaLogs** (structured logs).
- **Docker Compose** dev environment.
- **Domain-Driven Design**, **Hexagonal** (ports/adapters), **Vertical-Slice** organisation: the domain layer is framework-free; external services sit behind ports and **degrade gracefully** when their API key is absent.

## Local development

### Prerequisites
- Node 24+ (`.nvmrc` targets 26) with `pnpm` via `corepack enable`
- Docker + Docker Compose

### Run everything in Docker
```bash
cp .env.example .env          # boots fine even with the API keys left blank
docker compose up             # postgres, redis, victorialogs, bugsink, app, worker
```
The `app` container runs migrations then serves http://localhost:3000; `worker` processes the pipeline.

### Fast inner loop (services in Docker, app on host)
```bash
cp .env.example .env
docker compose up -d postgres redis victorialogs bugsink
pnpm install
pnpm build:client             # Tailwind + Lit bundle → public/
pnpm db:migrate
pnpm dev                      # HTTP app (rebuilds client + server on change)
pnpm worker                   # worker (separate terminal)
```

### API keys (optional — the app degrades without them)
Set in `.env`: `BRANDFETCH_API_KEY` + `BRANDFETCH_CLIENT_ID` (resolve), `TAVILY_API_KEY` (search + extract), `ANTHROPIC_API_KEY` (classify), `GOOGLE_API_KEY` + `GOOGLE_CX` (context). Each missing key records a Warning and disables just that signal — the Job still completes.

### Error reporting (Bugsink)
Open http://localhost:8000 (log in `admin@example.com` / `admin`), create a project, copy its DSN into `SENTRY_DSN`, restart the app.

### See it without keys
```bash
curl -i localhost:3000/demo   # seeds a finished fixture Job → redirects to its page
```

### Verify
```bash
pnpm test            # unit tests, no network
pnpm lint            # Biome
curl localhost:3000/health
curl "http://localhost:9428/select/logsql/query" --data-urlencode 'query=service:breakbeat' --data-urlencode 'limit=5'
```

## Approach

This re-architecture was executed agent-assisted as **nine tracer-bullet vertical slices** (epic `aglow-ti2`), each taken through the same disciplined loop: **spec** (Superpowers brainstorming) → self-**grill** (`/grill-me`, every branch resolved) → **plan** (Superpowers writing-plans) → self-grill → **implement** (TDD on the pure logic) → **CodeRabbit** review until no blocking issues → **PR**. Specs and plans live in [`docs/superpowers/`](docs/superpowers/); each slice is a reviewable PR against the `the-aglow-problem` integration branch. Every external integration was built behind a port with a graceful-degradation path, and each slice was verified live (against Docker) before merge.

## Trade-offs

- **Production-shaped stack over the v1 minimalism.** The brief is local-only, but the new stack (NestJS, queue, Postgres, observability) demonstrates real background-job architecture and a clean port/adapter seam; the cost is more moving parts than a single-file app.
- **Graceful degradation over hard requirements.** No API key fails softly with a Warning rather than blocking the Job — the reviewable list is the product, so a partial signal still ships.
- **Snippet/extract quality is classification quality.** We spend on Tavily `advanced` + Extract because the classifier reads text, not pages.
- **Sentiment is mocked** (deterministic, isolated) — a real pass swaps in without touching the UI.

## Next steps

- Job cancellation + retry; resume from the last completed stage after a restart.
- A real sentiment pass (currently mocked for the gauge).
- Semantic dedup (embeddings) beyond exact-title Collapse.
- Result virtualization past the ~300-item plain-list ceiling.
- Auth + multi-tenant (out of scope for the local exercise).

## Docs

- [`docs/0-brief.md`](docs/0-brief.md) — original exercise brief
- [`docs/aglow-writeup.md`](docs/aglow-writeup.md) — re-architecture write-up (approach, trade-offs, next steps)
- [`docs/aglow-transcript.md`](docs/aglow-transcript.md) — agent-assisted execution transcript
- [`docs/superpowers/`](docs/superpowers/) — per-slice specs and plans
- [`CONTEXT.md`](CONTEXT.md) — domain glossary (Job, Result, Resolved Identity, Exclusion, Collapse, …)
- [`PRODUCT.md`](PRODUCT.md) · [`DESIGN.md`](DESIGN.md) · [`DESIGN-BRIEF.md`](DESIGN-BRIEF.md) — product & design system

> The v1 spec/plan ([`docs/1-spec.md`](docs/1-spec.md), [`docs/2-plan.md`](docs/2-plan.md)) describe the original Express/SQLite implementation, superseded by this re-architecture.
