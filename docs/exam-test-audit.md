# Exam / Test Feature Audit

Investigation only — no code changed. This document maps the current structure of the "Exams" and "Tests" tabs (`Academics → Exams & Tests`, route `academics/exams`) so a simplification approach can be discussed separately.

**Headline finding:** There is no separate `Test` model. A "Test" *is* an `Exam` row with `exam_group = NULL` (standalone). An "Exam" (as shown in the Exams tab) is an `ExamGroup` row plus one `Exam` row per class, all sharing that `exam_group`. Every downstream feature (marks entry, results, report cards, notifications, dashboards) operates on `Exam`/`ExamSubject`/`StudentMark` and does not know or care whether the parent `Exam` is grouped or standalone.

---

## 1. Data Models

All in `backend/examinations/models.py`.

### `ExamType`
Defines exam categories (Mid-Term, Final, Unit Test, etc.) — shared by both Exams and Tests.

| Field | Type | Notes |
|---|---|---|
| `school` | FK → `schools.School` | |
| `name` | CharField(100) | unique with `school` |
| `weight` | Decimal(5,2), default 100.00 | GPA weighting used by ReportCardView |
| `is_active` | Boolean | |
| `created_at` / `updated_at` | DateTime | |

### `ExamGroup` — "the Exam side of the wrapper"
Exists **only** to group per-class `Exam` rows created by the wizard. Has no marks/subjects of its own — all real data lives on its child `Exam`/`ExamSubject` rows.

| Field | Type | Notes |
|---|---|---|
| `school` | FK | |
| `academic_year` | FK → `academic_sessions.AcademicYear` | |
| `term` | FK, null/blank | |
| `exam_type` | FK → `ExamType` | |
| `name` | CharField(200) | |
| `description` | Text, blank | **only exists on ExamGroup**, not on Exam |
| `start_date` / `end_date` | Date, null/blank | |
| `is_active` | Boolean | |
| `created_at` / `updated_at` | DateTime | |

Unique together: `(school, name, academic_year)`. Has a computed `active_exams` property (annotated queryset, not stored).

### `Exam` — the single row type used for BOTH tabs

| Field | Type | Notes |
|---|---|---|
| `school` | FK | |
| `academic_year` | FK | |
| `term` | FK, null/blank | |
| `exam_type` | FK → `ExamType` | |
| `class_obj` | FK → `students.Class` | |
| `exam_group` | FK → `ExamGroup`, **null/blank**, `on_delete=SET_NULL` | **NULL = "Test" (standalone). Set = "Exam" (grouped).** This single field is the entire distinction between the two tabs. |
| `name` | CharField(200) | |
| `start_date` / `end_date` | Date, null/blank | |
| `status` | Choice: SCHEDULED / IN_PROGRESS / MARKS_ENTRY / COMPLETED / PUBLISHED | |
| `is_active` | Boolean | soft-delete flag |
| `created_at` / `updated_at` | DateTime | |

Constraint: `UniqueConstraint(fields=['school','exam_group','class_obj'], condition=Q(exam_group__isnull=False), name='exam_group_class_unique')` — only applies when `exam_group` is set. This is what enforces "one Exam per class per group" for the Exams tab, while deliberately **not** constraining standalone Tests (migration `0015_allow_multiple_standalone_tests.py` removed the old blanket `unique_together` for exactly this reason — a class can have many concurrent standalone tests, e.g. one per subject).

No field distinguishes "Exam" vs "Test" other than `exam_group` being null or not. There is no `is_standalone`, `kind`, or `type` field.

### `ExamSubject` — subjects within an Exam/Test
Identical for both; a "Test" typically ends up with exactly one `ExamSubject` row (one subject), a grouped "Exam" typically has one row per class subject.

| Field | Type | Notes |
|---|---|---|
| `school`, `exam` (FK→Exam), `subject` (FK→academics.Subject) | | unique together `(school, exam, subject)` |
| `total_marks` | Decimal(6,2), default 100.00 | |
| `passing_marks` | Decimal(6,2), default 33.00 | |
| `exam_date`, `start_time`, `end_time` | Date/Time, null/blank | per-subject schedule (this is the "date sheet" data) |
| `is_active` | Boolean | |
| `created_at` / `updated_at` | | |

