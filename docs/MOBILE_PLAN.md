# Mobile App Finalisation Plan

Status: **Scope agreed 2026-10-27 — awaiting go-ahead to start Phase 1. No code written.**

Decision made: **one app for all roles** (credentials decide where the user lands, like the web).
Role priority: **Admin → Teacher → Manager → Student → Parent → Driver → Others** (Principal, Accountant, Staff).

## 1. Where mobile stands today

Snapshot from ~Feb 2026: ~55 screens / ~10.6k lines (Expo 54, expo-router, TypeScript, axios, no React Query, no tests).
Since then web has had ~209 commits and backend ~202; mobile 9 (last real feature work Feb; Sept role rename; Oct branding/URL only).

Existing route groups: `(admin)`, `(parent)`, `(student)`, `(driver)`, `(auth)`. Every non-parent/student/driver role (Teacher, Manager, Accountant, Staff, Principal) falls into `(admin)`, which exposes Finance/Students tabs to everyone — no role or module gating (`isModuleEnabled` exists but is unused).

Known defects to fix regardless of phase:
- `payment-result.tsx` is a "Coming soon" stub; `parent/payment.tsx` depends on it.
- Admin dashboard hard-codes attendance % and pending approvals to 0.
- Classes use plain `/api/classes/` — not SessionClass-aware (see `CLASS_SYSTEM_GUIDE.md`, "Class scoping is per section").
- No forgot/reset password, no school-switcher UI (API call exists), no session/academic-year awareness.
- Face attendance uses the old upload flow; web's live-capture flow is client-side embeddings (see `docs/FACE_ATTENDANCE.md`) — mobile parity is a separate decision (see §9).
- No tests, no typecheck script, slug still `kodereduai`, no `docs/MOBILE.md`.

## 2. Architecture (Phase 0/1 — applies to everything after)

1. **Single role-driven navigation config**, mirroring `frontend/src/navigation/navigationConfig.js` (`buildStaffNavigation`): one function takes `{effectiveRole, isModuleEnabled, ...}` and returns tabs + "More" entries. Mobile must not invent its own visibility rules — web rules already encode decisions such as:
   - Manager has no student attendance, finance, transport, library, inventory, or student list (removed 2026-09).
   - Student attendance is admins + teachers only; Face attendance is admin only (teachers use Manual Entry).
   - Teachers see only "Collect Payments" under Finance; Assessments/Marks Entry/Results/Report Cards are admin+teacher.
   - Paper Builder/Papers/Worksheets: admin, principal, teacher, manager.
   - Staff: no academics/attendance/finance; only self-service (HR) + messages.
