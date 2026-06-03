# Breakbeat — Design Spec

**Date:** 2026-06-03
**Context:** 4-hour Head of Engineering technical exercise (see `head-of-engineering-technical-exercise.md`).
**Goal:** A pragmatic MVP web app that finds third-party content about a company from the last 36 months, demonstrating product judgement, architecture, retrieval strategy, background job design, deduplication, clear setup, and security/cost awareness.

## Key decisions

| Area | Decision |
|---|---|
| Retrieval | Tavily search API (single provider) |
| Filtering | Deterministic heuristics first, then one batched Claude Haiku classification pass |
| Web framework | Express |
| Persistence | SQLite via `node:sqlite` (built into Node 22+, zero deps) |
| Background jobs | In-process async queue with a job state machine |
| Status updates | Client polling every ~2s |

## 1. Smallest credible MVP

A single Express app that does exactly the brief and nothing more:

1. **One page**: input for company name and/or URL → "Start search" button.
2. **POST /api/jobs** creates a job row, kicks off the pipeline in-process, returns `jobId` immediately.
3. **Job pipeline** — each stage updates job status so the UI shows real progress:
   - **Resolve** — normalize company identity. If URL given, fetch homepage title/metadata to confirm name and capture own domains. If name only, use Tavily to find the homepage (needed for own-channel exclusion).
   - **Search** — ~6–8 parallel Tavily queries: per content type ("X press release", "X podcast interview", "X news"), with date filters for 36 months and `exclude_domains` for own site + aggregator blocklist.
   - **Filter (heuristics)** — drop own domains/subdomains, known aggregators (HN, Reddit, Slashdot…), URL-pattern ecommerce/review pages (`/product/`, `/vs/`, "best X alternatives" titles), out-of-window dates.
   - **Classify (LLM)** — one batched Claude Haiku call over surviving results (title+snippet+URL): assign content type, flag remaining exclusions, mark low-confidence items rather than silently dropping.
   - **Dedup** — exact URL dedup via DB unique constraint (after URL normalization: strip tracking params, trailing slashes), plus near-dup collapse on normalized title.
4. **GET /api/jobs/:id** for status polling (simple 2s polling — SSE is a nice-to-have, not needed).
5. **Results list** — grouped/filterable by content type, showing title, source domain, date, snippet, confidence flag, link. "Reviewable" means a human can scan and judge quickly.

That's the whole product. ~10 source files.

## 2. Main trade-offs

| Decision | Chose | Over | Why |
|---|---|---|---|
| Retrieval | Single API (Tavily) | Multi-provider | One key, clean results; multi-source is the obvious "next step" |
| Filtering | Heuristics → batched Haiku | LLM-per-result | ~$0.001/job vs ~$0.05+; deterministic rules handle 80%, LLM handles ambiguity |
| Jobs | In-process queue | Worker process / Redis queue | Local-only brief; the *interface* (job table + status machine) is what's portable to BullMQ later |
| Storage | SQLite (`node:sqlite`) | Postgres / in-memory | Zero setup for cloner; durable enough to demo dedup properly |
| Status | Polling | SSE/WebSockets | 20 lines vs 100; identical UX at this scale |
| Recall | ~8 queries, first page each | Exhaustive pagination/crawling | Cost ceiling per job (~10–15 Tavily credits); "as much as possible" bounded by a budget is the cost-aware reading |

## 3. Technical architecture

```
src/
  main.ts            # Express bootstrap, serves /public, mounts API
  routes/jobs.ts     # POST /api/jobs, GET /api/jobs/:id (+results)
  jobs/queue.ts      # tiny async queue, job state machine (pending→resolving→searching→filtering→classifying→done|failed)
  jobs/pipeline.ts   # orchestrates the 5 stages
  search/tavily.ts   # Tavily client + query strategy
  filter/heuristics.ts  # blocklists, URL/title rules, date window
  filter/classify.ts    # batched Anthropic call, validated output
  db.ts              # node:sqlite schema: jobs, results (UNIQUE on normalized_url per job)
public/index.html    # vanilla JS: form, status poller, results list
```

### Job state machine

`pending → resolving → searching → filtering → classifying → done | failed | done_with_warnings`

### Security & cost

- Keys only in `.env` (`.env.example` committed), never sent to the client.
- Per-job budget caps: max queries, max results to classify.
- Input validation on company name/URL.
- Outbound fetches limited to Tavily/Anthropic plus the one homepage fetch (SSRF guard: reject private IPs).

### Error handling

- Any stage failure → job `failed` with a human-readable message surfaced in the UI.
- Partial results kept: if search succeeded but classify failed, results are shown unclassified and the job is marked `done_with_warnings`.

### Testing

- Unit tests (`node --test`) on the pure logic — URL normalization, heuristics, dedup — not on the API clients.

## 4. Implementation plan (~4h budget)

| # | Slice | Time |
|---|---|---|
| 1 | Express skeleton + DB schema + job queue with fake pipeline → UI shows status end-to-end | 45m |
| 2 | Tavily integration + query strategy → real results in the list | 45m |
| 3 | Heuristic filters + URL normalization + dedup (with unit tests) | 45m |
| 4 | Haiku classification pass + confidence flags | 40m |
| 5 | UI polish: grouping, filters, status detail | 30m |
| 6 | README (setup), write-up (approach/trade-offs/next), transcript export | 35m |

Tracer-bullet ordering: after slice 1 the whole loop works with stub data; every later slice upgrades one stage.

## 5. Explicitly out of scope

Stated deliberately in the write-up:

- **Auth, hosting, CI/CD** (brief says so); rate limiting beyond per-job caps.
- **Multi-provider search**, podcast-specific APIs (Listen Notes), social APIs — Tavily's index surfaces major social/podcast content well enough; native APIs are the scaling step.
- **Full-page fetching/content extraction** — classify on title+snippet only; fetching every result is the biggest cost/latency lever and isn't needed for a reviewable list.
- **Entity disambiguation** beyond the homepage anchor (e.g., "Apple" the label vs the fruit company) — a known limitation with the homepage-domain trick as partial mitigation.
- **Job retries/concurrency control/queue durability across restart** — the state machine makes the upgrade path obvious.
- **Semantic dedup** (embedding similarity for syndicated articles) — normalized title collapse catches most syndication; embeddings are the next step.
