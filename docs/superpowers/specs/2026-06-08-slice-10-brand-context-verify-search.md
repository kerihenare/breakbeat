# Slice 10 — Brand Context, Verify stage & Anthropic search backstop

> Status: spec (awaiting review) · Epic: `aglow-ti2` · Date: 2026-06-08
>
> Builds on shipped slices 4 (Resolve), 5 (Search), 7 (Classify), 8 (Clipping Desk).
> Uses `CONTEXT.md` terms exactly: Job, Resolved Identity, Own Channel, Result,
> Exclusion, Collapse, Content Type, Warning, Angle Query, Time Slice.

## 1. Why

Two gaps in result quality, plus a precision gap:

1. **Thin Resolve context.** We anchor every later stage on the Resolved Identity,
   but today that identity is just name + domains + handles + similarly-named
   negative matches. We have no description of *what the company actually is*, so
   entity disambiguation is left implicit inside Classify.
2. **Single search source.** Search depends entirely on Tavily. When Tavily returns
   few accurate hits, the Job's reviewable list is thin with no fallback.
3. **Verification is implicit.** "Is this Result actually about the target company?"
   is currently a side-effect of the Classify prompt (the negative-match hint). It
   deserves to be a first-class, traceable step with a high certainty bar.

This slice: enriches Resolve with the BrandFetch **Brand API** and **Brand Context
API**; adds an **Anthropic web search** backstop in parallel with Tavily; and
promotes entity verification into its own **Verify** stage that runs *before*
Classify and is anchored on the Brand Context.

## 2. New pipeline shape

```
resolving → searching → filtering → verifying → classifying → (extracting → refining) → done
```

`verifying` is a new `JobStatus` inserted between `filtering` and `classifying`,
with the same terminal/`failed` edges as its neighbours:

- `filtering → verifying | failed`
- `verifying → classifying | done | done_with_warnings | failed`
- (`classifying → extracting | …` unchanged)

## 3. Resolve — richer brand identity

### 3.1 Brand API (existing endpoint, more fields)

