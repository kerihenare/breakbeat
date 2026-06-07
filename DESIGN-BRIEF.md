# Design Brief — Breakbeat: Search + Results

> Companion to `PRODUCT.md` (who/why) and `DESIGN.md` (how it looks). This brief is the build contract for the search-and-results experience. Stack: **HTMX + Web Components + Tailwind v4**, on the inherited Drumbeat brand.

## 1. What we're building

A two-pane "Clipping Desk" for running company content-searches and reading classified results. It keeps v1's information model (jobs → classified, sourced content items) and lifts the craft onto the Drumbeat brand, in a split layout, with two net-new reading aids (sentiment summary, richer company header).

This is a **product** surface: design serves the task. The classified results are the loudest thing on screen; the search rail and chrome recede.

## 2. Product model & data

**Job** — one search. Fields:
- `id`, `company` (display name), `query` (the boolean search string actually run), `homepageUrl`
- `identifiedAs` (e.g. "Apple") + `identifiedFrom` ("from URL")
- `status`: `running` | `done` | `done_with_warnings` | `failed`
- `window`: `{ from, to }` (the search date range)
- `counts`: `{ returned, excluded, classified }`
- `warnings`: string[] (surfaced, never hidden)
- `startedAt`

**Result item** — one piece of discovered content:
- `title`, `url`, `sourceDomain`, `publishedAt`
- `type`: `news` | `trade` | `press_release` | `podcast` | `blog` | `newsletter` | `social` | `other` | `unclassified`
- `excludedReason` (when excluded): `own_channel` | `aggregator` | `ecommerce_review` | `duplicate`
- `sentiment` *(net-new, mocked)*: `positive` | `neutral` | `negative`

**Classification groups** (from v1, preserve exactly): News, Trade publications, Press releases, Podcasts, Blog posts, Newsletters, Social posts, Other, Unclassified. **Exclusion buckets:** Own channel, Aggregator, Ecommerce/review, Duplicate.

## 3. Information architecture & layout

**Split layout** (`Search rail + Results`):

```
┌──────────────┬─────────────────────────────────────────────┐
│  SEARCH RAIL │  RESULTS PANE                                │
│  (≈320px)    │                                              │
│              │  Job header (company profile / key facts)    │
│  New search  │   identified-as · status+warnings · window   │
│   - company  │   counts: returned · excluded · classified   │
│   - homepage │  ──────────────────────────────────────────  │
│   [Start]    │  Sentiment summary  (stacked bar + labels)   │
│              │  ──────────────────────────────────────────  │
│  Recent jobs │  Filter: All · News · Trade · Press · …       │
│   · job ●done│  ──────────────────────────────────────────  │
│   · job ⟳run │  Grouped results                             │
│   · job ⚠warn│    News (124)                                │
│   · …        │      ▸ title — source · date                 │
│              │      ▸ …                                      │
│              │    Press releases (6) …                       │
│              │    Excluded / Unclassified (de-emphasized)   │
└──────────────┴─────────────────────────────────────────────┘
```

- **Rail** is persistent (the workspace): *New search* form above a selectable *Recent jobs* list. Active job is highlighted.
- **Results pane** renders the selected job. Scrolls independently of the rail.
- **Responsive:** below `lg` (1024px) the rail collapses to a top bar (search + a "recent jobs" disclosure / drawer); results take the full width. The split is a desktop affordance, not a mobile one.

## 4. Screens & states

The single screen is the split view; states live in the results pane and the rail.

- **First run / no job selected:** rail shows the search form + (empty) recent jobs; results pane shows a calm empty state ("Name a company to start tracking its coverage") — not a blank panel, not a fake hero.
- **Search running:** on submit, results pane shows a **running** state (the job header with a live status chip + a determinate-feeling progress affordance). HTMX polls for status; on terminal status it swaps to the full results view. The new job appears at the top of the rail immediately (out-of-band swap), marked running.
- **`done`:** full results view.
- **`done_with_warnings`:** identical, with the warning(s) surfaced as a visible, dismissible-but-not-hidden notice in the job header (coral surface + label + icon, never color alone). Warning count shown on the rail chip too.
- **`failed` / classification failed:** the Unclassified group explains itself ("classification failed, see warnings"); a hard job failure shows a clear error state in the pane with a retry action.
- **Empty filter:** if a content-type filter has zero items, show a one-line "No {type} found in this window," not an empty void.
- **Long/short content:** titles wrap to max 2 lines with ellipsis; measure capped at 65–75ch in any prose; the results list virtualizes or paginates only if a job exceeds ~300 items (v1 apple.com had 296 — a plain long list is acceptable for the first pass; note the perf ceiling).

## 5. Component inventory

**Server-rendered HTML partials** (HTMX swap targets — light DOM, Tailwind-styled):
- `search-form` — company + homepage URL fields, Start button.
- `recent-jobs-list` + `recent-job-row` — selectable rows; status chip, count, relative time.
- `job-pane` — the whole results pane for a job (header + sentiment + filter + groups).
- `job-header` — identified-as, status, warnings, count triad, window.
- `result-group` — a type heading + its `result-item`s.
- `result-item` — title (external link), source domain (mono), date (mono), type badge.

**Web Components** (encapsulated client-side behavior; see §6 for the styling rule):
- `<bb-result-filter>` — the content-type tabs. Toggles visibility of `result-group`s **client-side** (instant, no round trip, since the full result set ships with the job). Updates counts, manages the active tab, keyboard-navigable (arrow keys + roving tabindex).
- `<bb-sentiment-gauge>` — the sentiment summary: an accessible horizontal stacked bar (positive/neutral/negative) with text labels and counts. Reads counts from attributes. Animates width on mount (reduced-motion: appears instantly).
- `<bb-job-status>` — the live status chip: pulses while `running` (reduced-motion: static), settles to `done` / `done_with_warnings` / `failed`.
- `<bb-copy-link>` *(optional)* — copy a result's source URL with confirmation feedback.

