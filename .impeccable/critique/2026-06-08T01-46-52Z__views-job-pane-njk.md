---
target: the Clipping Desk UI (results pane, home rail, job page)
total_score: 31
p0_count: 0
p1_count: 0
timestamp: 2026-06-08T01-46-52Z
slug: views-job-pane-njk
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Live chip + counts; no cancel feedback for a long search |
| 2 | Match System / Real World | 3 | Triad now "found / excluded / sorted by type"; language is plain |
| 3 | User Control and Freedom | 3 | Recovery link on failure; still no in-flight cancel |
| 4 | Consistency and Standards | 3 | Job page is a lone wide column; home is rail + pane — two different rooms |
| 5 | Error Prevention | 3 | Required company name; native URL validation |
| 6 | Recognition Rather Than Recall | 3 | Timestamps disambiguate; result-count still absent |
| 7 | Flexibility and Efficiency | 3 | Keyboard-navigable filters; small filter touch target |
| 8 | Aesthetic and Minimalist Design | 4 | Calm rail (dot+label), teaching empty state, restrained, no slop |
| 9 | Error Recovery | 3 | Failed state now frames the error and offers a way forward |
| 10 | Help and Documentation | 3 | Empty state teaches; rail has no empty copy for first-run |
| **Total** | | **31/40** | **Good — consistency between surfaces is the last structural gap** |

## Anti-Patterns Verdict
Clean. Detector `[]`. Rail loudness resolved. No slop tells.

## Priority Issues

- **[P2] Job page ≠ home page.** A direct `/jobs/:id` renders a single wide column with only a back link, losing the search rail and recent-jobs history the home page provides. Fix: extract the rail into a shared partial and render both surfaces as the same rail + pane layout; the job pane lives in `#results` so the rail's search/recent targets work identically. → `layout`/`polish`
- **[P3] Rail first-run is blank.** With no jobs yet, "Recent jobs" sits above an empty list with no copy. Fix: an empty line ("No searches yet."). → `clarify`
- **[P3] Filter-tab touch target.** ~31px tall; bump padding toward the 44px comfort target. → `adapt`/`polish`
- **[P3] Result-count in recent rows.** Timestamps disambiguate; a count would make history scannable (deferred: per-row count is an N+1 without a repo count method). → `layout`

## Persona Red Flags
**Casey (Mobile):** A shared job link on a phone now lands directly in results (good); after this cycle, the search rail will be reachable from there too.
**Jordan (First-Timer):** Oriented by the teaching empty state; the blank recent list on first run is the one remaining "is this thing on?" moment.

## Questions to Consider
- Should the job page and home page literally be one template with a different pane payload?
- Is the result row carrying enough at a glance, or would a one-line snippet/excerpt help triage?
