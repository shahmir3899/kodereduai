# Production after-measurement (2026-10-18 22:18, demo school 42, headless, hard loads)

Deployed: backend 7bfb9a7 and the new frontend build. Baseline: `baseline-pages.json` (old code, same school, same script family).

| Page | API calls before -> after | waterfall depth | 
|---|---|---|
| students list | 17 -> 6 | 5 -> 3 |
| student profile | 20 -> 9 | 5 -> 3 |
| exams | 23 -> 13 | 5 -> 3 |
| fee collect | 22 -> 11 | 5 -> 3 |
| finance dashboard | 24 -> 13 | 6 -> 3 |
| subjects | 17 -> 6 | 5 -> 3 |
| dashboard | 22 -> 12 | 4 -> 4 |

Dashboard: the combined bootstrap call took ~350 ms on production (753 -> 1105 ms), well inside the 2 s limit, and the
hr/library/inventory/admissions/attendance tiles were all served from it (no individual calls). The one remaining tile
call is fee `monthly_summary`: this admin has several schools, so the tile reads the all-schools key, which the bootstrap
does not seed.

Wall-clock caveat: the new script includes a deliberate 1.5 s settle wait that the first baseline script did not, so the
"total_ms" values are not directly comparable. Subtracting that wait, load-to-idle is roughly flat to ~10 % better
(e.g. dashboard ~1.9 s vs 2.2 s, subjects ~1.9 s vs 2.0 s, profile ~2.9 s vs 2.7 s). Fewer calls did not translate into a
large wall-clock drop: the page waits on JS chunk loading and the auth/me call, and each remaining call is one ~170-250 ms
round trip. Only a same-script before/after run would give an exact time delta.
