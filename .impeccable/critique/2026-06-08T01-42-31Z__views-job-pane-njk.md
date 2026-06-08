---
target: the Clipping Desk UI (results pane, home rail, job page)
total_score: 29
p0_count: 0
p1_count: 0
timestamp: 2026-06-08T01-42-31Z
slug: views-job-pane-njk
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Live chip + counts strong; no feedback path for a long-running or cancellable search |
| 2 | Match System / Real World | 3 | Status humanized everywhere now; "returned"/"classified" triad labels still lean internal |
| 3 | User Control and Freedom | 3 | No cancel for a running search; no retry for a failed one |
| 4 | Consistency and Standards | 3 | Status consistent now; job page still lacks the home page's search rail |
| 5 | Error Prevention | 3 | Company name now `required`; URL gets native validation |
| 6 | Recognition Rather Than Recall | 3 | Timestamps disambiguate recent rows; result-count would finish the job |
| 7 | Flexibility and Efficiency | 3 | Filter tabs keyboard-navigable; no focus-search shortcut |
| 8 | Aesthetic and Minimalist Design | 3 | Empty state teaches now; stacked full coral pills in the rail read as alarm |
| 9 | Error Recovery | 2 | Failed job shows a raw error string and offers no way forward |
| 10 | Help and Documentation | 3 | Empty state teaches the interface; counts could self-explain |
| **Total** | | **29/40** | **Good — surrounding states are the remaining gap** |

## Anti-Patterns Verdict
LLM: still no slop. Detector `[]`. The one drift: a column of filled coral "Done · warnings" pills in the rail violates the product rule "no heavy color on inactive states." The chip is right for the active job header; the inactive history list wants a calmer indicator.

## Priority Issues

- **[P2] Rail status is too loud.** Full semantic-color pills on every inactive history row dilute the signal and read as alarm. Fix: a quiet variant (status dot + muted label) for the list, reserving the filled chip for the active job. → `quieter`/`polish`
- **[P2] Failed jobs dead-end.** A failed search shows a coral banner with a raw error and no next step. Fix: friendlier framing plus a retry that re-runs the same company. → `polish`/`harden`
- **[P2] Triad labels lean internal.** "returned / classified" are pipeline terms; a PR pro reads "found / sorted" faster. → `clarify`
- **[P2] Job page lacks the search rail.** A direct/bookmarked `/jobs/:id` loses the search front door the home page has. → `layout`
- **[P3] Result-count would complete recent rows.** Timestamps disambiguate; a count would make the history scannable for "which run had the most coverage." → `layout`

## Persona Red Flags
**Jordan (First-Timer):** Now oriented by the teaching empty state, but a failed search leaves them stuck with a raw message.
**Riley (Stress Tester):** Empty submit now blocked by `required`; a failed job still has no recovery path; recent list is bounded and scrollable now.

## Minor Observations
- Count triad "classified" excludes unclassified-but-shown items, so the number can read lower than the visible list; a plainer label reduces confusion.
- Filter tabs remain ~31px tall, under the 44px comfort target.

## Questions to Consider
- What's the lightest status indicator that still says done/running/failed at a glance in a dense list?
- When a search fails, what's the single most useful thing to offer: retry, edit, or contact?
