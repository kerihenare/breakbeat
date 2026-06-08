---
target: the Clipping Desk UI (results pane, home rail, job page)
total_score: 24
p0_count: 0
p1_count: 3
timestamp: 2026-06-08T01-28-26Z
slug: views-job-pane-njk
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Strong: live SSE chip, count triad, running pulse. Ready/empty state gives no "what now". |
| 2 | Match System / Real World | 2 | Recent jobs print raw enums (`done_with_warnings`, `pending`) to non-technical PR users. |
| 3 | User Control and Freedom | 3 | Back link + revisit jobs; no cancel for a running search, no clear/remove on recent jobs. |
| 4 | Consistency and Standards | 2 | Same status rendered two ways (humanized chip vs raw token); job page drops the search rail the home page has. |
| 5 | Error Prevention | 2 | Form submits empty; only the URL field gets native validation. |
| 6 | Recognition Rather Than Recall | 2 | Duplicate "Acme" recent rows are indistinguishable — no date or count. |
| 7 | Flexibility and Efficiency | 3 | Filter tabs have roving tabindex + arrow keys; no focus-search shortcut. |
| 8 | Aesthetic and Minimalist Design | 3 | Clean, restrained, on-brand; the giant empty pane and very wide result cards cost it. |
| 9 | Error Recovery | 2 | Failed job shows raw `error` string; no retry affordance. |
| 10 | Help and Documentation | 2 | One helper line; empty state teaches nothing; content types never explained. |
| **Total** | | **24/40** | **Acceptable — clean foundation, real first-run/consistency/recognition gaps** |

## Anti-Patterns Verdict

**LLM assessment:** Does NOT read as AI slop. The newsprint paper + ink + single press-blue accent is a committed, coherent brand; no purple gradient, no hero-metric block, no identical icon-card grid, no eyebrow scaffolding. Count triad is three honest numbers. This passes the product slop test on identity. The weakness is not strangeness, it is under-finished surfaces (empty state, recent-jobs row) where the craft of the results pane didn't reach.

**Deterministic scan:** `detect.mjs` over `views/` returned `[]` — zero findings. Clean.

**Visual overlays:** Captured live at 1440px (home + job) and 390px (home) via Chrome DevTools; no automated overlay injected, evidence is the screenshots.

## Overall Impression

The results pane is genuinely good: grouped, sourced, every claim links out, status is live and legible, sentiment never relies on color alone. That is the product, and it works. The problem is everything around the moment of results. The single biggest opportunity: the primary surface — the results pane — is an empty void on first open, and the recent-jobs rail (the only other persistent surface) leaks raw machine tokens and can't tell two jobs apart. The craft is real but unevenly distributed.

## What's Working

1. **The Results Pane is traceable and calm.** Grouped by content type, mono source+date on every row, "date unknown" rather than a hidden gap, opens-in-new-tab announced to screen readers. "Every claim is traceable" is honored.
2. **Status is honestly live.** The `bb-job-status` chip humanizes terminal states, pulses while running, carries `role="status"`/`aria-live`, and suppresses the pulse under reduced motion. Real system-status visibility.
3. **Brand discipline.** One accent held to a sliver, flat surfaces with hairline borders, one type family. It reads like a desk, not a dashboard — exactly the stated north star.

## Priority Issues

- **[P1] Empty results pane teaches nothing.** On first open the product's largest, most valuable surface shows one line of centered gray text. Violates "Results first", "Obvious without a manual", and the product-register rule that empty states should teach the interface.
  - **Why it matters:** A non-technical PR pro's first impression is a void. They can't see what the tool will return (content types, sourcing, sentiment) before committing a search.
  - **Fix:** Turn the empty pane into a teaching state — name the content types it surfaces, show a one-line sample of a sourced result, and point to the search rail.
  - **Suggested command:** `/impeccable onboard`

- **[P1] Raw status enums leak to users.** Recent jobs print `done_with_warnings` and `pending` verbatim in mono; the chip elsewhere says "Done · warnings".
  - **Why it matters:** Same state, two languages — one machine, one human. The audience is non-technical.
  - **Fix:** Reuse the chip's human labels (or the chip itself) in the recent rows; never show the raw token.
  - **Suggested command:** `/impeccable clarify`

- **[P1] Recent jobs are indistinguishable.** Four "Acme" rows in a row with no date and no result count.
  - **Why it matters:** Recognition-over-recall fails; the user can't tell which run was which, so the history is nearly useless.
  - **Fix:** Add a relative timestamp and the returned-count to each row; consider collapsing exact duplicates.
  - **Suggested command:** `/impeccable clarify` then `/impeccable layout`

- **[P2] Mobile buries the answer.** Below `lg` the order is form → full recent-jobs list → results pane, so a phone user scrolls past every recent job to reach results or the empty state.
  - **Why it matters:** "Results first" inverts on the most interrupted device.
  - **Fix:** Reorder so the results/empty-state pane leads on mobile and recent jobs collapse behind a disclosure.
  - **Suggested command:** `/impeccable adapt`

- **[P2] Layout inconsistency between home and job pages.** The home page has the 320px search rail; a direct `/jobs/:id` link renders the pane alone with only a "← New search" text link.
  - **Why it matters:** The search front door disappears when arriving from a shared/bookmarked link.
  - **Fix:** Render the job view inside the same split layout, or give it a persistent search affordance.
  - **Suggested command:** `/impeccable layout`

## Persona Red Flags

**Jordan (First-Timer):** Lands on the home page, sees a huge empty pane that says only "Name a company to start tracking its coverage" — no sense of what comes back. In recent jobs, reads `done_with_warnings` and has to decode it. No content-type explanation anywhere.

**Sam (Accessibility):** Mostly well served — visible focus ring, `role="status"` live regions, sentiment gauge has a full `aria-label` and labelled legend, color never sole carrier. Watch items: the recent-jobs raw status is announced as an underscored token; empty-state has no landmark/heading for orientation.

**Riley (Stress Tester):** Submitting the form with both fields blank still posts. Duplicate recent jobs pile up unbounded. A failed job surfaces the raw `error` string with no retry.

## Minor Observations

- Result cards stretch very wide on desktop with only a title + domain inside, leaving large empty right margins; the row affordance could be denser or width-capped to the reading measure.
- Input placeholder contrast is borderline on page-white; verify ≥4.5:1.
- Recent-jobs list is unbounded; no count or limit indicator.
- Empty state copy is passive ("Name a company...") rather than an actionable invitation tied to the adjacent field.

## Questions to Consider

- What would a first-run pane look like if it showed the *shape* of an answer before any search ran?
- Should recent jobs be a richer, scannable history (date, count, status) rather than a name list?
- Does the job page need to feel like the same room as the home page?
