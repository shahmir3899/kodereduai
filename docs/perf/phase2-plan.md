# Phase 2 plan: shorten the time before a page's own data starts loading (no code changed yet)

## What production shows (after-prod.json, demo school, hard loads)
Per page, ms from navigation start:
| Page | auth/me done | page's FIRST own call starts | gap | page's own calls finish |
|---|---|---|---|---|
| subjects | 552 | 1031 | 479 | 1360 |
| students list | 581 | 1228 | 647 | 1681 |
| student profile | 544 | 811 | 267 | 2425 (ai-profile 1.6 s, not blocking) |
| exams | 427 | 861 | 434 | 1547 |
| finance | 450 | 943 | 493 | 1771 (balances 830 ms) |

Average ~460 ms passes between "who am I" returning and the page asking for its own data. That is as long as everything the
page then fetches (150-350 ms). Fewer calls cannot touch this gap; it is the app booting, not the API.
`sessions/terms` is NOT the cause: it ends at a different time from the page start on every page (and nothing gates render on it).
Suspects, in order: (1) the page's lazy JS chunk and its ~10-23 small dependency chunks are only requested after auth/me
returns and the router renders (students has 23 deps, the slowest gap; but profile with 12 deps is fast, so not proven);
(2) React render/effect ordering after auth; (3) a slow endpoint on the page (finance balances 830 ms, profile ai-profile 1.6 s).

## Step 0 - find the real cause first (no app code)
Extend `scripts/perf_pages.py` to also log JS/CSS chunk requests with start/end and a marker for the render of the page.
One deploy-free local run (prod-style build, localhost) shows ordering; one production run shows timings. This decides
between candidates A and B below; I will not guess.

## Candidates (savings are estimates until Step 0)
A. Warm the page's chunk while auth/me is in flight (est. -150..-450 ms on every deep link/refresh; low risk)
   At boot (before auth/me returns) start `import()` for the route matching `location.pathname`, through a small table of
   the ~15 busiest routes (dashboard, students, student profile, exams, finance, fee collect, subjects, attendance...).
   The chunk and its dependencies then download in parallel with the 250 ms auth call instead of after it.
   Risk: none functionally (it only starts a download that would happen anyway); table must be kept in sync, so one test
   asserts every table entry resolves.
B. Render from a cached user while auth/me revalidates (est. -250..-550 ms; medium risk, needs your decision)
   Keep the last user/school object (no tokens) in localStorage; render immediately and swap in the fresh one when auth/me
   returns. Danger: a role or module change shows stale for ~250 ms, and a logged-out/forbidden user could flash the app
   shell before redirect. Backend still enforces everything. Only do this if A is not enough and you accept that flash.
C. Dashboard: stop waiting for the fee tile (-1 round trip, dashboard depth 4 -> 3, ~ -230 ms on dashboard)
   For multi-school admins the fee tile reads the all-schools key, which the bootstrap does not seed, so it fires after the
   bootstrap returns. Do not hold that one query on the bootstrap when the user has several schools: fire it in parallel.
   One-line condition in the two dashboards; covered by the existing hook tests plus one new case. Low risk.
D. Slow endpoints seen in prod (backend, measured by the script, will be profiled with the local DB queries):
   finance/accounts/balances 830 ms; exams page 13 calls with same-path repeats (exam-groups x2, exams x2, session-classes x2,
   probably different params: verify and merge) ; student profile fires 4 calls, ai-profile is 1.6 s (check it is not blocking
   the visible area). Each is its own small fix, listed after Step 0 with numbers.
E. sessions/terms on boot: fetch only when a term-aware page needs it (-1 call per boot, frees a slot). Needs a check of
   every consumer of `terms/currentTerm` from the context first; low value alone, do last.

## Order
Step 0 -> C (trivial) -> A -> measure -> B only if still needed -> D items by measured cost -> E.

## Success criteria
- Gap (auth/me done -> first page call) average from ~460 ms to <= 150 ms after A (B only if not reached).
- Dashboard depth 4 -> 3 after C.
- No change in what any user can see or do (tests per item; B excluded unless approved).

## Human involvement (kept to the minimum)
Step 0 local run: none (I run it; uses the dev seed login on localhost only).
After A + C + the next fixes: ONE deploy (backend push + submodule bump + frontend upload, same flow as today) and ONE
`perf_pages.py` run by you. Nothing else.

## Risks
- A: wrong chunk warmed for a route (wasted download only). B: stale-permission flash (why it needs your sign-off).
- Measurement noise: each run uses the same script, same school, same hour; differences under ~10 % are not claimed.
