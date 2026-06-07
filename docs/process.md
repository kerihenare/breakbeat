# Breakbeat — Search & Retrieval Process

How Breakbeat goes from a company name and/or URL to a deduplicated, classified, reviewable list of third-party content from the last 36 months.

This document describes the pipeline **as built**. It uses the domain language from [`CONTEXT.md`](../CONTEXT.md) exactly (Job, Resolved Identity, Own Channel, Result, Exclusion, Collapse, Content Type, Warning, Angle Query, Time Slice). The architecture rationale lives in [`docs/1-spec.md`](1-spec.md); this is the operational walkthrough.

## The shape of it: a funnel of soft exclusions

A **Job** is one run of the pipeline for one company. It moves through a state machine (`src/jobs/queue.ts`):

```
pending → resolving → searching → filtering → classifying → done | done_with_warnings | failed
```

Retrieval is a funnel. Search casts wide (~360 raw hits), then each later stage narrows by **Exclusion**, never by deletion:

```
   ~18 Tavily queries × 20 results          ← Search casts wide
            │
   URL dedup at INSERT (DB unique key)       ← exact-duplicate URLs never become two rows
            │
   Heuristic Exclusion (deterministic)       ← own channel, aggregator, ecommerce/review, out-of-window
            │
   Collapse (near-duplicate titles)          ← syndication copies fold into the earliest original
            │
   Classify (LLM backstop + Content Type)    ← own-channel backstop + the seven content types
            │
   Reviewable list (included) + audit trail (excluded)
```

**Every Result is born `included`.** The only transition is to `excluded`, carrying a machine-groupable `exclusion_code` (`own_channel`, `aggregator`, `ecommerce_review`, `out_of_window`, `duplicate`) and a nullable `exclusion_detail`. Nothing is ever dropped — excluded Results stay in the database and surface in a collapsed audit section. The only content that is genuinely *absent* is content Search never returned. This is what makes the filtering strategy debuggable: you can always see *why* a Result was excluded, and by which rule.

`exclusion_code` records **why**, never which stage caught it — the Classify backstop writes the same vocabulary as the heuristics. Where the LLM is the catcher, `exclusion_detail` is the literal string `"LLM"` (never free text echoed from the model — that would be a prompt-injection channel into our UI).

---

## Stage 0 — Job creation and identity matching

`POST /` (`src/routes/jobs.ts`) accepts a company name and/or homepage URL, validates input (name length cap + non-empty; URL must parse and be `http(s):`), upserts a `companies` row, creates a `jobs` row, kicks off the pipeline in-process, and 303-redirects to `GET /:id` (Post/Redirect/Get — refresh-safe).

The `companies` row is just the **durable raw input**. Identical input reuses it; every Job resolves fresh, so the Resolved Identity lives on the Job, not the company. "Identical input" matches on `(lowercase-trimmed name, normalized URL host)`. When a URL is given, the host is the identity key; a later name-only or name+URL submission backfills onto the same row rather than forking a duplicate company. If name and URL conflict, **the URL wins** — it is the higher-fidelity signal — and the name is kept only as a display label.

---

## Stage 1 — Resolve: establish the anchor

`src/jobs/resolve.ts`. Resolve produces the **Resolved Identity** — the company name plus zero or more own domains and scraped social handles — that every later stage filters against.

### The 36-month window is computed once, here

`computeWindow()` takes `job.created_at`, subtracts 36 calendar months (date-only, UTC, with month-end clamping), and stores `window_start`/`window_end` on the Job row. Every query and every date filter reads the *stored* boundary, so they can never disagree. The Job page states it explicitly (e.g. "window: 2023-06-07 → 2026-06-07").

### The resolution cascade

The cascade mirrors the filter funnel's philosophy: **deterministic first, LLM only for genuine ambiguity.**

- **URL provided** (`resolveFromUrl`): the given host is kept as an own domain *regardless of fetch outcome* — we never discard knowledge the user supplied. The homepage is then fetched (SSRF-guarded, below) best-effort to confirm the name (`<title>`) and scrape social handles (`extractHandles` — LinkedIn `/company/` URLs and X/Twitter handles via raw-HTML regex). Provenance: `url_provided`. If the fetch fails, the Job proceeds with the host as a domain-only identity and records a **Warning** ("social handles not scraped, own-channel exclusion is domain-only").

