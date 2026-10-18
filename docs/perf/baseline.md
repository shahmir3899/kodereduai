# Phase 0 Baseline (2026-10-18)

Target: Singapore production, Demo School (id 42), demo admin, read-only. Client: user's PC (network round trip to Singapore included).
Raw data: `baseline-api.json`, `baseline-api.log`. Script: `scripts/perf_baseline.py` (5 warm runs after 1 cold).

## Backend / API (ms, warm median / p95, cold)
| Endpoint | median | p95 | cold | bytes | gzip |
|---|---|---|---|---|---|
| dashboard_health (/sessions/health/) | 229 | 276 | 338 | 1128 | 579 |
| dashboard_ai_summary | 195 | 2066 | 1697 | 956 | 555 |
| students_list | 212 | 228 | 267 | 10154 | 1297 |
| students page_size=200 | 204 | 232 | 205 | 10154 | 1297 |
| classes | 216 | 270 | 204 | 735 | 264 |
| session_classes | 173 | 242 | 232 | 1095 | 332 |
| academic_years (cached) | 260 | 312 | 183 | 311 | 196 |
| subjects | 176 | 179 | 176 | 1212 | 324 |
| exams | 200 | 239 | 236 | 1971 | 498 |
| finance_balances_all | 207 | 212 | 258 | 564 | 269 |
| finance_accounts | 190 | 204 | 286 | 502 | 257 |
| hr_staff | 181 | 200 | 249 | 2821 | 590 |
| hr_dashboard_stats | 177 | 192 | 201 | 496 | 259 |
| attendance_records | 219 | 427 | 238 | 8864 | 831 |
| notif_unread | 170 | 242 | 178 | 18 | 38 |
| notif_templates | 179 | 288 | 174 | 663 | 315 |

All 16 returned 200. Login POST time is in the JSON.

### What the numbers say
- Every call costs ~170-260 ms, even an 18-byte response (notif_unread = 170 ms). That is the network round trip plus fixed overhead. Backend compute is small on demo data.
- So per-request server work is not the bottleneck here; the cost is the NUMBER of sequential round trips per page. This favours items 2 (bundles), 3 (prefetch), 7 (polling), 5 (304) over 4 (payload) and 8 (indexes).
- Demo data is tiny (students list 10 KB). Items 4 and 8 cannot show gains on demo school; a big real school would be needed to measure them.
- Server cache (item 1) cannot show a latency gain through this network floor: cached academic_years (260 ms median) is not faster than uncached subjects (176 ms). Its gain is DB/CPU load, not visible per call here.
- dashboard_ai_summary: cold 1.7 s, p95 2.1 s (LLM-backed); already deferred off the critical path.

## Frontend bundle (fresh `vite build` to scratch dir, nothing in repo touched)
- 188 JS chunks, 6.4 MB JS raw total, 156 KB CSS.
- Initial load chain: main 4 KB + index 337 KB (102 KB gz) + shared vendor chunk `financeQueryRules` 478 KB (138 KB gz) = ~820 KB raw / ~241 KB gz before CSS.
- Large chunks: CameraPermissionNotice 628 KB (153 KB gz), xlsx 419 KB, jspdf-autotable 410 KB, BarChart 336 KB, QuestionBankPicker 315 KB, html2canvas 197 KB.
- No `manualChunks`: the vendor chunk is oddly named after financeQueryRules and a 628 KB chunk is named after a small component, which means shared libraries are bundled into arbitrary chunks (item 9).

## Frontend runtime, logged-out login page (https://demo.educationai.pk/, browser pane)
- TTFB 566 ms, DOMContentLoaded 814 ms, load 2181 ms, FCP 2976 ms
- 9 requests, 3 JS, 185 KB transferred; 1 API call (`schools/by-subdomain`, 643 ms)

## Still to capture (needs a signed-in browser session)
Per page: API requests fired, waterfall depth, load time, repeat-visit load, idle requests per minute for
Dashboard, Student Profile, Exams, Fee Collect, Finance Dashboard, Teacher Dashboard, Students list.

## Signed-in pages (headless Chromium, demo school, `baseline-pages.json`)
Cold = hard navigation; repeat = second hard navigation. "idle" = time until the network went quiet.
| Page | API calls | Waterfall depth | idle ms | FCP ms | KB cold | repeat API / idle ms |
|---|---|---|---|---|---|---|
| dashboard | 22 | 4 | 2181 | 1052 | ~1 | 24 / 1648 |
| students list | 17 | 5 | 3292 | 1088 | 219 | 17 / 1928 |
| student profile | 20 | 5 | 2725 | 816 | 23 | 20 / 2018 |
| exams | 23 | 5 | 1992 | 672 | 25 | 22 / 2366 |
| fee collect | 22 | 5 | 1963 | 700 | 29 | 22 / 1932 |
| finance dashboard | 24 | 6 | 2317 | 620 | 111 | 24 / 2067 |
| subjects | 17 | 5 | 1988 | 656 | 13 | 16 / 2085 |

Idle polling on the dashboard over 60 s: 0 requests (see caveat).

### Findings
- 16 of the 17-24 calls on every page are the same app-shell set, fired on EVERY navigation:
  auth/me, schools/by-subdomain, bootstrap/admin-dashboard, bootstrap/leadership-academic-insights,
  examinations/exams, sessions/terms, notifications/unread-count, attendance monthly_bulk,
  attendance uploads/pending_review, admissions/enquiries, hostel/dashboard, inventory/dashboard,
  library/stats, transport/dashboard, tasks/ai-insights, tasks/ai-jobs.
  A subjects page needs 1 call of its own but fires 17. The page's own data is only 1-6 calls.
- Many of those shell calls belong to modules the page does not use (hostel, inventory, library, transport,
  admissions) and are fetched for a school that may not even have the module enabled.
- Duplicates inside a page: exams (exam-groups, exams, session-classes twice), finance dashboard
  (monthly_summary, reports twice), dashboard (unread-count twice).
- Waterfall depth 4-6 sequential round trips at ~170-250 ms each = most of the ~2 s load.
- Repeat full reload barely helps (same API count) because only reference data is persisted.
- Caveat: idle polling shows 0 requests in 60 s although NotificationBell polls every 30 s in source;
  headless tab visibility likely pauses it. Treat the polling baseline as unverified, re-check in a headed browser.
