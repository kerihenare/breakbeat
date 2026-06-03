# Breakbeat — Design Spec

**Date:** 2026-06-03 (revised same day after design review)
**Context:** Head of Engineering technical exercise (see `0-brief.md`).
**Goal:** A pragmatic MVP web app that finds third-party content about a company from the last 36 months, demonstrating product judgement, architecture, retrieval strategy, background job design, deduplication, clear setup, and security awareness — with result quality as the deciding factor in every trade-off.

## Key decisions

| Area | Decision |
|---|---|
| Runtime | Node.js v26 (pinned via `.nvmrc`/`engines`) — native TypeScript support, no build step. Type stripping means **erasable syntax only**: no `enum`, `namespace`, or constructor parameter properties |
| Retrieval | Tavily search API (single provider), `search_depth: "advanced"` everywhere |
| API clients | Official vendor SDKs (`@anthropic-ai/sdk`, `@tavily/core`) |
| Filtering | Deterministic heuristics first, then one batched Claude Haiku classification pass (structured outputs) |
| Web framework | Express |
| Templating | Nunjucks, `autoescape: true` non-negotiable; deliberate raw output uses the `\| safe` filter — a greppable marker for reviewers |
| Status updates | HTMX load-polling every ~2s — `htmx.min.js` vendored from node_modules into `/public`, no CDN |
| Persistence | SQLite via `node:sqlite` (built into Node, zero deps) |
| Background jobs | In-process async queue with a job state machine |

## 1. Smallest credible MVP

A single Express app that does exactly the brief and nothing more:

1. **Home page**: jobs list (company, status, result count, started-at) + form — input for company name and/or URL → "Start search" button. Jobs are durable rows; listing them makes the queue visible (a `pending` job behind a running one) and keeps the demo coherent across visits. "Run again" (form pre-fill) is slice-5 polish, not scope. The form hints "provide the URL for unambiguous results."
2. **POST /** creates company and job rows (the company row is just the durable raw input — identical input reuses it; every job resolves fresh, so the resolved identity lives on the job), kicks off the pipeline in-process, and 303-redirects to **GET /:id** (PRG — refresh-safe). **"Identical input" is defined**: match on `(lowercase-trimmed name, normalized URL host)` — the same URL-normalization function from §3, reused. If a URL is provided, host alone is the identity key; name-only inputs match on name alone. If name and URL conflict ("Acme" + `globex.com`), **the URL wins** — it's the higher-fidelity signal; the name is kept as a display label only, and the resolved-identity status line surfaces the outcome either way. No conflict detection — that's the confirmation gate, out of scope (§5).
3. **Job pipeline** — each stage updates job status so the UI shows real progress:
   - **Resolve** — normalize company identity. The **36-month window is computed here, once**: `job.created_at` minus 36 calendar months (date-only, UTC), stored on the job row — every query and filter reads the stored boundary so they agree forever, and the job page states it explicitly ("window: 2023-06-03 → 2026-06-03"). If URL given, fetch homepage title/metadata to confirm name, capture own domains, **and scrape social profile handles** (LinkedIn/X/etc. links in homepage metadata/footer) for own-channel exclusion. The scrape is best-effort (raw HTML regex — JS-rendered SPAs may yield nothing) and is a *pre-filter*, not the own-channel guarantee: anything it catches is excluded deterministically; anything it misses falls through to the LLM, which is the actual backstop. If name only, resolution is a **cascade mirroring the filter funnel's own philosophy — deterministic first, LLM only for genuine ambiguity**: (1) *heuristic*: scan the top 5 Tavily results; first result passing both guards wins — domain not on the never-a-homepage blocklist (§3), and a normalized name-token match in domain or title (`acme` ⊆ `acme.com` / `getacme.io` / "Acme, Inc."); (2) *LLM fallback, only when the heuristic finds nothing*: one Haiku call over the same top 5, **constrained to a structured output of `candidate_index: 0–4 | none`** — it picks from a closed list of domains we hand it, so it can't introduce one; the injection blast radius collapses to "picks the wrong item from our own list," same as the heuristic's; (3) both fail → **proceed degraded** — the resolved identity carries zero domains/handles, a warning is recorded ("no homepage identified — own-channel exclusion is LLM-only"), and the classify backstop carries own-channel alone. The degraded path is the *correct* failure for companies whose domain shares no token with their name (Alphabet → abc.xyz) — heuristic miss falls to the LLM, which handles exactly that class. **Provenance is recorded** on the job (`url_provided` / `heuristic` / `llm` / `none`) and shown in the status line ("Identified as: abc.xyz (LLM-assisted)"); LLM-resolved jobs also carry a warning ("homepage identified with low confidence — verify"), so the confident path is the heuristic one and everything below it self-reports via `done_with_warnings`.
   - **Search** — ~18 parallel Tavily queries (`max_results: 20` each, ~360 raw results), all with `exclude_domains` for own site + aggregator blocklist, all fired concurrently via `Promise.allSettled` (well under Tavily rate limits; no concurrency-limiter dependency — the per-job caps already bound the fan-out; per-query failure → warning), in three groups:
     - *Per content type* ("X press release", "X podcast interview", "X news") with a 36-month date filter.
     - *Time-sliced news & press releases* — one query per 12-month window (`start_date`/`end_date`) for the two types where Tavily dates are reliable and archives are deep. Counters recency bias so the list visibly spans the window. Slicing is **not** applied to dateless types (blogs/podcasts/social) — it returns the same top hits per slice, paying 3× for noise.
     - *Angle queries* ("X funding", "X acquisition", "X leadership interview", "X partnership", "X lawsuit OR controversy") — distinct phrasings surface distinct content; overlap is absorbed by URL dedup. Scaling recall further means more angles, not more slices.
     - **Tavily parameters**: the news-ish queries (the "X news" / "X press release" type queries and all six time-sliced queries) use `topic: "news"` — the news index is where `published_date` is reliable and `start_date`/`end_date` are real; everything else uses `topic: "general"` with `time_range: "3y"` as a best-effort filter, accepting that dateless results are kept and flagged. `search_depth: "advanced"` everywhere (2 credits vs 1, ~36 credits/job ≈ 27 free-tier jobs/month): classification runs on title+snippet only (§5 — no page fetching), so **snippet quality is classification quality** — the one place we spend. Named constant; downgrading is a one-line change.
   - **Filter (heuristics, then Collapse)** — exclude own domains/subdomains, the company's own social profile URLs (e.g. `linkedin.com/company/x`, `x.com/<handle>` — but *not* social domains wholesale, since third-party posts about the company are in scope), known aggregators, URL-pattern ecommerce/review pages, out-of-window dates (blocklists and patterns pinned in §3). **Results with no detectable date are kept and flagged "date unknown"** — dropping them would gut recall; flagging keeps the 36-month promise honest. Then, still inside this stage, **Collapse** near-dups on normalized title **over still-included results only** (an already-excluded aggregator copy must never win and swallow legitimate coverage): winner = earliest published date (proxy for the original source; syndication copies follow it), falling back to first-seen when dates are missing; losers become `excluded, duplicate of #N`. False-collapse guards: only collapse titles ≥ ~25 chars after normalization, and only when published dates are within ~14 days (or unknown) — same title 18 months apart is two stories, and the window lets boundary-straddling results from adjacent time-sliced queries still collapse. Running Collapse before Classify means the LLM never pays to classify duplicates. (Exact-URL dedup is not a stage at all — it's the DB unique constraint on normalized URL, firing at insert during Search. Normalization rules for both URL and title are pinned in §3.)
   - **Classify (LLM)** — batched Claude Haiku call(s) over surviving results (title+snippet+URL), with the resolved identity (company name, domains, scraped handles) in the prompt as context. **Output is enforced by the API, not the app**: Anthropic structured outputs (`output_format: { type: "json_schema" }`, supported on `claude-haiku-4-5` — model pinned as a named constant) guarantee schema-conformant JSON via constrained decoding, honoring the no-tool-use stance; a thin sanity layer checks returned result IDs match the IDs sent (schema can't enforce that). If the beta flag is unavailable in the SDK, fall back to prompt-requested JSON + parse + validate + one retry. Per-result schema: `{ id, content_type: news|trade_publication|blog_post|press_release|social_post|newsletter|podcast|other, exclude: none|own_channel|ecommerce_review|aggregator, confidence: high|low }`. **One `confidence` flag covers both decisions** (type + exclusion) — the UI has only one low-confidence treatment anyway. **No free-text reasoning field** — it's the prompt-injection echo channel (hostile snippet text quoted back into our UI) and burns output tokens × 400 results; the enums are the audit trail. Content-type boundary tie-breakers live in the prompt ("trade publication = industry-niche outlet; if unsure between news and trade, choose news; newsletter = email-first publication, Substack counts"; `other` is the explicit escape hatch, never force-fit). The brief's "**major** social posts" is an ambiguity handled by interpretation: Tavily exposes no engagement signal, so "major" is read as "surfaced by search ranking" — engagement-based thresholds need native social APIs (out of scope, §5). Own-channel means content on a surface the company *controls* (its profiles/accounts), **not** content it authored: a wire press release or company-bylined guest post sits on someone else's editorial surface and is in scope, as is any content *about* the company. Low-confidence items are marked, never silently dropped. The per-job classify cap doubles as the batch chunk size, so an oversized result set means multiple calls (fired via `Promise.allSettled`), not a truncated one.
   - **Exclusion is soft, never a delete**: every result is stored born-`included`, with exclusion as the only transition — a `status` (`included`/`excluded`), a machine-groupable `exclusion_code` from a closed set (`own_channel`, `aggregator`, `ecommerce_review`, `out_of_window`, `duplicate`), and a nullable human-readable `exclusion_detail` ("of #42", "LLM"). **Codes record *why*, not *which stage caught it*** — the LLM backstop writes the same code vocabulary as the heuristics (one closed set across the funnel), with `exclusion_detail` recording that the LLM was the catcher. The UI groups the collapsed "excluded (N)" section by code and shows detail on the row — the filtering strategy made visible and debuggable; tests assert codes, not strings. Nothing is dropped except by never being returned by Search.
4. **GET /:id** for status: serves the full job page as HTML — deep-linkable and refresh-safe. While the job is running, the status header + results list live in a **self-replacing HTMX load-polling container**: `hx-get` on the same route, `hx-trigger="every 2s"`, `hx-swap="outerHTML"`. The route checks the `HX-Request` header (sent automatically by HTMX) and renders just the fragment for poll requests, the full page otherwise — **one route, two render depths**; no JSON API, no client templating. When the job reaches a terminal state, the server renders the same fragment *without* the polling attributes and polling stops naturally — **the stop-condition lives server-side in the Nunjucks template**, with the rest of the state machine. Page chrome and the form sit outside the container and never re-render; scroll position survives swaps. The render is **progressive**: status header with per-stage counters ("47 fetched · 12 excluded · 31 classified", one `GROUP BY`) above whatever results currently exist — the list visibly assembles as stages run, which is the background-job story told in the UI. Accepted trade-off: a result can vanish into the excluded section on the next swap mid-job.
5. **Results list** — "reviewable" means a human can scan and judge quickly, so the layout is pinned:
   - **Fixed section order by editorial weight, not alphabet**: News → Trade publications → Press releases → Podcasts → Blog posts → Newsletters → Social posts → Other → Unclassified. The highest-signal third-party coverage hits the scanner first. Section headers carry counts; empty sections are omitted entirely.
   - **Within a section**: published date descending; date-unknown rows sink to the bottom with a visible "date unknown" badge — the dated timeline stays clean, recall stays intact.
   - **Unclassified is its own section, present only on classify failure**, labeled honestly ("Unclassified — classification failed, see warnings") — never dumped into Other, which is reserved for genuine type ambiguity.
   - **Excluded**: one collapsed `<details>` block at the very bottom, grouped by `exclusion_code` with counts ("own_channel (12) · duplicate (9) · aggregator (5)"), each row showing its `exclusion_detail`. Collapsed by default — it's the audit trail, not the product.
   - **Low-confidence flag**: an inline badge on the row, not a separate section — a low-confidence news item is still news.
   - Rows show title, source domain, date, snippet, confidence flag, link (the *original* URL, not the normalized key).
   - **Filtering (slice 5)**: a type chip row that shows/hides sections — visibility toggles only, no search box, no client templating. First thing cut under time pressure (§4); the fixed grouping already delivers "reviewable."

That's the whole product.

## 2. Main trade-offs

| Decision | Chose | Over | Why |
|---|---|---|---|
| Retrieval | Single API (Tavily) | Multi-provider | One key, clean results; multi-source is the obvious "next step" |
| Search depth | `advanced` (2 credits/query) | `basic` | Classify runs on title+snippet only, so snippet quality *is* classification quality; result quality is the stated deciding factor — this is the one place we spend |
| Filtering | Heuristics → batched Haiku | LLM-per-result | Deterministic rules handle the clear-cut 80% predictably and debuggably; the LLM is reserved for genuine ambiguity, where it improves classification quality |
| Templating | Nunjucks (autoescape on) | Zero-dep tagged template literals | Boring conventional tooling over artisanal minimalism; escaping is the engine's default behaviour, with `\| safe` as the explicit, greppable opt-out |
| Status | HTMX load-polling | SSE/WebSockets / vanilla-JS poll / meta-refresh | The polling stop-condition lives server-side in the template instead of in client JS; scroll survives swaps; §5's cancel button becomes a one-attribute addition. Cost: ~14kB vendored dep |
| Jobs | In-process queue | Worker process / Redis queue | Local-only brief; the *interface* (job table + status machine) is what's portable to BullMQ later |
| Storage | SQLite (`node:sqlite`) | Postgres / in-memory | Zero setup for cloner; durable enough to demo dedup properly |
| Recall | ~18 queries × 20 results (types + slices + angles) | Exhaustive pagination/crawling | "As much as possible" taken literally, bounded by reviewability; the funnel (URL dedup at insert → heuristics → Collapse → classify, all via soft exclusion) is what keeps volume reviewable |

## 3. Technical architecture

```
src/
  main.ts               # Express bootstrap, Nunjucks config (autoescape: true), serves /public, mounts routes
  routes/jobs.ts        # GET / (jobs list + new job form), POST / (creates job, 303 → /:id), GET /:id (full page, or fragment when HX-Request header present)
  views/                # Nunjucks templates: layout, jobs list, job page, job fragment (status + results container)
  jobs/queue.ts         # tiny async queue (FIFO, concurrency 1 — configurable cap later), job state machine (pending→resolving→searching→filtering→classifying→done|failed|done_with_warnings)
  jobs/pipeline.ts      # orchestrates the 4 stages (resolve, search, filter, classify)
  search/tavily.ts      # Tavily client (@tavily/core) + query strategy
  filter/heuristics.ts  # blocklists, URL/title rules, date window, then title-Collapse (included results only)
  filter/classify.ts    # batched Anthropic calls (@anthropic-ai/sdk), structured outputs
  db.ts                 # node:sqlite schema + boot-time CREATE TABLE IF NOT EXISTS
public/
  htmx.min.js           # vendored from node_modules — no CDN; clone → run stays self-contained
data/
  breakbeat.db          # gitignored (whole directory); created at boot
```

### Persistence

- DB file at `./data/breakbeat.db`; `data/` gitignored and created at boot.
- Schema via idempotent `CREATE TABLE IF NOT EXISTS` in `db.ts` at boot. **No migrations — deliberate**: local-only, one author; the schema ships final, evolution is a hosted-version concern. A `db:reset` npm script (delete the file) makes the demo repeatable.
- Pragmas: `journal_mode = WAL` and `foreign_keys = ON`. WAL matters more than it looks: the HTMX poll reads while the pipeline writes, and rollback-journal mode can hit `SQLITE_BUSY` on that overlap.
- Tables: jobs (+ warnings, resolution provenance, stored 36-month window), results (`UNIQUE(job_id, normalized_url)`; `status` + `exclusion_code`/`exclusion_detail` columns — soft exclusion).

### Normalization rules (pinned — these are the dedup policy)

**Normalized URL** (the `UNIQUE` key; the original URL is stored separately and is what the UI links to):
1. Lowercase host, strip `www.`
2. Drop the scheme from the key — `http://` and `https://` copies collapse
3. Strip the fragment
4. Strip **only known tracking params** (`utm_*`, `fbclid`, `gclid`, `mc_cid`, `ref`, `source`) and **keep everything else** — stripping all params merges genuinely distinct content (`youtube.com/watch?v=…`, `?id=`-style article URLs). Blocklist-of-trackers, not allowlist-of-params
5. Sort remaining query params — order never defeats dedup
6. Strip trailing slash on path; **preserve path case** (paths are case-sensitive in the wild; hosts aren't)
7. Uniqueness scope: **per job** — two jobs for the same company each show full results

**Normalized title** (the Collapse key): Unicode NFKC → lowercase → strip punctuation → collapse whitespace → **exact match** (fuzzy/embedding similarity is §5). Plus **outlet-suffix stripping** — syndicated copies usually differ only by branding (`… | TechCrunch` vs `… - Yahoo Finance`): strip a trailing ` | X` / ` – X` / ` - X` segment, final separator only, and only if the remaining title is still ≥ 25 chars *and* the stripped segment is ≤ ~40 chars (outlet names are short; a real subtitle isn't). `Acme - The Real Story` survives intact.

### Blocklists (named constants in `filter/heuristics.ts`)

- **Aggregators** (results filter): `news.ycombinator.com`, `reddit.com`, `slashdot.org`, `lobste.rs`, `digg.com`, `flipboard.com`, `feedly.com`, `news.google.com`, `apple.news`. **Medium is *not* excluded** — it hosts original blog posts; wholesale exclusion would gut that content type. **Reddit is excluded wholesale** despite sometimes being "major social posts": where one site is both an explicit exclude (aggregator) and an include (social), the explicit exclusion wins — and soft exclusion means excluded threads remain visible in the audit section anyway.
- **Never-a-homepage** (Resolve cascade only — *not* a results filter): `wikipedia.org`, `linkedin.com`, `facebook.com`, `x.com`, `twitter.com`, `instagram.com`, `crunchbase.com`, `bloomberg.com`, `glassdoor.com`, `indeed.com`, `youtube.com`, `github.com`. (A company's GitHub org is arguably an own channel for *results*, but that's left to the LLM backstop rather than hard-coded.)
- **Ecommerce/review**: path segments `/product/`, `/products/`, `/shop/`, `/store/`, `/buy/`, `/pricing/`, `/vs/`, `/compare/`, `/alternatives/`; title regexes `^best .* (alternatives|tools|software)`, `(review|comparison) of`, `^top \d+` (anchored — "Top 10 fintech stories" mid-title can be real coverage); review-site domains `g2.com`, `capterra.com`, `trustpilot.com`, `trustradius.com`, `getapp.com`, `softwareadvice.com`, `producthunt.com` (launch pages are arguably coverage, but PH is review/aggregator-shaped — excluded, and soft exclusion makes it recoverable). **`vs` is a path pattern only, never a title match** — "Acme vs the regulators" is legitimate news; title-`vs` comparisons are left to the LLM.

### Job state machine

`pending → resolving → searching → filtering → classifying → done | failed | done_with_warnings`

### Security & operational limits

- Keys only in `.env` (`.env.example` committed), never sent to the client. Loaded natively via `node --env-file-if-exists=.env` (no dotenv; `-if-exists` so a keyless clone still boots). Boot-time check names any missing key and exits cleanly — "clone → add keys → run" is graded, so the failure mode is a friendly message, not a stack trace.
- Per-job caps, as named constants in one place: max 20 queries (strategy uses ~18), Tavily `max_results: 20` (the purest recall knob — the brief says "as much content as possible"), classify cap 400 in chunks of 50 (~4–6 parallel Haiku calls). **Caps sit above the strategy's natural output — they bound runaway failure, never recall**; recall is bounded only by what the funnel keeps reviewable.
- Input validation: company name → length cap + non-empty; URL → `URL` parse + `https?:` scheme check. Nothing cleverer — output escaping is the real defence.
- **Escape on render, everywhere**: Tavily result titles/snippets are untrusted input landing in our HTML, same as the form fields. Nunjucks autoescape is the structural guarantee; `\| safe` is the only opt-out and is greppable.
- The same untrusted titles/snippets are also *prompt* input to the classify pass (prompt injection surface). Mitigated by structured outputs (API-enforced schema, closed enums, no free-text echo channel) and no tool use in that call — the worst a hostile snippet can do is misclassify itself, which soft exclusion makes visible and reviewable. The Resolve cascade's LLM fallback is constrained the same way (`candidate_index` from a closed list — it can't introduce a domain).
- Outbound fetches limited to Tavily/Anthropic plus the one homepage fetch. SSRF guard on that fetch: resolve hostname and reject private/loopback/link-local ranges, redirect cap (~3) **re-checking each hop's host**, 5s timeout, ~1MB response cap, `https?:` only. Timeout/size caps double as liveness guards — a hanging homepage would otherwise stall the FIFO-1 queue for every job behind it. DNS-rebinding pinning is named-and-skipped (production-grade effort, local-only threat model).

### Error handling

**Degraded-stage principle**: a stage that completes its purpose *partially* records a warning on the job; a stage that can't serve its purpose *at all* fails the job. Terminal state is `done_with_warnings` iff the warning list is non-empty.

- Total stage failure → job `failed` with a human-readable message surfaced in the UI.
- Partial completion → warning, surfaced in the status header. Concretely: some Tavily queries fail → warn ("14/18 queries succeeded"; *all* fail → job `failed`); no homepage resolved → warn and proceed degraded; LLM-assisted resolution → warn ("identified with low confidence"); classify errors → warn, results shown unclassified (content type is nullable — never defaulted to `other`, which is reserved for genuine type ambiguity).

### Testing

- Unit tests (`node --test "src/**/*.test.ts"` — explicit glob; default discovery shouldn't be trusted to find `.ts` across Node versions) on the pure logic, co-located next to sources (`src/filter/heuristics.test.ts`): URL normalization, title normalization + suffix stripping (adversarial cases: `Acme - The Real Story`, the TechCrunch/Yahoo syndication pair), heuristics (exclusion *codes*, not strings), Collapse guards, the resolve heuristic. Not the API clients.