### `StudentMark` — marks entry, identical for both
FK to `ExamSubject`, `student`, optional `enrollment` snapshot FK, `marks_obtained`, `is_absent`, `remarks`, `ai_comment` + `ai_comment_generated_at` (AI report-card comment generation). Unique together `(school, exam_subject, student)`.

### `GradeScale`
School-wide percentage→letter-grade mapping, unrelated to the Exam/Test split — shared by both.

### Adjacent models (not part of the tab split, but reference `Exam`)
- `Question`, `ExamPaper`, `PaperQuestion`, `StudentResponse`, `QuestionStats`, `QuestionRevision`, `PaperUpload`, `PaperFeedback` — the separate **Question Paper Builder** feature (`academics/paper-builder`, `academics/papers` routes). `ExamPaper.exam` is an **optional** FK to `Exam` ("Optional: Link to exam lifecycle") — a paper can exist with no linked Exam/Test at all, or be tied to either a grouped Exam or a standalone Test with no code difference.
- `StudentTermAssessment` — skills/behaviour ratings, entirely separate feature, only shares the `examinations` app for organizational reasons.

### Fields that exist on `ExamGroup` but not `Exam`
- `description` (Exam has no description field)

### Fields that exist on `Exam` but not `ExamGroup`
- `status` (SCHEDULED/IN_PROGRESS/MARKS_ENTRY/COMPLETED/PUBLISHED) — ExamGroup has no status of its own; "publish all" just bulk-sets `status=PUBLISHED` on the child Exams.
- `class_obj` — ExamGroup is class-agnostic by design (it fans out to multiple classes); the per-class Exam carries the class.

---

## 2. Where They Diverge

Since "Exam" and "Test" are the same model, divergence is entirely about **behavior conditioned on `exam_group` being null vs. set**, plus differences between the `Exam` API and the `ExamGroup` API:

| Aspect | Grouped Exam (`exam_group` set) | Standalone Test (`exam_group` NULL) |
|---|---|---|
| Created via | `ExamGroupViewSet.wizard_create` (`POST /exam-groups/wizard-create/`) | `ExamViewSet.bulk_test_apply` (`POST /exams/bulk-test-apply/`), or plain `POST /exams/` |
| Creation permission | `IsSchoolAdmin` only — **teachers cannot even read/list ExamGroups** (`IsSchoolAdmin.has_permission` has no read exemption) | `IsSchoolAdminOrReadOnly` on the ViewSet (teachers can read/list), and `bulk_test_preview`/`bulk_test_apply` explicitly override permissions (`get_permissions()` in `ExamViewSet`, `views.py:847-850`) to allow role `TEACHER` via `_assert_bulk_test_role` — but scoped to subjects the teacher is assigned to (`views.py:253-254`) |
| Uniqueness | Enforced: one Exam per `(school, exam_group, class_obj)` | Not enforced by DB constraint; app-level conflict check in `_build_bulk_test_plan` (matches on `academic_year + term + exam_type + class + exam_group__isnull=True`, per subject) |
| Bulk creation unit | One `ExamGroup` + N `Exam` rows (one per selected class) + M `ExamSubject` rows (all class subjects, auto-populated from `ClassSubject`) | N `Exam` rows (one per selected subject, same class) each with exactly 1 `ExamSubject` |
| Default marks | `default_total_marks` (100) / `default_passing_marks` (33) applied to **every** subject uniformly | Per-subject `total_marks` entered individually per row; `passing_marks` auto-derived as `total_marks * 0.33` (`views.py:967`) — grouped exams let admins set one passing default, standalone tests don't expose a passing-marks input in the UI at all |
| Naming | `"{group name} - {class name}"` per Exam (`views.py:531`) | `"Test - {subject name}[ - {term}] {year}"` auto-generated per row, or admin/teacher-typed override (`_generate_bulk_test_name`, `views.py:164`) |
| Publish action | `ExamGroupViewSet` has a `publish-all` action intended at `/exam-groups/{id}/publish-all/` **and** `ExamViewSet.publish` (`/exams/{id}/publish/`) per single Exam | Same single-Exam `publish` action used for standalone tests |
| Notification on publish | `Exam.publish` (single) calls `notifications.triggers.trigger_exam_result_published(exam)` (`views.py:1016-1025`). The group's bulk `publish_all` (as coded) does a **plain queryset `.update(status=PUBLISHED)`** with no notification fan-out — publishing an entire group does not notify anyone, only publishing an individual exam does. | Same single-Exam `publish` action fires notifications normally |
| Date sheet UI | Dedicated per-group "Date Sheet" modal, spreadsheet-style, editable per class×subject, downloadable Excel | Inline per-subject date/time fields directly in the Test edit form (`ExamsPage.jsx` "Test Schedule" table, `views.py` `testScheduleRows`) |
| Wizard steps | 4-step wizard: Details → Classes → Date Sheet → Preview (`ExamWizard.jsx`) | 3-step modal: Details → Schedule → Preview (`BulkTestModal.jsx`), with a live **preview/apply** two-phase API (`bulk-test-preview` then `bulk-test-apply`) that the group wizard does not have — the wizard has no dry-run preview step, it validates and creates in one call |

