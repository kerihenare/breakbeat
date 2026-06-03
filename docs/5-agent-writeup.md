# Breakbeat — Write-up

## Approach

### Pipeline: Resolve → Search → Filter → Classify

Each job runs four stages in sequence. Every stage transition is persisted so the HTMX-polling UI shows real progress, and the results list assembles visibly as stages complete.

**Resolve** — Before any search runs, the app pins the company's identity. The 36-month window boundary (`job.created_at − 36 calendar months`, date-only UTC) is computed once here and stored on the job row; every later stage reads that stored value so they agree forever. If a URL is provided, the homepage is fetched (SSRF-guarded) to confirm the company name, capture own domains, and scrape social-profile handles (LinkedIn, X/Twitter) for deterministic own-channel exclusion. If only a name is given, a short cascade resolves it: first a heuristic scan of the top-5 Tavily results (domain/title token match), then a Claude Haiku call constrained to `candidate_index: 0–4 | none` (can't hallucinate a domain), then a degraded path (zero domains, the classify backstop carries own-channel alone). Resolution provenance (`url_provided`, `heuristic`, `llm`, `none`) is stored and shown in the status line.

**Search** — ~18 parallel Tavily queries per job (`Promise.allSettled`), all `search_depth: "advanced"`, `max_results: 20`, all with `exclude_domains` set to own domains plus an aggregator blocklist. Three query groups: seven per-content-type queries ("X news", "X press release", "X podcast interview", etc.), six time-sliced news/PR queries (one per 12-month window, countering recency bias where dates are reliable), and five angle queries ("X funding", "X acquisition", "X leadership interview", "X partnership", "X lawsuit OR controversy"). News-ish queries use `topic: "news"` with real `start_date`/`end_date`; dateless types use `topic: "general"` + `time_range: "3y"`. Results are inserted via `INSERT OR IGNORE` against a `UNIQUE(job_id, normalized_url)` constraint — exact-URL dedup fires at insert, not as a separate stage.

**Filter** — Deterministic heuristics first, then Collapse. Heuristics apply a closed exclusion-code vocabulary: own domains/subdomains and own social-profile URL prefixes → `own_channel`; aggregator blocklist → `aggregator`; review domains, ecommerce path segments, anchored title regexes → `ecommerce_review`; published date before `window_start` → `out_of_window`. Results with no detectable date are kept and flagged "date unknown" — dropping them would gut recall. Collapse then groups still-included results by normalized title (≥25 chars after normalization), clusters by anchor-on-earliest within 14 days, and writes losers as `duplicate`. Collapse runs before Classify so the LLM never pays to classify duplicates.

**Classify** — One batched Claude Haiku pass over surviving included results (title + snippet + URL), in chunks of 50 via `Promise.allSettled`. The resolved identity (company name, domains, scraped handles) is in the prompt as context. Output is enforced by Anthropic structured outputs (`output_format: json_schema`) — schema-conformant JSON via constrained decoding. Per-result schema: `{ id, content_type, exclude, confidence }`. No free-text reasoning field — it's both the prompt-injection echo channel and a token burn; the enums are the audit trail. The LLM backstop catches own channels the scrape missed and judgement-call review pages, writing the same exclusion-code vocabulary as the heuristics with `exclusion_detail = 'LLM'`.

### Key decisions

**Exclusion is soft, never a delete.** Every result is stored `included` and exclusion is the only transition. Every excluded result stays visible in the collapsed audit section at the bottom of the job page, grouped by code with per-row detail. The filtering strategy is made visible and debuggable — not hidden.

**Structured outputs for LLM calls.** Both the Resolve cascade's LLM fallback (`candidate_index` from a closed list) and the Classify pass use API-enforced structured outputs. For Classify: no free-text field, closed enums, no tool use. Worst case of a hostile snippet is self-misclassification, which soft exclusion makes visible and recoverable.

**SSRF guard on the one outbound fetch.** The homepage fetch resolves the hostname via `node:dns`, rejects private/loopback/link-local ranges (including IPv6 ULA `fc00::/7`), caps redirects at 3 with per-hop host re-checking, enforces a 5s timeout via `AbortSignal.timeout`, cancels the body stream and discards the remainder at 1MB, and accepts `https?:` only.

**Deduplication at two levels.** `normalizeUrl` (exact-URL dedup key, enforced by DB constraint at insert) and `normalizeTitle` (Collapse key, with outlet-suffix stripping). Both normalizers live in a single `filter/normalize.ts` — no duplication. The outlet-suffix strip uses a full-title ≥25 char check after stripping: `Acme - The Real Story` has a remaining title of only 16 chars, so the suffix is not stripped and the title survives intact.

**Nunjucks custom `where`/`whereNot` filters.** Nunjucks's native `selectattr` uses `===` identity comparison, which fails for string equality in this engine version. The app registers custom `where(arr, key, val)` and `whereNot(arr, key, val)` filters that use `==` and work correctly for grouping results by content type and exclusion code.

---

## Trade-offs

### Main trade-offs (from spec §2)

