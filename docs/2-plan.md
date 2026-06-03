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
  routes/company.ts          # findOrCreateCompany — the spec §1.2 identity rule (URL host wins)
  routes/company.test.ts
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
    normalize.ts             # normalizeHost (identity key) + normalizeUrl (dedup key) + normalizeTitle (Collapse key)
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

Four tables, created idempotently at boot. No migrations (deliberate — `pnpm db:reset` deletes the db file *and its WAL sidecars*; see Task 2).

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
    ('own_channel','aggregator','ecommerce_review','out_of_window','duplicate')),
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

The exclusion-code set is exactly the five above. `llm_excluded` is **deliberately not a code**: spec §1 pins one closed set across the funnel — codes record *why*, not which stage caught it — and the LLM backstop writes the same vocabulary with `exclusion_detail = 'LLM'` recording the catcher. (CONTEXT.md's Exclusion entry briefly listed it; both documents now agree.)

### Background job approach

- `POST /` inserts a `pending` job row and enqueues its id; an in-process FIFO (concurrency 1) runs the pipeline one job at a time. The jobs list makes the queue visible (a `pending` job behind a running one).
- The state machine `pending → resolving → searching → filtering → classifying → done | failed | done_with_warnings` lives in `jobs/queue.ts` as a general `transition(jobId, toState, message?)` that validates legal transitions and writes the row — the shape the spec wants so the future boot-sweep and cancel button slot in without pipeline changes.
- The queue takes the pipeline runner by injection (registered in `main.ts`) so `queue.ts` stays dependency-free and testable; a throwing runner never kills the queue.
- Uncaught pipeline error → `transition(id, 'failed', message)`. Terminal state is `done_with_warnings` iff the job's warning list is non-empty.
- At boot, `main.ts` re-enqueues jobs still in `pending` (id order) — a pending orphan has no partial state, so this is risk-free and keeps queued jobs alive across the `--watch` restarts dev hits constantly.
- Known, accepted gap (spec §5), now narrowed to exactly the hard part: a job **mid-flight** at process exit stays in its running state forever (resuming needs persisted stage output). Named in the write-up, not fixed.

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
3. **Collapse** (tail of Filter, still-`included` Results only): group by normalized title (≥25 chars after normalization). Within a title group, dated copies cluster by **anchor-on-earliest**: sorted ascending, a copy joins iff within 14 days of the cluster's *earliest* member (span never exceeds 14 days — no pairwise chaining drift). **Unknown-dated copies collapse only when unambiguous**: they join the cluster iff the group has ≤1 dated cluster (or is all-unknown); with multiple clusters they stay `included` — never guess which story they belong to. Winner per cluster = earliest published date, all-unknown → first-seen (lowest id); losers → `duplicate`, detail "of #N".
4. **Classify backstop** (Haiku): catches what heuristics can't see — Own Channels missed by the scrape, title-`vs` comparisons, judgement-call review pages. Writes the same exclusion-code vocabulary, `exclusion_detail = 'LLM'`.

### Deduplication strategy

Two distinct mechanisms, two pinned normalizations (`filter/normalize.ts`):

- **normalizeUrl** (exact-URL dedup key, per job): lowercase host, strip `www.`, drop scheme, strip fragment, strip only known tracking params (`utm_*`, `fbclid`, `gclid`, `mc_cid`, `ref`, `source`) keeping everything else, sort remaining params, strip trailing slash, preserve path case.
- **normalizeTitle** (Collapse key): NFKC → outlet-suffix strip (trailing ` | X` / ` – X` / ` - X`, final separator only, remainder ≥25 chars and segment ≤40) → lowercase → strip punctuation → collapse whitespace → exact match.
- **normalizeHandle** (own-channel handle key — distinct from the dedup key, which preserves path case): `normalizeUrl` → lowercase everything → canonicalize `twitter.com` → `x.com`. Both stored handle prefixes and candidate Result URLs pass through it; a prefix matches only at a **segment boundary** (next char `/`, `?`, or end) — `x.com/acme` matches `x.com/acme/status/1` but never `x.com/acmecorp`.

### Status lifecycle

`pending → resolving → searching → filtering → classifying → done | failed | done_with_warnings`

Every stage transition updates the job row; the HTMX fragment re-renders it every 2s with per-stage counters ("47 returned · 12 excluded · 31 classified" — one `GROUP BY`; "returned", never "fetched" — CONTEXT.md reserves *fetch* for the Resolve homepage fetch). When the job reaches a terminal state the server renders the fragment *without* polling attributes and polling stops naturally.

### Error handling

**Degraded-stage principle:** partial completion → Warning row + continue; total stage failure → job `failed` with a human-readable message in the UI — *where total failure leaves nothing to show*. A stage whose total failure still leaves the Job's purpose served (Classify: the list exists, it's just untyped and unaudited) degrades to a Warning instead; `failed` is reserved for losses that leave no reviewable list (all Search queries fail, pipeline crash).