- **Name only** (`resolveFromName`): a three-step cascade over the top 5 Tavily results for `"<name> official website"`:
  1. **Heuristic** (`pickHomepage`): first candidate passing *both* guards wins — domain not on the `NEVER_HOMEPAGE` blocklist (`wikipedia.org`, `linkedin.com`, `x.com`, `crunchbase.com`, `github.com`, …), and a name-token match in the domain or title (`acme` ⊆ `acme.com` / `getacme.io` / "Acme, Inc."). Provenance: `heuristic` — the confident path.
  2. **LLM fallback** (only when the heuristic finds nothing): one Haiku call (`callLlmForHomepage`) over the *same* top 5, constrained by structured output to `candidate_index: 0–4 | "none"`. It picks from a closed list we hand it — it cannot introduce a domain, so the injection blast radius is "picks the wrong item from our own list." Provenance: `llm`, plus a Warning ("identified with low confidence — verify"). This path exists precisely for companies whose domain shares no token with their name (Alphabet → `abc.xyz`).
  3. **Degraded**: both fail → proceed with zero domains/handles and a Warning ("no homepage identified — own-channel exclusion is LLM-only"). The Classify backstop then carries own-channel alone.

Provenance is recorded on the Job and shown in the status line ("Identified as: abc.xyz (LLM-assisted)"), so the confidence of every resolution self-reports.

### SSRF guard on the one real fetch

The homepage fetch is the **only** outbound HTTP fetch in the system (Results are never fetched — title + snippet is all there is). `isSafeUrl` resolves the hostname via DNS and rejects loopback / private / link-local ranges (IPv4 and IPv6, including IPv4-mapped IPv6). `fetchHomepage` enforces `https?:` only, a 5s timeout, a manual redirect cap of 3 **re-checking each hop's host**, and a 1 MB response cap. The timeout and size caps double as liveness guards — a hanging homepage would otherwise stall the FIFO-1 queue for every Job behind it.

---

## Stage 2 — Search: cast wide across angles, not slices

`src/search/tavily.ts`. `buildQueries()` is a pure function that generates **exactly 18 Tavily queries** from the Resolved Identity, in three groups. All carry `search_depth: "advanced"` and `max_results: 20` (~360 raw hits), and all are excluded from the company's own domains, scraped handle hosts, and the aggregator blocklist via Tavily's `excludeDomains`.

> **Why `advanced` everywhere:** classification runs on title + snippet only — no page fetching. **Snippet quality *is* classification quality**, so this is the one place we deliberately spend (2 credits/query vs 1; ~36 credits/job). It is a one-line downgrade if cost matters.

### Group 1 — Per Content Type (7 queries)

`"<name> news"`, `"<name> press release"`, `"<name> podcast interview"`, `"<name> blog post"`, `"<name> newsletter"`, `"<name> trade publication"`, `"<name> social media"`.

- **News and press release** use `topic: "news"` with real `startDate`/`endDate` bounds — the news index is where `published_date` is reliable.
- The other five use `topic: "general"` with `timeRange: "year"` as a best-effort recency filter (Tavily has no 3-year `timeRange`; dateless results are kept and flagged downstream rather than dropped).

### Group 2 — Time-Sliced news & press releases (6 queries)

The 36-month window is tiled into three exact 12-month **Time Slices**, and `"<name> news"` + `"<name> press release"` is run once per slice with that slice's `startDate`/`endDate` and `topic: "news"`. This counters recency bias so the list visibly spans the full window. Slicing is applied **only** to news and press releases — the two types where Tavily dates are reliable and archives are deep. Running it on dateless types (blogs, podcasts, social) would just return the same top hits per slice and pay 3× for noise.

### Group 3 — Angle Queries (5 queries)

`"<name> funding"`, `"<name> acquisition"`, `"<name> leadership interview"`, `"<name> partnership"`, `"<name> lawsuit OR controversy"`.

An **Angle Query** is phrased around an *event type* rather than a content type. Distinct phrasings surface distinct coverage; the way to scale recall further is **more angles, not more slices.** Overlap between angles is absorbed by URL dedup at insert.

### Execution and exact-URL dedup at insert

`runSearch()` fires all 18 queries concurrently via `Promise.allSettled` — the per-Job caps already bound the fan-out, so no concurrency-limiter dependency is needed. Each hit is inserted with `INSERT OR IGNORE` against a `UNIQUE(job_id, normalized_url)` constraint: **exact-URL dedup is not a stage — it is the database key, firing at insert time.** A hit whose URL fails to parse is skipped.

