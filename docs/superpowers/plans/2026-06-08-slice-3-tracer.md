# Slice 3 — Tracer bullet: Implementation Plan

> Builds on Slices 1–2. Spec: `docs/superpowers/specs/2026-06-08-slice-3-tracer-design.md`.

**Goal:** submit → BullMQ → worker stub stages → SSE status → grouped results, end-to-end.

## Task 1 — Deps + view renderer + static HTMX
- Add deps: `@nestjs/bullmq`, `bullmq`, `nunjucks`; dev `@types/nunjucks`, `htmx.org`.
- Vendor HTMX + its SSE ext to `public/` (copy from `node_modules/htmx.org/dist/htmx.min.js` and `ext/sse.js`); serve `public/` via `app.useStaticAssets` in `main.ts`.
- `src/shared/view/view-renderer.ts`: `@Injectable ViewRenderer` wrapping `nunjucks.Environment` (FileSystemLoader `views/`, autoescape true) with `render(name, ctx): string`. `ViewModule` (global) provides it.
- `views/`: `layout.njk`, `home.njk`, `job.njk`, `_job_live.njk`, `_job_pane.njk`, `_result_group.njk`, `_result_row.njk`, `_recent_row.njk`, `404.njk`. Minimal markup; fixed content-type section order.

## Task 2 — Ports + repo addition
- `domain/ports/job-queue.port.ts`: `JOB_QUEUE` token + `interface JobQueue { enqueue(jobId: string): Promise<void> }`.
- `domain/ports/job-events.port.ts`: `JOB_EVENTS` token + `interface JobEvents { publish(jobId: string): Promise<void>; subscribe(jobId: string, onEvent: () => void): Promise<() => Promise<void>> }`.
- `JobRepository.listRecent(limit: number): Promise<Job[]>` (+ Drizzle impl: order by created_at desc).

## Task 3 — Adapters
- `infrastructure/queue/bullmq-job-queue.ts`: `BullmqJobQueue` implements `JobQueue` via `@InjectQueue("pipeline")`; `enqueue` adds `{ jobId }`.
- `infrastructure/events/redis-job-events.ts`: `RedisJobEvents` implements `JobEvents`; `publish` → `redis.publish("job:"+id, "1")`; `subscribe` → `redis.duplicate()`, `subscribe`, `on("message")`; returns an unsubscribe that quits the duplicate. Inject `REDIS`.

## Task 4 — Application
- `application/submit-job.use-case.ts`: `SubmitJob.execute({ companyName, homepageUrl })` → validate, `new Job(id.next(), name, url, computeWindow(clock.now()), clock.now())`, `jobRepo.save`, `queue.enqueue(id)`, return job.
- `application/pipeline.service.ts`: `PipelineService.run(jobId)` (worker side) — load job; for each stub stage: `transitionTo`, `jobRepo.save`, insert fake Results (via ResultRepository, normalizeUrl), `jobEvents.publish`, short `await delay`. Finalize → publish. Catch → `transitionTo("failed", msg)`, save, publish. Fake dataset: ~10 included across content types + 2 excluded (own_channel, aggregator) + 1 unclassified.

## Task 5 — Interface
- `interface/view-model.ts`: `buildJobView(job, results)` → `{ job, counts:{returned,excluded,classified}, groups: [{type,label,items}], excluded: [{code,label,items}] }` in fixed order; empty groups omitted.
- `interface/jobs.controller.ts`: `GET /` (home: form + `listRecent`), `POST /jobs` (SubmitJob; PRG 303 or HTMX fragment + OOB rail row), `GET /jobs/:id` (full page or `_job_pane` fragment on `HX-Request`). Use `ViewRenderer`.
- `interface/job-events.controller.ts`: `GET /jobs/:id/events` — `@Res() res`; set SSE headers; subscribe via `JobEvents`; on event reload job+results, write `event: message` + `data:` lines of the rendered `_job_pane`; when terminal write `event: done` then end; `req.on("close")` → unsubscribe.

## Task 6 — Wiring
- `JobsModule`: `BullModule.registerQueue({ name: "pipeline" })` + `BullModule.forRootAsync` (Redis connection from config) ; providers: SubmitJob, ViewModel, JobQueue→Bullmq, JobEvents→Redis, controllers. Export nothing new.
- `WorkerModule`: import JobsModule pieces needed + register the `@Processor("pipeline")` `PipelineProcessor` that calls `PipelineService.run(job.data.jobId)`. The processor is provided ONLY here.
- `infrastructure/queue/pipeline.processor.ts`: `@Processor("pipeline")` extends `WorkerHost`, `process(job)` → `pipeline.run(job.data.jobId)`.
- BullMQ needs Redis connection config in both processes — `BullModule.forRootAsync` using `REDIS_URL`.

## Task 7 — Verify (live)
- `docker compose up` (app + worker + infra). Submit a company at `/`; watch the pane assemble via SSE to `done`; refresh + deep-link; recent jobs shows it. lint + test + build green. Tear down.

## Self-review
Covers spec §2–§6 + §8b resolutions. Types: `JobQueue.enqueue`, `JobEvents.publish/subscribe`, `buildJobView`. SSE uses manual writes + `sse-close="done"`. ViewRenderer renders to strings.