| Event | Outcome |
|---|---|
| Some Tavily queries fail | Warning "14/18 queries succeeded" |
| All Tavily queries fail | Job `failed` |
| No homepage resolved (name-only) | Warning; proceed degraded — zero domains/handles, Classify carries own-channel alone |
| LLM-assisted resolution | Warning "homepage identified with low confidence — verify" |
| Classify call errors (some chunks) | Warning; affected Results shown unclassified (`content_type` NULL) |
| Classify fails totally (all chunks) | **Still `done_with_warnings`, never `failed`** — the searched/filtered list is the product; Warning discloses both losses: "classification failed — results unclassified; own-channel backstop did not run" |
| Homepage fetch fails (timeout/oversize/SSRF reject), URL provided | Keep given host as own domain, provenance stays `url_provided`; Warning "homepage fetch failed — social handles not scraped, own-channel exclusion is domain-only" |
| Homepage fetch fails, name-only (cascade candidate) | Candidate rejected; cascade continues (LLM fallback → degraded) |
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
| Cost: ~36 Tavily credits (+1 basic-depth Resolve call on name-only jobs, ≈37) + ~4–6 Haiku calls per job | ≈27 free-tier jobs/month; caps are constants, downgrade is one line |
| Recency bias in search ranking | Time-sliced news/PR queries; an early cut under time pressure |
| FIFO-1 queue: slow job blocks the queue | Visible in jobs list as `pending`; liveness guards (timeouts) bound each stage |

**If time runs short, cut in spec §4 order:** social handle scraping → time-sliced queries → Resolve LLM fallback → per-hop redirect re-checking (set cap to 0) → slice-5 polish.

---

## Tasks

Tracer-bullet ordering (spec §4): after Task 6 the whole loop works end-to-end with a fake pipeline; every later task upgrades one stage. Conventions for all tasks: TDD (failing test → minimal implementation → green → commit); local imports use explicit `.ts` extensions (Node type stripping requires them); tests are co-located, use `node:test` + `node:assert/strict`, never touch the network, and use `createDb(":memory:")` when they need a DB; run `pnpm lint:fix` before every commit; erasable TS syntax only.

### Slice 1 — skeleton: UI shows status end-to-end with a fake pipeline

#### Task 1: Dependencies, vendored HTMX, gitignore

**Files:** modify `package.json` (via pnpm), create `public/htmx.min.js`, verify `.gitignore`.

- [ ] `pnpm add express nunjucks @tavily/core @anthropic-ai/sdk` and `pnpm add -D htmx.org @types/express @types/nunjucks` (htmx is only read at vendor time — a dev dep, not a runtime one)
- [ ] Copy `node_modules/htmx.org/dist/htmx.min.js` → `public/htmx.min.js` and commit it (no CDN; clone → run stays self-contained)
- [ ] Verify `data/` is gitignored and `public/htmx.min.js` is not (`git check-ignore`)
- [ ] Commit: `chore: add runtime deps, vendor htmx`

#### Task 2: Database schema (`src/db.ts`)

**Files:** create `src/db.ts`, `src/db.test.ts`.

- [ ] Write failing tests covering: a Result is born `included`; `normalized_url` is unique per job but the same URL may exist across jobs; `exclusion_code`/`status`/`content_type` CHECK constraints reject values outside the closed sets; a new job starts `pending`
- [ ] Implement: `createDb(path)` factory (opens DB, sets `journal_mode = WAL` + `foreign_keys = ON`, runs the idempotent schema from the Data model section) and a lazy `getDb()` singleton that creates `data/` and opens `data/breakbeat.db`. The factory exists so tests run against `":memory:"`
- [ ] Change the `db:reset` script in `package.json` to `rm -f data/breakbeat.db*` — WAL mode creates `-wal`/`-shm` sidecar files; deleting only the db file orphans them against the next boot's fresh db
- [ ] `pnpm test` green
- [ ] Commit: `feat: sqlite schema — jobs, results (soft exclusion), warnings`

