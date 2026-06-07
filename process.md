# Breakbeat — Process at a Glance

A simple, numbered walkthrough of how a Job goes from input to a reviewable list. For the full rationale, see [`docs/process.md`](docs/process.md).

1. **Submit** — User enters a company name and/or homepage URL on `POST /`. Input is validated, a `companies` row is upserted, a `jobs` row is created, and the page redirects to `GET /:id`.
2. **Compute the window** — Subtract 36 calendar months from the Job's creation date and store `window_start`/`window_end`. Every later date filter reads these stored bounds.
3. **Resolve identity** — Establish the Resolved Identity (company name + own domains + social handles):
   1. If a URL was given, keep its host as an own domain and best-effort fetch the homepage (SSRF-guarded) to confirm the name and scrape handles.
   2. If only a name was given, find the homepage via heuristic match, then LLM fallback, then degrade gracefully with a Warning.
4. **Search** — Build exactly 18 Tavily queries from the Resolved Identity and run them concurrently:
   1. 7 per-content-type queries (news, press release, podcast, blog, newsletter, trade pub, social).
   2. 6 time-sliced news/press-release queries across three 12-month slices.
   3. 5 angle queries (funding, acquisition, leadership, partnership, lawsuit/controversy).
5. **Dedup at insert** — Insert each hit with `INSERT OR IGNORE` against a unique normalized-URL key, so exact-duplicate URLs never become two rows.
6. **Filter (heuristics)** — Apply deterministic soft Exclusions in order: own channel, aggregator, ecommerce/review, out-of-window. Dateless results are kept and flagged.
7. **Collapse** — Fold near-duplicate titles (within 14 days of a cluster anchor) into the earliest-published original; losers become `excluded, duplicate`.
8. **Classify** — Batch the surviving results through Claude Haiku to assign one of the seven Content Types and catch any own-channel/aggregator/ecommerce items the heuristics missed.
9. **Finalize** — Transition the Job to `done` (or `done_with_warnings` if any Warning was recorded; `failed` only on an uncaught error).
10. **Present** — Render the reviewable list grouped by editorial weight, newest first, with excluded results in a collapsed audit section. The page live-polls via HTMX until the Job reaches a terminal state.
