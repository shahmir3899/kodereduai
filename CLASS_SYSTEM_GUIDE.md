# Class System Guide: Master Class vs Session Class

This is the developer-facing guide for the dual-key class system in this codebase. It supersedes
`CLASS_SYSTEM_DOCUMENTATION.md` (Phase 1 investigation) as the reference to read before touching
any class-scoping code; that file is kept for historical detail but this guide is now the primary
source, with a verified re-audit folded in.

---

## 0. Rules for New Features (read this before writing code)

Any PR that adds or touches class filtering/scoping MUST follow these rules:

1. **Backend: never hand-roll a class resolver.** If a view/endpoint accepts a class filter
   (`class_id`, `class_obj`, `session_class_id`), call `resolve_class_scope()`
   (`backend/core/class_scope.py:21`). Don't write a second ad hoc "look up SessionClass and derive
   class_obj_id" helper — one already exists and is used by 20+ call sites across `academics`,
   `academic_sessions`, `face_attendance`, `finance`, `lms`, `examinations`.

2. **Frontend: never rely on `ClassSelector`'s default scope.** `ClassSelector.jsx` defaults
   `scope` to `'master'` (`frontend/src/components/ClassSelector.jsx:18`). Every call site embedded
   in a session-aware flow (i.e. anywhere `activeAcademicYear` drives the rest of the form) must
   pass `scope={classSelectorScope}` (or the equivalent `activeAcademicYear?.id ? 'session' :
   'master'` expression) explicitly — do not omit it and assume the default is correct. The one
   legitimate exception found in this audit is `FaceDevicesPage.jsx:80`, which omits `scope`
   because the underlying `FaceAttendanceDevice.class_obj` field
   (`backend/face_attendance/models.py:366`) is Master-Class-only by model design — in that case the
   default happens to be correct, but say so in a comment so the next reader doesn't "fix" it.

3. **If you add a uniqueness constraint involving class, explicitly decide and document whether
   it's per Master Class or per Session Class, and why.** Precedent to follow:
   - Per-session_class: `ClassSubject.unique_together` includes `session_class`
     (`backend/academics/models.py:81`) — because two sections can have different subject-teacher
     pairings.
   - Per-session_class with a legacy fallback: `StudentEnrollment` has two mutually exclusive
     constraints, `unique_roll_per_session_class_enrollment` (session_class set) and
     `unique_roll_per_legacy_class_enrollment` (session_class null)
     (`backend/academic_sessions/models.py:310-319`) — the dual-constraint pattern to copy for any
     model growing a nullable `session_class` FK on top of an existing `class_obj`-keyed uniqueness.
   - Per-master-class only: `Exam` (`exam_group_class_unique`,
     `backend/examinations/models.py:151-156`) — intentional, because `Exam` has no `session_class`
     field at all (see §7, Issue 3).

4. **If a model/trigger reads `session_class` only to build a display label, that's a smell.**
   `notifications/triggers.py` has this exact anti-pattern in three places (see §7, Issues 1, 2, 2b)
   — a `ClassTeacherAssignment.session_class` is joined and select_related'd, then used only for a
   `class_label` string while the actual student/attendance queryset filters on `class_obj` alone.
   If you read `session_class` for a label, ask whether the filtering logic beside it should use it
   too.

