# Mobile polish and speed plan

Status: **in progress**. Step 1 (B4, B2, A4, A1) built and reviewed 2026-11-26. Step 2 (B1) built
2026-11-26, uncommitted, waiting for owner review (needs a backend deploy to take effect; the app
falls back to the old requests until then). Step 3 (B3, B5) built 2026-11-26, uncommitted, waiting for owner review. B5 done as the owner chose:
pickers only (`hooks/usePrefetchNext.ts`, called by the admin, teacher and finance Homes).
Step 4 (A2 batch 1, A3) built 2026-11-26, uncommitted, waiting for owner review. Step 5 (B7, A5) built 2026-11-26, uncommitted, waiting for owner review (server parts need the
backend deploy; the app works with the old server meanwhile). Step 6 (A2 batch 2) built 2026-11-26, uncommitted, waiting for owner review. Step 7 (B6) built 2026-11-26, uncommitted,
waiting for owner review: all 7 steps are now built. Open: owner review of Steps 5-7, commit,
backend deploy (Steps 2 and 5), and one new APK (Step 7 adds a native module).
Browser check 2026-11-26 (scratch data, admin / teacher / parent): all changed screens render with
no console errors. Fixed during it: the teacher bundle's in-process calls used the host "testserver"
(not in ALLOWED_HOSTS), so any section whose list has a next page failed (attendance progress showed
"Could not load"); they now use the real request's host. FormScreen leaves room for the raised tab
circle (`TAB_BUBBLE_RISE` in FancyTabBar) so it no longer covers Save. Two raw dates fixed (teacher
Home exams, submissions header).
Step 7 notes: `expo-image` ~3.0.11 installed (owner approved). 11 places showing pictures from the
server now use it (disk cache, fade-in on Avatar): Avatar, login school logo, school profile
logo/letterhead, face enrollment thumbs and review crops, question pictures, picture picker,
scan review, block form, paper photo viewer, document picture. Camera previews and the bundled icon
keep the built-in Image (already on the phone). `npx expo export --platform android` builds.
Step 6 notes: 13 lists moved onto RecordCard: exams admin, assignments, submissions, lesson plans,
curriculum coverage, papers, worksheets, content lists, appraisals, letters, insights, calendar,
subjects (their dates now read "26 Nov 2026"). Not moved: results (the gold/silver/bronze rank circle
and the open-up marks table are the point of that screen) and the question bank (the question text
needs three lines; a row card shows one).
Step 5 notes: B7 = `core.mixins.ListETagMixin` (ETag is a hash of the list answer itself, 304 when
unchanged; done in finalize_response, so ViewSets with their own list() are covered) on academic
years, terms, classes, subjects, accounts, expense and income categories; phone side
`services/etagCache.ts` + the axios interceptors in `services/api.ts` (memory only, cleared with the
query cache). Checked on the scratch db: all 7 lists give 304 with the tag, 200 with a stale one.
The web app gets the same 304s through the browser's own cache. A5 = `recent_entries` takes
`offset` (cap 2000) and `date_from`/`date_to` (each row's own date), same list shape; existing tests
pass (13). Phone: `useEntryHistory` (Load 50 more, month filter); with an older server it stops
when a page brings nothing new and checks the month on each row.
Step 4 notes: A2 moved 16 lists onto RecordCard (fee collection, accounts, payroll, salary, payslips,
staff directory, my attendance, enquiries, library catalog + issue/return, hostel allocations + gate
passes, inventory items/movements/assignments/reorder). RecordCard gained `selected`/`onSelect` (tick
box) and `trailingColor`. Student fee amounts and staff attendance marking stay as they are: they are
editing grids, like marks entry; their lists now keep off-screen rows (typing boxes). A3:
`components/ui/FormScreen` on the full-page forms (income, expense, student, staff, assignment, send
notification). Transfer and enquiry already use the shared `FormSheet`, and leave its own sheet; fee
setup is a table editor, so none of these moved.
Step 3 notes: B3 moved 7 screens to drawn-as-you-scroll lists: student leave, deleted students,
running jobs, transport dashboard, student transport, exam schedule (dates now "26 Nov 2026"), and
the fee overview's pending students (one card per class). New `components/ui/QueryList` = AppList +
QueryBoundary states. Assessments already used a list (Step 1); report cards show one student, so
no long list there. B5 as written conflicts with the app's own rules: attendance and money screens
always fetch fresh (`staleTime: 0`), so loading them early is wasted or shows old figures; the
parent Home already loads each child's overview under the same key. Proposed instead: prefetch
only the pickers those screens wait on (teacher's class list, session/master classes, account
names, exam types).
Step 2 notes: `GET /api/bootstrap/teacher-dashboard/` (`backend/core/teacher_bootstrap_views.py`)
runs each existing endpoint in-process as the same user, so every section is that endpoint's exact
answer (checked against the scratch db: all sections identical). The phone's
`useTeacherHomeBundle` (`hooks/useTeacher.ts`) seeds each section's own cache key; a null section
or a failed bundle falls back to that section's own request. The teacher performance card stays a
separate request on purpose (it builds a whole-school report for the rank).
Step 1 notes: B2 ships as `components/ui/AppList` on 55 lists (chat lists, marks entry, the paper editor,
picture picker and `Select` keep a plain FlatList); per-row memoising was not done (rows pass inline
handlers, so memo would not help). A4 adds `services/dates.ts` plus `monthLong` ("November 2026") for
month headings. A1: the two "some rows were not saved" lists (manual attendance, marks entry) are now a red toast
with the first 3 names and "...and N more"; long toasts stay up to 8 s. `confirm()` itself is still
the system box on phones (separate follow-up if wanted).
Follows `MOBILE_UI_REFRESH_PLAN.md` (all 5 phases built). Out of scope by decision: dark mode,
vibration on tap.

Each item says where it lands: **phone** (mobile JS only), **server** (needs a backend deploy) or
**APK** (adds a native module, needs a new app build). Tests: decided per item with the owner when
it is reviewed (small changes ship without new tests).

---

## Part A: UI

### A1. Replace system pop-ups with the app's own (phone, small)
`Alert.alert` looks like a plain system box and does nothing on the web build. 16 calls in 10 files:

| File | Calls |
|---|---|
| `app/(admin)/attendance/capture.tsx` | 3 (OCR, parked feature) |
| `app/(admin)/attendance/review.tsx` | 2 (OCR, parked feature) |
| `app/(admin)/face-attendance/capture.tsx` | 1 |
| `app/(auth)/login.tsx` | 2 |
| `app/(auth)/register.tsx` | 3 |
| `components/attendance/ManualAttendanceScreen.tsx` | 1 |
| `components/ChatInterface.tsx` | 1 |
| `components/exams/MarksEntryScreen.tsx` | 1 |
| `components/nav/SchoolSwitcher.tsx` | 1 |
| `components/ui/Toast.tsx` | 1 (fallback inside the toast itself) |

Rule: information → `toast`; a question with Yes/No → `confirm()` (already used elsewhere).

### A2. Remaining lists onto the shared row card (phone, medium)
About 45 list screens still draw their own rows. Move the people/record lists onto `RecordCard`
(icon or photo, title, subtitle, status pill, amount, footer for buttons). In two batches:
- **Batch 1 (most used):** fee collection + student fees, accounts, payroll, salary, payslips,
  staff attendance, staff directory, my attendance, enquiries, library catalog + issue/return,
  hostel allocations + gate passes, inventory items/movements/assignments/reorder.
- **Batch 2:** exams admin, results, assignments, submissions, lesson plans, coverage, papers,
  worksheets, question bank, content lists, appraisals, letters, insights, calendar, subjects.
Not moved (they are editors or chat, not record lists): marks entry, manual attendance, register
grid, block paper editor, picture picker, Aura chat, ChatInterface.

### A3. One form layout (phone, medium)
A shared `FormScreen` wrapper: fields scroll above the keyboard, the Save button is pinned at the
bottom, same spacing and error line everywhere. Apply to the record/edit forms (income, expense,
transfer, student, staff, assignment, leave, notification, enquiry, fee setup...).

### A4. One date format everywhere (phone, small)
21 places format dates their own way (`toLocaleDateString`, `format(...)`, `shortDate`,
`formatLessonDate`, `formatIssueDate`). Add one `services/dates.ts` with `day` ("26 Nov 2026"),
`dayShort` ("26 Nov"), `dayTime` ("26 Nov, 10:42"), `monthYear` ("Nov 2026") and switch them over.
Dates sent to the server stay `YYYY-MM-DD`.

### A5. Transaction history: more than 50, with dates (server + phone, small)
`recent_entries` stops at 50. Add `offset` and `date_from`/`date_to` to it (same shape, server),
then "Load more" and a month filter on the Transaction History screen (phone).

---

## Part B: Speed

### B1. One request for the teacher's Home (server + phone, medium)
The teacher Home opens about 10 requests (timetable, class assignments, section progress, off day,
pending submissions, students at risk, exams, week lesson plans, performance, notifications). Add a
`teacher dashboard` bundle endpoint, like the admin's `bootstrapApi.getAdminDashboard`, returning
them in one answer; the Home reads that. Same idea afterwards for manager / staff / driver Homes if
measured slow.

### B2. Shared settings for long lists (phone, small)
62 `FlatList`s; 3 set any rendering limits. Add a shared `AppList` (or defaults in the existing
`List` helper): `initialNumToRender` ~10, `windowSize` ~7, `maxToRenderPerBatch` ~10,
`removeClippedSubviews` on Android, memoised rows. Swap the 62 over.

### B3. Big lists drawn all at once (phone, medium)
19 screens map query data inside a `ScrollView`, drawing every row up front. Move the ones that can
grow large to `AppList`: student leave, deleted students, fee overview student list, exam schedule,
assessments, report card list, student transport, transport dashboard, running jobs. Short fixed
lists (a handful of rows) stay as they are.

### B4. Keep rarely-changing lists longer (phone, small)
Default `staleTime` is 60 s, so these refetch on almost every visit. Set 15-30 min for:
`academicYears`, `classes`, `subjects`, `terms` / `academicTerms`, account options
(`accounts/options`), entry categories, departments, designations. Money roots stay at 0
(`services/queryRules.ts` `MONEY_QUERY_ROOTS`), and any save already invalidates its list.

### B5. Fetch likely next screens early (phone, small)
After each Home settles, quietly prefetch what that role opens next:
admin → today's attendance + fee collection; teacher → today's sections + marks entry list;
parent → each child's overview; finance → fee overview. Uses `queryClient.prefetchQuery` with the
same keys, so the next screen opens from cache.

### B6. Cache photos and logos on the phone (APK, small)
13 places use the built-in `Image`, which re-downloads. Switch to `expo-image` (disk cache,
placeholder, fade-in), starting with `Avatar` (used everywhere) and the school logo.
**Needs a new APK**: plan it into the next build.

### B7. "Nothing changed" replies for fixed lists (server, medium)
Same pattern as `/api/schools/directory/`: an ETag on the rarely-changing list endpoints (academic
years, classes, subjects, terms, accounts options, categories). The phone sends `If-None-Match` and
gets an empty 304 when nothing changed. One shared server helper (mixin) so each endpoint is a
line; phone side is one axios interceptor that remembers ETags per URL.

---

## Order

| Step | Items | Lands as | Why first |
|---|---|---|---|
| 1 | B4, B2, A4, A1 | phone | Small, no deploy, felt at once |
| 2 | B1 | server + phone | Biggest Home speed-up |
| 3 | B5, B3 | phone | Faster next screens, smoother big lists |
| 4 | A2 batch 1, A3 | phone | Visual consistency on the busiest screens |
| 5 | B7, A5 | server + phone | Fewer bytes; fuller history |
| 6 | A2 batch 2 | phone | The rest of the lists |
| 7 | B6 | APK | Rides the next app build |

Server items (B1, B7, A5) need a backend deploy before the matching app update; each falls back
safely if the app ships first. Nothing here changes the database.

---

## How to work (for the session that builds this)

**Owner's rules**
- Stop after **each step** in the Order table: say in plain words what changed and what to look
  at, then wait for the owner to review before starting the next step.
- No new tests and no browser checks unless the owner asks; the owner checks each step and says
  when tests are wanted. Run `npx tsc --noEmit -p .` (from `mobile/`) after edits so nothing is
  left broken, and `node scripts/ui_audit.js` (must stay all 0).
- Never commit or push unless asked. The working tree already holds a lot of other uncommitted
  work (UI refresh phases, school search, finance screens...): touch only this plan's files.
- Never run `migrate`; nothing in this plan needs a migration. Never write to the real database.
- New screens and rows use the blocks listed in `docs/MOBILE.md` "Screen building blocks"
  (RecordCard, TileGrid, AttentionCard, HomeHero, SectionState, EmptyState, RoleStack...).
  Sizes and colours come from `mobile/constants/colors.ts` (`FontSize`, `GlyphSize`, `Colors`,
  `Palette`): no raw numbers or hex values (the audit checks).
- Write for a non-technical owner: plain words, say what they will see.

**Code pointers**
- Query defaults: `mobile/services/queryClient.ts` (staleTime 60 s) and
  `mobile/services/queryRules.ts` (`MONEY_QUERY_ROOTS` get staleTime 0: never lengthen those).
  Static lists live in `hooks/useAcademicYear.ts` (academicYears, classes), `hooks/useAssignments.ts`
  and `hooks/useManager.ts` (subjects), `hooks/useExamsAdmin.ts` (terms), `hooks/useAccountsAdmin.ts`
  (`accounts/options`; the `accounts` root also holds balances, so set the longer time per query,
  not per root).
- Teacher Home: `mobile/app/(teacher)/dashboard.tsx`; the admin's bundle endpoint to copy is
  `bootstrapApi.getAdminDashboard` (backend `bootstrap` app).
- Existing list helper: `List` inside `mobile/components/finance/FinanceListScreen.tsx`.
- Recent entries feed: `recent_entries` in `backend/finance/views.py` (A5).
- ETag pattern to copy (B7): `SchoolViewSet.directory` in `backend/schools/views.py` +
  `useSchoolDirectory` in `mobile/hooks/useSchoolDirectory.ts`. Every `/api/` answer gets
  `Cache-Control: no-cache` from `core/cache_middleware.py` (fine: ETag + 304 still works);
  `if-none-match` is allowed and `etag` exposed in CORS (`config/settings.py`).

**Running it** (`.claude/launch.json`)
- Real data: `backend-real-8000` + `mobile-real-8383` (open `http://localhost:8383`). Signing in
  here writes real login records.
- Scratch data (safe): `backend-scratch-8300` + `mobile-scratch-8300` (`http://localhost:8282`),
  local SQLite with two schools (`seed-test-alpha`, `seed-test-beta`). Logins (password
  `Abcd1234`): `SEED_TEST_admin`, `SEED_TEST_staff_teacher1`, `guide_parent`. The 8300 server
  runs with `--noreload`: restart it after backend edits.
- The Expo web bundle does not hot-reload (`hot=false`): refresh the page after edits.
