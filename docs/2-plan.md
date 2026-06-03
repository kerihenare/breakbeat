# Breakbeat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local-only Express web app that runs a background Job pipeline (Resolve → Search → Filter → Classify) finding third-party content about a company from the last 36 months, presented as a reviewable, deduplicated list.

**Architecture:** Single Node.js v26 process: Express + Nunjucks (autoescape) serve HTML; HTMX load-polling re-renders a job fragment every 2s; an in-process FIFO queue (concurrency 1) drives a job state machine persisted in SQLite (`node:sqlite`). Retrieval is ~18 parallel Tavily queries; filtering is deterministic heuristics + title Collapse, then one batched Claude Haiku classification pass with structured outputs. Source of truth for all behaviour: `docs/1-spec.md`; domain language: `CONTEXT.md` (Job, Result, Exclusion, Collapse, Own Channel, Warning — use these terms exactly in code, comments, and tests).

**Tech Stack:** Node v26 native TS (erasable syntax only — no `enum`/`namespace`/ctor param properties), Express, Nunjucks, HTMX (vendored), `node:sqlite`, `@tavily/core`, `@anthropic-ai/sdk`, Biome, pnpm, `node --test`.

---

## Design summary

These sections condense `docs/1-spec.md` into the decisions the tasks below implement. Where this plan and the spec disagree, the spec wins.

### Stack choice

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js v26, native type stripping | No build step; `.nvmrc` pins it. Erasable TS syntax only |
| Web | Express + Nunjucks (`autoescape: true`) | Boring, conventional; escaping is the engine default, `\| safe` is the greppable opt-out |
| Live status | HTMX load-polling (every 2s, `hx-swap="outerHTML"`) | Stop-condition lives server-side in the template; no client JS state |
| Persistence | SQLite via `node:sqlite`, WAL mode | Zero deps, zero setup; WAL lets the poll read while the pipeline writes |
| Jobs | In-process async FIFO queue, concurrency 1 | Local-only brief; the job table + state machine is the portable interface |
| Search | Tavily, `search_depth: "advanced"` everywhere | Classify sees only title+snippet, so snippet quality *is* classification quality |
| Classification | One batched Claude Haiku pass, structured outputs | Heuristics handle the clear-cut 80%; LLM reserved for genuine ambiguity |
| Env | `node --env-file-if-exists=.env` | No dotenv; keyless clone still boots to a friendly error |

### App structure

```
src/
  main.ts                    # Express bootstrap, Nunjucks config, env check, serves /public, mounts routes
  db.ts                      # node:sqlite open + pragmas + CREATE TABLE IF NOT EXISTS (no migrations)
  routes/jobs.ts             # GET / (list+form), POST / (create job, 303), GET /:id (page or fragment)
  views/
    layout.njk               # page chrome
    index.njk                # jobs list + new-job form
    job.njk                  # full job page (wraps the fragment)
    _job.njk                 # the self-replacing HTMX fragment: status header + results
  jobs/
    queue.ts                 # FIFO queue + job state machine (transition())
    queue.test.ts
    pipeline.ts              # orchestrates Resolve → Search → Filter → Classify
    resolve.ts               # identity resolution: homepage fetch (SSRF-guarded), handle scrape, cascade
    resolve.test.ts
  search/
    tavily.ts                # @tavily/core client + the ~18-query strategy + insert-time URL dedup
    tavily.test.ts           # query-strategy shape only (no API calls in tests)
  filter/
    normalize.ts             # normalizeUrl (dedup key) + normalizeTitle (Collapse key)
    normalize.test.ts
    heuristics.ts            # blocklists, exclusion rules, date window, Collapse
    heuristics.test.ts
    classify.ts              # batched Haiku structured-output calls + ID sanity layer
public/
  htmx.min.js                # vendored from node_modules, committed — no CDN
data/                        # gitignored; breakbeat.db created at boot
```

API clients (`tavily.ts`, `classify.ts`, the fetch in `resolve.ts`) are deliberately untested per the spec; everything pure has co-located tests.

