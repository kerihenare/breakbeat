# Slice 1 — Foundation: Design Spec

**Bead:** `aglow-ti2.1` (epic `aglow-ti2`)
**Date:** 2026-06-07
**Status:** Draft for self-grill
**Authoring mode:** Self-directed (user delegated all decisions: "Do not ask me any questions — I trust your choices"). The user-review gate is satisfied by the `/grill-me` self-grill + assessment that follows this spec.

---

## 1. Purpose

Stand up the **walking-skeleton infrastructure** for the re-architected Breakbeat: a NestJS application (HTTP + worker process model) running against a Docker Compose dev environment (Postgres, Redis, Bugsink, VictoriaLogs), with typed config, structured logging shipped to VictoriaLogs, error reporting to Bugsink, a health endpoint, and lint/test tooling.

This slice ships **no domain behaviour** — no Jobs, no pipeline, no UI beyond health/debug. It proves the rails the other eight slices stand on: *clone → set `.env` → `docker compose up` → the app boots, connects to Postgres + Redis, logs land in VictoriaLogs, and a thrown error lands in Bugsink.*

It is the first tracer bullet's runway, not the bullet.

## 2. Goals / Non-goals

**Goals**
- `docker compose up` brings up Postgres, Redis, Bugsink, VictoriaLogs, and the app + worker.
- The NestJS app boots, validates config, and verifies live connections to Postgres and Redis.
- Structured logs are emitted to stdout **and** shipped to VictoriaLogs.
- Unhandled errors (and a dev-only `/debug/error`) are captured by Bugsink via the Sentry SDK.
- `GET /health` returns liveness + Postgres/Redis readiness.
- Hexagonal + vertical-slice directory conventions are established and documented for later slices.
- Migration tooling exists and runs (baseline migration), so Slice 2 only adds schema.
- Biome lint/format + a test runner are wired; lint + the foundation's tests pass.
- A keyless clone still **boots** (external API keys are warn-not-fatal; infra has compose defaults).

**Non-goals (deferred, with owning slice)**
- Domain model, entities, repositories for Jobs/Results → **Slice 2**.
- Submit flow, BullMQ queue + worker *processor*, SSE, results page → **Slice 3** (Slice 1 wires the BullMQ *connection* and a worker bootstrap, but registers no real queues/jobs).
- BrandFetch / Tavily / Anthropic clients → **Slices 4–7**.
- Any UI styling / Tailwind / Lit → **Slice 8**.
- Auth, hosting, CI/CD (out of scope for the whole project).

## 3. Decisions & rationale

Each decision lists the approaches considered and the chosen option. These are the points the self-grill will pressure-test.

### 3.1 Process model — single codebase, two bootstraps
**Approaches:** (a) one Nest app that also hosts the BullMQ processor in-process; (b) NestJS monorepo (`apps/api`, `apps/worker`, `libs/*`); (c) one codebase, **two entrypoints** — `main.ts` (HTTP) and `worker.ts` (a Nest *application context*, no HTTP listener) — sharing one module graph.
**Chosen: (c).** It models the real split (web dyno vs worker dyno) the brief's "background job" intent wants, keeps deploy/runtime honest (the worker can't accidentally serve HTTP, the API can't accidentally process jobs unless we register it to), and avoids monorepo tooling overhead for a single-team local exercise. (a) blurs the boundary the whole point of BullMQ is to draw; (b) is more ceremony than a local exercise warrants. Compose runs `app` and `worker` as two services off one image.

