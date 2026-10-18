# Local after-measurement (Steps 1-3), 2026-10-18

Method: production-style build of the CURRENT working tree (`VITE_API_URL` empty, served by `vite preview`, proxied to a
local Django on :8000 using the remote dev DB), driven headless as the seed school admin (school 37, all 14 modules on).
Baseline: production demo school (42), old code, `baseline-pages.json`. Both schools have all modules enabled.
Only API CALL COUNTS and waterfall depth are comparable. Times are NOT (local backend to remote DB is slow), so no ms claims.

| Page (hard load) | API calls before -> after | change | depth before -> after |
|---|---|---|---|
| students list | 17 -> 6 | -65 % | 5 -> 2 |
| student profile | 20 -> 9 | -55 % | 5 -> 2 |
| exams | 23 -> 13 | -43 % | 5 -> 2 |
| fee collect | 22 -> 11 | -50 % | 5 -> 2 |
| finance dashboard | 24 -> 13 | -46 % | 6 -> 2 |
| subjects | 17 -> 6 | -65 % | 5 -> 2 |
| dashboard | 22 -> 21 | -5 % | 4 -> 4 |

Remaining calls on a deep link (subjects = 6): auth/me, schools/by-subdomain, sessions/terms, tasks/ai-jobs,
notifications/unread-count + the page's own call.

## Open finding: dashboard does not benefit
On /dashboard the page mounts at the same moment the preload starts, so its own queries (daily_report, hr dashboard_stats,
fee monthly_summary, library, inventory, admissions) fire in parallel with the bootstrap that was meant to feed them.
The bootstrap result then arrives too late to prevent them. The fold-in is correct (verified by tests) but the dashboard
needs a sequencing change to use it.

## Correction: where the gain came from
The 43-65 % drop on non-dashboard pages comes from Step 1 alone (no dashboard preload on a deep link). Step 2 (module
sections in the bootstrap) adds nothing yet: on /dashboard the page and the preload fetch the same data in parallel, and
after a login the user lands on the dashboard with the same race. Step 2 only pays off once the dashboard consumes the
bootstrap (see dashboard-race-plan.md).

## Points deliberately skipped (decision 2026-10-18), with the evidence
- 4 Slimmer payloads / lower max_page_size: responses are 0.5-10 KB raw (0.3-1.3 KB gzipped) on the demo school; every call
  costs ~170-260 ms even at 18 bytes, so payload size is not the cost. Lowering the 2000 cap would break callers that send
  page_size=9999 (exams, session classes). Revisit only with a large real school's numbers.
- 5 ETag / 304: saves bytes, not round trips; the server still does all the work. Bytes are already tiny. No measurable win.
- 6 Wider persisted cache: the only boot call left that is reference data is sessions/terms, and it is a raw axios call
  outside React Query (AcademicYearContext), so persisting needs a refactor for one call. Not worth it now.
- 8 Index migrations: needs EXPLAIN on a large real school; demo data is too small to show any gain, and migrations need
  explicit sign-off. Revisit with real data.
- 9 Bundle splitting: the initial load is main + index + one vendor chunk (~241 KB gzipped); the big chunks (xlsx, jspdf, charts,
  face) are lazy and not on the initial path. Splitting would not change first load.
- 7 Polling (partly): React Query already pauses refetchInterval in hidden tabs; the two unread-count pollers were
  merged for one-school users in Step 3. Further interval lengthening is a UX decision, not a speed fix.

## B + A re-measure (local, 2026-10-18) - `after-local-A.json`
Hard-load calls vs production baseline: students 17->6, profile 20->9, exams 23->13, fee collect 22->11,
finance 24->13, subjects 17->6, dashboard 22->17.
Dashboard timeline: the combined bootstrap call started at 3.0 s and took 7.5 s because this laptop talks to the Singapore
database (each of its ~35 queries pays a round trip), so the 4 s timeout fired and every tile fell back to its own request
(the fallback path works, which is what it is for). The local run therefore cannot validate A: on Render the database is next
to the server (the old three-section bootstrap took ~270 ms in the production baseline). A must be judged on a deployed build.
Timeout lowered from 4 s to 2 s so a slow bootstrap can stall the tiles for at most 2 s.
The switch-off (B only) comparison run was not completed (my runner killed itself).