### Data model

Four tables, created idempotently at boot. No migrations (deliberate — `pnpm db:reset` deletes the file).

```sql
CREATE TABLE IF NOT EXISTS companies (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,                  -- raw input, trimmed (display label)
  url         TEXT,                           -- raw input URL as given
  url_host    TEXT,                           -- normalized host — the identity key when present
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id             INTEGER NOT NULL REFERENCES companies(id),
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending','resolving','searching','filtering','classifying',
     'done','failed','done_with_warnings')),
  window_start           TEXT,                -- date-only UTC; computed ONCE at Resolve
  window_end             TEXT,
  resolved_name          TEXT,
  resolved_domains       TEXT NOT NULL DEFAULT '[]',  -- JSON array of hosts
  resolved_handles       TEXT NOT NULL DEFAULT '[]',  -- JSON array of profile-URL prefixes
  resolution_provenance  TEXT CHECK (resolution_provenance IN
    ('url_provided','heuristic','llm','none')),
  error                  TEXT,                -- human-readable; set when status = failed
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS warnings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     INTEGER NOT NULL REFERENCES jobs(id),
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS results (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id           INTEGER NOT NULL REFERENCES jobs(id),
  url              TEXT NOT NULL,             -- original URL; what the UI links to
  normalized_url   TEXT NOT NULL,             -- the dedup key (rules in filter/normalize.ts)
  title            TEXT NOT NULL,
  snippet          TEXT,
  source_domain    TEXT NOT NULL,
  published_date   TEXT,                      -- nullable → "date unknown" badge
  status           TEXT NOT NULL DEFAULT 'included' CHECK (status IN ('included','excluded')),
  exclusion_code   TEXT CHECK (exclusion_code IN
    ('own_channel','aggregator','ecommerce_review','out_of_window','duplicate','llm_excluded')),
  exclusion_detail TEXT,                      -- "of #42", "LLM", …
  content_type     TEXT CHECK (content_type IN
    ('news','trade_publication','blog_post','press_release',
     'social_post','newsletter','podcast','other')),  -- nullable: unclassified ≠ other
  confidence       TEXT CHECK (confidence IN ('high','low')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (job_id, normalized_url)             -- exact-URL dedup IS this constraint
);
```

Key invariants (from CONTEXT.md): Results are born `included`; Exclusion is the only transition and is soft (never a delete); `content_type` stays NULL on classify failure (never defaulted to `other`); the 36-month window is computed once at Resolve and read everywhere else.

### Background job approach

- `POST /` inserts a `pending` job row and enqueues its id; an in-process FIFO (concurrency 1) runs the pipeline one job at a time. The jobs list makes the queue visible (a `pending` job behind a running one).
- The state machine `pending → resolving → searching → filtering → classifying → done | failed | done_with_warnings` lives in `jobs/queue.ts` as a general `transition(jobId, toState, message?)` that validates legal transitions and writes the row — the shape the spec wants so the future boot-sweep and cancel button slot in without pipeline changes.
- The queue takes the pipeline runner by injection (registered in `main.ts`) so `queue.ts` stays dependency-free and testable; a throwing runner never kills the queue.
- Uncaught pipeline error → `transition(id, 'failed', message)`. Terminal state is `done_with_warnings` iff the job's warning list is non-empty.
- Known, accepted gap (spec §5): a job mid-flight at process exit stays in its running state forever. Named in the write-up, not fixed.

### Search / retrieval strategy

~18 Tavily queries per job, all `search_depth: "advanced"`, `max_results: 20`, all with `exclude_domains` = own domains + aggregator blocklist, fired concurrently via `Promise.allSettled`:

1. **Per content type (7)** — one query per brief category ("X news", "X press release", "X podcast interview", …), 36-month window.
2. **Time-sliced (6)** — news and press releases only, one query per 12-month `start_date`/`end_date` slice; counters recency bias where dates are reliable. Never applied to dateless types.
3. **Angle queries (5)** — "X funding", "X acquisition", "X leadership interview", "X partnership", "X lawsuit OR controversy". Overlap is absorbed by URL dedup.