Keep result items as server-rendered HTML, not Web Components; reserve WCs for genuinely interactive or self-contained widgets.

## 6. Technical architecture

### HTMX flows
- **Start search:** `hx-post="/jobs"` from the form → server creates the job, returns the running `job-pane` into `#results`; an out-of-band swap (`hx-swap-oob="afterbegin:#recent-jobs"`) prepends the new rail row.
- **Status polling:** the running `job-pane` includes `hx-get="/jobs/{id}" hx-trigger="every 2s" hx-swap="outerHTML"`; it stops polling itself once the returned fragment is terminal (the terminal fragment simply omits the polling trigger).
- **Open a recent job:** `hx-get="/jobs/{id}" hx-target="#results" hx-push-url="true"` so each job is linkable/back-button-able.
- **Filtering:** handled **client-side** by `<bb-result-filter>` (no round trip). Server-side filtering (`?type=`) is the fallback only if result sets grow past the in-DOM ceiling.
- HTMX auto-processes `hx-*` attributes in swapped fragments; custom elements auto-upgrade on insertion, so no manual `htmx.process()` is needed for the Web Components.

### Web Components + Tailwind (important styling rule)
Tailwind utility classes **do not pierce shadow DOM**, but CSS custom properties **do** inherit through it. Therefore:
- **Default to light-DOM Web Components** (no shadow root) so Tailwind utilities apply and HTMX can target inside them. Use this for `<bb-result-filter>` and `<bb-job-status>`.
- **Use shadow DOM only where encapsulation earns it** (e.g. `<bb-sentiment-gauge>`), and inside it style with the Drumbeat **CSS custom properties** (`var(--ui-text)`, `var(--color-press-blue)`, etc.) rather than Tailwind utilities. The tokens are already exposed as custom properties by the Drumbeat/Tailwind v4 layer.

### Tailwind v4
- Map the `DESIGN.md` frontmatter tokens into the Tailwind v4 `@theme` (newsprint/ink/press-blue scales, FK Grotesk, radii, spacing). Reuse Drumbeat's `--ui-*` semantic names where possible so this stays brand-aligned and easy to reconcile with the platform later.
- FK Grotesk: load the brand webfont with `font-display: swap`; `system-ui` fallback is already in the stack.

### Progressive enhancement
- The form and job links work as plain HTML POST/GET without JS; HTMX upgrades them to partial swaps. Web Components enhance an already-rendered, already-readable results list (filter works as visible groups even before JS upgrades; the filter just hides/shows).

## 7. Visual direction

Per `DESIGN.md` ("The Clipping Desk"): warm **newsprint** paper (`#efe8e3`), **ink charcoal** type (`#292a2a`), a single **press-blue** accent (`#1a8cd6`, focus `#46bbff`), **FK Grotesk** throughout, flat surfaces with hairline borders. Mono (`ui-monospace`) for source domains, dates, counts.

- **Rail:** quiet — newsprint-muted surface, ink labels, the active job marked with a press-blue marker (not a heavy fill).
- **Job header:** the count triad reads as three clear figures (title-weight numbers, mono/label captions), not a gradient hero-metric block.
- **Type badges:** small label-type chips. Use the semantic brand families *sparingly and meaningfully* — e.g. press-blue for News, green for "live"/recent, neutral for the rest. Always badge text + (optional) shape, never color alone.
- **Sentiment:** positive = live-green, negative = alert-coral, neutral = ink/newsprint. Each segment labeled with its count.
- **Honor the bans:** no SaaS purple gradient, no hero-metric template, no identical card grids, no cluttered-enterprise density, no border-left stripes, no gradient text, no per-section all-caps eyebrows. Don't nest cards.

## 8. Motion
Responsive, not choreographed (per PRODUCT.md). `0.15s` ease-standard for hover/focus/selection and filter toggles; ease-out-entrance for the results swapping in and the sentiment bar filling. Running status pulses. Every motion has a `prefers-reduced-motion` instant/crossfade fallback. No motion that delays reading the results.

## 9. Accessibility (WCAG 2.1 AA)
- All body/meta text ≥4.5:1 (muted metadata on newsprint already clears it; verify badges).
- Full keyboard path: form → Start → rail job selection → filter tabs (roving tabindex, arrow keys) → result links. Visible `#46bbff` focus rings everywhere.
- Status and warnings announced via an `aria-live` region when a job transitions running → done/warning/failed.
- Sentiment gauge is not color-only: labels + counts carry the meaning; bar is supplementary.
- External result links: descriptive accessible names (title text), `rel="noopener noreferrer"`, and a visual + `aria` indication they open in a new tab.

## 10. Mock data plan
Realistic fixtures modeled on the v1 apple.com job: believable sources (bloomberg.com, 9to5mac.com, macrumors.com, cnet.com, …), real-shaped titles, ISO dates within the window, a plausible distribution across all types (heavy News, light Trade), a handful of exclusions per bucket, one `done_with_warnings` job, one `running` job (to exercise polling), one `failed`/classification-failed case. Sentiment values assigned per item so the gauge has real proportions. Structure the data access behind one module so a real API swaps in as a single change.

## 11. Out of scope (this pass) / follow-ups
- No real search/aggregation backend — mock only.
- No auth, no job management beyond run + revisit (no delete/share/export yet).
- Sentiment is fabricated; if the real pipeline can't produce it, the section is removable without disturbing the layout.
- Virtualization/pagination deferred unless a job exceeds the ~300-item plain-list ceiling.

---

**Gate:** This brief is the contract. Build only on confirmation. No code, project scaffolding, or dependencies until then.
