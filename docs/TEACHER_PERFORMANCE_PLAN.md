# Teacher Performance Report — Plan

Status: **All four phases built (2026-11-17), uncommitted. Phase 1 migrations applied to Supabase; later phases needed none. Waiting for a phone test on a device (`docs/MOBILE_QA.md` 6o) and a decision to commit.** See sections 12-15.

An automated report that scores each teacher on the work they did in the app
against the work that was due, for a calendar month or any date range.

## 1. Decisions already made

| # | Question | Answer |
|---|---|---|
| 1 | Record who marked attendance and who entered exam marks? | Yes. New nullable columns, filled from now on. |
| 2 | Can teachers see their own score? | Yes, on their dashboard (web and mobile). |
| 3 | Do student results affect the score? | No. Shown as information only. |
| 4 | Default weights | Accepted, then re-balanced for the four added measures (section 3). |
| 5 | Attendance cut-off time | 11:00 am school time, editable per school. |
| 6 | Extra scored measures | Login days, messages answered, question papers created, book content entered. |
| 7 | Info button | Wherever a score or rank is shown, an info button explains the rules and how to improve. |

Assumption to confirm: a teacher sees their own score and their own position
("5th of 22") but never other teachers' names or scores. Controlled by a
school setting `show_rank_to_teachers` (default on).

## 2. Scoring principle

Every measure is **done ÷ due**, giving 0–100. Raw counts are never the score.

- A teacher with 2 classes and a teacher with 8 are compared fairly.
- Creating empty records does not raise a score: only published / complete items count, and count-type measures are capped at their target.
- A measure that does not apply to a teacher is left out and the remaining weights are rescaled to 100 (for example, a subject teacher who is not a class teacher has no attendance-marking measure).
- Off days (`SchoolCalendarEntry`, `OFF_DAY`, respecting class scope) and the teacher's approved leave (`LeaveApplication`) are removed from "due".
- Only staff with the teaching flag (`is_teaching`, see `core/roles.py`) and an active membership are scored.

Overall score = weighted average of the applicable measures. Bands:
90+ Excellent, 75–89 Good, 60–74 Fair, below 60 Needs attention (editable).

## 3. The ten scored measures

| Key | Measure | Due | Done | Timeliness rule | Weight |
|---|---|---|---|---|---|
| `attendance_marking` | Class attendance marked | working days × sections where they are class teacher | days with records for that section | full credit if first record `created_at` is before the cut-off (11:00); half credit if later the same day; none after | 20 |
| `lesson_plans` | Lesson plans | timetable periods in the range (`TimetableEntry` × working days) | `PUBLISHED` plans with `lesson_date` in range, max one per period | full credit if created on or before `lesson_date` | 15 |
| `marks_entry` | Exam marks entered | students × exam subjects they teach, for exams with `exam_date` in range | `StudentMark` with marks or `is_absent` | full credit within N days of `exam_date` (default 7) | 15 |
| `own_attendance` | Own attendance | working days minus approved leave | `PRESENT` = 1, `LATE` / `HALF_DAY` = 0.5 | none | 10 |
| `homework` | Homework and diary | target per class-subject per week (default 2) | `PUBLISHED` assignments, capped at target | none | 10 |
| `grading` | Homework grading | submissions received in range | graded submissions | full credit if `graded_at` within N days of `submitted_at` (default 3) | 10 |
| `messages_answered` | Messages answered | incoming messages from parents / students / admin that start or continue a thread | threads where the teacher replied after the incoming message | full credit within 24 hours | 5 |
| `question_papers` | Question papers created | target per month (default 1 per class-subject taught, pro-rated to the range) | `ExamPaper` with `generated_by` = teacher, status `READY` or `PUBLISHED`, capped at target | none | 5 |
| `book_content` | Book content entered | target content blocks per month (default 10, pro-rated) | `ContentBlock` rows created by the teacher plus edits (`ContentRevision.changed_by`), capped at target | none | 5 |
| `login_days` | Login days | working days in range | distinct dates with a `LoginEvent` for the user | none | 5 |