Tavily params: news-ish queries (type-queries for news/press release + all six slices) use `topic: "news"` (reliable `published_date`, real `start_date`/`end_date`); everything else `topic: "general"` + `time_range: "3y"` best-effort. Per-job caps (named constants, one place): max 20 queries, 20 results each, classify cap 400 in chunks of 50.

### Result filtering rules

Funnel order (cheap → expensive), all via soft Exclusion with a closed code set:

1. **Insert-time URL dedup** — the `UNIQUE(job_id, normalized_url)` constraint; not a stage.
2. **Heuristics** (`filter/heuristics.ts`): own domains/subdomains and own social-profile URL prefixes → `own_channel`; aggregator blocklist (`news.ycombinator.com`, `reddit.com`, `slashdot.org`, `lobste.rs`, `digg.com`, `flipboard.com`, `feedly.com`, `news.google.com`, `apple.news` — Medium deliberately NOT listed) → `aggregator`; review domains (`g2.com`, `capterra.com`, `trustpilot.com`, `trustradius.com`, `getapp.com`, `softwareadvice.com`, `producthunt.com`), ecommerce path segments (`/product/`, `/products/`, `/shop/`, `/store/`, `/buy/`, `/pricing/`, `/vs/`, `/compare/`, `/alternatives/`), and anchored title regexes (`^best .* (alternatives|tools|software)`, `(review|comparison) of`, `^top \d+`) → `ecommerce_review` (`vs` is a path pattern only, never a title match); published date before `window_start` → `out_of_window`. **Dateless Results are kept and flagged**, never Excluded.
3. **Collapse** (tail of Filter, still-`included` Results only): group by normalized title (≥25 chars after normalization); winner = earliest published date, falling back to first-seen; losers → `duplicate`, detail "of #N". Only collapse when published dates are ≤14 days apart (or unknown).
4. **Classify backstop** (Haiku): catches what heuristics can't see — Own Channels missed by the scrape, title-`vs` comparisons, judgement-call review pages. Writes the same exclusion-code vocabulary, `exclusion_detail = 'LLM'`.

### Deduplication strategy

Two distinct mechanisms, two pinned normalizations (`filter/normalize.ts`):

- **normalizeUrl** (exact-URL dedup key, per job): lowercase host, strip `www.`, drop scheme, strip fragment, strip only known tracking params (`utm_*`, `fbclid`, `gclid`, `mc_cid`, `ref`, `source`) keeping everything else, sort remaining params, strip trailing slash, preserve path case.
- **normalizeTitle** (Collapse key): NFKC → outlet-suffix strip (trailing ` | X` / ` – X` / ` - X`, final separator only, remainder ≥25 chars and segment ≤40) → lowercase → strip punctuation → collapse whitespace → exact match.

### Status lifecycle

`pending → resolving → searching → filtering → classifying → done | failed | done_with_warnings`

Every stage transition updates the job row; the HTMX fragment re-renders it every 2s with per-stage counters ("47 fetched · 12 excluded · 31 classified" — one `GROUP BY`). When the job reaches a terminal state the server renders the fragment *without* polling attributes and polling stops naturally.

### Error handling

**Degraded-stage principle:** partial completion → Warning row + continue; total stage failure → job `failed` with a human-readable message in the UI.

| Event | Outcome |
|---|---|
| Some Tavily queries fail | Warning "14/18 queries succeeded" |
| All Tavily queries fail | Job `failed` |
| No homepage resolved (name-only) | Warning; proceed degraded — zero domains/handles, Classify carries own-channel alone |
| LLM-assisted resolution | Warning "homepage identified with low confidence — verify" |
| Classify call errors | Warning; affected Results shown unclassified (`content_type` NULL) |
| Homepage fetch hangs/oversized | 5s timeout / 1MB cap → treated as unresolved (degraded path) |
| Missing API key at boot | Friendly named-key message + clean exit, not a stack trace |