Everything else — `ExamSubject`, `StudentMark`, results calculation, report cards, grading, GPA weighting by `exam_type.weight` — is 100% shared code with zero branching on `exam_group`.

### Confirmed anomaly (not a design divergence, an apparent bug)
`update_date_by_subject`, `download_date_sheet`, and `publish_all` (`views.py:718`, `735`, `829`) are defined as `@action` methods **inside `StudentResponseViewSet`** (registered under the `student-responses` router prefix), not inside `ExamGroupViewSet` (registered under `exam-groups`). But the frontend (`frontend/src/services/api.js:661,663,664`) calls them at `/api/examinations/exam-groups/{id}/download-date-sheet/`, `/update-date-by-subject/`, `/publish-all/`. Since DRF routes `@action` methods under the ViewSet's own router registration, these three routes are not registered under `exam-groups` at all — the "Download Excel" and "Publish All" buttons in the Exams-tab Date Sheet modal call URLs that do not exist under that prefix. This was verified directly against the file (indentation confirmed via raw bytes) and against `urls.py` (no manual `path()` entries fill the gap). Worth independently confirming against actual runtime behavior before relying on this document, but the static code strongly suggests these two buttons in the "Exams" tab are currently non-functional.

---

## 3. UI / Frontend

Single page, `frontend/src/pages/examinations/ExamsPage.jsx`, route `academics/exams`, mounted for the `AssessmentManageRoute` guard. It renders both tabs from one component with `activeTab` state (`'exams' | 'tests'`), backed by two separate queries:

- **Exams tab**: `examinationsApi.getExamGroups(...)` → grouped/expandable list of `ExamGroup` + nested per-class `Exam` table. Actions: expand/collapse group, Date Sheet, Publish All, Delete group, and per-row Edit/Publish/Reactivate/Delete on child exams.
- **Tests tab**: `examinationsApi.getExams({ ungrouped: true, ... })` → flat table/cards of standalone `Exam` rows. Actions: per-row Edit/Publish/Reactivate/Delete (same action set as the nested Exam rows in the other tab).

Both tabs share:
- The **same "Quick Create / Edit" modal** (`showModal` in `ExamsPage.jsx`) for editing an existing Exam or Test — same form fields, branching only on `activeTab === 'tests'` to show a "Test Schedule" sub-table instead of Start/End Date inputs (`ExamsPage.jsx:1055-1120`).
- The same `ClassSelector`, `useSessionClasses`, `getClassSelectorScope`/`getResolvedMasterClassId` utilities, `useConfirmModal`, `STATUS_STYLES` map, and mutation set (`updateMut`, `deleteMut`, `publishMut`, `reactivateMut` all call the same `examinationsApi.*Exam` functions regardless of tab).
- The same `DateSheetModal` component is defined inside `ExamsPage.jsx` but only ever opened from the Exams (grouped) tab.