5. **When a model gains a new nullable `session_class` FK on an existing `class_obj`-only model
   (as `LessonPlan` did in migration `0017`), audit every consumer of that model in the same PR**,
   not just the CRUD viewset. The `LessonPlan` rollout got the `LessonPlanViewSet.get_queryset`
   query-param filtering right (`backend/lms/views.py:1381-1393`) but missed:
   - `_apply_teacher_dual_scope()` (`backend/lms/views.py:87-118`), which still scopes teacher
     visibility by `class_obj_id` only, with a comment that is now stale ("lesson plans don't store
     session_class", `backend/lms/views.py:104`) — a section-A-only teacher can still see section
     B's lesson plans.
   - `notifications.triggers.trigger_lesson_plan_published()`
     (`backend/notifications/triggers.py:1163-1169`), which notifies `Student.objects.filter(
     class_obj=lesson_plan.class_obj, ...)` — every student in every section of the master class
     gets notified even if the plan's `session_class` targets one section only.
   A field-level migration is not a complete rollout until every reader of the model is checked.

6. **A `resolve_class_scope()` caller must decide what to do with `invalid: True`.** The helper
   hard-fails (`backend/core/class_scope.py:84-87`) when a `SessionClass.class_obj` is null (an
   "orphan" session class — a known, named condition, see
   `backend/academic_sessions/views.py:474-475`). Most current call sites do `if scope['invalid']:
   return qs.none()`, silently returning an empty list rather than a clear 400 error. If you add a
   new call site, decide deliberately whether silent-empty or an explicit error is right for that
   endpoint — don't just copy-paste the pattern without considering the UX.

7. **There is no class-merge feature — don't build on the assumption that one exists.** The closest
   things (`SessionClassViewSet.assign_unassigned`, `SessionClassViewSet.initialize`, the
   `ClassesGradesPage` manual link picker, `buildSessionLabeledMasterClassOptions`) are orphan-repair
   and display-grouping tools, not a real merge of two `SessionClass` rows or two `Class` rows. If a
   feature genuinely needs "combine these two sections/classes," it needs new design — see §8 Open
   Question 2.

---

## 1. Core Concepts

- **Master Class** = `students.Class` (`backend/students/models.py:7-72`). School-level, permanent,
  independent of academic year. FK field name used everywhere: `class_obj`.
- **Session Class** = `academic_sessions.SessionClass` (`backend/academic_sessions/models.py:184-239`).
  Year-specific class/section catalog entry, with its own nullable `class_obj` FK
  (`SET_NULL`) back to the Master Class. FK field name used to reference it: `session_class`.
- **Enrollment** = `academic_sessions.StudentEnrollment`
  (`backend/academic_sessions/models.py:242-324`) carries both `class_obj` (required) and
  `session_class` (nullable) for a student in a given `academic_year`.
- Design intent, from the `SessionClass` docstring (`academic_sessions/models.py:185-190`): *"This
  allows schools to keep different class structures per academic year while preserving the existing
  master Class model for cross-module compatibility."* In practice, this is a dual-key system
  **mid-migration**: `attendance`, `academics` (`ClassSubject`/`ClassTeacherAssignment`), and `lms`
  (`LessonPlan`, added most recently) are section-aware; `examinations`, `finance`, `notifications`,
  and the `academics.TimetableEntry` model are Master-Class-only.
- Central backend resolver: `resolve_class_scope()` (`backend/core/class_scope.py:21-104`).
- Central frontend resolvers: `frontend/src/utils/classScope.js`, plus
  `frontend/src/components/ClassSelector.jsx` (`scope` prop, `'master'`|`'session'`, **defaults to
  `'master'`** — see Rule 2 above).

For full model field tables, migration history, and the complete backend/frontend inventory, see
`CLASS_SYSTEM_DOCUMENTATION.md` §1–6 — those sections were re-verified in this pass and remain
accurate (line numbers may drift by a few lines release to release; re-check before citing in a PR).

---

## 2. Verified Issue List (re-audit as of 2026-08-01)

All items from `CLASS_SYSTEM_DOCUMENTATION.md` §7 (Known Issues) and §8 (Open Questions),
re-checked against current code.

### Known Issues

1. **Class-teacher attendance reminder ignores section scope despite reading it — STILL TRUE.**
   `backend/notifications/triggers.py:920-984` (function `trigger_class_teacher_attendance_pending`,
   shifted a few lines from the doc's 920-1004 but same logic). `select_related(...,
   'session_class')` at line 927; `session_class` used only to build `class_label` at
   lines 982-984; the actual student/attendance querysets filter on `class_obj` alone at lines
   965/970 (enrollment branch) and 974-975 (legacy fallback branch). Failure scenario unchanged:
   two sections sharing one master class, one section's attendance marked, the other section's
   teacher never gets reminded because `attendance_qs.exists()` is true school-wide-for-that-class.

2. **Fee-pending / absence digest triggers group by Master Class, not by section — STILL TRUE, and
   found in one additional function not in the original doc.** Confirmed at
   `backend/notifications/triggers.py:146,152,166` (absence trigger), `:271-289` and `:463-464`
   (fee reminder trigger `class_totals` keyed by `student.class_obj_id`), and `:637` (a third
   digest). **New finding**: `trigger_class_teacher_fee_reminder`
   (`backend/notifications/triggers.py:1030-1130`) has the identical pattern — it `select_related`s
   `ClassTeacherAssignment.class_obj` only (no `session_class` at all this time, line 1050) and
   filters `FeePayment` by `student__class_obj=class_obj` (line 1069) — so if two sections have
   different class teachers, both teachers get the exact same consolidated pending-fee list for the
   whole master class, not just their own section.

   **2b. New finding — `trigger_lesson_plan_published` ignores `LessonPlan.session_class` — NEW
   ISSUE, not in the original doc** (expected, since `LessonPlan.session_class` was added the day
   before the original investigation). `backend/notifications/triggers.py:1163-1169` filters
   `Student.objects.filter(class_obj=lesson_plan.class_obj, school=..., is_active=True)` — every
   student in every section of the master class is notified, even when
   `lesson_plan.session_class_id` is set to one specific section.

3. **`Exam`/`ExamPaper`/`StudentTermAssessment` never received a `session_class` field — STILL
   TRUE.** Confirmed: `Exam.class_obj` at `backend/examinations/models.py:121` (no `session_class`
   field on the model); `ExamPaper.class_obj` at `backend/examinations/models.py:560`; unique
   constraint `exam_group_class_unique` is `class_obj`-scoped only
   (`backend/examinations/models.py:151-156`). `StudentTermAssessment`
   (`backend/examinations/models.py:956-1037`) has neither field; `unique_together = ('student',
   'academic_year', 'month')` confirmed at line 1027. `ExamViewSet.get_queryset`
   (`backend/examinations/views.py:987-1031`) calls `resolve_class_scope(...,
   class_param_names=('class_obj', 'class_id'))` at line 997 and filters only on the resolved
   `class_obj_id` (lines 1011-1013) — a `session_class_id` param is accepted and silently collapsed
   to Master-Class granularity. `StudentTermAssessmentRosterView` remains the one exception that
   supports true section-level rostering by walking `StudentEnrollment.session_class` (not
   independently re-verified line-by-line this pass, but nothing in `examinations/models.py`
   contradicts the original doc's description).

   **Related, previously an "open question," now CONFIRMED as a live correctness gap**:
   `ExamViewSet.perform_create` (`backend/examinations/views.py:1033-1049`) auto-creates
   `ExamSubject` rows from `ClassSubject.objects.filter(school_id=exam.school_id,
   class_obj=exam.class_obj, is_active=True)` (lines 1037-1042) — but `ClassSubject`'s own
   uniqueness is keyed by `session_class` (`backend/academics/models.py:81`), meaning two sections
   of the same master class can legitimately have different subject sets/teachers. Filtering by
   `class_obj` alone at exam-creation time pulls in the union of every section's subjects rather
   than the specific section's — since `Exam` has no `session_class` field to disambiguate against,
   this cannot currently be fixed without a schema change (see Fix List, Deliverable A part 3).

4. **`FeeStructure` has no `session_class` field — STILL TRUE.**
   `backend/finance/models.py:312-338` confirmed: `class_obj` FK, nullable, no `session_class`
   field anywhere on the model. `FeeStructureViewSet.get_queryset`
   (`backend/finance/views.py:167-207`) accepts `session_class_id` (line 190), resolves it via
   `resolve_class_scope` (line 192) down to `class_obj_id` (line 195), and filters
   `Q(class_obj_id=class_id) | Q(student__class_obj_id=class_id)` (line 197) — Master-Class-level
   only, matching the model.

5. **`academics.TimetableEntry` is Master-Class-only — STILL TRUE.**
   `backend/academics/models.py:200-264` (`TimetableEntry`, doc cited line 223 for the
   corresponding field which is now line 223 exactly: `class_obj = models.ForeignKey('students.Class',
   ...)`) — no `session_class` field, `unique_together = ('school', 'class_obj', 'day', 'slot')`
   (line 255). Sits in the same file as `ClassSubject`/`ClassTeacherAssignment` which are both
   `session_class`-aware (lines 34-154) — confirms this is an inconsistency within one file, not
   across unrelated apps.

6. **Session-class backfill migrations silently drop/guess ambiguous rows — STILL TRUE.**
   `backend/academic_sessions/migrations/0007_studentenrollment_session_class.py:4-17`
   (`populate_session_class_links`) only links an enrollment to a `SessionClass` when exactly one
   match exists for `(school, academic_year, class_obj)` (line 15: `[:2]` then `if len(matches) ==
   1`) — ambiguous (already-split) classes are left `session_class=NULL`.
   `backend/academics/migrations/0008_backfill_session_class.py:36-47` confirmed: comment at lines
   10-13 explicitly states *"If multiple SessionClasses exist (different sections), use the first
   one"* — `.order_by('-academic_year_id')` then `.first()` (lines 41-45) is a heuristic, not a real
   resolution of which section a `ClassTeacherAssignment` actually belongs to. Any
   `ClassTeacherAssignment` created before this migration on an already-multi-section class may
   have been linked to the wrong section, which then silently feeds `get_teacher_session_class_scope`
   (`backend/core/permissions.py:76-106`) and Issue 1 above.

7. **`resolve_class_scope` hard-fails on an unlinked `SessionClass` — STILL TRUE.**
   `backend/core/class_scope.py:84-87`: if `session_class.class_obj_id` is null, returns
   `{'invalid': True, 'error': 'Selected session class is not linked to a master class.'}`. Orphan
   session classes are a named, expected condition elsewhere in the code (`unassigned_count`
   annotation comment, `backend/academic_sessions/views.py:474-475`: *"orphan rows from promotions
   done before session_class tracking was added"*), so any endpoint routed through
   `resolve_class_scope` with such an id gets a hard-invalid result (most call sites turn this into
   `queryset.none()`) rather than a graceful Master-Class-only fallback.

### Open Questions

1. **Is Master-Class-only scoping in `notifications`/`examinations`/`finance` intentional or
   incomplete? — STILL OPEN, but evidence now leans "incomplete."** `academics` shows the pattern of
   upgrading `ClassSubject`/`ClassTeacherAssignment` to section-aware while leaving `TimetableEntry`
   behind in the very same file (Issue 5). Combined with the newly-found `trigger_lesson_plan_published`
   gap (Issue 2b) appearing the day after `LessonPlan.session_class` landorted, the pattern across
   this codebase is "field added, some but not all consumers updated" rather than "deliberately kept
   simple." No ADR or comment anywhere states finance/notifications/examinations are permanently
   Master-Class-only by business decision — this needs a real product/business-logic decision, not
   just a code fix (see Rule 3 above and Fix List item under examinations).

2. **What is the intended UX/data model for a genuine "merge two Session Classes" operation? — STILL
   OPEN, unresolved.** No backend model or endpoint expresses this. `assign_unassigned`
   (`backend/academic_sessions/views.py:505-532`) and `initialize`
   (`backend/academic_sessions/views.py:534-615`) are orphan-repair and per-year seeding tools, not
   merges. `buildSessionLabeledMasterClassOptions`
   (`frontend/src/utils/classScope.js:50-125`) is read-only display grouping only. If the business
   needs this, it must be designed from scratch.

3. **How many orphaned (`session_class IS NULL`) enrollments exist in production? — STILL OPEN,
   requires a production data query, not code inspection.** Not something this planning pass can
   answer; flagged again for follow-up (`SELECT COUNT(*) FROM academic_sessions_studentenrollment
   WHERE session_class_id IS NULL AND is_active` against production, or via the existing
   `unassigned_count` annotation on `SessionClassViewSet`).

4. **Is `ClassSelector.jsx`'s default `scope='master'` always correctly overridden? — PARTIALLY
   RESOLVED by this pass.** A targeted grep of all `<ClassSelector` usages
   (`frontend/src/**/*.jsx`) found roughly 30 call sites. Of those examined in this pass:
   - The large majority explicitly pass `scope={classSelectorScope}` or an equivalent
     `activeAcademicYear?.id ? 'session' : 'master'` expression (e.g.
     `frontend/src/pages/examinations/ExamsPage.jsx:1447`,
     `frontend/src/pages/examinations/MarksEntryPage.jsx:353`,
     `frontend/src/pages/examinations/ReportCardPage.jsx:158`,
     `frontend/src/pages/examinations/QuestionsPage.jsx:765,1718`,
     `frontend/src/pages/finance/DiscountsPage.jsx:1249,1669`,
     `frontend/src/pages/academics/TimetablePage.jsx:500`,
     `frontend/src/pages/academics/AssessmentsPage.jsx:417`,
     `frontend/src/pages/face-attendance/FaceLiveCapturePage.jsx:241`,
     `frontend/src/pages/face-attendance/FaceEnrollmentPage.jsx:281`,
     `frontend/src/pages/examinations/BulkTestModal.jsx:274`,
     `frontend/src/pages/examinations/QuestionPaperBuilderPage.jsx:975`,
     `frontend/src/pages/examinations/CurriculumCoveragePage.jsx:65`,
     `frontend/src/components/attendance/RegisterTab.jsx:153`,
     `frontend/src/pages/AttendanceRecordsPage.jsx:198`,
     `frontend/src/components/BatchConvertModal.jsx:141`).
   - A second group bypasses the `scope` question entirely by passing an explicit `classes=` array
     prop, which short-circuits `ClassSelector`'s internal fetch (`ClassSelector.jsx:21-25,27`) —
     e.g. `frontend/src/pages/academics/SubjectsPage.jsx:763,874,1025,1134`,
     `frontend/src/pages/fee-collection/AnnualChargesStudentTab.jsx:194`,
     `frontend/src/pages/fee-collection/FeeGenerationSurface.jsx:377`,
     `frontend/src/pages/fee-collection/FeeModals.jsx:461,896`,
     `frontend/src/pages/fee-collection/FeeSetupPage.jsx:394,534`,
     `frontend/src/pages/fee-collection/MonthlyChargesTab.jsx:239`,
     `frontend/src/pages/fee-collection/FeeFilters.jsx:86` (this one interestingly computes
     `scope={classOptions ? 'master' : selectorScope}` even while also passing `classes=`, i.e.
     belt-and-suspenders). These are fine as long as the caller-supplied `classes` array itself is
     correctly scoped — not independently re-verified for every one of these in this pass.
   - One call site omits `scope` **and** has no `classes=` override:
     `frontend/src/pages/examinations/ExamPapersPage.jsx:95-104` — but this is harmless because
     `ExamPaper` is Master-Class-only by model design (Issue 3), so a Master Class dropdown is
     actually correct here, not a bug.
   - One call site omits both `scope` and `classes=` for a genuinely Master-Class-only backend field:
     `frontend/src/pages/face-attendance/FaceDevicesPage.jsx:80-84` — `FaceAttendanceDevice.class_obj`
     (`backend/face_attendance/models.py:366`) has no `session_class` counterpart, so the default
     scope happens to be correct, though it's fragile (see Rule 2).
   - **Net finding: no confirmed live bug from a wrongly-defaulted `ClassSelector` in the call sites
     checked.** The risk flagged in the original doc is structurally real (the API makes it easy to
     forget), but this pass did not find a concrete misuse among the sites read. The full ~30-site
     list was not each individually traced end-to-end against its surrounding form's session
     awareness — treat this as a strong-not-exhaustive result.

5. **Does `ExamViewSet.perform_create`'s `ClassSubject` filter correctly account for session_class
   keying? — RESOLVED, now CONFIRMED as a real gap** (see Issue 3 above; promoted from open question
   to confirmed issue in this pass).

6. **No documented ownership of the class_obj-vs-session_class decision per feature — STILL TRUE.**
   No `docs/` file governs this; `CLAUDE.md` did not mention Session Classes before this guide was
   written. This guide (§0 above) is the first attempt at that governing checklist.

---

## 3. Bucket Classification

**1. Correctly section-aware (reads AND filters by session_class end-to-end):**
- `academics.ClassSubject` / `academics.ClassTeacherAssignment` — uniqueness and querying keyed by
  `session_class` (`backend/academics/models.py:34-154`).
- `lms.LessonPlan` viewset query-param filtering — `backend/lms/views.py:1367-1393` correctly
  resolves and filters by `session_class_id` when provided, with a legacy `session_class__isnull=True`
  fallback for old rows.
- `attendance.AttendanceUpload` — dual uniqueness constraints mirroring `StudentEnrollment`'s
  pattern (`backend/attendance/models.py:136-146`).
- `examinations.StudentTermAssessmentRosterView` — supports either `session_class` or `class_obj`
  query param and filters `StudentEnrollment` accordingly (per original doc §3, not re-verified
  line-by-line this pass).
- `core.permissions.get_teacher_session_class_scope` / `teacher_has_student_access` — true
  section-level access control with a documented master-fallback (`backend/core/permissions.py:76-106,
  191-198`).
- `academic_sessions.PromotionOperation` / `PromotionEvent` — track both class levels in parallel
  (`backend/academic_sessions/models.py:360-373, 465-492`).
- **As of Phase 1 (2026-08-01, see Changelog):** `notifications.trigger_class_teacher_attendance_pending`,
  `trigger_absence_notification`, `trigger_class_teacher_fee_pending`, the class-teacher loops in
  `trigger_fee_reminder` and `trigger_fee_pending_in_app`, `trigger_lesson_plan_published`, and
  `lms._apply_teacher_dual_scope` (for `LessonPlanViewSet` only, via its new opt-in
  `session_class_field` parameter) all now use the session-first/master-fallback pattern and moved
  here from bucket 3 below.

**2. Intentionally Master-Class-only (documented decision):**
- `finance.FeeStructure` (`backend/finance/models.py:312-338`) — **now documented directly on the
  model's docstring** (Phase 1, 2026-08-01): fee amounts are a billing policy set per grade and apply
  uniformly to every section; a per-section amount is a per-student override, not a schema gap.
- `face_attendance.FaceAttendanceDevice` (`backend/face_attendance/models.py:366`) — a physical
  device is mounted for one room/master-class scope; `scope_type` is `CLASS`/`SCHOOL` only, no
  section concept, matching the frontend's un-scoped `ClassSelector` at
  `frontend/src/pages/face-attendance/FaceDevicesPage.jsx:80`. Legitimate given the model's own
  validation logic (`backend/face_attendance/models.py:404-409`).
- `examinations.Exam`/`ExamPaper` — **now documented directly on `Exam`'s docstring** (Phase 1,
  2026-08-01): an exam's schedule/paper is assumed to apply uniformly across every section of the
  grade. The docstring also flags the known caveat that `ExamViewSet.perform_create`'s `ClassSubject`
  auto-fill can still pull in another section's subject/teacher pairing — that remains a real,
  unfixed gap, deferred to Phase 2 (needs an `Exam.session_class` schema change; see Fix List item 8).

**3. Inconsistent/broken (remaining, unfixed in Phase 1):**
- `academics.TimetableEntry` (Issue 5) — inconsistent specifically because sibling models in the
  same file were upgraded and it wasn't. Deferred to Phase 2 (Fix List item 9).
- `examinations.ExamViewSet.perform_create` ClassSubject auto-fill (Issue 3 related finding) —
  deferred to Phase 2 (Fix List item 8), tracked in `Exam`'s docstring in the meantime.

---

## 4. Fix List (ordered safest-first, grouped by module)

Categories used: **safe/mechanical** (pure refactor, no behavior change, no migration) /
**behavior change** (alters what users see/receive, needs product sign-off) / **needs data backfill**
(requires a migration or one-off script against existing rows).

**Items 1-7 (Phase 1) are DONE — see Changelog entry dated 2026-08-01.** Items 8-10 (schema/backfill)
are Phase 2 and have not been started.

### Safe/mechanical — ✅ done (Phase 1, 2026-08-01)
1. ~~**`lms._apply_teacher_dual_scope` stale comment**~~ — fixed in the same edit as item 6; the
   function docstring now explains `session_class_field` instead of the false "lesson plans don't
   store session_class" claim.
2. ~~**`resolve_class_scope` invalid-handling**~~ — documented as Rule 6 above; no code change was
   planned for this item and none was needed.

### Behavior change — ✅ done (Phase 1, 2026-08-01)
3. ~~**`notifications.trigger_class_teacher_attendance_pending`**~~ — the `academic_year_id` branch
   now filters by `enrollments__session_class_id=assignment.session_class_id` when set, falling back
   to the original `class_obj_id` filter otherwise. Verified functionally: with two sections sharing
   one master class, marking attendance for section A no longer suppresses section B's teacher's
   reminder.
4. ~~**`notifications` fee/absence digest triggers`**~~ — fixed in all three places a
   `ClassTeacherAssignment`-driven recipient existed: `trigger_class_teacher_fee_pending` (filters
   `FeePayment` by `session_class_id` when set), and the class-teacher loops inside
   `trigger_fee_reminder` and `trigger_fee_pending_in_app` (now split section totals out of the
   already-computed `student_totals` when the assignment is section-scoped). Also fixed
   `trigger_absence_notification`'s class-teacher recipient list, which had the same bug but wasn't
   named in the original fix-list wording: it now only notifies the teacher(s) assigned to the
   absent student's own section (plus any master-class-wide assignment with no `session_class`).
   `trigger_fee_overdue` was reviewed and left unchanged — it notifies each student's own parent
   directly by phone number and has no class-teacher aggregation step to be wrong about.
5. ~~**`notifications.trigger_lesson_plan_published`**~~ — now filters students via
   `enrollments__session_class_id` (further scoped by `lesson_plan.academic_year_id` when set) when
   the lesson plan has a `session_class`, else falls back to the legacy whole-master-class filter.
   Verified functionally: a lesson plan published for one section only notifies that section's
   students.
6. ~~**`lms._apply_teacher_dual_scope`**~~ — added an opt-in `session_class_field` parameter
   (default `None`, so the other 5 call sites — `Book`, `Chapter`/`Topic`, `Assignment`,
   `Submission` — are unaffected). `LessonPlanViewSet.get_queryset` now passes
   `session_class_field='session_class_id'`, so a section-assigned teacher sees their own sections'
   lesson plans plus any legacy (`session_class IS NULL`) plans for their master classes.
7. ~~**Decide and document `FeeStructure` and `Exam`/`ExamPaper` as intentionally Master-Class-only**~~
   — both models' docstrings now state this explicitly (`backend/finance/models.py:312`,
   `backend/examinations/models.py:89`); `Exam`'s docstring also flags the still-open `ClassSubject`
   auto-fill caveat (Fix List item 8, Phase 2).

