# Speed Improvement Plan (API wrapping / fast loading)

Status: PROPOSED, awaiting approval. No code changed yet.
Context: backend + DB both in Singapore (see render-singapore-migration). Dashboard ~1.2 s, calls < ~650 ms before this plan.

## Rules for this work
- One phase = one commit, shown with `git show` before approval. No push/PR without approval.
- No schema changes. Index work (item 8) is proposed as migrations and needs explicit sign-off per migration.
- Never cache money/payment/live-attendance endpoints.
- Every phase ends with a re-measure against the baseline; a phase that does not improve or that regresses is reverted.

## Phase 0 - Baseline (before any change)

Measure on the same target, same account, same time of day, 5 runs each, record median and p95.
Target: Singapore production, Demo School (id 42), SCHOOL_ADMIN account, password via env var only
(`PERF_USER`, `PERF_PASS`, `PERF_BASE_URL`; never inline).

### Backend parameters (script `scripts/perf_baseline.py`, output `docs/perf/baseline.json`)
| Parameter | How |
|---|---|
| Time to first byte + total time per endpoint (cold = first call, warm = repeat) | requests timing |
| Response size raw and gzipped | content-length + gzip of body |
| DB query count + DB time per endpoint | local run with `CaptureQueriesContext` / `assertNumQueries` harness against the remote DB, read-only |
| Cache hit ratio on cached endpoints | repeat-call timing delta |
Endpoint set (the heavy pages): dashboard, student profile, fee collect, exams list, teacher dashboard,
finance dashboard, students list, classes, subjects, attendance records, notifications.

### Frontend parameters (browser pane, DevTools network + Performance, `docs/perf/baseline.md`)
| Parameter | How |
|---|---|
| API requests fired per page load (count) | read_network_requests |
| Request waterfall depth (sequential round trips) | network timing |
| Page load: FCP, LCP, TTI-ish (page usable), total transfer KB | Lighthouse / performance API |
| JS bundle: initial KB, largest chunk KB | `vite build` output |
| Repeat-visit load (cache warm, reload) | second load |
| Idle polling requests per minute | network log over 60 s |
Pages: login to dashboard, StudentProfile, ExamsPage, FeeCollect, FinanceDashboard, TeacherDashboard, Students list.

Throttle profile for all frontend runs: "Fast 3G"-like and unthrottled, both recorded.

## Phase 1 - Items 1-10

### 1. Server cache coverage (safe read-mostly lists)
- Candidates: fee structures/heads, subjects, class and session-class lists, timetable, academic calendar, notification templates, grade scales (already), school settings.
- Use existing `@cached_api(group, timeout=...)`; add `bump_group` on save/delete signals per group. Bulk paths covered by TTL only, so use short TTLs (60-180 s) where bulk writes exist.
- Excluded: fees due/paid, payments, balances, payroll, live attendance.
- Tests: hit/miss, invalidation on save, per-school and per-user isolation (no cross-tenant leak), using shared seed_data.
- Success: warm response time drops >60 % on each cached endpoint; zero stale reads in tests.

### 2. Page-bundle endpoints
- One backend call per heavy page returning everything its first render needs:
  StudentProfile (10 queries), ExamsPage (11), Dashboard (11), FinanceDashboard (8), TeacherDashboard (7), FeeCollect (8).
- Pattern: `GET /api/<app>/bundle/<page>/` returns named sections; old endpoints stay (modals and refetches still use them). Frontend seeds React Query caches with `setQueryData` from the bundle so child components keep their existing `useQuery` keys.
- Each section computed with the same querysets as today (no logic fork); permission and module gating checked per section.
- Success: requests per page load down by >=50 %, waterfall depth <= 2.

### 3. Prefetching
- Prefetch dashboard data right after login success; prefetch next likely route data on link hover/focus (idle callback); `modulepreload` hint for the school-app chunk in `index.html`.
- Central helper `src/utils/prefetch.js` so the pattern is not scattered.
- Success: navigation from dashboard to top 5 pages shows data with no spinner on warm path.