`normalizeUrl` (`src/filter/normalize.ts`) is the pinned dedup key: lowercase host + strip `www.`, drop the scheme (so `http`/`https` copies collapse), strip the fragment, strip **only known tracking params** (`utm_*`, `fbclid`, `gclid`, `mc_cid`, `ref`, `source`) while keeping everything else (so `?v=…` / `?id=…` content params survive), sort remaining params, strip the trailing slash, and **preserve path case**. The *original* URL is stored separately — that is what the UI links to.

### Failure semantics

Per-query failure → **Warning** ("14/18 search queries failed"). **All** queries failing → the stage throws and the Job is `failed` — Search is the one stage whose total failure leaves nothing to show.

---

## Stage 3 — Filter: deterministic heuristics, then Collapse

`src/filter/heuristics.ts`. Two passes over the still-`included` Results, both writing soft Exclusions.

### Pass A — Heuristic Exclusion (`heuristicExclusion`, `applyHeuristics`)

Each Result is tested in order; the first matching rule wins:

1. **`own_channel`** — `source_domain` matches an own domain or any subdomain (`acme.com` blocks `blog.acme.com` but not `notacme.com`), **or** the Result URL prefix-matches a scraped own handle at a path-segment boundary (`matchesHandlePrefix`, with `twitter.com` canonicalized to `x.com`). Note this excludes the company's *own* social profiles, **not** social domains wholesale — a journalist's post *about* the company is in scope.
2. **`aggregator`** — `source_domain` is on the `AGGREGATOR_BLOCKLIST` (`news.ycombinator.com`, `reddit.com`, `news.google.com`, `apple.news`, …) or a subdomain of one. **Medium is deliberately *not* listed** (it hosts original blog posts); **Reddit *is* excluded wholesale** — where a site is both an explicit exclude and a possible include, the exclusion wins, and soft Exclusion keeps it visible anyway.
3. **`ecommerce_review`** — a review-site domain (`g2.com`, `capterra.com`, `producthunt.com`, …), an ecommerce URL **path** segment (`/product/`, `/pricing/`, `/vs/`, `/compare/`, `/alternatives/`, …), or an anchored title pattern (`^best .* (alternatives|tools|software)`, `(review|comparison) of`, `^top \d+`). `vs` is a **path pattern only** — "Acme vs the regulators" is legitimate news, so it is never a title match.
4. **`out_of_window`** — a parseable `published_date` strictly before `window_start`. **Dateless Results are KEPT** and flagged "date unknown" downstream — dropping them would gut recall and break the 36-month promise's honesty.

### Pass B — Collapse (`collapse`)

Near-duplicate **Collapse** runs at the tail of Filter, over still-`included` Results only — an already-Excluded aggregator copy can never win and swallow legitimate coverage. Running it before Classify means the LLM never pays to classify duplicates.

The key is `normalizeTitle`: NFKC → outlet-suffix stripping (drop a trailing ` | TechCrunch` / ` - Yahoo Finance` segment, final separator only, only when the remainder stays ≥ 25 chars and the segment is ≤ 40 chars) → lowercase → strip punctuation → collapse whitespace → **exact match**.

Algorithm:
- Titles shorter than 25 normalized chars are skipped (too little signal); singleton groups are ignored.
- Within a group, dated copies are sorted ascending and clustered **anchored on the earliest member**: a copy joins a cluster iff it is within 14 days of that cluster's *anchor* (no pairwise chaining drift). So the same title 18 months apart is two stories, while boundary-straddling results from adjacent Time Slices still collapse.
- The **winner is the earliest-published copy** (proxy for the original; syndication copies follow it); losers become `excluded, duplicate, "of #<winner.id>"`.
- A date-unknown copy joins only when the group is **unambiguous**: with 0 or 1 dated clusters it folds in (winner = the dated anchor, or the lowest id in an all-undated group); with 2+ dated clusters it stays `included` rather than being guessed into a story.

---

## Stage 4 — Classify: the LLM backstop and the seven Content Types

`src/filter/classify.ts`. A batched Claude Haiku (`claude-haiku-4-5`) pass over the surviving `included` Results, seeing title + snippet + URL + source domain, with the Resolved Identity (name, domains, handles) in the prompt as context.

