# Slice 3 — Tracer bullet: Design Spec

**Bead:** `aglow-ti2.3` · **Date:** 2026-06-08 · Self-directed. Builds on Slices 1–2.

## 1. Purpose
Prove the rails end-to-end with **stub** pipeline stages: submit a company → create a Job (Slice-2 domain) → enqueue a **BullMQ** job → a **worker** process advances it through stub Resolve/Search/Filter/Classify (fake Results + stage progress) → the page streams live status via **Server-Sent Events** (HTMX-driven; full-page reload is the no-JS fallback) → the reviewable list renders grouped by Content Type with a collapsed excluded audit section. No real external calls (Slices 4–7 replace the stubs).

## 2. Flows & routes (`JobsController`, HTTP process)
- `GET /` — home: submit form (company name and/or homepage URL) + recent-jobs list.
- `POST /jobs` — validate input (name or URL required; URL parseable `https?:`), build a `Job` (status `pending`, `computeWindow(clock.now())`) via `SubmitJob` use-case, persist, **enqueue** to the `pipeline` queue. PRG: non-HTMX → 303 to `/jobs/:id`; HTMX → return the running `job-pane` fragment (and OOB-prepend the rail row).
- `GET /jobs/:id` — full job page (deep-linkable, refresh-safe) or the `job-pane` fragment when `HX-Request` present. Renders current persisted state.
- `GET /jobs/:id/events` — **SSE** stream: emits the re-rendered `job-pane` fragment on each stage transition; closes on terminal state.

## 3. Background job (worker process)
- `@nestjs/bullmq` queue **`pipeline`**; producer (enqueue) in the HTTP process, `@Processor` in the worker process (registered only in `WorkerModule`).
- Stub `PipelineService.run(jobId)`: load Job, transition `pending→resolving→searching→filtering→classifying`, inserting fake Results along the way (a believable spread across content types + a couple of heuristic-excluded rows), then `finalize()` (→ `done`). Small delays between stages so the live UI visibly assembles. Uncaught error → `transitionTo('failed', msg)`.
- After each transition, **publish** a `job:<id>` event so the HTTP SSE endpoint can react across processes.

## 4. Cross-process status — Redis pub/sub
A `JobEvents` port: `publish(jobId)` (worker) and `subscribe(jobId, handler) → unsubscribe` (HTTP SSE). Adapter uses a dedicated ioredis subscriber connection (`redis.duplicate()`); channel `job:<id>`. The SSE handler, on each event, reloads the Job + Results and writes the rendered `job-pane` fragment; on terminal status it sends a final frame and ends the response. (DB is the source of truth; pub/sub is only the nudge.)

## 5. Rendering — Nunjucks (autoescape on)
- View engine: Nunjucks configured in `main.ts` (`nunjucks.configure(viewsDir, { autoescape: true, express: app })`), templates under top-level `views/` (loaded from `process.cwd()/views`, so it works under both `pnpm dev` and `node dist`). Autoescape is the XSS guarantee for untrusted Result titles; `| safe` is the only (greppable) opt-out.
- Templates: `layout.njk`, `home.njk` (form + `recent-jobs`), `job.njk` (full page wrapping `job-pane`), partials `_job_pane.njk` (header: identified-as, status, window, count triad; grouped results; collapsed excluded `<details>`), `_result_group.njk`, `_result_row.njk`, `_recent_jobs.njk`. Fixed Content-Type section order by editorial weight (News → Trade → Press → Podcast → Blog → Newsletter → Social → Other → Unclassified). Minimal styling now; Slice 8 applies the Clipping Desk brand.
- HTMX vendored to `public/` (served static) — no CDN. SSE via HTMX `sse` extension (`hx-ext="sse" sse-connect=".../events" sse-swap="message"`), target `#job-pane`.

## 6. Module shape (vertical slice + hexagonal)
```
src/modules/jobs/
  application/submit-job.use-case.ts        # build+persist+enqueue
  application/pipeline.service.ts           # STUB stage orchestration (worker)
  domain/ports/job-queue.port.ts            # enqueue(jobId)
  domain/ports/job-events.port.ts           # publish/subscribe
  infrastructure/queue/bullmq-job-queue.ts  # producer adapter
  infrastructure/queue/pipeline.processor.ts# @Processor (worker only)
  infrastructure/events/redis-job-events.ts # pub/sub adapter
  interface/jobs.controller.ts              # GET / , POST /jobs, GET /jobs/:id
  interface/job-events.controller.ts        # GET /jobs/:id/events (SSE)
  interface/view-model.ts                   # Job+Results → grouped template view-model
```
`JobsModule` registers the `pipeline` queue + producer + controllers + view-model; the `@Processor` is provided only in `WorkerModule` (so the API never processes jobs). Recent-jobs needs a `JobRepository.listRecent(limit)` addition.

## 7. Decisions
1. **DB is source of truth; pub/sub is a nudge.** SSE re-reads state on each event, so a missed message self-heals on the next event / page reload. Avoids serialising domain state through the channel.
2. **SSE over polling** (stack directive) but the page is fully functional without JS (GET renders current state; refresh = manual poll). HTMX SSE swaps fragments; on terminal the stream ends.
3. **Stub stages live in `application/pipeline.service.ts`** as one service now; Slices 4–7 replace each stage with a real implementation behind the same orchestration.
4. **Recent jobs** is a simple `listRecent` query (no pagination yet).
5. **Validation**: name-or-URL required, URL must parse with an `https?:` scheme; everything escapes on render.

## 8. Acceptance
- Submitting a company creates a Job, enqueues it, the worker advances it through stub stages to `done`, and the page streams status via SSE and ends on terminal.
- Grouped stub results render (incl. a collapsed excluded section); refresh and deep-link to `/jobs/:id` work; the new job appears in recent jobs.
- `docker compose up` runs app + worker + infra; lint + tests + build green. Live run verified (submit → watch → done).

## 8b. Self-grill resolutions
- **SSE terminal close:** HTMX `sse` ext with `sse-swap="message"` + **`sse-close="done"`** — the server sends `message` frames (rendered `job-pane` fragment) per transition and a final `done` event at terminal, so HTMX closes the source instead of reconnecting forever.
- **Manual SSE writes:** the events endpoint writes raw SSE on the Express `Res` (headers `text/event-stream`; each fragment split into `data:` lines per the SSE spec), subscribes to `job:<id>`, and unsubscribes on `req.on("close")`.
- **`ViewRenderer` provider:** one Nunjucks `Environment` (autoescape on, `FileSystemLoader` at `views/`) exposing `render(name, ctx): string`; controllers and SSE both render to strings (no `setViewEngine`).

## 9. Out of scope
Real Resolve/Search/Filter/Classify (Slices 4–7), BrandFetch selection UI (Slice 4), Clipping Desk styling + Lit components + sentiment gauge (Slice 8). Job cancellation, retries, auth.
