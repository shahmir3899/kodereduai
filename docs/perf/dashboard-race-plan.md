# Dashboard race: plan (no code changed yet)

## Problem (measured, local prod-style build, `after-local.json`)
Dashboard hard load: 22 -> 21 calls, depth 4 -> 4. Cause, from the call timeline:
- ~1.3 s: bootstrap/admin-dashboard starts AND the dashboard page mounts. The page's own queries (daily_report,
  hr dashboard_stats, fee monthly_summary, library/stats, inventory/dashboard, admissions/enquiries) fire in the same tick,
  so the bootstrap's seeded cache arrives too late to prevent them.
- The preload also fires things the dashboard does not render on load:
  attendance monthly_bulk (full-month attendance of every class, for the register page), leadership-academic-insights
  (the page only requests it when the admin opens "insights"), attendance pending_review, upcoming exams.

Calls on /dashboard now (21): 16 the page needs + 5 preload-only
(bootstrap, pending_review, leadership, exams, monthly_bulk).

## Options
A. Dashboard consumes the bootstrap (recommended).
   One `useDashboardBootstrap` query is the single source for attendance, hr, finance, transport, library, hostel,
   inventory, admissions. It seeds the existing keys; the individual queries become `enabled` only after it settles
   (success, error, or 2 s timeout -> they fall back to their own endpoints, so nothing can get stuck).
   Calls: 21 -> ~11-12 (the 8 module/summary calls disappear; bootstrap replaces them as 1).
   Cost: tiles wait for one combined call instead of 8 parallel ones. Server work is the sum, not the max, so tiles may
   appear ~100-200 ms later (estimate, not measured). Benefit: 8-9 fewer requests per dashboard boot on the single
   Render worker. To be measured on prod after deploy before we keep it.
B. Remove only the duplicates: drop the speculative preload on /dashboard (monthly_bulk, leadership, pending_review,
   exams) and stop calling bootstrap there. Calls 21 -> 16, no latency change, tiny diff. Leaves Step 2 unused.
C. Do nothing on the dashboard.

Recommendation: B first (safe, immediate), then A behind a one-line switch (`VITE_DASHBOARD_BOOTSTRAP`) so it can be
turned off from env without a code revert if latency regresses.

## Steps
1. (B) In `preloadVisibleData`, when the landing page is the dashboard, skip monthly_bulk, leadership, pending_review,
   upcoming exams for SCHOOL_ADMIN/PRINCIPAL (the pages that need them still fetch on demand; attendance register already
   loads its own data). Test: unit test of what the admin preload queues on dashboard vs deep link.
2. (A) Add `useDashboardBootstrap` (AdminDashboard + DashboardPage principal variant): calls the existing endpoint with
   `sections=...`, seeds keys with the same `setQueryData` code now in AuthContext (move it into one shared function),
   returns `{settled}`. Individual queries: `enabled: schoolReady && moduleOn && settled`.
   Remove the admin bootstrap from the AuthContext preload (it moves to the page) so it is not fetched twice.
3. Keys: make the page's dailyReport / fee keys use the same academic-year id the bootstrap used (today the page key can
   carry `undefined` until AcademicYearContext resolves, which would miss the seeded entry) - wait for the year to resolve
   before enabling.
4. Tests: vitest for the hook (seeds keys, falls back on error and on timeout), existing dashboard tests still pass,
   backend bootstrap tests already cover the server side (7 tests).
5. Re-measure: same local prod-style run for call counts; the latency check needs the deployed build (one deploy).

## Success criteria
Dashboard hard load API calls: 21 -> <= 16 after B, <= 12 after A. No tile shows a permanent spinner when the bootstrap
fails (tested). Time-to-tiles on prod after A within +150 ms of today, otherwise switch A off.

## Risks
- A adds one round trip before tiles render if the bootstrap is slow: mitigated by the 4 s cap, the env switch, measuring.
- Seed shape drift: covered by tests comparing bootstrap sections to the standalone endpoints (exist) and by reusing the
  same seeding function the preload uses.
- PRINCIPAL uses DashboardPage (different query keys in places): handled in step 2, covered by a test for each variant.