- **Selection & caps:** up to `CLASSIFY_CAP` (400) Results, fetched one past the cap so an overflow is *reported* via Warning, never silently truncated. Chunked into groups of `CLASSIFY_CHUNK_SIZE` (50) and fired concurrently via `Promise.allSettled` (~4–6 parallel calls).
- **Output is enforced by the API:** Anthropic structured outputs (`output_config.format: json_schema`) guarantee schema-conformant JSON via constrained decoding — no tool use. Per Result: `{ id, content_type, exclude, confidence }`. `content_type` is the brief's seven categories verbatim plus `other`; `exclude` is `none | own_channel | ecommerce_review | aggregator`; `confidence` is `high | low`, covering both the type and exclusion decisions.
- **No free-text reasoning field** — it would be a prompt-injection echo channel and burn output tokens across hundreds of Results. The enums *are* the audit trail. The worst a hostile snippet can do is misclassify itself, which soft Exclusion makes visible.
- **ID reconciliation** (`validateResultIds`): the schema can't force the model to echo our IDs, so a thin sanity layer keeps only recognized IDs (first occurrence wins on duplicates), and reports both **rogue** IDs (returned but never sent → discarded) and **missing** IDs (sent but never returned → left unclassified) as Warnings, so nothing vanishes without a trace.
- **Applying results:** `exclude !== "none"` writes a soft Exclusion with `exclusion_detail = "LLM"`; otherwise the Result gets its `content_type` + `confidence`.

This is the **own-channel backstop**: anything the deterministic handle/domain rules missed (degraded resolutions, unscraped SPAs, the company's GitHub org) falls through to here.

### Why "major" social posts are read as "search-surfaced"

The brief asks for "*major* social posts." Tavily exposes no engagement signal, so "major" is interpreted as "surfaced by search ranking." True engagement thresholds need native social APIs (out of scope).

### Classify failure is a Warning, not a failure

A failed chunk → Warning; those Results stay **unclassified** (`content_type` NULL — never defaulted to `other`, which is reserved for genuine type ambiguity). Even a *total* Classify failure is only `done_with_warnings`, not `failed` — the reviewable list is the Job's purpose and it still exists, just untyped and with the own-channel backstop unaudited. "Unclassified" is a *reading* of NULL at a terminal state; mid-Job, NULL just means awaiting classification.

---

## Finalize and present

`src/jobs/pipeline.ts` orchestrates all four stages in a single `try/catch` (any uncaught throw → `failed` with a human-readable message). `finalize()` then transitions to `done_with_warnings` iff the Job accumulated any **Warning**, else `done`.

The reviewable list (`src/views/`) is grouped by **editorial weight, not alphabet**: News → Trade publications → Press releases → Podcasts → Blog posts → Newsletters → Social posts → Other → Unclassified. Within a section, published date descending; date-unknown rows sink to the bottom with a visible badge. Low-confidence Results carry an inline badge (a low-confidence news item is still news). The Excluded section is one collapsed `<details>` block at the bottom, grouped by `exclusion_code` with counts — the audit trail, not the product.

### Progress is live and progressive

While the Job runs, `GET /:id` self-replaces via HTMX load-polling (`hx-trigger="every 2s"`, `hx-swap="outerHTML"`). One route renders two depths — a fragment when the `HX-Request` header is present, the full page otherwise. The status header shows per-stage counters and the list visibly assembles as stages run. When the Job reaches a terminal state, the server renders the same fragment *without* the polling attributes, so **polling stops server-side, from the template** — there is no client-side state machine.

---

## Caps, concurrency, and cost (the bounds in one place)

All named constants, in `src/search/tavily.ts` unless noted:

| Bound | Value | Purpose |
|---|---|---|
| `MAX_QUERIES` | 20 (strategy uses 18) | Bounds Search fan-out |
| `max_results` / query | 20 | The purest recall knob |
| `search_depth` | `advanced` | Snippet quality = classification quality |
| `CLASSIFY_CAP` | 400 | Bounds LLM spend |
| `CLASSIFY_CHUNK_SIZE` | 50 | Batch size = ~4–6 parallel Haiku calls |
| Queue concurrency | 1 (FIFO) | In-process; the *interface* ports to a real queue later |
| Homepage fetch | 5s / 3 redirects / 1 MB | SSRF + liveness guard |

**Caps sit *above* the strategy's natural output — they bound runaway failure, never recall.** Recall is bounded only by what the funnel keeps reviewable. API keys live only in `.env`, are checked at boot, and are never sent to the client. Untrusted Tavily titles/snippets are escaped on render (Nunjucks autoescape; `| safe` is the only, greppable, opt-out) and are treated as prompt-injection surface in Classify (structured outputs, closed enums, no free-text echo, no tool use).