Separate creation flows launched from each tab's "+ Create" button:
- **`ExamWizard.jsx`** ("Create Exam Group") — 4-step modal: Details, Classes (multi-select), Date Sheet (per class×subject grid), Preview. Submits once via `wizardCreateExamGroup`.
- **`BulkTestModal.jsx`** ("Create Tests") — 3-step modal: Details (single class + multi-subject-select), Schedule (per-subject rows: name/date/marks/times), Preview (calls a real preview endpoint first, shows create/conflict/forbidden/invalid counts, then a separate Apply call).

Other examinations-app pages (not tab-specific, used by both Exams and Tests equally since they operate on `Exam`/`ExamSubject`/`StudentMark` without checking `exam_group`):
- `ExamTypesPage.jsx` — manage `ExamType` (shared category list).
- `MarksEntryPage.jsx` — pick any Exam by ID (`selectedExamId`) via `examinationsApi.getExamTypes`/`getExams`, enter marks; no distinction between grouped/standalone.
- `ResultsPage.jsx` — pick any Exam, show computed results/ranks (`exams/{id}/results/`).
- `ReportCardPage.jsx` — student-level report card across all published exams (weighted by `exam_type`), regardless of group.
- `GradeScalePage.jsx` — manage `GradeScale`, unrelated to grouping.
- `ExamPapersPage.jsx` / `QuestionPaperBuilderPage.jsx` / `QuestionsPage.jsx` / `CurriculumCoveragePage.jsx` / `StudentResponsePage.jsx` — the separate Question Paper Builder feature; `ExamPaper.exam` optionally links to either kind of Exam with no code difference.

Dashboards that surface "exams" generically (no group/standalone distinction in the query):
- `pages/teacher/TeacherDashboard.jsx` — "Upcoming Exams" widget via `examinationsApi.getExams(...)`.
- `pages/DashboardPage.jsx` (admin/school dashboard) — "Examinations" quick-action + upcoming count via `getExams({status: 'SCHEDULED', ...})`.
- `pages/parent/ParentDashboard.jsx`, `pages/parent/ChildOverview.jsx`, `pages/parent/ChildExamResults.jsx`, `pages/student/StudentDashboard.jsx`, `pages/student/StudentResults.jsx` — student/parent-facing results views, sourced from a student-portal endpoint that returns published exam results without any group/standalone flag.

---

## 4. Backend / API

All routes under `/api/examinations/` (`backend/examinations/urls.py`), via `DefaultRouter`.

| Route (prefix) | ViewSet | Purpose |
|---|---|---|
| `exam-types/` | `ExamTypeViewSet` | CRUD, shared |
| `exam-groups/` | `ExamGroupViewSet` | CRUD for the "Exam" (grouped) side; extra actions: `wizard-create` (POST), `date-sheet` (GET/PATCH) |
| `exams/` | `ExamViewSet` | CRUD for **both** Exam-child-rows and standalone Tests (same table, filtered by `ungrouped=true` query param for Tests tab); extra actions: `bulk-test-preview` (POST), `bulk-test-apply` (POST), `{id}/publish/` (POST), `{id}/populate-subjects/` (POST), `{id}/results/` (GET), `{id}/class_summary/` (GET), `{id}/generate-comments/` (POST, AI report-card comments) |
| `exam-subjects/` | `ExamSubjectViewSet` | CRUD, shared by both |
| `marks/` | `StudentMarkViewSet` | marks CRUD + `bulk_entry`, `by_student`, `download_template`, shared |
| `student-responses/` | `StudentResponseViewSet` | Question Paper Builder responses — **also unintentionally hosts** `update-date-by-subject`, `download-date-sheet`, `publish-all` (see anomaly above) |
| `grade-scales/` | `GradeScaleViewSet` | shared |
| `questions/`, `exam-papers/`, `paper-uploads/`, `paper-feedback/` | Question Paper Builder (separate feature) | |
| `report-card/`, `student-term-assessment/*` | plain `APIView`s | Report card + skills/behaviour assessment |