Shown but **not scored**: syllabus coverage against `TopicSchedule` dates,
questions added to the bank, class result averages, total leave days.

Every weight, target and deadline above lives in the school's config row.

### Notes per measure

- **Attendance marking** is scored by responsibility (the class teacher owns the section), not by who pressed the button. The new `marked_by` column is shown in the detail view as information.
- **Marks entry** is scored by responsibility too (`ClassSubject.teacher` for the exam's class / section and subject). `entered_by` is shown as information.
- **Messages** come from two places: `messaging.Message` (threads with `ThreadParticipant`) and `parents.ParentMessage` (`recipient_user` = teacher). Both are counted. A thread the teacher started with no incoming message is not "due".
- **Login days**: access tokens last 1 hour in production, 1 day locally, and the app refreshes silently, so a `LoginEvent` is written only on a real login. Phase 1 must check whether a teacher who stays signed in for days still produces daily events. If not, record a "seen today" marker on token refresh instead (one row per user per day).
- **Book content**: `ContentBlock` has no creator column, and `ContentRevision.changed_by` is only filled when the view sets `_revision_changed_by`. Phase 1 must confirm which write path the content editor uses (`ContentBlock` rows or the `Topic.content_blocks` JSON) and attribute from there.
- **Known limit**: class and subject assignments keep no history, so a teacher who changed classes mid-period is scored on their current classes. Frozen monthly snapshots (section 5) remove this problem for past months.

## 4. Database changes

All additive. Applying migrations to Supabase is the owner's call
(see CLAUDE.md hard rules); verify the DB engine before any `migrate`.

New tables (app `hr`):

- `TeacherPerformanceConfig` — one row per school: `weights` (JSON), `attendance_cutoff_time` (default 11:00), `marks_deadline_days`, `grading_deadline_days`, `message_reply_hours`, `homework_per_week`, `papers_per_month`, `content_blocks_per_month`, `bands` (JSON), `show_rank_to_teachers`, `enabled`.
- `TeacherPerformanceSnapshot` — `school`, `staff_member`, `period_start`, `period_end`, `overall_score`, `rank`, `out_of`, `breakdown` (JSON: per measure due / done / on-time / score / weight / missed items), `config_used` (JSON), `computed_at`. Unique on (`school`, `staff_member`, `period_start`, `period_end`).

New nullable columns on existing tables (**sign-off given, decision 1**):

- `attendance.AttendanceRecord.marked_by` → `users.User`, set in manual bulk entry and face-attendance confirm.
- `examinations.StudentMark.entered_by` → `users.User`, set in marks entry.
- `lms.ContentBlock.created_by` → `users.User` (**needs sign-off**; required for the book-content measure unless Phase 1 finds an existing attribution).

Old rows stay null; nothing is backfilled.

## 5. Server design

```
backend/hr/performance/
    __init__.py
    periods.py     # working days per school / class, leave removal, pro-rating
    metrics.py     # one function per measure, whole school per call
    scoring.py     # weights, rescaling for N/A measures, bands, ranking
    explain.py     # builds the info-button text from the school's config
    service.py     # compute(school, start, end, staff_ids=None) -> results
```

- Each metric function runs a few grouped queries for the whole school and returns `{staff_id: {due, done, on_time, score, missed: [...]}}`. No per-teacher query loops. No `iterator()` (transaction-pooled Postgres).
- School time zone: the cut-off compares local school time, not UTC.
- Custom ranges are computed live. If timing on a large school is slow, route through `core/task_utils.py::dispatch_background_task`.
- **Monthly snapshots**: a Celery Beat task on the 1st of each month freezes the previous month for every school with the feature enabled, then sends each teacher an in-app notification. A manual fallback is added to `run_scheduled_jobs`.
- A request for a full past calendar month reads the snapshot; anything else is live.

Endpoints (all tenant-scoped via `ensure_tenant_school_id`, HR module gated):

| Method | URL | Who | Returns |
|---|---|---|---|
| GET | `/api/hr/teacher-performance/?start=&end=` | admin, principal | ranked list |
| GET | `/api/hr/teacher-performance/{staff_id}/?start=&end=` | admin, principal | full breakdown with missed items |
| GET | `/api/hr/teacher-performance/my/?start=&end=` | teacher | own breakdown, own rank if allowed |
| GET / PUT | `/api/hr/teacher-performance/config/` | admin | config row |
| GET | `/api/hr/teacher-performance/explainer/` | any signed-in staff | info-button content |
| POST | `/api/hr/teacher-performance/export/` | admin, principal | PDF / Excel via `reports` generators |

## 6. Info button

Shown next to every score and rank: admin list header, teacher detail page,
teacher dashboard card (web and mobile).

- Web: hover (and keyboard focus) opens a popover. Mobile: tap opens a bottom sheet (phones have no hover).
- Content comes from `explainer/`, built from the school's own config, so it always states the real numbers. Example:
  - "Mark class attendance before **11:00 am**. Later the same day earns half."
  - "Enter exam marks within **7 days** of the paper."
  - "Grade homework within **3 days**. Answer messages within **24 hours**."
  - "Publish a lesson plan on or before the lesson date."
  - "Targets: **2** homework per subject per week, **1** paper per subject per month."
  - "Holidays and approved leave never count against you."
  - Each measure's weight, and the three measures where this teacher lost the most points ("Your quickest wins").

## 7. Web screens

- `pages/hr/TeacherPerformancePage.jsx` — month picker plus custom range; ranked list using the shared card system (`RecordCard`, `CardGrid`, `StatusPill`, `ViewToggle`); score band colour; info button.
- Detail view — one bar per measure (due, done, on time), and the exact misses (dates attendance was late or missing, exams with marks pending, ungraded submissions, unanswered threads).
- Settings tab — weights (must total 100), targets, cut-off time, deadlines, rank visibility.
- `pages/teacher/TeacherDashboard.jsx` — "My performance" card: this month's score, band, position, three quickest wins, info button, link to own detail.
- "Start appraisal from this report" on the detail view pre-fills `PerformanceAppraisalPage` (suggested rating = score ÷ 20, rounded; reviewer can change it).
- API calls go in a `teacherPerformanceApi` object in `services/api.js`; React Query everywhere.
- Navigation entry under HR; user guide entry.

## 8. Mobile screens

- `mobile/app/(teacher)/dashboard.tsx` — the same "My performance" card and a detail screen.
- Admin list and detail under the admin HR area.
- Info button opens a bottom sheet.

## 9. Phases

| Phase | Scope | Done when |
|---|---|---|
| 1 | Migrations (2 tables + new columns), write-path changes to fill the new columns, `periods.py`, all ten metrics, scoring, live endpoints, explainer | per-metric tests pass on the shared seed school; results checked by hand for 2 teachers in school 37 |
| 2 | Web admin page, detail view, settings tab, info button | checked in the browser against the Focus school |
| 3 | Teacher dashboard card and own detail (web), monthly snapshot task, in-app notification, PDF / Excel export | snapshot for a past month matches the live figure |
| 4 | Mobile (teacher card, admin list), appraisal pre-fill, unscored information measures, docs (`API_ENDPOINTS.md`, `FRONTEND_PAGES.md`, `MOBILE.md`, user guide) | phone test |

## 10. Tests

- `backend/hr/tests/` (or the app's existing pattern): one test file per metric plus scoring and permissions. Reuse the shared `seed_data` school; do not create schools per test.
- Cases that must be covered: off day excluded; teacher on approved leave excluded; non-class-teacher gets weights rescaled; late attendance earns half; target cap; teacher cannot read another teacher's report; another school's data never leaks.
- Frontend: vitest for the list page, the weights form (total must be 100) and the info popover.
- Run only new / touched test files while building; full suite at the end.

## 11. Open items for Phase 1 to settle

1. Does `LoginEvent` give one row per active day, or is a "seen today" marker needed?
2. Which write path stores book content, and is `ContentBlock.created_by` needed (sign-off)?
3. Where the school's time zone comes from for the 11:00 cut-off.
4. Confirm the teacher-sees-own-rank assumption (section 1).

## 12. Phase 1 results (2026-11-16)

Open items settled (section 11):

1. **Login days**: `LoginEvent` is written only on a password sign-in; silent token refresh (web hourly,
   phone up to 30 days) writes nothing. Added `core.UserActiveDay` (one row per user per day), written on
   sign-in and on token refresh (`core/activity.py`, cached so at most one insert per user per day).
   Login days = days with a marker or a sign-in.
2. **Book content**: the web curriculum page and the phone app both write `ContentBlock` rows through
   `/api/lms/content-blocks/`; nothing writes the `Topic.content_blocks` JSON. `ContentBlock.created_by`
   added (signed off); `perform_update` now passes the user to the revision signal so
   `ContentRevision.changed_by` is filled on edits (it was only filled on restore).
3. **Time zone**: `School.timezone` via `core.school_time` (default `Asia/Karachi`).
4. **Own rank**: confirmed by the owner; `show_rank_to_teachers` defaults on.

Rules chosen while building (change in `hr/performance/metrics.py` if wanted):

- Late work earns half credit for lesson plans, marks, grading and messages. Attendance keeps its own rule
  (half after the cut-off the same day, none on a later day).
- An item still inside its deadline and not done is left out ("not yet due"); done items always count.
- Weekly and monthly targets are pro-rated by the teacher's working days (6 per week, 26 per month), so
  holidays and leave lower the target.
- Homework counts every published assignment type; a class-subject's count is capped at its own target.
- Own attendance is left out for everyone when the school recorded no staff attendance in the range.
- Class-only off days free that class's register but not the teacher's own working days.
- Fixed-camera face attendance leaves `marked_by` empty (no person behind it).

Migration files (all applied to Supabase 2026-11-17): `core 0009_useractiveday`, `attendance 0011_attendancerecord_marked_by`,
`examinations 0042_studentmark_entered_by` (depends on the unapplied paper-builder 0040/0041),
`lms 0021_contentblock_created_by`, `hr 0007_teacherperformanceconfig_teacherperformancesnapshot`.

Tests: `backend/hr/tests/test_perf_*.py` (one file per measure, plus scoring, permissions, write paths).

## 13. Phase 2 results (2026-11-17)

- `frontend/src/pages/hr/TeacherPerformancePage.jsx` at `/hr/teacher-performance` (admin and principal), menu item
  "Teacher Performance" under HR. Report tab: month picker or custom range; table or cards (`useViewPreference`),
  rank, score, band pill, quickest wins. Clicking a teacher opens the detail view.
- `pages/hr/teacherPerformance/TeacherPerformanceDetail.jsx`: score, band, rank, one bar per measure (due / done /
  on time / effective weight), measures that do not apply greyed out, missed items per measure.
- `pages/hr/teacherPerformance/TeacherPerformanceSettings.jsx`: weights with a live total (save blocked unless 100),
  cut-off time, deadlines, targets, bands, rank visibility; server errors shown by the field.
- `components/teacher/PerformanceInfo.jsx`: the info button. Opens on hover, keyboard focus or tap; positioned from
  the button and kept inside the viewport (works at phone width); content from `explainer/`. Reusable for Phase 3.
- `teacherPerformanceApi` in `services/api.js`.
- Tests: `pages/hr/__tests__/TeacherPerformancePage.test.jsx` (7 pass).
- Checked in the browser on the Focus school (9 teachers ranked, detail, missed items, settings save, phone width).
  A report takes about 5 s from a local machine to the Singapore database; faster on Render is expected. If it is
  slow in production, route custom ranges through `dispatch_background_task` (section 5).

## 14. Phase 3 results (2026-11-17)

- **Snapshots** (`hr/performance/snapshots.py`): `freeze_month` stores one row per teacher (score, rank, out of,
  full breakdown, settings used); re-freezing replaces the month's rows. `report_for` returns the snapshot for a
  whole past month that has one (`snapshot: true`, `frozen_at`), otherwise live. List, detail, `my/` and export use it.
- **Monthly job:** `hr.tasks.freeze_teacher_performance`, Beat entry `monthly-teacher-performance-snapshot`
  (03:15 on the 1st). Freezes the previous month for every active school with HR, without creating settings rows.
  Manual: `run_scheduled_jobs --teacher-performance [--school ID] [--month YYYY-MM]`; not part of `--all`
  (the daily fallback), and a named-month re-freeze sends no messages.
- **Notification:** one in-app `GENERAL` message per scored teacher after the freeze, only when teachers may see their
  score; the position is left out when rank is hidden.
- **Export:** `POST /api/hr/teacher-performance/export/` (`start`, `end`, `format` PDF or XLSX), admin and principal.
  Landscape PDF and its own Excel writer (`hr/performance/export.py`); the shared Excel renderer is broken (see
  `docs/PHASE5_KNOWN_FAILURES.md`).
- **Web:** "My performance" card on the teacher dashboard (`components/teacher/MyPerformanceCard.jsx`), own page
  `/my-performance` (menu item for teachers), Export PDF / Excel buttons and a "frozen on" note on the admin page.
- **Tests:** backend `hr/tests/test_perf_snapshots.py`, `test_perf_export.py` (whole suite 70 pass; frozen month equals
  live); frontend `MyPerformanceCard.test.jsx` + additions to `TeacherPerformancePage.test.jsx` (16 pass).
- Browser: export checked on Focus (PDF and Excel built from real data). The teacher card and own page were checked
  in tests only (no Focus teacher login used). No month was frozen on Supabase.

## 15. Phase 4 results (2026-11-17)

- **Information figures** (`hr/performance/info.py`), in every result under `info`, never scored: syllabus topics planned
  in the period and taught by their planned date (`lms.coverage`'s meaning of taught), questions added to the bank,
  class result average for the teacher's class-subjects, approved leave on working days. Shown on web and phone detail
  views; extra columns in the Excel export (not the PDF).
- **Appraisal pre-fill:** "Start appraisal from this report" on the admin detail opens the appraisal form with the
  teacher, period, suggested rating (score ÷ 20, rounded, 1-5) and the quickest wins under areas to improve. Passed in
  router state rather than the address bar, so no text lands in a URL.
- **Phone app:** teacher Home card, My Performance screen (More > My HR), admin HR > Teacher Performance (list, detail,
  PDF / Excel through the share sheet), info button as a bottom sheet. Settings stay web-only.
- **Docs:** `API_ENDPOINTS.md`, `FRONTEND_PAGES.md`, `BACKEND_APPS.md`, `MOBILE.md`, `MOBILE_QA.md` (6o), user guide
  sections 8.13 (admins) and 8.14 (teachers).
- **Tests:** backend 73 pass (`hr/tests`), web 20 (+192 guide/page tests unchanged), mobile 145 (helpers, menus, route
  structure, accessibility); `tsc` clean.
- **Checked in the Expo web build** at phone size against a scratch SQLite backend (port 8300, launch configs
  `backend-scratch-8300` and `mobile-scratch-8300`): teacher card, My Performance, info sheet, admin list and detail.
  Share buttons need a device. Never run on a phone.