### Setup instructions (what the README must say)

```bash
nvm use                       # Node v26 (.nvmrc)
pnpm install
cp .env.example .env          # then set ANTHROPIC_API_KEY + TAVILY_API_KEY
pnpm dev                      # http://localhost:3000
pnpm test                     # unit tests, no network
pnpm db:reset                 # fresh demo
```

### Risks and trade-offs

| Risk / trade-off | Mitigation / acceptance |
|---|---|
| Tavily SDK params drift from spec assumptions | Verify against the SDK at integration time (Task 9); params are named constants in one file |
| Anthropic structured-outputs flag unavailable in SDK | Fallback pinned in spec: prompt-requested JSON + parse + validate + one retry |
| Wrong company resolved (name-only input) | Provenance surfaced in status line + low-confidence Warning; per-job caps bound the damage; form hints "provide the URL" |
| Prompt injection via hostile snippets | Structured outputs, closed enums, no free-text echo field, no tool use; worst case = self-misclassification, visible via soft Exclusion |
| SSRF via the one homepage fetch | Private/loopback/link-local IP rejection, redirect cap 3 re-checking each hop, 5s/1MB caps, `https?:` only; DNS-rebinding named-and-skipped |
| Process restart orphans a running job | Accepted (spec §5); boot-time sweep is the named next step |
| Cost: ~36 Tavily credits + ~4–6 Haiku calls per job | ≈27 free-tier jobs/month; caps are constants, downgrade is one line |
| Recency bias in search ranking | Time-sliced news/PR queries; an early cut under time pressure |
| FIFO-1 queue: slow job blocks the queue | Visible in jobs list as `pending`; liveness guards (timeouts) bound each stage |

**If time runs short, cut in spec §4 order:** social handle scraping → time-sliced queries → Resolve LLM fallback → per-hop redirect re-checking (set cap to 0) → slice-5 polish.

---

## Tasks

Tracer-bullet ordering (spec §4): after Task 6 the whole loop works end-to-end with a fake pipeline; every later task upgrades one stage. Conventions for all tasks: TDD (failing test → minimal implementation → green → commit); local imports use explicit `.ts` extensions (Node type stripping requires them); tests are co-located, use `node:test` + `node:assert/strict`, never touch the network, and use `createDb(":memory:")` when they need a DB; run `pnpm lint:fix` before every commit; erasable TS syntax only.

### Slice 1 — skeleton: UI shows status end-to-end with a fake pipeline

#### Task 1: Dependencies, vendored HTMX, gitignore

**Files:** modify `package.json` (via pnpm), create `public/htmx.min.js`, verify `.gitignore`.

- [ ] `pnpm add express nunjucks @tavily/core @anthropic-ai/sdk htmx.org` and `pnpm add -D @types/express @types/nunjucks`
- [ ] Copy `node_modules/htmx.org/dist/htmx.min.js` → `public/htmx.min.js` and commit it (no CDN; clone → run stays self-contained)
- [ ] Verify `data/` is gitignored and `public/htmx.min.js` is not (`git check-ignore`)
- [ ] Commit: `chore: add runtime deps, vendor htmx`

#### Task 2: Database schema (`src/db.ts`)

**Files:** create `src/db.ts`, `src/db.test.ts`.

- [ ] Write failing tests covering: a Result is born `included`; `normalized_url` is unique per job but the same URL may exist across jobs; `exclusion_code`/`status`/`content_type` CHECK constraints reject values outside the closed sets; a new job starts `pending`
- [ ] Implement: `createDb(path)` factory (opens DB, sets `journal_mode = WAL` + `foreign_keys = ON`, runs the idempotent schema from the Data model section) and a lazy `getDb()` singleton that creates `data/` and opens `data/breakbeat.db`. The factory exists so tests run against `":memory:"`
- [ ] `pnpm test` green
- [ ] Commit: `feat: sqlite schema — jobs, results (soft exclusion), warnings`