### Where Exam-group creation and Test creation share logic vs. don't

- **Do NOT share a code path.** `ExamGroupViewSet.wizard_create` (`views.py:448-566`) and `ExamViewSet.bulk_test_apply` (`views.py:932-1010`) are two independent implementations, each doing its own `Exam.objects.create(...)` + `ExamSubject.objects.create(...)`/`bulk_create(...)` inside its own `transaction.atomic()` block. There is no shared "create one exam+subjects" helper reused N times by the group wizard — the group wizard loops classes and bulk-creates one `ExamSubject` per `ClassSubject` per class in a single flat list; `bulk_test_apply` loops the submitted subject rows and creates one `Exam` + one `ExamSubject` each individually (not bulk_create).
- **Both call the plain `ExamViewSet.perform_create`** only when a bare `POST /exams/` is used (the "Quick Create" modal path for a Test with no wizard/bulk-modal) — that override auto-populates `ExamSubject` rows from the class's `ClassSubject` assignments (`views.py:903-922`), which is a third, simpler creation path used by the "Edit"/"Quick Create" modal in `ExamsPage.jsx` itself.
- `bulk_test_preview`/`bulk_test_apply` share `_build_bulk_test_plan` (`views.py:180-372`) — the preview and apply endpoints literally call the same planning function, then apply only proceeds if `can_apply` is true. The group wizard has no equivalent preview function.
- Conflict-checking logic is duplicated with different granularity: `wizard_create` checks "does this class already have an active exam of this type+term" (whole-exam level, `views.py:474-487`); `_build_bulk_test_plan` checks "does this subject already have an active standalone test of this type+term+class" (per-subject level, `views.py:260-278`).

---

## 5. The "Bulk Operation" — Exam Group Wizard, Step by Step

Entry point: `POST /api/examinations/exam-groups/wizard-create/` → `ExamGroupViewSet.wizard_create` (`views.py:447-566`), driven by `ExamGroupWizardCreateSerializer`.

**Request payload** (built by `ExamWizard.jsx:handleSubmit`):
```
academic_year, term, exam_type, name, start_date, end_date,
class_ids: [int, ...],
default_total_marks (default 100), default_passing_marks (default 33),
date_sheet: [{class_id, subject_id, exam_date, start_time, end_time}, ...]  // only rows with a date filled in
```

**Server-side steps, in order:**
1. Validate payload shape via `ExamGroupWizardCreateSerializer` (date ordering, required fields).
2. Resolve `school_id` from tenant context; 400 if missing.
3. Look up all `class_ids` as active `Class` rows for the school; 400 if any ID doesn't resolve (`views.py:463-470`).
4. **Conflict pre-check**: for each selected class, look for an existing **active** `Exam` with the same `(school, exam_type, class_obj, term)` — regardless of `exam_group`. If any class already has one, abort the whole request with `409 Conflict` and a `conflicts` list (`class_id`, `class_name`, `existing_exam` name) — nothing is created (`views.py:472-492`). The frontend renders this list in the wizard's error banner.
5. Build a lookup dict from the submitted `date_sheet` rows: `(class_id, subject_id) → {exam_date, start_time, end_time}` (`views.py:494-505`).
6. **Inside one `transaction.atomic()` block:**
   a. Create one `ExamGroup` row (`school, academic_year, term, exam_type, name, description, start_date, end_date`).
   b. For each valid class, create one `Exam` row: `name = f"{group.name} - {class.name}"`, `exam_group = group`, `status = SCHEDULED`, same `academic_year/term/exam_type/start_date/end_date` as the group.
   c. For each created `Exam`, look up that class's **active `ClassSubject` assignments** (`academics.ClassSubject`, filtered `school_id`, `class_obj`, `is_active=True`) — this determines which subjects get added; there is no per-subject selection step in the wizard, it's implicitly "all subjects currently assigned to the class."
   d. For each `(exam, class_subject)` pair, build an `ExamSubject(total_marks=default_total, passing_marks=default_passing, exam_date/start_time/end_time = whatever was in the date_sheet lookup for that class+subject, else blank)`.
   e. `ExamSubject.objects.bulk_create(all_exam_subjects, ignore_conflicts=True)` — one bulk insert for every class×subject combination across the whole group.