`BrandfetchClient.fetchProfile` already calls `GET /v2/brands/{domain}` (this *is*
the Brand API — https://docs.brandfetch.com/brand-api/overview). Extend the parsed
`BrandProfile` to also capture the company fields useful for verification and the
UI: `description`, `industry`, and any `aliases`/alternative names exposed by the
response. Existing fields (`name`, `domain`, `handles`) unchanged.

### 3.2 Brand Context

Add a brand-context fetch to the same adapter, returning a compact:

```ts
type BrandContext = {
  description: string;        // what the company is / does
  industry: string | null;
  aliases: string[];          // alternative names the company is known by
};
```

Stored on the Resolved Identity as a new optional field `context: BrandContext | null`.
Consumed by **Verify** (primary) and **Classify** (its prompt already receives the
identity).

> **Plan-time verification:** confirm BrandFetch's "Brand Context API" endpoint and
> response shape against `docs.brandfetch.com` (WebFetch) during planning. **If no
> distinct Brand Context endpoint exists**, compose the same `BrandContext` shape
> from the Brand API company fields (§3.1) plus the existing Google context — the
> stored shape and all downstream consumers are identical; only the adapter's source
> changes. This keeps the change transparent and is the documented fallback.

### 3.3 Degradation

Brand keys / context unavailable → a **Warning** (`brand context unavailable —
verification will run on name + domains only`), `context` stays null, the Job
proceeds. Never a failure (the reviewable list is the Job's purpose).

## 4. Search — Tavily ∥ Anthropic web search (adaptive backstop)

### 4.1 New port + adapter

```ts
// domain/ports/web-search-backstop.port.ts
export const WEB_SEARCH_BACKSTOP = Symbol("WEB_SEARCH_BACKSTOP");
export interface WebSearchBackstop {
  search(naturalQuery: string): Promise<SearchHit[]>; // SearchHit reused as-is
  isConfigured(): boolean;
}
```

Adapter `AnthropicWebSearch` (infrastructure/anthropic) — Claude with the
server-side `web_search` tool. Returns `SearchHit[]` mapped from the tool's
citations: `url`, `title`, `content` (snippet/encrypted-content text when present),
`sourceDomain` (derived from URL host), `publishedDate` (from page age when
present, else null), `score: null` (no Tavily-style score). `isConfigured()` keys
off `ANTHROPIC_API_KEY` (reused).

A *separate* port from `SearchProvider` because the query models differ: Tavily
consumes the structured `SearchQuery` set (Angle Query × Time Slice);
the backstop consumes natural-language strings.

### 4.2 Stage behaviour (revised `SearchStage`)

1. Build the Tavily structured query set (`buildSearchQueries(identity)` — existing).
2. Build **1–3 broad NL queries** from the identity (name + primary domain, e.g.
   `recent news and coverage about "<name>" (<domain>)`). Pure helper, unit-tested.
3. **Default fan-out (parallel):** run the Tavily set **and** the broad NL queries
   concurrently (`Promise.allSettled` across both). Every hit goes through the
   existing insert-time URL dedup (`results_job_url_unique`); provider overlap is
   collapsed for free.
4. **Escalation:** if the count of usable Tavily results is below
   `TAVILY_THIN_THRESHOLD`, render the full angle set as NL queries through the
   backstop and insert those hits too.
5. **Warnings:** per-provider partial failures recorded as today (`N/M Tavily
   queries failed`; `Anthropic web search failed`).
6. **Job failure rule (relaxed):** fail the Job only if **both** providers yield
   zero usable results. (Today Search fails when *all Tavily* queries fail; with a
   second source that bar moves to "nothing at all to show".) Backstop unconfigured
   simply disables it (Warning), exactly like Tavily unconfigured.

### 4.3 Cost note

Anthropic `web_search` is billed as a server-side tool per call; the default path
fires only 1–3 such calls. The escalation path (full angle set) only triggers when
Tavily is thin. Both facts go in the write-up's cost section.

## 5. Verify — new stage (snippets only)

### 5.1 New port + adapter

```ts
// domain/ports/result-verifier.port.ts
export const RESULT_VERIFIER = Symbol("RESULT_VERIFIER");
export type VerifyDecision = "match" | "mismatch" | "uncertain";
export type VerifyVerdict = { id: string; decision: VerifyDecision; confidence: Confidence };
export interface ResultVerifier {
  verify(inputs: VerifyInput[], identity: ResolvedIdentity): Promise<VerifyVerdict[]>;
  isConfigured(): boolean;
}
```

Adapter `HaikuVerifier` (Claude Haiku, structured outputs). Reuses the Classify
patterns: chunking, a closed-enum JSON schema (no free-text echo channel), and
`validateResultIds` for sent/received id reconciliation. A dedicated verify prompt
that states the Resolved Identity **including the Brand Context** and asks, per
Result, only: *is this content about this specific company?*

### 5.2 Input

Judges **title + snippet + URL** — **no Extract**. (Tavily Extract stays inside
Classify, on its snippet-survivors.) Brand Context + negative matches make snippet
-level entity disambiguation viable and cheap.

### 5.3 Outcome (hybrid)

Per included Result:

| Verdict | confidence | Action |
|---|---|---|
| `mismatch` | high | **Exclude**, code `off_topic`, `exclusion_detail = "LLM"` |
| `match` | any | `verification_status = "verified"` (stays included) |
| `uncertain`, or `mismatch` low-confidence | — | `verification_status = "uncertain"` (stays included) |

Confident off-topic Results are Excluded **before** Classify pays to Extract them —
a cost win and a cleaner Excluded section.

### 5.4 Stage mechanics (`VerifyStage`)

- Not configured, or `identity.context` is null → **Warning** (`verification not
  configured / no brand context — results unverified`), `verification_status` stays
  null for all, stage is a no-op. Graceful degradation.
- Load included Results; apply a cap (`VERIFY_CAP`, mirror `CLASSIFY_CAP`'s 400) with
  a Warning when truncating.
- Chunk → verify concurrently (`Promise.allSettled`); failed chunks → Warning
  (`N/M verification batches failed — those results left unverified`), mirroring
  Classify. One write per Result (Exclude or set `verification_status`).
- A total Verify failure is a **Warning**, never a Job failure.

## 6. Domain & persistence changes

### 6.1 Exclusion code

Add `off_topic` to the closed set. New full set:
`own_channel · aggregator · ecommerce_review · out_of_window · duplicate · off_topic`.
Meaning: *the Result is about a different entity, not the target company.*
`exclusion_detail = "LLM"` records the catcher (never model free text — the
prompt-injection echo channel rule holds). `exclusion_code` is a plain `text`
column, so **no DB change** for the code itself; update the domain enum + `CONTEXT.md`.

### 6.2 Result verification status

New nullable field `verification_status: "verified" | "uncertain" | null` (born
null = not yet verified / Verify didn't run). Migration adds
`results.verification_status text`.

### 6.3 Brand context storage

Add a `jobs.brand_context jsonb` column (`$type<BrandContext>()`) alongside the
existing `context_note` (which keeps holding the Google context lines). Migration
adds the column; repository maps it onto `ResolvedIdentity.context`.

### 6.4 Migration

One Drizzle migration: `results.verification_status` (text, null) +
`jobs.brand_context` (jsonb, null). No backfill (both nullable; existing rows read
as "unverified" / "no context", which is correct).

## 7. Clipping Desk UI (surface now)

- An included Result with `verification_status = "uncertain"` renders a quiet marker
  — *"uncertain — may not be about this company"* — using `DESIGN.md` tokens
  (press-blue accent, hairline, low-emphasis; honours *every claim is traceable*
  without shouting over confident results).
- The Excluded section gains an `off_topic` reason label (e.g. **"Different
  company"**) — it already renders exclusion codes, so this is a label addition.
- `verified` Results render unchanged (no badge — absence of the uncertain marker is
  the signal). Visual treatment routed through `/impeccable`.

## 8. Testing

Follow existing `*.spec.ts` patterns; unit-level, ports faked.

- `ResolveStage`: attaches `context`; Warning when context unavailable; Brand API
  field enrichment.
- `BrandfetchClient`: `fetchContext` happy path + degraded (HTTP error / unparseable
  → null); Brand API field parse.
- `SearchStage`: default parallel fan-out merges both sources; escalation fires only
  below `TAVILY_THIN_THRESHOLD`; Job fails only when **both** sources yield zero;
  backstop-unconfigured degrades to Warning.
- `AnthropicWebSearch`: citation → `SearchHit` mapping; degraded → `[]`.
- `VerifyStage`: high-confidence `mismatch` → Excluded `off_topic`; `match` →
  `verified`; `uncertain`/low-confidence → `uncertain`; not-configured/no-context
  no-op + Warning; partial chunk failure → Warning.
- `HaikuVerifier`: schema shape, id reconciliation, degraded.
- Pipeline: `verifying` status edges; stage ordering Filter → Verify → Classify.

## 9. Out of scope

- Re-running Verify on extracted full text (snippets only this slice).
- Surfacing Brand Context (description/industry) directly in the UI beyond its use
  for verification.
- Sentiment (the existing unused `sentiment` column is untouched).
- Any change to Collapse, Filter heuristics, or Time Slicing.

## 10. Tracking

One new slice under epic `aglow-ti2`. The implementation plan (writing-plans →
to-issues) decomposes into per-stage tickets, roughly: (a) domain — exclusion code,
`verification_status`, `BrandContext` type, `JobStatus` edge; (b) migration +
repository mapping; (c) Resolve Brand API + Brand Context; (d) Search backstop port +
`AnthropicWebSearch` + adaptive stage; (e) `ResultVerifier` port + `HaikuVerifier` +
`VerifyStage` + pipeline wiring; (f) Clipping Desk UI; (g) docs reconciliation
(`CONTEXT.md`, `.env.example` notes, write-up cost section).
