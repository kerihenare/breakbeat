# Breakbeat — Process at a Glance

A numbered walkthrough of how a Job goes from input to a reviewable list, in the re-architected (`aglow`) pipeline. For the domain language, see [`CONTEXT.md`](CONTEXT.md); for rationale, the per-slice specs in [`docs/superpowers/specs/`](docs/superpowers/specs/).

1. **Submit** — User enters a company name and/or homepage URL. With only a name, **BrandFetch Brand Search** offers candidate brands to pick from (disambiguation); a URL skips selection. A `jobs` row is created (status `pending`) and the page redirects to `/jobs/:id`.
2. **Enqueue** — The Job is placed on the BullMQ `pipeline` queue; a worker process picks it up. The 36-month window is computed once from the Job's creation date.
3. **Resolve** — Establish the Resolved Identity:
   1. **BrandFetch Brand API** on the chosen domain → own domains + social handles.
   2. **Google** search `"{name}" "{domain}" -site:{domain}` → extra company context.
   3. **BrandFetch Brand Search** on the name → similarly-named brands stored as **negative matches**.
   Missing signals (no key, no domain, API error) record a Warning and proceed degraded.
4. **Search** — Build 18 **Tavily** queries from the Resolved Identity (7 per-content-type + 6 time-sliced news/PR + 5 angle), excluding own domains, own-social hosts, the aggregator blocklist, and the negative-match domains. Fire concurrently; per-query failure → Warning, all-fail → Job failed.
5. **Dedup at insert** — Each hit is inserted against a `UNIQUE(job_id, normalized_url)` constraint, so exact-duplicate URLs never become two rows.
6. **Filter** — Deterministic soft Exclusions in order: own channel, aggregator, ecommerce/review, out-of-window. Dateless results are kept and flagged.
7. **Collapse** — Fold near-duplicate titles (within 14 days of a cluster anchor) into the earliest-published original; losers become `excluded, duplicate`.
8. **Extract + Classify** — **Tavily Extract** pulls page content per surviving result; **Claude Haiku** (structured outputs) assigns one of the Content Types and catches any own-channel/aggregator/ecommerce the heuristics missed, using extracted content + identity + negative matches as context. Extract failures degrade to the search snippet; classify failures are a Warning (results left unclassified), never a Job failure.
9. **Finalize** — Transition to `done` (or `done_with_warnings` if any Warning; `failed` only on an uncaught error in a stage that left nothing to show).
10. **Present** — Render the reviewable list grouped by editorial weight, newest first, with excluded results in a collapsed audit section. The page streams status via **Server-Sent Events** until the Job reaches a terminal state.
