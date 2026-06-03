# Breakbeat

Finds third-party content about a company from the last 36 months via a background pipeline, and presents it as a reviewable list. Single context.

## Language

**Job**:
One run of the pipeline for one company, moving through a state machine from `pending` to a terminal state.
_Avoid_: task, search (a Job *contains* a Search stage)

**Resolved Identity**:
The company name plus *zero or more* own domains and scraped social handles, established per-Job by the Resolve stage; the anchor every later stage filters against. Domains/handles are optional — a name-only input that resolves no homepage proceeds degraded (with a Warning), leaving Own Channel exclusion entirely to the Classify backstop.
_Avoid_: company profile, match

**Own Channel**:
A surface the company *controls* — its domains, or its named accounts/profiles on third-party platforms (its LinkedIn page, its X handle, its Substack). Content on a controlled surface is always excluded. Control, not authorship, is the test: a wire-distributed press release or a company-bylined guest post sits on *someone else's* editorial surface and is in scope; content *about* the company on any platform is in scope.
_Avoid_: own site (too narrow — misses social accounts); "authored by the company" (wrong test — it would exclude press releases, a required Content Type)

**Result**:
One search hit returned by the Search stage, stored permanently with a `status` of `included` or `excluded`. Born `included`; Exclusion is the only transition. Scoped to its Job — re-runs produce fresh Results. ("Fetch" is reserved for the one real HTTP fetch: the Resolve homepage fetch.)
_Avoid_: hit, item, link, fetched (Result pages are never fetched — title+snippet is all there is)

**Exclusion**:
Marking a Result `excluded` with a machine-groupable `exclusion_code` (closed set: `own_channel`, `aggregator`, `ecommerce_review`, `out_of_window`, `duplicate`, `llm_excluded`) plus a nullable human-readable `exclusion_detail` ("of #42", the LLM's stated reason). Soft — never a delete; nothing is dropped except by never being returned by Search.
_Avoid_: drop, delete, filter out (as a verb for the action)

**Collapse**:
Deduplicating near-identical Results on normalized title; runs at the tail of the Filter stage, over still-`included` Results only (an already-Excluded copy never competes or wins). The winner is the earliest-published copy, losers are Excluded as duplicates. There is no dedup *stage*: exact-URL dedup happens at insert time during Search (DB unique constraint).
_Avoid_: merge, dedupe (say "URL dedup" for the insert-time constraint, "Collapse" for the title pass)

**Content Type**:
The brief's seven categories verbatim (news article, trade publication, blog post, press release, major social post, newsletter, podcast) plus `other` as the explicit escape hatch. Assigned only by the Classify stage and nullable — a failed classify leaves Results "unclassified" (never defaulted to `other`, which is reserved for genuine type ambiguity) under `done_with_warnings`.

**Warning**:
A recorded note that a stage completed its purpose *partially* (3 of 18 search queries failed, no homepage resolved, classify errored leaving Results unclassified). A stage that can't serve its purpose at all fails the Job instead. Terminal state is `done_with_warnings` iff the Job's warning list is non-empty.
_Avoid_: error (errors fail the job), partial failure (a Warning is a partial *success*)

**Angle Query**:
A search query phrased around an event type ("X funding", "X acquisition") rather than a content type — recall comes from more angles, not more slices.

**Time Slice**:
One 12-month `start_date`/`end_date` window of a query; applied only to news and press releases, where dates are reliable.

## Relationships

- A **Job** belongs to one company and produces many **Results**; the company row is just the durable raw input (name/URL) — re-runs reuse it but resolve fresh
- A **Job**'s Resolve stage produces one **Resolved Identity** (job-scoped); Search, Filter, and Classify all consume it
- A **Collapse** Excludes all but one of a set of near-duplicate still-`included` **Results**
- An `included` **Result** is assigned one **Content Type** by the Classify stage — or none, if classify fails (**Warning**)
- A **Job** accumulates **Warnings**; any Warning turns `done` into `done_with_warnings`

## Example dialogue

> **Dev:** "The heuristic pass dropped a bunch of Reddit links."
> **Domain expert:** "Nothing is *dropped* — they're **Excluded** as aggregators, with the reason on the row. They'll show in the collapsed excluded section."
> **Dev:** "And the company's LinkedIn posts?"
> **Domain expert:** "**Own Channel**, Excluded. But a journalist's LinkedIn post *about* the company is in scope — Own Channel is about the author, not the platform."

## Flagged ambiguities

- "drop" was used for both *never returned* and *filtered out* — resolved: filtered-out Results are **Excluded** (soft, with reason); only content never returned by Search is absent.
- "own site" vs **Own Channel** — resolved: exclusion covers the company's accounts on third-party platforms, not just its domains, and never third-party content on those platforms.
- **Own Channel** as "authored by the company" contradicted the brief — press releases are company-authored by definition yet a required Content Type. Resolved: the test is *control of the surface*, not authorship; wire releases and guest posts are in scope.
- "fetched" implied Result pages are retrieved — they never are (out of scope). Resolved: Results are *returned* by Search; "fetch" names only the Resolve homepage fetch.
- Whether an Excluded copy could win a **Collapse** (earliest-published aggregator copy swallowing legitimate coverage) — resolved: the Collapse pool is `included` Results only.
- Dedup appeared as both a pipeline stage and an insert-time constraint — resolved: no dedup stage exists; URL dedup fires at insert (Search), title-**Collapse** runs at the tail of Filter, before Classify (so the LLM never pays for duplicates).