### Needs data backfill / schema change — Phase 2, not started
8. **`ExamViewSet.perform_create` ClassSubject mismatch** (`backend/examinations/views.py:1037-1042`)
   — requires adding a `session_class` field to `Exam` before the `ClassSubject` auto-fill can be
   scoped correctly. Until then, mitigate by warning admins in the UI when a class's `ClassSubject`
   rows have differing `session_class` values.
9. **`academics.TimetableEntry` Master-Class-only** (`backend/academics/models.py:200-264`) — if the
   business decides sections need distinct timetables, add a nullable `session_class` FK plus a
   backfill migration modeled on `academic_sessions/migrations/0007` and
   `academics/migrations/0008` — but flag ambiguous multi-section rows for manual review instead of
   guessing "the first match," unlike those two migrations.
10. **Audit fallout from the `0007`/`0008` ambiguous-backfill shortcuts** — run a production query
    (Open Question 3: `SELECT COUNT(*) FROM academic_sessions_studentenrollment WHERE
    session_class_id IS NULL AND is_active`, plus the equivalent for `ClassTeacherAssignment`) before
    deciding whether a corrective backfill script is worth writing.

---

## 5. Changelog

- **2026-08-01 — v1.** Created from the Phase 1 planning pass. This is a planning document only —
  no application code was changed as part of producing it. Re-verified all 7 Known Issues and 6 Open
  Questions from `CLASS_SYSTEM_DOCUMENTATION.md` against current code, found two new issues not
  present in the original investigation (`trigger_class_teacher_fee_reminder` Master-Class grouping,
  `trigger_lesson_plan_published` ignoring `LessonPlan.session_class`), promoted one open question
  (`ExamViewSet.perform_create` ClassSubject filter) to a confirmed issue, and added the "Rules for
  New Features" checklist (§0) that did not exist before this document.