#### Task 3: Job state machine + FIFO queue (`src/jobs/queue.ts`)

**Files:** create `src/jobs/queue.ts`, `src/jobs/queue.test.ts`.

- [ ] Write failing tests covering: legal transitions walk the full pipeline; illegal jumps throw and leave status untouched; `failed` is reachable from every non-terminal state and stores the human-readable message on the job row; terminal states accept no further transitions; `addWarning` appends to the job's warning list; the queue runs jobs strictly FIFO with concurrency 1 (job 2 waits for job 1); a throwing runner doesn't kill the queue (job 3 still runs)
- [ ] Implement: `transition(db, jobId, toState, message?)` validating against a legal-edges table; `addWarning(db, jobId, message)`; `TERMINAL_STATES` constant; `createQueue(run)` returning `{ enqueue(jobId) }` — runner injected so the module stays dependency-free
- [ ] `pnpm test` green
- [ ] Commit: `feat: job state machine + in-process FIFO queue`

#### Task 4: Fake pipeline (`src/jobs/pipeline.ts`)

**Files:** create `src/jobs/pipeline.ts` (stub version — no test; it's throwaway scaffolding replaced by Tasks 10/13/15).

- [ ] Implement `runPipeline(db, jobId)`: walk all four stage transitions with a ~1.5s `setTimeout` between each; the fake Search stage inserts ~8 hard-coded Results (varied domains/titles/dates, two sharing a normalized URL to show the unique constraint firing); the fake Filter stage Excludes one as `aggregator`; finish via a shared `finalize` helper: `done_with_warnings` iff warnings exist, else `done`. Wrap the whole run in try/catch → `transition(…, 'failed', message)`
- [ ] Commit: `feat: fake pipeline walks the state machine with stub data`

#### Task 5: Routes + views

**Files:** create `src/routes/jobs.ts`, `src/views/layout.njk`, `src/views/index.njk`, `src/views/job.njk`, `src/views/_job.njk`.

- [ ] `GET /` — jobs list (company, status, included-result count, started-at; one query with a `LEFT JOIN`/subselect) + the new-job form (name and/or URL, hint text "provide the URL for unambiguous results")
- [ ] `POST /` — validate (name: non-empty after trim, length cap ~200; URL: `URL` parse + `https?:` scheme; at least one of the two present; on invalid → re-render form with message). Find-or-create the company on the identity key `(lowercase-trimmed name, normalized URL host)`; URL wins on conflict per spec §1.2. Insert `pending` job, enqueue, `303` redirect to `/:id` (PRG)
- [ ] `GET /:id` — one route, two render depths: full page normally; just the `_job.njk` fragment when the `HX-Request` header is present. 404 for unknown ids
- [ ] `_job.njk` — the self-replacing container: `hx-get="/:id" hx-trigger="every 2s" hx-swap="outerHTML"` **only when status is non-terminal** (the stop-condition lives in this template); status header (state, resolved-identity line + provenance, window line, warnings, per-stage counters from one `GROUP BY`); results list grouped in fixed section order (News → Trade publications → Press releases → Podcasts → Blog posts → Newsletters → Social posts → Other → Unclassified), date-desc within sections, date-unknown rows sinking with a badge; collapsed `<details>` excluded section at the bottom grouped by `exclusion_code` with counts and per-row `exclusion_detail`. Rows: title, source domain, date, snippet, confidence badge, link to the **original** URL. Autoescape everywhere; zero `| safe` unless deliberate and greppable
- [ ] Commit: `feat: routes + views — jobs list, PRG create, HTMX polling fragment`

#### Task 6: Bootstrap (`src/main.ts`) + end-to-end check

**Files:** modify `src/main.ts`.

- [ ] Boot-time env check: name any missing key (`ANTHROPIC_API_KEY`, `TAVILY_API_KEY`) in a friendly message and exit cleanly — no stack trace
- [ ] Express bootstrap: Nunjucks with `autoescape: true`, serve `/public` static, `express.urlencoded`, mount routes, wire `createQueue(runPipeline)` and pass the enqueue handle to the routes, listen on 3000
- [ ] Manual verification (the slice-1 demo): `pnpm dev`, create a job, watch it walk `pending → … → done` with the stub Results appearing, polling stopping at terminal state, refresh-safe job page, second job queuing visibly behind the first
- [ ] Commit: `feat: express bootstrap — slice 1 end-to-end with fake pipeline`

### Slice 2 — real Resolve + Search

#### Task 7: Normalization (`src/filter/normalize.ts`)

**Files:** create `src/filter/normalize.ts`, `src/filter/normalize.test.ts`.

- [ ] Write failing tests straight from the spec's pinned rules: `http`/`https`/`www.` copies collapse; fragment stripped; `utm_*`/`fbclid`/`gclid`/`mc_cid`/`ref`/`source` stripped while `?v=`/`?id=` survive; param order never defeats dedup; trailing slash stripped; path case preserved; `normalizeTitle` adversarial cases — the TechCrunch/Yahoo syndication pair collapses to one key, `Acme - The Real Story` survives intact (remainder < 25 chars), a long-subtitle strip is refused (segment > 40 chars), NFKC + punctuation + whitespace folding
- [ ] Implement `normalizeUrl(raw)` and `normalizeTitle(raw)` exactly per the Deduplication strategy section (suffix strip runs before punctuation stripping, final separator only)
- [ ] `pnpm test` green; commit: `feat: pinned URL + title normalization (the dedup policy)`

#### Task 8: Resolve stage (`src/jobs/resolve.ts`)

**Files:** create `src/jobs/resolve.ts`, `src/jobs/resolve.test.ts`.

- [ ] Write failing tests for the pure parts only: 36-month window computation (date-only UTC, calendar months — assert the spec's own example: created 2026-06-03 → window 2023-06-03 → 2026-06-03); the homepage-pick heuristic over a fixed fake top-5 (first result passing both guards wins; never-a-homepage blocklist rejects; name-token matching handles `acme` ⊆ `getacme.io` / "Acme, Inc."; no candidate → `none`); social-handle extraction regexes over sample HTML (LinkedIn company URL, X/Twitter handle); SSRF guard predicate rejects private/loopback/link-local IPs
- [ ] Implement: window computation stored on the job row; SSRF-guarded homepage fetch (resolve hostname via `node:dns`, reject private ranges, redirect cap 3 re-checking each hop's host, 5s timeout via `AbortSignal.timeout`, 1MB read cap, `https?:` only); best-effort title/metadata + social-handle scrape (raw HTML regex); the resolution cascade — URL provided → `url_provided`; else heuristic over top-5 Tavily results → `heuristic`; else Haiku fallback constrained to `candidate_index: 0–4 | none` over the same closed list → `llm` + Warning "homepage identified with low confidence — verify"; else `none` + Warning "no homepage identified — own-channel exclusion is LLM-only". Persist resolved name/domains/handles/provenance on the job
- [ ] `pnpm test` green; commit: `feat: resolve stage — window, SSRF-guarded fetch, identity cascade`

#### Task 9: Tavily client + query strategy (`src/search/tavily.ts`)

**Files:** create `src/search/tavily.ts`, `src/search/tavily.test.ts`.

- [ ] Write failing tests for `buildQueries(identity, windowStart, windowEnd)` (pure): exactly 18 queries; 7 type + 6 slice + 5 angle; news/PR type-queries and all slices carry `topic: "news"` + date bounds; the three 12-month slices tile the window exactly; dateless types carry `topic: "general"` + `time_range: "3y"` and are never sliced; every query carries `exclude_domains` = own domains + aggregator blocklist; total ≤ the `MAX_QUERIES = 20` cap
- [ ] Implement `buildQueries` + `runSearch(db, job, identity)`: fire all queries via `Promise.allSettled` with `searchDepth: "advanced"`, `maxResults: 20`; insert each hit with `INSERT OR IGNORE` (the unique constraint is the dedup); store original URL, normalized URL, title, snippet, source domain, published date (nullable). Failed queries → one Warning "N/18 queries succeeded"; all failed → throw (stage failure → job `failed`). Verify actual `@tavily/core` parameter names against the installed SDK here — this is the pinned integration-check point
- [ ] `pnpm test` green; commit: `feat: tavily query strategy + insert-time URL dedup`

#### Task 10: Wire Resolve + Search into the pipeline

**Files:** modify `src/jobs/pipeline.ts`.

- [ ] Replace the fake Resolve and Search stages with the real ones (Filter/Classify still stubs); keep the try/catch → `failed` envelope and the `finalize` helper
- [ ] Manual verification: run a job for a real company (e.g. name + URL); real Results stream into the list mid-job; warnings render if any query fails
- [ ] Commit: `feat: pipeline runs real resolve + search`

### Slice 3 — heuristic Filter + Collapse

#### Task 11: Heuristic exclusion rules (`src/filter/heuristics.ts`)

**Files:** create `src/filter/heuristics.ts`, `src/filter/heuristics.test.ts`.

- [ ] Write failing tests asserting **codes, not strings** (spec §1): own domain + subdomain → `own_channel`; own social-profile URL prefix (`linkedin.com/company/x`, `x.com/<handle>`) → `own_channel` while a third-party post on the same platform passes; aggregator domains → `aggregator` (and Medium passes); review domains, ecommerce path segments, anchored title regexes → `ecommerce_review`; "Top 10 fintech stories" mid-title passes (anchored `^top \d+`); "Acme vs the regulators" title passes (`vs` is path-only); date before window → `out_of_window`; dateless → kept, no exclusion
- [ ] Implement the blocklists as named exported constants and a pure `heuristicExclusion(result, identity, windowStart) → {code, detail} | null`; plus the impure `applyHeuristics(db, jobId, identity)` that walks included Results and writes Exclusions
- [ ] `pnpm test` green; commit: `feat: heuristic exclusion rules — closed codes, pinned blocklists`

#### Task 12: Collapse

**Files:** modify `src/filter/heuristics.ts` + tests.

- [ ] Write failing tests: syndicated pair (same normalized title, dates 3 days apart) collapses — earliest date wins, loser gets `duplicate` + detail `of #<winner id>`; short titles (< 25 chars normalized) never collapse; same title 18 months apart does NOT collapse (two stories); unknown dates fall back to first-seen and may collapse; an already-Excluded copy never competes or wins (Collapse pool is `included` only); boundary-straddling pair at 14 days still collapses
- [ ] Implement `collapse(db, jobId)` as a pure grouping over still-included rows + Exclusion writes, running at the tail of the Filter stage
- [ ] `pnpm test` green; commit: `feat: title collapse — earliest-published wins, guards pinned`

#### Task 13: Wire Filter into the pipeline

**Files:** modify `src/jobs/pipeline.ts`.

- [ ] Replace the fake Filter stage with `applyHeuristics` then `collapse`; manual verification: excluded section populates grouped by code, duplicates point at their winners
- [ ] Commit: `feat: pipeline runs real heuristic filter + collapse`

### Slice 4 — Classify

#### Task 14: Haiku classification (`src/filter/classify.ts`)

**Files:** create `src/filter/classify.ts`.

- [ ] Implement per spec §1 Classify: batch surviving included Results in chunks of 50 (cap 400), fire chunks via `Promise.allSettled`; model pinned as named constant `claude-haiku-4-5`; prompt carries the Resolved Identity + the content-type tie-breakers verbatim from the spec (trade-pub vs news, newsletter = email-first/Substack, `other` = escape hatch never force-fit, own-channel = control not authorship, "major" social = surfaced by ranking); structured outputs (`output_format: json_schema`) with the per-result schema `{ id, content_type, exclude: none|own_channel|ecommerce_review|aggregator, confidence: high|low }` — no free-text reasoning field; sanity layer: returned IDs must match sent IDs, mismatches discarded with a Warning; SDK-unavailable fallback: prompt-requested JSON + parse + validate + one retry. Writers: `exclude ≠ none` → Exclusion with that code, detail `LLM`; else set `content_type` + `confidence`. Chunk failure → Warning, its Results stay unclassified (`content_type` NULL — never `other`)
- [ ] No unit tests (API client, per spec) — but keep the prompt-builder and the ID-sanity check as exported pure functions so they *can* be tested if time allows
- [ ] Commit: `feat: batched haiku classification — structured outputs, closed enums`

#### Task 15: Wire Classify + finalize

**Files:** modify `src/jobs/pipeline.ts`.

- [ ] Replace the final stub; `finalize` already picks `done_with_warnings` iff warnings exist. Manual verification: full real job end-to-end — sections populate by content type, low-confidence badges render, Unclassified section appears only when a classify chunk failed
- [ ] Commit: `feat: full pipeline live — resolve, search, filter, classify`

### Slice 5 — polish

#### Task 16: Status detail + type chips

**Files:** modify `src/views/_job.njk`, `src/routes/jobs.ts`.

- [ ] Per-stage counters in the status header ("47 fetched · 12 excluded · 31 classified" — one `GROUP BY` query); resolved-identity status line with provenance wording ("Identified as: abc.xyz (LLM-assisted)"); explicit window line ("window: 2023-06-03 → 2026-06-03")
- [ ] Type chip row toggling section visibility — plain `<details>`/checkbox CSS or a few lines of inline JS; visibility toggles only, no search box, no client templating. **First thing cut under time pressure**
- [ ] Commit: `feat: status detail + type-chip filtering`

### Slice 6 — deliverables

#### Task 17: README + write-up + transcript

**Files:** rewrite `README.md`, create `docs/3-writeup.md`, export agent transcript into `docs/`.

- [ ] README: the Setup instructions section above, verbatim flow (clone → `nvm use` → `pnpm install` → copy `.env` → `pnpm dev`), plus a one-paragraph product description and a pointer to the docs
- [ ] Write-up (`docs/3-writeup.md`): approach, trade-offs (lift from the Risks table + spec §2), explicit out-of-scope list (spec §5), next steps (boot-sweep, cancel button, confirmation gate, multi-provider, semantic dedup)
- [ ] Export the agent transcript into the repo per the brief's deliverables
- [ ] Final check: fresh-clone simulation — `git clean -xfd` a scratch copy (or re-clone), `pnpm install`, add keys, `pnpm dev`, run one job; `pnpm test` and `pnpm lint:fix` clean
- [ ] Commit: `docs: README, write-up, transcript`

---

## Spec-coverage check

| Spec section | Covered by |
|---|---|
| §1.1–1.2 Home page, PRG, identity key, URL-wins | Task 5 |
| §1.3 Resolve (window, cascade, provenance, degraded path) | Task 8 |
| §1.3 Search (18 queries, slices, angles, params) | Task 9 |
| §1.3 Filter + Collapse | Tasks 11–12 |
| §1.3 Classify (structured outputs, tie-breakers, injection stance) | Task 14 |
| §1.3 Soft Exclusion vocabulary | Tasks 2, 11, 14 |
| §1.4 One route two depths, server-side stop condition | Task 5 |
| §1.5 Reviewable list (section order, badges, excluded details) | Tasks 5, 16 |
| §3 Persistence, WAL, normalization, blocklists, state machine | Tasks 2, 3, 7, 11 |
| §3 Security (env check, validation, autoescape, SSRF, caps) | Tasks 5, 6, 8, 9, 14 |
| §3 Error handling (degraded-stage principle) | Tasks 3, 8, 9, 14, 15 |
| §3 Testing (pure logic, codes-not-strings, adversarial titles) | Tasks 2, 3, 7, 8, 11, 12 |
| §4 Slice order + cut list | Slice headers + Risks section |
| §6 Deliverables | Task 17 |