**Slice-1 scope of the worker (self-grill #4):** `worker.ts` is included now but **minimal** — it boots a Nest application context, connects to Redis, logs "worker started", and registers **no** processors. The two-process compose shape and the Dockerfile's dual command are foundation concerns (cheap now, awkward to retrofit); real processors arrive in Slice 3. The worker has no HTTP health probe in Slice 1 (compose observes process liveness + the started log line).

### 3.2 Architecture — Hexagonal + Vertical Slice + DDD
- **Vertical slices** are NestJS modules under `src/modules/<slice>`. Slice 1 creates only `health` (and a dev-only `debug`).
- Each slice follows a **hexagonal** internal shape:
  ```
  modules/<slice>/
    domain/          # entities, value objects, PORT interfaces, pure logic — zero framework imports
    application/     # use-cases / command + query handlers (orchestration)
    infrastructure/  # ADAPTERS: postgres repos, bullmq, http clients (implement domain ports)
    interface/       # delivery: controllers, SSE, view rendering
    <slice>.module.ts
  ```
- **Shared kernel** under `src/shared/`: `config/`, `observability/` (logging + error reporting), `database/` (connection + migration infra), and `domain/` (base `Entity`/`ValueObject`/`Result`/`DomainEvent` primitives). Ports are owned by the slice that needs them; only genuinely cross-cutting primitives live in `shared/domain`.
- **Dependency rule (enforced by convention + an import-boundary lint where practical):** `domain` imports nothing from `application`/`infrastructure`/`interface`; adapters depend inward on domain ports.

### 3.3 Runtime & build — compile to CommonJS, drop "erasable syntax only"
**Context:** v1 ran TypeScript natively via type-stripping, which forbids `enum`, `namespace`, and **constructor parameter properties**. NestJS is built on decorators + DI that depend on `emitDecoratorMetadata` and constructor parameter properties — type-stripping cannot run it.
**Decision:** Adopt a real build. `tsconfig` targets **CommonJS** (`module: commonjs`, `moduleResolution: node`, `experimentalDecorators`, `emitDecoratorMetadata`, `strict`). Dev uses `nest start --watch`; there is no prod build requirement for this exercise. `package.json` drops `"type": "module"`.
**Consequence:** The CLAUDE.md "erasable syntax only / `node:sqlite` / Express / Nunjucks / HTMX-polling" stack notes are **superseded** by the user's new stack instruction; doc reconciliation is owned by **Slice 9**. The `.nvmrc` Node 26 pin stays.

### 3.4 Config — `@nestjs/config` + Zod validation, fail-soft on API keys
A single Zod schema validates `process.env` at boot, exposed through a typed config accessor (no stringly-typed `get('FOO')`). **Infra** vars (`DATABASE_URL`, `REDIS_URL`, `VICTORIALOGS_URL`, `PORT`, `NODE_ENV`) have compose-aligned defaults and are required-with-default. **External API keys** (`ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `BRANDFETCH_API_KEY`, `BRANDFETCH_CLIENT_ID`) and `SENTRY_DSN` are **optional**: absence logs a named warning at boot and disables the dependent feature, so a keyless clone still boots (the brief grades "clone → add keys → run"). `.env` is loaded by Nest's config (and by Docker Compose `env_file`); `.env.example` is the committed template.

### 3.5 Persistence driver & migrations — Drizzle + postgres.js, infrastructure-only
**Approaches:** Prisma (schema-centric, fights hexagonal), TypeORM (active-record/decorator leakage into domain), raw `pg` + node-pg-migrate (max purity, hand-mapped), Kysely/Drizzle (typed, SQL-first).
**Chosen: Drizzle ORM + drizzle-kit migrations over the `postgres` (postgres.js) driver**, confined to `src/shared/database` and slice `infrastructure/`. It keeps the domain ORM-free (repositories are adapters mapping rows ↔ domain objects), gives typed SQL + a real migration workflow, and is light. Slice 1 ships the connection module, drizzle config, and a **minimal viable baseline migration** (a `schema_migrations` marker table) whose job is to **prove the migration pipeline itself** — the rail Slice 2's real `jobs`/`results` schema stands on. `db:migrate`, `db:generate`, and `db:reset` scripts exist.

**Migration application (self-grill #2):** migrations are applied **explicitly**, never silently inside Nest bootstrap. The container entrypoint runs `pnpm db:migrate` (idempotent) *before* starting the app; host devs run it themselves. This keeps schema changes an observable, intentional step.

### 3.6 Logging — `nestjs-pino` to stdout (source of truth) + a fail-open VictoriaLogs shipper
Structured JSON logging via **`nestjs-pino`** (pino). **stdout JSON is the source of truth** (dev-readable, container-native); the VictoriaLogs delivery is an *attached* pino transport, not the primary sink — so swapping to a collector sidecar later (the production-shaped alternative, documented in the README) is non-breaking. When `VICTORIALOGS_URL` is set, the transport ships newline-delimited JSON to VictoriaLogs' JSON-line ingestion endpoint (`POST {url}/insert/jsonline` with `_stream_fields`, `_msg_field=msg`, `_time_field=time`; exact query params verified against current VictoriaLogs docs at implementation). The shipper is **fail-open**: a transport error never blocks a request or crashes the app, but it surfaces a single throttled stderr warning (it does **not** silently swallow ship failures). Each log line carries a correlation/request id.

### 3.7 Error reporting — Sentry SDK pointed at Bugsink
Bugsink is Sentry-protocol-compatible. Use **`@sentry/nestjs`** (+ `@sentry/node`) initialised with `SENTRY_DSN` = the Bugsink project DSN. The Nest Sentry integration installs a global exception filter so unhandled errors report automatically. With no DSN the SDK is a **no-op** (keyless clone safe). The DSN isn't known until a Bugsink project is created; the README documents: open Bugsink → log in → create project → copy DSN into `.env`. A dev-only `GET /debug/error` (guarded to non-production) throws to verify capture end-to-end.

### 3.8 Health — `@nestjs/terminus`
`GET /health` uses Terminus to report liveness plus **readiness** checks pinging Postgres and Redis. This is the acceptance probe for "app connects to Postgres + Redis" and the compose healthcheck target for the `app` service.

### 3.9 Tooling — Biome + Jest, pnpm
- **Biome** (already a dep) for lint+format; the NestJS scaffold's ESLint+Prettier are removed in favour of it (project mandate).
- **Jest** via `@nestjs/testing` for tests — the lowest-friction, best-supported runner for Nest's decorator/DI testing (chosen over node:test and Vitest to avoid decorator-metadata config rabbit-holes in the foundation; a Vitest swap is a documented later option). Foundation tests cover: config validation (valid/invalid/keyless-warn), the health controller via the Nest testing module, and the VictoriaLogs shipper's fail-open behaviour.
- pnpm scripts: `dev` (HTTP, watch), `worker` (worker, watch), `build`, `start`, `test`, `test:watch`, `lint`, `lint:fix`, `db:migrate`, `db:generate`, `db:reset`, `compose:up`, `compose:down`.

### 3.10 Docker Compose topology
Services (all on one bridge network, named volumes for state):
| Service | Image | Port | Notes |
|---|---|---|---|
| `postgres` | `postgres:17-alpine` | 5432 | `POSTGRES_*` env; volume; `pg_isready` healthcheck |
| `redis` | `redis:7-alpine` | 6379 | `redis-cli ping` healthcheck |
| `victorialogs` | `victoriametrics/victoria-logs` | 9428 | volume; ingestion + query HTTP API |
| `bugsink` | `bugsink/bugsink` | 8000 | `SECRET_KEY`, superuser bootstrap, SQLite+volume by default (Postgres optional); exact env verified at implementation |
| `app` | built from `Dockerfile` (Node 26 + corepack/pnpm) | `${PORT}` | `pnpm dev`; bind-mount for hot reload; `depends_on` postgres+redis healthy |
| `worker` | same image | — | `pnpm worker`; same `depends_on` |

`app`/`worker` containerise dev to honour "Docker compose development environment"; the README also documents the **infra-only** alternative (a compose profile for backing services + `pnpm dev`/`pnpm worker` on the host) for fastest inner-loop iteration. Bugsink uses its **own SQLite volume** (its default), deliberately *not* our Postgres, so a third-party tool's schema never couples to our migrations (self-grill #5).

**Dual-context env URLs (self-grill #1):** `.env.example` ships **host-oriented** defaults (`DATABASE_URL=…@localhost:5432`, `REDIS_URL=…@localhost:6379`, `VICTORIALOGS_URL=http://localhost:9428`) so the recommended host inner-loop (`pnpm dev`) works out of the box. Compose then **overrides** the connection URLs per-service via `environment:` (service-name hosts: `postgres`, `redis`, `victorialogs`), so containers get correct values regardless of `.env`. One `.env`, correct in both run modes.

## 4. Boot data flow

1. Process starts (`main.ts` for `app`, `worker.ts` for `worker`).
2. Config module loads `.env` + env, validates via Zod. Missing infra var with no default → **fatal, friendly message**; missing API key/DSN → **warn + disable feature**.
3. Logger (pino) initialises; VictoriaLogs transport attaches if `VICTORIALOGS_URL` set.
4. Sentry initialises if `SENTRY_DSN` set (else no-op).
5. Migrations are applied **before** the process starts (container entrypoint / host `pnpm db:migrate`), then the Database module opens the postgres.js pool. Nest bootstrap does not migrate silently.
6. `app`: Nest HTTP server listens on `PORT`; Terminus health wired. `worker`: Nest application context starts (no HTTP), ready to register processors in Slice 3.
7. A structured "service started" log line is emitted (and shipped to VictoriaLogs).

## 5. Error handling
- **Config failure** (missing required infra var, malformed `DATABASE_URL`): log a single clear message naming the variable and exit non-zero. No stack-trace wall for a setup error.
- **Backing service unreachable at boot** (Postgres/Redis): retry with bounded backoff, then fail with a message naming the unreachable service and its expected URL. Health endpoint reports `down` for the specific dependency rather than 500-ing.
- **Observability degradation is never fatal:** VictoriaLogs unreachable → stdout logging continues + one warning; Bugsink unreachable / DSN unset → app runs, errors still surface in logs.
- **Unhandled exceptions / rejections:** captured by the Sentry global filter (reported to Bugsink when configured) and logged.

## 6. Testing
- `config`: valid env parses; invalid/missing required infra var throws with the variable named; absent API key produces a warning, not a throw.
- `health`: controller returns the expected shape; readiness reflects mocked up/down dependencies.
- `observability`: the VictoriaLogs shipper batches and POSTs expected payload shape; on transport error it does not throw and emits exactly one throttled warning.
- No tests against live external APIs. Live Postgres/Redis/Bugsink/VictoriaLogs wiring is verified by the **acceptance checklist** (§7), not unit tests.

## 7. Acceptance verification (maps to the bead)
1. `docker compose up` → all five infra/app services reach healthy/running.
2. App log shows config validated + "service started"; the same line is queryable in VictoriaLogs (`/select/logsql/query`).
3. `GET /health` → 200 with Postgres + Redis `up`.
4. `GET /debug/error` (dev) → 500; the error appears in the Bugsink project.
5. `pnpm lint` and `pnpm test` pass.
6. Removing the API keys from `.env` and rebooting still boots (warnings, no crash).

> **Verification honesty (self-grill #7):** items 1–4 require a running Docker daemon. At implementation, `docker compose up` is attempted; if the environment cannot run Docker, everything host-checkable (build, lint, tests, config validation, app boot) is verified and the live-service checks are reported as **manually verified or deferred** — never claimed as passing without evidence.

## 8. Risks & mitigations
- **Bugsink/VictoriaLogs exact env vars & ingestion paths** drift between versions → confirm against current docs (context7/official) during planning/implementation; the design depends only on their *protocols* (Sentry DSN; JSON-line ingest), which are stable.
- **NestJS + ESM friction** → mitigated by choosing CommonJS up front.
- **Containerised dev hot-reload on macOS bind mounts** can be slow → infra-only compose profile + host `pnpm dev` documented as the fast path.
- **Drizzle migration ergonomics** are light in Slice 1 (baseline only); real exercise comes in Slice 2.

## 9. Out of scope for this slice
Everything in §2 Non-goals. Notably: no real queue/processor logic, no domain types, no external API calls, no styled UI. The debug error endpoint is a temporary verification aid and may be removed or guarded further in a later slice.