2. **Route groups by persona, not by every role**: `(admin)` (Admin/Principal/SuperAdmin), `(teacher)`, `(manager)`, `(accountant)`, `(staff)`, `(parent)`, `(student)`, `(driver)`. Each group has its own `_layout` with ≤5 bottom tabs + a "More" screen (grouped list) for the rest. A shared `navigation/` module feeds each layout.
3. **Route guard** in `app/index.tsx` + each group layout: wrong-role deep links redirect to the user's home (mirrors web `*AccessRoute` guards). Gate every module screen with `isModuleEnabled`.
4. **Data layer**: add `@tanstack/react-query` (same patterns as web: `useQuery`/`useMutation`, invalidate on success), offline-tolerant caching + pull-to-refresh. Replace per-screen `useState/useEffect` fetching progressively (don't rewrite working screens in Phase 1).
5. **Tenant/session context**: `X-School-ID` (exists), plus an `AcademicYearContext` equivalent; every class/exam/fee picker uses SessionClass per the class-scoping decision.
6. **Shared UI kit**: extend `components/ui` (add Select/Picker modal, Tabs/SegmentedControl, ListRow, Modal/BottomSheet, Toast, ConfirmDialog, SearchBar, DateField) and a `StatusPill`/`RecordCard` analogue of web's card system (`docs/CARD_SYSTEM.md`).
7. **Auth**: forgot/reset password (web endpoints exist), school switcher, change password (exists), logout everywhere, handle base-role STUDENT/PARENT (`portal-base-role-phase2` — verify login payload shape against migrations 0008/0009 before building).
8. **Quality gates**: `npm run typecheck` (tsc), Jest + `@testing-library/react-native` for nav config + critical flows, and a manual QA checklist per phase. Add a `docs/MOBILE.md` documenting structure, env, build, release.
9. **Design**: replace emoji tab icons with `@expo/vector-icons` (bundled with Expo); keep light-only for v1, dark mode deferred.

## 3. Phased delivery (priority order)

Each phase ships as its own internal EAS build; nothing is pushed or merged without your approval (CLAUDE.md hard rules). Estimates are working sessions, not calendar time.

### Phase 1 — Foundation + Admin (Admin / Principal / SuperAdmin) — ~5–6 sessions
Foundation (§2) plus:
- Real dashboard from the same endpoints the web `DashboardPage` uses (attendance %, collection, pending leave/approvals, at-risk, calendar highlights).
- **Attendance:** Manual Entry (per SessionClass/date), Attendance Record (register), keep existing capture/review only if `OCR_ENABLED`, otherwise hide (OCR is parked).
- **Students:** list/search/filter (status groups: enrolled/departed/alumni), profile (fee summary, attendance), edit; soft-deleted list for Admin/Principal.
- **Finance:** dashboard, fee overview, collect payments (existing — modernise), income/expense (existing), accounts. Fee setup/discounts → web only (§8).
- **HR:** leave approvals (existing), staff list/detail.
- **Notifications + Messages** (messaging app), inbox with unread badge and push deep-links.
- Hostel gate passes, Library issue/return, Transport overview (existing screens, re-gated).
- Admissions: enquiries list + status change + add (quick capture is a strong mobile use case).
- School switcher, settings (profile, change password, logout), User Guide link.

### Phase 2 — Teacher — ~4 sessions
New `(teacher)` group:
- Dashboard (today's periods from timetable, classes assigned, pending marks, attention items; mirror `TeacherDashboard.jsx` + `teacherDashboardUtils.js`).
- Attendance Manual Entry for assigned sections; attendance register.
- **Marks Entry** (exam → section → subject grid with validation), Results, Report Cards (view/download PDF; follow `report-card-exam-rules`).
- Assessments, Exam Schedule, Timetable.
- Assignments: create, view submissions, grade.
- Collect Payments (teacher-allowed subset), Leave self-service, Messages/Notifications, inventory assignments if present.
- Question bank / paper builder / worksheets / lesson plans / curriculum coverage: **view-only or web-only in v1** (heavy authoring; see §8).

### Phase 3 — Manager — ~1.5 sessions (BUILT 2026-10-28, uncommitted, never run on a device)
New `(manager)` group, deliberately small to match the 2026-09 scope-down: Dashboard, Academics (Timetable, Curriculum, Content Creation: Question Bank / Paper Builder view, Papers, Worksheets), Notifications, Messages, Leave self-service, User Guide.

### Phase 4 — Student — ~3 sessions (BUILT 2026-10-28, uncommitted, never run on a device)
Existing `(student)` group, brought to web parity: dashboard, attendance, fees, timetable, **exam schedule (new)**, results, assignments (view + submit with file/photo upload), **library (new)**, **transport (new, incl. live bus tracking)**, profile, study-helper AI, inbox. Verify against base-role STUDENT work. Backend endpoints for library/transport/exam-schedule already exist.

### Phase 5 — Parent — ~4 sessions (BUILT 2026-10-28, uncommitted, never run on a device; payments dropped per section 9.6)
Existing `(parent)` group to parity: dashboard (multi-child), child overview/attendance/fees/timetable/results, **exam schedule, library, transport (new)**, leave application, messages (threads), **fee payment end-to-end** (gateway checkout → deep-link `educationai://payment-result` → real result screen; replaces the stub), track-child, push notifications. Parent self-registration kept.
Payments touch real money: needs test-mode verification and your sign-off before release.

### Phase 6 — Driver — ~1 session (BUILT 2026-10-28, uncommitted, needs a real-device test: docs/ANDROID_BACKGROUND_LOCATION.md)
Existing dashboard + journey: harden background location (permissions rationale, foreground-service notification, battery/offline resilience, resume after kill), route/stop view, student boarding attendance if web `transport/attendance` has a driver flow. Android background location store-review justification text prepared.

### Phase 7 — Other roles — ~2 sessions
- **Accountant:** Finance suite (dashboard, accounts, fee overview, collect, income, expenses, reports view) and messages; no academics/attendance.
- **Staff:** HR self-service (own attendance, leave, payslips/documents), messages, inventory assignments, notifications.
- **Principal:** uses the Admin shell (read-heavy); verify the admin-only restrictions (e.g. Settings, face attendance).

### Phase 8 — Release hardening — ~2–3 sessions
- Full role × module matrix test using test accounts (SCHOOL_ADMIN, TEACHER, MANAGER, ACCOUNTANT, STAFF, PARENT, STUDENT, DRIVER on school 37 and demo school 42).
- Error/offline states, empty states, session-expiry flow, accessibility (touch targets, font scaling), Urdu/RTL decision (web guide videos exist in EN/UR — see §9).
- Performance (list virtualisation, image sizing), crash reporting, push-token lifecycle on logout.
- Store assets: rename slug, icons/splash, privacy policy URL, data-safety form, screenshots, versioning policy, EAS production build + OTA channel strategy.
- `docs/MOBILE.md`, plus update `CLAUDE.md` directory/commands, `ENV_AND_DEPLOYMENT.md`.

Approximate total: **23–27 sessions**, mostly sequential per phase but parts of Phases 4–6 are independent of each other.

## 4. Screen coverage matrix (target for v1)

| Area | Admin | Teacher | Manager | Student | Parent | Driver | Accountant | Staff |
|---|---|---|---|---|---|---|---|---|
| Dashboard | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Attendance entry/register | ✔ | ✔ | – | view | view | boarding | – | – |
| Students | ✔ | assigned only | – | self | children | – | – | – |
| Fees / payments | ✔ | collect | – | view | pay | – | ✔ | – |
| Exams: marks / results / report cards | ✔ | ✔ | – | results | results | – | – | – |
| Assignments (LMS) | ✔ | ✔ | – | submit | – | – | – | – |
| Timetable | ✔ | ✔ | ✔ | ✔ | ✔ | – | – | – |
| Library / Transport | ✔ | – | – | view | view | route | – | – |
| HR (leave, self-service) | ✔ | self | self | – | – | – | self | self |
| Messages / notifications | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Admissions | ✔ | – | – | – | – | – | – | – |

(The matrix follows web rules above; any disagreement with the web config is resolved in favour of the web config.)

## 5. Backend work likely needed

Mostly none — mobile consumes existing endpoints. To verify per phase:
- `/api/auth/me/` / login payload carries what the role router needs (`role`, `effectiveRole`, `enabled_modules`, base-role fields).
- Endpoints that currently depend on session-auth tenant resolution (`request.tenant_school` is `None` for pure-JWT — known gap in `docs/FACE_ATTENDANCE.md`) must work with JWT + `X-School-ID`; mobile is JWT-only, so any module gated by `ModuleAccessMixin` must be tested from the app.
- Payment-gateway return URL → deep link for mobile (Phase 5).
- Forgot/reset password endpoints: confirm they're usable from mobile (email link vs OTP).

## 6. Testing strategy

- Dev backend caution: dev DB is remote Supabase — read-only exploration by default; writes via test accounts only with your approval.
- Scratch/QA must check port 8000 first (see memory `check-port-8000-before-scratch-testing`).
- Unit tests: nav config per role/module; auth routing; API param builders.
- Manual QA script per role per phase, recorded in `docs/MOBILE_QA.md`.
- Optionally reuse the guide-video scenario tooling on a phone viewport for screenshots/regression (already mobile mode in the video pipeline).

## 7. Risks

- **Scope creep**: web has 172 routes; the matrix in §4 plus §8 are the guardrails.
- **Class/session migration is mid-rollout**: mobile touching class scoping needs your sign-off (CLAUDE.md hard rule: no schema changes without approval; mobile itself needs none).
- **Payments and background location** are the two store-review/regression-sensitive features.
- **Single app, many roles**: a bad release affects everyone → use EAS channels (internal → staff pilot → all).
- **Single developer bandwidth** alongside guide-video work (video storage move is on hold).

## 8. Items formerly "web-only" — final decisions (2026-10-27)

| # | Item | Decision |
|---|---|---|
| 1 | Fee setup and discounts | **Include, Admin only** (Phase 9) |
| 2 | School setup wizard | **Web only** — "Open on web" hint |
| 3 | Payroll, salary, appraisals, HR letters | **Include**: payslips (view/approve) first, then appraisals and letters (Phase 9) |
| 4 | Academic sessions and promotion | **Promotion: web only** (hint). Academic calendar included (Phase 1). Session setup/management: web hint (assumption — confirm if you want read-only sessions list) |
| 5 | Exam types, grade scale, exam creation | **Exam creation included** (Phase 9). **Exam types and grade scale: web hint** |
| 6 | Question bank and paper builder authoring | **Include**: question bank first, paper builder last (Phase 9) |
| 7 | Curriculum and TOC OCR | **Include** (camera capture of book TOC; Phase 9) |
| 8 | Lesson plan authoring | **Include** (Phase 9) |
| 9 | Financial reports | **Include** summaries/charts + PDF share (Phase 9) |
| 10 | Inventory management | **Include** items, transactions, assignments (Phase 9) |
| 11 | Risk score and analytics pages | **Include**, read-only cards (Phase 9) |
| 12 | Accuracy dashboard | **Skip** (attendance OCR is parked) |
| 13 | Student bulk import/export | **Skip, with "Open on web" hint** |
| 14 | Super-admin pages, brochure | **Skip** — no super-admin pages on mobile; brochure not included |

"Open on web" hint = a screen/entry that explains the feature is on the web and deep-links to it, instead of a dead end.

## 9. Decisions made

1. **Distribution:** APK (EAS `preview` profile) for now; Play Store for the final release. iOS not in scope.
2. **Language:** English only in v1 (Urdu RTL = full right-to-left layout mirroring; deferred).
3. **Face attendance:** same flow as web (live capture, client-side embeddings). `face-api.js` does not run in React Native, so the first approach is to load the web live-capture page in a WebView (`react-native-webview` is already a dependency); native detection is a later option and must produce `faceapi_v1`-compatible embeddings. Look for bugs while reading the web flow and record them in `docs/PHASE5_KNOWN_FAILURES.md`.
4. **Offline:** read-only cache (React Query persistence); no offline writes.
5. **Teacher authoring:** included via Phase 9 items 6, 7, 8 (supersedes the earlier view-only proposal).
6. **Payments:** no gateway is working. Parents get fee viewing/history and a "pay at school" message; the `payment-result` stub is removed. Full checkout is built when a gateway goes live.
7. **Driver:** student boarding attendance included (match web `transport/attendance`).
8. **Web-only list:** replaced by §8.

## 10. Phase 9 — Extended modules — ~12–15 sessions

Order (each reviewed with you before the next): 11 risk/analytics cards → 9 financial reports → 10 inventory → 1 fee setup/discounts → 3 payroll (payslips first) → 5 exam creation → 7 curriculum + TOC OCR → 8 lesson plans → 6 question bank → 6 paper builder.
Plus "Open on web" hint screens for items 2, 4 (promotion/sessions), 5 (exam types, grade scale), 13.

Total estimate: Phases 1–8 about 23–27 sessions + Phase 9 about 12–15 = **~36–42 sessions**.

## 11. Proposed first step on approval

Phase 1 foundation, in this order (each reviewed with you before the next): (1) nav config + role route groups + guards with tests, (2) auth additions (school switcher, forgot password), (3) React Query + UI kit additions, (4) admin dashboard and Manual Entry attendance. No commits, pushes or PRs without your explicit approval.