#### Task 3: Job state machine + FIFO queue (`src/jobs/queue.ts`)

**Files:** create `src/jobs/queue.ts`, `src/jobs/queue.test.ts`.

- [ ] Write failing tests covering: legal transitions walk the full pipeline; illegal jumps throw and leave status untouched; `failed` is reachable from every non-terminal state and stores the human-readable message on the job row; terminal states accept no further transitions; `addWarning` appends to the job's warning list; the queue runs jobs strictly FIFO with concurrency 1 (job 2 waits for job 1); a throwing runner doesn't kill the queue (job 3 still runs)
- [ ] Implement: `transition(db, jobId, toState, message?)` validating against a legal-edges table; `addWarning(db, jobId, message)`; `TERMINAL_STATES` constant; `createQueue(run)` returning `{ enqueue(jobId) }` — runner injected so the module stays dependency-free. The legal-edges table, in full (`finalize` picks the terminal directly from `classifying`; `done → done_with_warnings` is **not** an edge):

  ```
  pending     → resolving | failed
  resolving   → searching | failed
  searching   → filtering | failed
  filtering   → classifying | failed
  classifying → done | done_with_warnings | failed
  done, failed, done_with_warnings → ∅ (terminal — no outgoing edges)
  ```
- [ ] `pnpm test` green
- [ ] Commit: `feat: job state machine + in-process FIFO queue`

#### Task 4: Fake pipeline (`src/jobs/pipeline.ts`)