## 4. Implementation plan

| # | Slice |
|---|---|
| 1 | Express + Nunjucks + HTMX skeleton + DB schema + job queue with fake pipeline → UI shows status end-to-end |
| 2 | Tavily integration + query strategy → real results in the list |
| 3 | Heuristic filters + URL/title normalization + dedup (with unit tests) |
| 4 | Haiku classification pass (structured outputs) + confidence flags |
| 5 | UI polish: type chips, status detail |
| 6 | README (setup), write-up (approach/trade-offs/next), transcript export |

Tracer-bullet ordering: after slice 1 the whole loop works with stub data; every later slice upgrades one stage.

**If time runs short, cut in this order** — each cut is safe because a backstop exists:

1. **Social handle scraping** in Resolve — the classify pass is the own-channel backstop anyway; losing the pre-filter changes nothing about correctness.
2. **Time-sliced queries** — angle queries still carry recall; the list just skews recent.
3. **The Resolve cascade's LLM fallback** — the heuristic + degraded path still works; odd-domain companies just resolve degraded instead of correctly.
4. **Per-hop redirect re-checking** in the SSRF guard — set the redirect cap to 0 instead (stricter, simpler).
5. **Slice 5 polish** — grouping by content type stays (it's "reviewable list" core); type chips and status detail go.

## 5. Explicitly out of scope

Stated deliberately in the write-up:

- **Auth, hosting, CI/CD** (brief says so); rate limiting beyond per-job caps.
- **Multi-provider search**, podcast-specific APIs (Listen Notes), social APIs — Tavily's index surfaces major social/podcast content well enough; native APIs are the scaling step, and the only way to rank "major" social posts by actual engagement.
- **Full-page fetching/content extraction** — classify on title+snippet only; fetching every result is the biggest latency lever and isn't needed for a reviewable list. (This is also why `search_depth: "advanced"` is worth its cost — the snippet is all the classifier sees.)
- **Entity disambiguation** beyond the homepage anchor (e.g., "Apple" the label vs the fruit company) — a known limitation with the homepage-domain trick as partial mitigation.
- **Job retries/concurrency control/queue durability across restart** — the state machine makes the upgrade path obvious. Known consequence: a job mid-flight at process exit stays in its running state forever (the UI will poll it indefinitely). Next steps, in order: a boot-time sweep marking non-terminal jobs `failed` ("interrupted by restart"), then true resume from the last completed stage (requires persisting intermediate stage output). The state machine exposes a general `transition(jobId, toState, message)` so the sweep — and the future cancel button — slot in without pipeline changes.
- **Identity confirmation gate & job cancellation** — resolution is fully automatic in the MVP (a wrong match is bounded by the per-job caps, and the resolved identity + provenance are surfaced prominently so it's obvious immediately). Name/URL conflicts are resolved silently (URL wins), not detected. Next steps, in order: a cancel button for visibly-wrong jobs (a one-attribute HTMX addition), then an `awaiting_confirmation` pause state before search runs. The form hints "provide the URL for unambiguous results."
- **Schema migrations** — local-only, one author; the schema ships final. `db:reset` exists for a fresh start.
- **Semantic dedup** (embedding similarity for syndicated articles) — normalized title collapse + outlet-suffix stripping catches most syndication; embeddings are the next step.