### 4. Slimmer payloads
- Add `?fields=` sparse-field support via a small serializer mixin (opt-in per list view), `.only()`/`.defer()` on the heaviest list views (students, enrollments, fee payments).
- Lower `max_page_size` from 2000 to a sane cap (proposal 500) except explicit export endpoints; check frontend callers that rely on large `page_size` first.
- Revisit "slim students list" only if baseline shows backend serialization time, not network, is the cost.
- Success: students list backend time and DB time down; gzipped size down.

### 5. HTTP conditional requests (ETag / 304)
- Add ETag generation for API GETs (Django `ConditionalGetMiddleware` or per-view `condition`), keeping `Cache-Control: no-cache` so the browser always revalidates.
- Verify behind Cloudflare; confirm axios handles 304 and React Query still gets data (browser serves cached body transparently).
- Success: unchanged list refetches return 304 with near-zero body.

### 6. Wider persisted cache
- Extend `PERSISTED_QUERY_KEY_ROOTS` with stable reference lists (grade scales, fee heads, school settings).
- Keep wipe-on-logout/school-switch; keep 10 min maxAge; never persist student records or money data.
- Success: repeat-visit load shows reference data with no network wait.

### 7. Polling reduction
- Audit the 18 `refetchInterval` uses: pause when tab hidden (`refetchIntervalInBackground: false` plus visibility check), lengthen NotificationBell/Carousel 30 s -> 60 s, messages 15 s -> 30 s when the thread is not open, invalidate-on-mutation instead of polling where possible.
- Success: idle requests per minute down >=50 %.

### 8. Database indexes
- Run `EXPLAIN (ANALYZE)` read-only on the slowest queries from Phase 0 (remote DB, read-only allowed).
- Propose composite indexes as migrations, listed one by one for sign-off. Nothing applied without approval. Use `CREATE INDEX CONCURRENTLY` style (`AddIndexConcurrently`) for production.
- Success: targeted queries' DB time down; no write-path regression on attendance/marks upsert.

### 9. Bundle size
- `build.rollupOptions.output.manualChunks`: vendor-react, vendor-query, vendor-charts, face-api and heavy export libs separate.
- Run `vite build` with a visualizer to confirm what is large before splitting.
- Success: initial JS KB down; repeat deploys keep vendor chunks cached.

### 10. Regression guards (added; the earlier list had 9 items)
- Query-count tests (`django_assert_num_queries`) on every bundle endpoint and the heaviest list views, so N+1 cannot return.
- `scripts/perf_baseline.py` kept in repo and re-runnable; `docs/perf/` stores baseline and after-results.
- Budget check: initial JS size and request counts per page noted in `docs/perf/`.

## Order of work
Phase 0 baseline -> 10 (guards first, cheap) -> 1 -> 2 -> 3 -> 6 -> 7 -> 4 -> 5 -> 9 -> 8 (needs sign-off, last).
After each item: run backend tests for touched apps + frontend tests for touched files, re-measure its parameters, record in `docs/perf/after-<item>.md`.

## Phase 2 - Final re-measure
Re-run the exact Phase 0 scripts and browser measurements; produce `docs/perf/comparison.md` with before/after table
(median, p95, requests per page, KB, FCP/LCP, polling per minute) and a verdict per item.

## Risks
- Stale data from caching: mitigated by version-key invalidation, short TTLs, exclusions list.
- Bundles hide a failing section: each section returns its own error state, never fails the whole page.
- ETag behind Cloudflare may be rewritten: verify before keeping.
- Measuring on production adds load: small request counts, read-only, off-peak.

## Open decisions for you
1. Measure on production (Singapore, Demo School 42) or a local backend against the same DB?
2. Page-size cap value (500 proposed).
3. Index migrations: allowed to propose, applied only on your explicit sign-off per migration.