- **2026-08-01 — v2 (Phase 1 implementation).** Implemented Fix List items 1-7 (all safe/mechanical
  and behavior-change tiers; no schema changes, no migrations, no frontend changes):
  - `backend/notifications/triggers.py`: `trigger_class_teacher_attendance_pending`,
    `trigger_absence_notification`, `trigger_class_teacher_fee_pending`, `trigger_fee_reminder`,
    `trigger_fee_pending_in_app`, and `trigger_lesson_plan_published` now all prefer
    `session_class`-level filtering when the driving `ClassTeacherAssignment` or `LessonPlan` has a
    `session_class` set, falling back to the original `class_obj`-level filtering when it doesn't.
    `trigger_fee_overdue` was reviewed and confirmed to need no change (per-student/parent, no
    class-teacher aggregation).
  - `backend/lms/views.py`: `_apply_teacher_dual_scope` gained an opt-in `session_class_field`
    parameter; only `LessonPlanViewSet.get_queryset` passes it (`session_class_field='session_class_id'`).
    The other 5 call sites (`Book`, `Chapter`/`Topic` at line 825, `Assignment`, `Submission`) are
    unaffected — confirmed by re-reading each site's model (none has a `session_class` field). Also
    replaced the stale "lesson plans don't store session_class" comment.
  - `backend/finance/models.py` (`FeeStructure`) and `backend/examinations/models.py` (`Exam`): added
    docstring notes documenting the Master-Class-only scoping as an intentional decision, per Fix
    List item 7. `Exam`'s docstring also names the still-open `ClassSubject` auto-fill caveat.
  - **Verification**: `pytest lms/` — 61 passed, 1 skipped (unrelated), no regressions.
    `notifications/` has no test suite to run. Additionally ran two scripted functional checks against
    a throwaway test database (two `SessionClass` rows sharing one `class_obj`, two
    `ClassTeacherAssignment` rows, one per section): (1) marking attendance for section A's only
    student and calling `trigger_class_teacher_attendance_pending` correctly reminded only section
    B's teacher, not section A's; (2) publishing a `LessonPlan` scoped to section B and calling
    `trigger_lesson_plan_published` correctly notified only section B's student. Both confirm the
    fix resolves the originally-documented bug scenario.
  - Fix List items 8-10 (schema/backfill changes: `Exam.session_class`, `TimetableEntry.session_class`,
    production orphan-enrollment audit) remain **not started** — deferred to Phase 2 per the approved
    plan.