| Decision | Chose | Over | Why |
|---|---|---|---|
| Retrieval | Single API (Tavily) | Multi-provider | One key, clean results; multi-source is the obvious "next step" |
| Search depth | `advanced` (2 credits/query) | `basic` | Classify runs on title+snippet only, so snippet quality *is* classification quality; result quality is the stated deciding factor — this is the one place we spend |
| Filtering | Heuristics → batched Haiku | LLM-per-result | Deterministic rules handle the clear-cut 80% predictably and debuggably; the LLM is reserved for genuine ambiguity |
| Templating | Nunjucks (autoescape on) | Zero-dep tagged template literals | Boring conventional tooling; escaping is the engine's default, `\| safe` is the explicit greppable opt-out |
| Status | HTMX load-polling | SSE/WebSockets / vanilla-JS poll | Stop-condition lives server-side in the template; scroll survives swaps |
| Jobs | In-process queue | Worker process / Redis queue | Local-only brief; the job table + state machine is what's portable to BullMQ later |
| Storage | SQLite (`node:sqlite`) | Postgres / in-memory | Zero setup for cloner; durable enough to demo dedup properly |
| Recall | ~18 queries × 20 results | Exhaustive pagination/crawling | "As much as possible" bounded by reviewability; the funnel keeps volume reviewable |

### Risks and mitigations (from plan §Risks)

| Risk / trade-off | Mitigation / acceptance |
|---|---|
| Tavily SDK params drift from spec assumptions | Params are named constants in one file; verified against the SDK at integration |
| Anthropic structured-outputs flag unavailable | Fallback pinned: prompt-requested JSON + parse + validate + one retry |
| Wrong company resolved (name-only input) | Provenance surfaced in status line + low-confidence warning; per-job caps bound the damage; form hints "provide the URL" |
| Prompt injection via hostile snippets | Structured outputs, closed enums, no free-text echo field, no tool use; worst case = self-misclassification, visible via soft exclusion |
| SSRF via homepage fetch | Private/loopback/link-local IP rejection (including IPv6 ULA), redirect cap 3 re-checking per hop, 5s/1MB caps, `https?:` only |
| Process restart orphans a running job | Accepted; boot-time sweep is the named next step |
| Cost: ~36 Tavily credits + ~4–6 Haiku calls per job | See cost note below |
| Recency bias in search ranking | Time-sliced news/PR queries counter this |
| FIFO-1 queue: slow job blocks the queue | Visible in jobs list as `pending`; liveness guards bound each stage |

---

## Explicitly out of scope

The following are deliberate omissions from the MVP, stated in spec §5:

- **Mid-flight job recovery on process restart** — a job running when the process exits stays in its non-terminal state. The boot-time sweep re-enqueues `pending` orphans (they hold no partial state), but in-flight jobs need persisted stage output for true resume.
- **Cancel button** — the job state machine's `transition()` function is shaped so a cancel button is a one-attribute HTMX addition + a new terminal transition from non-terminal states; the architecture supports it, the button isn't built.
- **Confirmation gate for identity conflicts** — when name and URL conflict, URL wins silently. An `awaiting_confirmation` pause state before Search would let users review the resolved identity; not implemented.
- **Multi-provider search** — Tavily only. Adding a second provider (Exa, Perplexity, etc.) is the most direct recall improvement.
- **Semantic/fuzzy title dedup** — normalized title collapse + outlet-suffix stripping catches most syndication; embedding-based similarity for paraphrase detection is the next dedup step.
- **Social API integrations for native handle scraping** — the handle scrape is raw-HTML regex over the homepage; JS-rendered SPAs may yield nothing. Native LinkedIn/X APIs would give reliable handle discovery but require OAuth.
- **Page content fetching** — classification runs on title + snippet only. Fetching each result page is the biggest latency lever and isn't needed for a reviewable list.

---

## Next steps

In priority order:

1. **Boot-sweep for in-flight jobs** — mark non-terminal jobs `failed` at boot with reason "interrupted by restart", so stuck jobs don't poll forever. The state machine's `transition()` and the job page's warning section already support this; it's a boot-time `UPDATE` away.
2. **Cancel button** — HTMX `hx-post="/jobs/:id/cancel"` that calls `transition(id, 'failed', 'cancelled by user')`; one new route, no pipeline changes.
3. **Confirmation gate** — add an `awaiting_confirmation` status between `resolving` and `searching`; render a "is this the right company?" review step in the job fragment; HTMX `hx-post` to confirm or restart.
4. **Multi-provider search** — add Exa or Perplexity alongside Tavily; merge results before the filter stage; URL dedup at insert absorbs overlap.
5. **Semantic dedup** — embed result titles/snippets and cluster by cosine similarity to catch paraphrase syndication that exact-title collapse misses.

---

## Cost note

Each job uses approximately:

- **~36 Tavily credits** at `search_depth: "advanced"` (2 credits/query × ~18 queries). Tavily's free tier is ~1,000 credits/month, which is roughly 27 full jobs/month. To reduce cost, set `search_depth` to `"basic"` (1 credit/query, ~18 credits/job) — it's a one-line change in a named constant; snippet quality will be lower, which affects classification quality.
- **~4–6 Claude Haiku API calls** for the Classify pass (chunks of 50 results, cap 400). Haiku is priced at $0.25/M input tokens and $1.25/M output tokens — a full job costs well under $0.05 at typical result volumes.
- Name-only jobs add one extra Tavily `search_depth: "basic"` call for the Resolve cascade (not counted in the 36).