7. Return `{group_id, group_name, exams_created (count), subjects_created (count)}`, HTTP 201.

**Defaults applied:** `default_total_marks=100`, `default_passing_marks=33` (or whatever the user typed in Step 1) applied uniformly to every subject in every class — no per-subject override during creation (must be edited afterward via `exam-subjects/{id}/` PATCH or the Date Sheet). `status` always starts `SCHEDULED`. Date/time per class-subject is optional and only set if the user filled in that row in the wizard's Step 3 grid.

**What is NOT part of this operation:** `StudentMark` rows are not created here — marks entry is a separate, later step (`MarksEntryPage.jsx`) once subjects exist.

For contrast, the standalone-Test bulk flow (`bulk-test-preview` → `bulk-test-apply`) works per-subject instead of per-class: one `Exam` (with `exam_group=None`) + one `ExamSubject` is created per submitted subject row, each with its own name/date/marks/times (no shared defaults), after a mandatory preview step classifies every row as `create`/`conflict`/`forbidden`/`invalid` and blocks apply unless every row is `create`.

---

## 6. Fields That Look Unused / Extra / Legacy

- **`ExamGroup.description`** — model field and serializer field exist (`ExamGroupCreateSerializer` fields list, `views.py`/`serializers.py:421`), but **neither `ExamWizard.jsx` nor `ExamsPage.jsx` render an input for it.** The wizard's `wizardData` state has no `description` key, so it's always submitted as the serializer default `''`. Effectively dead in the UI.
- **`ExamGroup.start_date` / `end_date`** — set once at group creation, shown in the collapsed group header, but not otherwise used for validation (`Exam.start_date`/`end_date` on child exams are set to the same values at creation time but can drift independently after — e.g. `ExamsPage.jsx`'s Test-tab edit form recomputes `start_date`/`end_date` from the per-subject date-sheet rows, `ExamsPage.jsx:293-304`, while the group's own dates are never recomputed from its children).
- **`Question.exam_type`** (optional FK) — "Optional: Link to exam type" on the Question Bank; unrelated to whether a Question is used in a paper tied to a grouped Exam or standalone Test; low usage signal but is a genuinely separate feature (question bank tagging), not itself an Exam/Test field.
- **`ExamSubject.is_active`** — every ExamSubject is created with default `True` and there is no UI control to deactivate a single subject row independently (deletion goes through the standard `DELETE /exam-subjects/{id}/`, which is presumably a hard delete via the ViewSet's default `destroy`, not a toggle) — the field exists mainly for `.filter(is_active=True)` guards sprinkled through the results/report-card code, but nothing in the two UI tabs ever sets it to `False` directly.
- **`Exam.exam_group_name`** on `ExamSerializer` — present so the flat Exam list can show a group label if needed, but the standalone Tests tab never has a group, so this field is always `null` for every row rendered in the Tests tab (harmless but always-blank in that context).
- The **legacy unique constraint message** in `bulk_test_apply`'s `IntegrityError` handler (`views.py:982-994`) references a specific old constraint name (`examinations_exam_school_id_exam_type_id_c_bf67c535_uniq`) from before migration `0015` — this is defensive code for schools whose DB migrations might be behind; on any fully-migrated environment this branch is dead code.

No fields were found that are always blank/default across the board beyond the above — most of the model is actively read somewhere (results calculation, report cards, or the date-sheet/marks-entry UI).

---

## 7. Dependencies — What Else Touches Exam/Test

If `Exam`/`ExamGroup`/`ExamSubject` are merged or restructured, these are the consumers that would need review:

**Reports**
- `backend/reports/generators/academic.py` — `ClassResultGenerator` (needs `exam_id` param, queries `Exam.objects.get(id=exam_id)` directly — works identically for a grouped Exam or standalone Test) and a student-progress-across-all-exams generator (`StudentMark` joined to `exam_subject__exam`, ordered by `exam__start_date`).
- `ReportCardView` (`views.py:1989+`) — builds the full student report card by pulling all `PUBLISHED` `Exam` rows for the student's class/academic year/enrollment, grouping by `exam_type` and weighting by `exam_type.weight` (`views.py:2039`, `2106-2134`). **Does not filter or branch on `exam_group`** — a standalone Test and a grouped Exam of the same `exam_type` contribute to the same weighted average identically. This is the strongest evidence that "Exam" and "Test" are the same concept downstream.
- Excel date-sheet export (`ExamGroupViewSet`-adjacent `download_date_sheet`, currently misrouted — see Section 2 anomaly) — group-only, no Test equivalent (Tests don't have a "date sheet" export, just inline per-subject dates).

**PDF/DOCX generators** (`docx_generator.py`, `pdf_generator.py`, `paper_export_layout.py`) — these render `ExamPaper` (Question Paper Builder), not `Exam`/`Test` result documents; only loosely coupled via the optional `ExamPaper.exam` FK.

**Notifications** (`backend/notifications/triggers.py`)
- `trigger_exam_result_published(exam)` — fired only from `ExamViewSet.publish` (single Exam/Test). Notifies admins, assigned class teachers (via `ClassTeacherAssignment`), and all parents/students in `exam.class_obj`, gated by a per-school `exam_result_enabled` config flag and a "already sent today" de-dupe check. **Not fired** by `ExamGroupViewSet.publish_all`'s bulk `.update()` — see Section 2.
- `trigger_exam_result(student, exam)` — an older, narrower "backward-compatible" per-student variant, still present, seemingly superseded by `trigger_exam_result_published` but not removed.

**Permissions / Roles**
- `IsSchoolAdmin` gates `ExamGroupViewSet` entirely (create **and read** — teachers cannot list Exam Groups at all).
- `IsSchoolAdminOrReadOnly` gates `ExamViewSet` (everyone authenticated can read/list Exams+Tests; only admins can write) — except `bulk_test_preview`/`bulk_test_apply`, which are opened up to `TEACHER` role too, scoped to their assigned class-subjects via `_build_bulk_test_plan`'s teacher-scope filtering.
- `_apply_teacher_exam_scope` (`views.py:68-102`) further restricts which Exam rows a teacher can even see in `ExamViewSet.get_queryset`, using a combined "full class scope" + "subject-assignment scope" union — this scoping applies identically whether the row is a grouped Exam or a standalone Test.
- `CanManageStudentAssessments` — used by `StudentTermAssessment*` views only, unrelated to the Exam/Test split itself but lives in the same app/permissions cluster.

**Dashboards** — `TeacherDashboard.jsx`, `DashboardPage.jsx` (admin), `ParentDashboard.jsx`, `ChildOverview.jsx`, `StudentDashboard.jsx` all query `examinationsApi.getExams(...)` generically for "upcoming/scheduled exams" counts and widgets, with no `ungrouped` filter — they surface both Exams and Tests together, unlabeled as to which is which.

**Tests (automated)** — `backend/tests/test_phase6_examinations.py` has extensive coverage distinguishing the two flows: `TestExams` (b1-b14, includes b13 "Standalone tests can share exam_type+class+term when they differ by subject" — explicitly testing the migration-0015 behavior) and `TestBulkStandaloneTests` (bt1-bt5, covering preview/apply/teacher-scoping/conflict-detection for the Tests-tab bulk flow). There is no equivalent dedicated test class found for `ExamGroupViewSet.wizard_create` in the file section reviewed — the grouped-Exam wizard path appears to have comparatively thinner automated coverage than the standalone-Test bulk path.

**Migrations of note** — `0002_add_exam_group_model.py` (introduced ExamGroup), `0007`/`0008`/`0009` (fixed exam cascade-delete FKs, three separate migrations to get cascade behavior right), `0015_allow_multiple_standalone_tests.py` (the migration that made the current Exam/Test dual-purpose model possible by relaxing the old blanket unique constraint).