**Files:** create `src/jobs/pipeline.ts` (stub version — no test; it's throwaway scaffolding replaced by Tasks 10/13/15).

- [ ] Implement `runPipeline(db, jobId)`: walk all four stage transitions with a ~1.5s `setTimeout` between each; the fake Search stage inserts ~8 hard-coded Results (varied domains/titles/dates, two sharing a normalized URL to show the unique constraint firing; hard-code the `normalized_url` strings — real normalization arrives in Task 7, don't jump ahead); the fake Filter stage Excludes one as `aggregator`; finish via a shared `finalize` helper: `done_with_warnings` iff warnings exist, else `done`. Wrap the whole run in try/catch → `transition(…, 'failed', message)`
- [ ] Commit: `feat: fake pipeline walks the state machine with stub data`

#### Task 5a: Company identity + routes

**Files:** create `src/routes/company.ts`, `src/routes/company.test.ts`, `src/filter/normalize.ts` (`normalizeHost` only — Task 7 extends this file), `src/filter/normalize.test.ts`, `src/routes/jobs.ts`.

- [ ] Write failing tests for `normalizeHost(raw)` (lowercase the host, strip `www.` — `https://www.Acme.com/x` → `acme.com`) and `findOrCreateCompany(db, name, url)`. The spec §1.2 identity rule is **three pinned cases, not a composite key**:
  1. **URL provided** → the normalized host **alone** is the identity key; the name is ignored for matching and kept as a display label only — "Acme" + `https://globex.com` reuses an existing `globex.com` company even if it was stored as "Globex" (URL wins on conflict; no conflict detection — that's the out-of-scope confirmation gate). **No host match → fall back to name match and backfill** `url`/`url_host` onto the matched name-only row (a Monday name-only "Acme" and a Tuesday "Acme" + `acme.com` are one company, not two; "URL wins" holds from then on)
  2. **Name only** → match on lowercase-trimmed name alone
  3. **No match either way** → insert a new company row storing trimmed name, raw url, and `url_host`
- [ ] Implement `normalizeHost` + `findOrCreateCompany`
- [ ] `GET /` — jobs list (company, status, included-result count, started-at; one query with a `LEFT JOIN`/subselect) + the new-job form (name and/or URL, hint text "provide the URL for unambiguous results")
- [ ] `POST /` — validate (name: non-empty after trim, length cap ~200; URL: `URL` parse + `https?:` scheme; at least one of the two present; on invalid → re-render form with message). **URL-only submission** → `name = normalizeHost(url)` ("acme.com" as the display label; `companies.name` stays NOT NULL, no template fallback needed). `findOrCreateCompany`, insert `pending` job, enqueue, `303` redirect to `/:id` (PRG)
- [ ] `GET /:id` — one route, two render depths: full page normally; just the `_job.njk` fragment when the `HX-Request` header is present. 404 for unknown ids
- [ ] `pnpm test` green
- [ ] Commit: `feat: company identity rule + routes — PRG create, two render depths`

#### Task 5b: Views

**Files:** create `src/views/layout.njk`, `src/views/index.njk`, `src/views/job.njk`, `src/views/_job.njk`.

- [ ] `layout.njk` (page chrome, loads `/public/htmx.min.js`), `index.njk` (jobs list + new-job form), `job.njk` (full job page wrapping the fragment)
- [ ] `_job.njk` — the self-replacing container: `hx-get="/:id" hx-trigger="every 2s" hx-swap="outerHTML"` **only when status is non-terminal** (the stop-condition lives in this template); basic status header for now — state name, `error` message when failed, warnings list (per-stage counters, resolved-identity line, and window line are Task 16, slice 5 — not here); results list grouped in fixed section order (News → Trade publications → Press releases → Podcasts → Blog posts → Newsletters → Social posts → Other → Unclassified), date-desc within sections, date-unknown rows sinking with a badge; NULL `content_type` rows occupy the last section with a **state-dependent label** — "Awaiting classification" while the job is non-terminal, "Unclassified — classification failed, see warnings" at terminal (NULL means *failed* only once the job is terminal; mid-job it just means Classify hasn't run); collapsed `<details>` excluded section at the bottom grouped by `exclusion_code` with counts and per-row `exclusion_detail`. Rows: title, source domain, date, snippet, confidence badge, link to the **original** URL. Autoescape everywhere; zero `| safe` unless deliberate and greppable
- [ ] Commit: `feat: views — jobs list, HTMX polling fragment with server-side stop condition`

#### Task 6: Bootstrap (`src/main.ts`) + end-to-end check

**Files:** modify `src/main.ts`.

- [ ] Boot-time env check: name any missing key (`ANTHROPIC_API_KEY`, `TAVILY_API_KEY`) in a friendly message and exit cleanly — no stack trace
- [ ] Express bootstrap: Nunjucks with `autoescape: true`, serve `/public` static, `express.urlencoded`, mount routes, wire `createQueue(runPipeline)` and pass the enqueue handle to the routes, listen on 3000
- [ ] Boot re-enqueue: `SELECT id FROM jobs WHERE status = 'pending' ORDER BY id` → enqueue each — pending orphans (no partial state) survive restarts; mid-flight orphans remain the accepted spec §5 gap
- [ ] Manual verification (the slice-1 demo): `pnpm dev`, create a job, watch it walk `pending → … → done` with the stub Results appearing, polling stopping at terminal state, refresh-safe job page, second job queuing visibly behind the first
- [ ] Dev-loop caveat (know it before you debug it): `pnpm dev` runs `node --watch`, so any file save mid-job restarts the process and orphans the running job in its non-terminal state — the accepted spec §5 gap, hit constantly during development, not a bug to chase. `pnpm db:reset` clears the evidence
- [ ] Commit: `feat: express bootstrap — slice 1 end-to-end with fake pipeline`

### Slice 2 — real Resolve + Search

#### Task 7: Normalization (`src/filter/normalize.ts`)

**Files:** modify `src/filter/normalize.ts` + `src/filter/normalize.test.ts` (created in Task 5a with `normalizeHost`; this task adds `normalizeUrl`, `normalizeTitle` + `normalizeHandle`).

- [ ] Write failing tests straight from the spec's pinned rules: `http`/`https`/`www.` copies collapse; fragment stripped; `utm_*`/`fbclid`/`gclid`/`mc_cid`/`ref`/`source` stripped while `?v=`/`?id=` survive; param order never defeats dedup; trailing slash stripped; path case preserved; `normalizeTitle` adversarial cases — the TechCrunch/Yahoo syndication pair collapses to one key, `Acme - The Real Story` survives intact (remainder < 25 chars), a long-subtitle strip is refused (segment > 40 chars), NFKC + punctuation + whitespace folding. Pin `normalizeUrl` expectations as literal pairs (host handling reuses `normalizeHost`):

  | input | normalized key |
  |---|---|
  | `https://www.Example.com/Path/?utm_source=x&b=2&a=1#frag` | `example.com/Path?a=1&b=2` |
  | `http://example.com/news/item` vs `https://example.com/news/item/` | `example.com/news/item` (same key) |
  | `https://youtube.com/watch?v=abc&fbclid=xyz` | `youtube.com/watch?v=abc` |
  | `https://news.example.com/post?ref=hn&source=tw` | `news.example.com/post` |
- [ ] Also test `normalizeHandle` + its boundary-aware prefix matcher: `x.com/Acme` matches `https://x.com/acme/status/123` (case-folded); `twitter.com/acme` matches an `x.com/acme/…` result (alias canonicalized); `x.com/acme` does NOT match `x.com/acmecorp/post` (segment boundary)
- [ ] Implement `normalizeUrl(raw)`, `normalizeTitle(raw)` and `normalizeHandle(raw)` + `matchesHandlePrefix(prefix, url)` exactly per the Deduplication strategy section (suffix strip runs before punctuation stripping, final separator only)
- [ ] `pnpm test` green; commit: `feat: pinned URL + title normalization (the dedup policy)`

#### Task 8: Resolve stage (`src/jobs/resolve.ts`)

**Files:** create `src/jobs/resolve.ts`, `src/jobs/resolve.test.ts`.

- [ ] Write failing tests for the pure parts only: 36-month window computation (date-only UTC, calendar months — assert the spec's own example: created 2026-06-03 → window 2023-06-03 → 2026-06-03); the homepage-pick heuristic over a fixed fake top-5 (first result passing both guards wins; never-a-homepage blocklist rejects; name-token matching handles `acme` ⊆ `getacme.io` / "Acme, Inc."; no candidate → `none`); social-handle extraction regexes over sample HTML (LinkedIn company URL, X/Twitter handle); SSRF guard predicate rejects private/loopback/link-local IPs
- [ ] Implement: window computation stored on the job row; SSRF-guarded homepage fetch (resolve hostname via `node:dns`, reject private ranges, redirect cap 3 re-checking each hop's host, 5s timeout via `AbortSignal.timeout`, 1MB read cap, `https?:` only); best-effort title/metadata + social-handle scrape (raw HTML regex); the resolution cascade — URL provided → `url_provided` (and if the homepage fetch fails, **keep the given host** as the sole own domain, provenance still `url_provided`, Warning "homepage fetch failed — social handles not scraped, own-channel exclusion is domain-only"; the zero-domain degraded path is name-only); else heuristic over top-5 Tavily results → `heuristic` (the cascade's one Tavily call, pinned: `query: "<name> official website"`, `search_depth: "basic"` — the heuristic reads domain+title only, snippets don't matter here — `max_results: 5`, `topic: "general"`, no date bounds; own named constants in `resolve.ts`, exempt from the Search-stage `MAX_QUERIES` cap); else Haiku fallback constrained to `candidate_index: 0–4 | none` over the same closed list → `llm` + Warning "homepage identified with low confidence — verify"; else `none` + Warning "no homepage identified — own-channel exclusion is LLM-only". Persist resolved name/domains/handles/provenance on the job. The never-a-homepage blocklist, pinned (spec §3, exported named constant — used by the Resolve cascade only, never as a results filter): `wikipedia.org`, `linkedin.com`, `facebook.com`, `x.com`, `twitter.com`, `instagram.com`, `crunchbase.com`, `bloomberg.com`, `glassdoor.com`, `indeed.com`, `youtube.com`, `github.com`
- [ ] `pnpm test` green; commit: `feat: resolve stage — window, SSRF-guarded fetch, identity cascade`

#### Task 9: Tavily client + query strategy (`src/search/tavily.ts`)

**Files:** create `src/search/tavily.ts`, `src/search/tavily.test.ts`.

- [ ] Write failing tests for `buildQueries(identity, windowStart, windowEnd)` (pure): exactly 18 queries; 7 type + 6 slice + 5 angle; news/PR type-queries and all slices carry `topic: "news"` + date bounds; the three 12-month slices tile the window exactly; dateless types carry `topic: "general"` + `time_range: "3y"` and are never sliced; every query carries `exclude_domains` = own domains + aggregator blocklist; total ≤ the `MAX_QUERIES = 20` cap. Example query objects — the shape under test (property names are the spec's; the implement step verifies the real `@tavily/core` names):

  ```js
  // news-ish: the news/PR type-queries + all six slices
  { query: "Acme press release", topic: "news", searchDepth: "advanced", maxResults: 20,
    startDate: "2023-06-03", endDate: "2026-06-03",
    excludeDomains: [/* own domains + aggregator blocklist */] }
  // everything else: dateless type-queries + the five angle queries
  { query: "Acme podcast interview", topic: "general", timeRange: "3y",
    searchDepth: "advanced", maxResults: 20, excludeDomains: [/* same */] }
  ```
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

- [ ] Write failing tests asserting **codes, not strings** (spec §1): own domain + subdomain → `own_channel`; own social-profile URL prefix (`linkedin.com/company/x`, `x.com/<handle>`, matched via `normalizeHandle` + segment boundary) → `own_channel` while a third-party post on the same platform passes; aggregator domains → `aggregator` (and Medium passes); review domains, ecommerce path segments, anchored title regexes → `ecommerce_review`; "Top 10 fintech stories" mid-title passes (anchored `^top \d+`); "Acme vs the regulators" title passes (`vs` is path-only); date before window → `out_of_window`; dateless → kept, no exclusion
- [ ] Implement the blocklists as named exported constants and a pure `heuristicExclusion(result, identity, windowStart) → {code, detail} | null`; plus the impure `applyHeuristics(db, jobId, identity)` that walks included Results and writes Exclusions
- [ ] `pnpm test` green; commit: `feat: heuristic exclusion rules — closed codes, pinned blocklists`

#### Task 12: Collapse

**Files:** modify `src/filter/heuristics.ts` + tests.

- [ ] Write failing tests: syndicated pair (same normalized title, dates 3 days apart) collapses — earliest date wins, loser gets `duplicate` + detail `of #<winner id>`; short titles (< 25 chars normalized) never collapse; same title 18 months apart does NOT collapse (two stories); anchor-on-earliest — days 0/10/20 form cluster {0,10} + singleton {20}, no chaining drift; unknown-dated copy joins a single-cluster group (and an all-unknown group collapses to first-seen) but stays `included` when the group has two dated clusters (never guess); an already-Excluded copy never competes or wins (Collapse pool is `included` only); boundary-straddling pair at 14 days still collapses
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

- [ ] Add the status-header detail deferred from Task 5b: per-stage counters ("47 returned · 12 excluded · 31 classified" — one `GROUP BY` query; "returned", never "fetched" — CONTEXT.md reserves *fetch* for the Resolve homepage fetch); resolved-identity status line with provenance wording ("Identified as: abc.xyz (LLM-assisted)"); explicit window line ("window: 2023-06-03 → 2026-06-03")
- [ ] Type chip row toggling section visibility — plain `<details>`/checkbox CSS or a few lines of inline JS; visibility toggles only, no search box, no client templating. **First thing cut under time pressure**
- [ ] Jobs-list liveness: wrap only the list (never the form) in its own polling fragment — same pattern as `_job.njk`, `hx-get` a list fragment every 2s **only while any visible job is non-terminal** (stop condition server-side); `GET /` renders the fragment alone under `HX-Request`. Makes the queue-visibility story watchable. **Second thing cut, right after type chips**
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
| §1.1–1.2 Home page, PRG, identity key, URL-wins | Task 5a |
| §1.3 Resolve (window, cascade, provenance, degraded path) | Task 8 |
| §1.3 Search (18 queries, slices, angles, params) | Task 9 |
| §1.3 Filter + Collapse | Tasks 11–12 |
| §1.3 Classify (structured outputs, tie-breakers, injection stance) | Task 14 |
| §1.3 Soft Exclusion vocabulary | Tasks 2, 11, 14 |
| §1.4 One route two depths, server-side stop condition | Tasks 5a (route), 5b (template) |
| §1.5 Reviewable list (section order, badges, excluded details) | Tasks 5b, 16 |
| §3 Persistence, WAL, normalization, blocklists, state machine | Tasks 2, 3, 7, 11 |
| §3 Security (env check, validation, autoescape, SSRF, caps) | Tasks 5a, 5b, 6, 8, 9, 14 |
| §3 Error handling (degraded-stage principle) | Tasks 3, 8, 9, 14, 15 |
| §3 Testing (pure logic, codes-not-strings, adversarial titles) | Tasks 2, 3, 5a, 7, 8, 11, 12 |
| §4 Slice order + cut list | Slice headers + Risks section |
| §6 Deliverables | Task 17 |
