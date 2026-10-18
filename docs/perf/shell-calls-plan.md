# Shell calls: investigation and fix plan (no code changed yet)

## What fires, and why

Source: `frontend/src/contexts/AuthContext.jsx`, function `preloadVisibleData` (about line 261-815).
It is switched on by `VITE_LOGIN_PRELOAD_ENABLED=true` in `frontend/.env` (default in code and `.env.example` is false).

It runs from three places: after login (line ~256), after school switch (~892), and on EVERY session restore
`fetchUser` (~200), i.e. every hard page load or browser refresh. A per-mount ref only blocks repeats inside one page lifetime.

What it does for SCHOOL_ADMIN / PRINCIPAL, regardless of which URL the user landed on:
1. Blocking step: `sessions/academic-years` fetch (so it knows the year id) before anything else.
2. Tier A: `bootstrap/admin-dashboard` (attendance + HR + finance in one call, seeds 3 query keys).
3. Tier B (after 1.2 s idle, 3 at a time): attendance `pending_review`, admissions `enquiries?status=NEW`,
   `examinations/exams?status=SCHEDULED`, transport / library / hostel / inventory dashboards,
   `bootstrap/leadership-academic-insights`, `tasks/ai-insights`, attendance `monthly_bulk`.
Other roles (teacher, manager, accountant, staff, parent, student) get their own smaller preload sets.

Other always-on calls: `auth/me`, `schools/by-subdomain` (init), `notifications/unread-count` and
`tasks/ai-jobs` (Layout polling), `sessions/terms` (AcademicYearContext).

## Answers to your two questions

1. Why on every page: the preload is not tied to the page. It is tied to "app booted". Any hard load, whatever the route,
   pays the whole dashboard preload. Preloading is meant to make the dashboard instant, so on a deep link (`/subjects`,
   `/exams`) the dashboard data is fetched for nothing.
2. Why for disabled modules: they are NOT fetched for disabled modules. Each Tier B call is gated by
   `isModuleAvailable(enabledModules)`. The 16 calls appeared in my test because Demo School very likely has every module
   enabled (a showcase school) - this is inferred, not verified; I will confirm via `enabled_modules` in step 0 below.
   Ungated one: `tasks/ai-insights` fetches for everyone with no module check.

## Correction to my baseline report

My page-load script used a hard navigation (`page.goto`) for every page, so each page was charged for a fresh boot
including the whole preload. A real user does one boot per session and then navigates client-side, where the shell calls do
not repeat. So "16 shell calls on every page" overstates the per-click cost; the true cost is "16+ calls on every
login, refresh, and deep-link open". Still significant: they run on every refresh, compete for the browser's 6 connections
and for the single gunicorn worker pool, and the first-paint page's own 1-6 calls queue behind them.
I will add a client-side-navigation mode to the measurement script so the before/after is fair.

## Proposed fix (4 changes, in this order)

### Step 0 - Measure properly (no app code)
- Extend `scripts/perf_pages.py`: (a) hard load, (b) SPA navigation by clicking sidebar links after the first load,
  (c) log the order and timestamps of API calls. Verify demo `enabled_modules`. Re-run for a corrected baseline.

### Step 1 - Make the preload route-aware
- Pass the landing path into `preloadVisibleData`. Only run the admin dashboard set when landing on `/dashboard`
  (or right after login, which redirects to the dashboard). On any other deep link run only the reference-data basics.
- Gain: hard load of any non-dashboard page drops from ~17-24 calls to about 6-9. No behaviour change on the dashboard.

### Step 2 - Collapse Tier B into the existing bootstrap call
- Extend `GET /api/bootstrap/admin-dashboard/` to also return transport, library, hostel, inventory, admissions-new count,
  upcoming-exams count, each only if the school has the module enabled (server-side gate, same rule as
  `ModuleAccessMixin`), computed with the same queries the individual endpoints use.
- Frontend seeds the existing query keys (`hostelDashboard`, `libraryStats`, ... ) from it with `setQueryData`,
  exactly as the bootstrap already does for attendance/HR/finance, so dashboard components do not change.
- Keep the old endpoints (the module pages still call them).
- Gain: ~8 calls -> 0 extra; dashboard boot ~22 calls -> ~8, depth 4 -> 2-3.

### Step 3 - Tidy what remains
- Gate `tasks/ai-insights` by role/module and move it off the critical path (idle callback), like the AI summary.
- Find why exams, finance dashboard and the dashboard issue duplicate calls with different query keys for the same URL
  (exam-groups, exams, session-classes, monthly_summary, reports, unread-count twice) and unify the keys.
- Reduce Layout polling per item 7 of SPEED_PLAN.md.

### Step 4 - Guards
- Backend: query-count test for the extended bootstrap endpoint; test that disabled modules return no section and
  no data for other schools.
- Frontend: vitest that deep-link boot makes no dashboard preload calls, and that the dashboard seeds the keys.

## Success criteria (hard load, demo school, same script)
| Case | Before | Target |
|---|---|---|
| /subjects hard load, API calls | 17 | <= 8 |
| /students hard load | 17 | <= 8 |
| /dashboard hard load, API calls | 22 | <= 10 |
| /dashboard waterfall depth | 4 | <= 3 |
| idle-network time /subjects | ~2.0 s | <= 1.3 s |
Server side: requests per login/refresh down >= 50 %.

## Risks
- Dashboard tiles show spinners if a seeded key mismatches: covered by the frontend test and by comparing keys to those
  the dashboard components read.
- Bootstrap response grows and one slow section slows the rest: each section wrapped in its own try, with failure
  returning `null` for that section so the old per-endpoint call can fill in.
- Env flag: change is in code, no env change needed on Hostinger; roll back by reverting one commit.
- No database or schema change.
