# Class System Documentation: Master Class vs Session Class

**Mapping of concepts to code:**
- **Master Class** = `students.Class` model (`backend/students/models.py:7`). School-level, independent of academic year. FK field name used everywhere: `class_obj`.
- **Session Class** = `academic_sessions.SessionClass` model (`backend/academic_sessions/models.py:184`). Year-specific class/section catalog entry, optionally linked back to a Master Class via its own `class_obj` FK. FK field name used to reference it: `session_class`.
- **Enrollment** = `academic_sessions.StudentEnrollment` (`backend/academic_sessions/models.py:242`) is the join model that carries *both* `class_obj` (Master Class, required) and `session_class` (Session Class, optional/nullable) for a student in a given `academic_year`.

The docstring on `SessionClass` (`academic_sessions/models.py:185-190`) states the design intent explicitly: *"This allows schools to keep different class structures per academic year while preserving the existing master Class model for cross-module compatibility."* In practice this is a dual-key system still mid-migration: some apps have been updated to read `session_class` (section-level precision), others still only read `class_obj` (whole master class, i.e. all sections combined).

---

## 1. Data Models

### `students.Class` — Master Class
File: `backend/students/models.py:7-72`

| Field | Type | Notes |
|---|---|---|
| `school` | FK → `schools.School`, CASCADE | `related_name='classes'` |
| `name` | CharField(50) | e.g. "Class 1", "PlayGroup" |
| `section` | CharField(10), blank/default `''` | 'A','B','C', or '' for single-section classes |
| `grade_level` | IntegerField, default 0 | Numeric sort key (0=Playgroup, 3=Class 1, 12=Class 10, etc.) |
| `is_active` | BooleanField, default True | |
| `created_at`/`updated_at` | DateTimeField | |

Constraints (lines 38-53):
- `unique_together = ('school', 'name', 'section')`
- `UniqueConstraint(fields=['school','grade_level','section'], condition=Q(section__gt=''), name='unique_level_section_per_school')`
- Indexes on `(school, is_active)` and `(school, grade_level, section)`

No merge-related fields exist on this model (no `merged_into`, `is_merged`, `parent_class`, etc.).

Static/derived helpers: `Class.get_highest_grade_level(school_id)` (line 58), `Class.student_count` property (line 69, counts active `students`).

### `students.Student`
File: `backend/students/models.py:75+`
- `class_obj` FK → `Class`, CASCADE, `related_name='students'` (line 102) — a student's **current** Master Class. This is a denormalized "current placement" pointer; the authoritative per-year record is `StudentEnrollment`.

### `academic_sessions.AcademicYear`
File: `backend/academic_sessions/models.py:4-44`
- `school` FK, `name`, `start_date`, `end_date`, `is_current` (only one true per school via `UniqueConstraint(fields=['school'], condition=Q(is_current=True))`, line 28-33), `is_active`.
- `save()` override (lines 39-44) auto-unsets `is_current` on other rows for the school when a new current year is saved.

### `academic_sessions.Term`
File: `backend/academic_sessions/models.py:47-88`
- FK to `school`, `academic_year`; `name`, `term_type` (TERM/SEMESTER/QUARTER), `order`, `start_date`, `end_date`, `is_current`, `is_active`.
- `unique_together = ('school', 'academic_year', 'name')`.

### `academic_sessions.SessionClass` — Session Class
File: `backend/academic_sessions/models.py:184-239`

| Field | Type | Notes |
|---|---|---|
| `school` | FK → `schools.School`, CASCADE | |
| `academic_year` | FK → `AcademicYear`, CASCADE | |
| `class_obj` | FK → `students.Class`, **SET_NULL**, `null=True, blank=True` | "Optional link to master class for backward compatibility" (line 208). **This is the merge-relevant field**: multiple `SessionClass` rows (e.g. across two merged academic sessions, or two sections) can point at the same `class_obj`. |
| `display_name` | CharField(50) | |
| `section` | CharField(10), blank/default `''` | |
| `grade_level` | IntegerField, default 0 | |
| `is_active` | BooleanField, default True | |
| `created_at`/`updated_at` | DateTimeField | |

Constraints/indexes (lines 217-230):
- `UniqueConstraint(fields=['school','academic_year','display_name','section'], name='unique_session_class_name_per_year')`
- A one-to-one-per-year constraint on `class_obj` (`unique_session_class_master_link_per_year`) **was added in migration `0005_sessionclass.py` and then removed one migration later** in `0006_remove_sessionclass_master_link_unique.py` — see Section 2. After removal, **nothing in the schema prevents two `SessionClass` rows in the same academic year from linking to the same `class_obj`** (this is in fact required, since two sections of "Class 5" both need to link back to the single "Class 5" master row).
- `label` property (line 232-236): `"{display_name} - {section}"` if section set, else `display_name`.

No explicit merge fields (`merged_into`, `is_merged`) exist on `SessionClass` either. See Section 6.

### `academic_sessions.StudentEnrollment`
File: `backend/academic_sessions/models.py:242-324`

| Field | Type | Notes |
|---|---|---|
| `school`, `student`, `academic_year` | FKs, CASCADE | |
| `session_class` | FK → `SessionClass`, **SET_NULL**, nullable | "Year-specific class placement for this enrollment" (line 282) |
| `class_obj` | FK → `students.Class`, CASCADE, **required** | |
| `roll_number` | CharField(20) | |
| `status` | choices: ACTIVE/PROMOTED/REPEAT/TRANSFERRED/WITHDRAWN/GRADUATED | |
| `is_active` | BooleanField | |

Constraints (lines 299-320):
- `unique_together = ('school', 'student', 'academic_year')` — one enrollment row per student per year.
- `unique_roll_per_session_class_enrollment`: unique `(school, academic_year, session_class, roll_number)` when `session_class` is set.
- `unique_roll_per_legacy_class_enrollment`: unique `(school, academic_year, class_obj, roll_number)` when `session_class` is **not** set (i.e. "legacy" rows pre-dating Session Class rollout).
- `__str__` (line 322-324) prefers `session_class.label`, falls back to `class_obj.name` — this fallback pattern (`session_class.label if session_class_id else class_obj.name`) recurs across the codebase (see Section 4/7).

### `academic_sessions.PromotionOperation` / `PromotionEvent`
File: `backend/academic_sessions/models.py:327-519`
- Both carry **parallel pairs** of class fields: `source_class`/`source_session_class` (Operation, lines 360-373) and `source_class`/`target_class`/`source_session_class`/`target_session_class` (Event, lines 465-492) — all `SET_NULL`, nullable. Used for promotion audit trail at both granularities simultaneously.

### `academics.ClassSubject` / `academics.ClassTeacherAssignment`
File: `backend/academics/models.py`
- `ClassSubject` (lines ~34-93): has both `session_class` (line 49) and `class_obj` (line 57) FKs. `unique_together = ('school','academic_year','session_class','subject')` (line 81) — uniqueness is enforced at the **session_class** level, not master class, so the same subject can be assigned to different teachers per section.
- `ClassTeacherAssignment` (lines ~115-154): same dual-FK pattern; `class_obj` docstring explicitly says "Master class (for backward compat + quick access). Section level tracked via session_class." (line 128). `unique_together = ('school','academic_year','session_class','teacher')` (line 142).
- `academics.Timetable`-type model (`TimetableSlot`/entry) at line 223 only has `class_obj`, **no `session_class` field** — timetable is Master-Class-scoped only (see Section 7).

### `examinations` models
File: `backend/examinations/models.py`
- `Exam` (lines 89-160): `class_obj` FK (line 121, CASCADE) — **no `session_class` field**. Exam is scoped to Master Class + `academic_year` + `term` only.
- `ExamPaper` (lines ~540-635): `class_obj` FK (line 560, CASCADE) — again **no `session_class`**.
- `StudentTermAssessment` (lines 956-1038): scoped by `student` + `academic_year` + `month` (`unique_together`, line 1027) — **has neither `class_obj` nor `session_class` on the model itself**; class scoping is only applied at the view/query layer via the student's enrollment (see Section 3).

### `lms.LessonPlan`
- Gained a `session_class` FK **only in migration `0017_lessonplan_session_class_and_more.py`** (dated 2026-07-31 — the day before this investigation), with `null=True` and the help text: *"Section/session class this plan applies to. Null means it applies to every section of the master class (legacy behavior, kept for old rows)."* This is the most recently touched model in the whole Master/Session Class system.

### `finance.FeeStructure`
File: `backend/finance/models.py:312-339`
- `class_obj` FK → `students.Class`, CASCADE, nullable ("Set fee for an entire class, leave student blank") — **no `session_class` field at all**. Fee structures cannot be defined per-section, only per Master Class or per-student override.

---

## 2. Migrations History

**`students` app** (Master Class):
- `0003_class_section_grade_class_grade_and_more.py` — added `section`/`grade_level` to `Class`.
- `0006_remove_grade_model.py` — removed an earlier separate `Grade` model in favor of `grade_level` int field.
- `0007_alter_class_name_alter_class_section.py` — updated help text to allow names like "Class 5-A" while a dedicated `section` field also exists (early source of name/section duplication).
- `0009_session_scoped_roll_numbers.py` — introduces session-scoped roll number handling.
- `0010_fix_class_name_unique_constraint.py` — **renames data**: strips section suffixes baked into `Class.name` (e.g. "Class 1-A" → "Class 1") via `RunPython`, and changes `unique_together` from `(school, name)` to `(school, name, section)`.
- `0012_alter_class_name.py` — further name field adjustment.

**`academic_sessions` app** (Session Class / Enrollment):
- `0002_session_scoped_roll_numbers.py` — roll-number scoping groundwork.
- `0005_sessionclass.py` — **creates `SessionClass`**, including a `unique_session_class_master_link_per_year` constraint (one `SessionClass` per `class_obj` per year).
- `0006_remove_sessionclass_master_link_unique.py` — **immediately removes** that constraint (next migration), permanently allowing multiple `SessionClass` rows to reference the same `class_obj` in one year (needed for multi-section classes, but also the mechanism that makes "duplicate"/unlinked session classes possible — see Section 6/7).
- `0007_studentenrollment_session_class.py` — adds `session_class` to `StudentEnrollment`; backfills existing rows via `RunPython` **only when exactly one matching `SessionClass` exists** for the enrollment's `(school, academic_year, class_obj)` (ambiguous cases — e.g. class already split into 2+ sections — are left with `session_class=NULL`); replaces the old single roll-number unique constraint with the two dual constraints described in Section 1.
- `0008_alter_studentenrollment_options_and_more.py` — ordering/options update reflecting the new `session_class` field.
- `0011_promotion_operation_and_event.py` — adds `PromotionOperation`/`PromotionEvent` with the parallel class/session_class field pairs.

**`academics` app**:
- `0006_classteacherassignment.py` — introduces `ClassTeacherAssignment` (originally Master-Class-only).
- `0007_alter_classteacherassignment_options_and_more.py` — adds `session_class` field/options to the assignment model.
- `0008_backfill_session_class.py` — **data migration**: for every existing `ClassTeacherAssignment`, finds a matching `SessionClass` for `(school, class_obj)` (preferring the most recent academic year) or **creates a new section-less `SessionClass`** if none exists, then links it. Comment in the migration: *"If multiple SessionClasses exist (different sections), use the first one"* — a heuristic, not a real resolution of which section the assignment actually belongs to.
- `0009_alter_classsubject_options_and_more.py` — reworks `ClassSubject` uniqueness to be `session_class`-based.

**`lms` app**:
- `0017_lessonplan_session_class_and_more.py` (2026-07-31) — adds `session_class` to `LessonPlan` (most recent Session-Class-awareness rollout in the codebase).
- `0018_backfill_class2_section_a_lesson_plans.py` — targeted one-off data backfill tied to that rollout.

**`attendance` app**:
- `0007_attendanceupload_pipeline_details_and_more.py`, `0008_attendanceupload_session_class_support.py` — adds `session_class` to `AttendanceUpload` with dual uniqueness constraints mirroring `StudentEnrollment`'s pattern (`unique_upload_per_session_class_date` vs `unique_upload_per_class_date` depending on whether `session_class` is set).
- `0009_rename_attendance__session_313c7f_idx_attendance__session_8905d0_idx.py` — index rename only.

**`examinations` app**: No `session_class` field was ever added to `Exam`/`ExamPaper`/`StudentTermAssessment` across its 27 migrations — this app never received the Session Class rollout that `academics`, `lms`, and `attendance` got (see Section 7).

**`finance` app**: `FeeStructure` likewise never gained a `session_class` field across its migration history.

---

## 3. Backend APIs

Central helper used by most of these endpoints: **`resolve_class_scope()`**, `backend/core/class_scope.py:21-104`. Given `session_class_id`, `class_id`/`class_obj`, and `academic_year` query/body params, it:
1. Looks up the `SessionClass` by id (scoped to the tenant school).
2. Requires `session_class.class_obj_id` to be non-null, else returns `{'invalid': True, 'error': 'Selected session class is not linked to a master class.'}` (lines 84-87).
3. Cross-checks any explicitly-passed `class_obj_id`/`academic_year_id` against the values derived from the `SessionClass`, erroring on mismatch (lines 92-100).
4. Returns a resolved `class_obj_id` + `academic_year_id` for the caller to filter on.

This function is imported/used in: `academics/views.py:26,248,736`, `academic_sessions/views.py:16,280`, `face_attendance/views.py:22,130,179,471`, `finance/views.py:26,192`, `lms/views.py:33` (6 call sites: 234, 614, 648, 841, 1381, 1501, 1836), `examinations/views.py:17` (4 call sites: 997, 1381, 1436, 2394).

### `students` app (`backend/students/urls.py`)
- `GET/POST /api/students/classes/` and `/classes/{id}/` — `ClassViewSet` (`students/views.py:58`), router-registered at `students/urls.py:17`. Master Class CRUD. Permission: `ModuleAccessMixin` + tenant scoping via `TenantQuerySetMixin`.
- `GET/POST /api/students/students/` and `/students/{id}/` — `StudentViewSet` (`students/views.py`), router-registered at `students/urls.py:18`. Supports `session_class_id` query param (`students/views.py:183-198`) which is resolved to a `class_obj_id` + enrollment-based student id set, falling back to `full_class_ids` (Master-Class-wide) if no session-scoped result (`students/views.py:170-198`).
- `POST /api/students/students/{id}/reclassify/` — `students/views.py:322-440`. Reassigns a student's `class_obj`/`session_class` for a chosen `academic_year` via `ReclassifyStudentSerializer`; writes both to `StudentEnrollment` and (if the year is the current year) to `Student.class_obj` directly; also writes `PromotionOperation`/`PromotionEvent` audit rows carrying both class fields. Permission: default `ModuleAccessMixin`/`HasSchoolAccess` stack (see viewset class decorators).

### `academic_sessions` app (`backend/academic_sessions/urls.py`)
- `GET/POST /api/sessions/academic-years/` — `AcademicYearViewSet` (`academic_sessions/views.py:68`).
- `GET/POST /api/sessions/session-classes/` and `/session-classes/{id}/` — `SessionClassViewSet` (`academic_sessions/views.py:448-616`). Supports `academic_year`, `class_obj`, `is_active` query filters (lines 487-498); annotates `enrollment_count` (enrollments directly linked to the session class) and `unassigned_count` (enrollments on the same master class + year with `session_class=NULL`, i.e. "orphan rows from promotions done before session_class tracking was added" — comment at line 475).
  - `POST /api/sessions/session-classes/{id}/assign-unassigned/` — `academic_sessions/views.py:505-532`. Bulk-attaches all orphan `StudentEnrollment`s (same `class_obj`+`academic_year`, `session_class IS NULL`) to this target `SessionClass`. Requires `target.class_obj_id` to be set (400 otherwise). This is a **repair** tool, not a merge of two existing `SessionClass` records — see Section 6.
  - `POST /api/sessions/session-classes/initialize/` — `academic_sessions/views.py:534-615`. Given a target `academic_year` (and optional `source_academic_year`), `get_or_create`s one `SessionClass` per Master `Class`, copying `display_name`/`section`/`grade_level` from the master. This is how a school seeds Session Classes for a new year — again, one `SessionClass` per Master Class, no merging of sections.
- `GET/POST /api/sessions/enrollments/` — `StudentEnrollmentViewSet` (`academic_sessions/views.py:618+`).
- `POST /api/sessions/promotion-advisor/`, `/setup-wizard/`, `/section-allocator/` — dedicated `APIView`s for bulk promotion planning and section allocation (`academic_sessions/urls.py:14-18`); not read in full for this doc, referenced via `SectionAllocatorView`/`SessionSetupView`/`PromotionAdvisorView`.

### `examinations` app (`backend/examinations/views.py`)
- `GET/POST /api/examinations/exams/` — `ExamViewSet`. `get_queryset` (lines 987-1031) calls `resolve_class_scope(..., class_param_names=('class_obj','class_id'))` (line 997) then filters strictly by the resolved **`class_obj_id`** (line 1011-1013) — i.e. even when a caller passes `session_class_id`, exams are only ever filtered down to Master-Class granularity (consistent with `Exam` having no `session_class` field at all).
- `GET/POST /api/examinations/student-term-assessments/` — `StudentTermAssessmentView` (`examinations/views.py:1720`).
- `GET /api/examinations/student-term-assessments/roster/` — `StudentTermAssessmentRosterView` (`examinations/views.py:1873-1966`). Accepts **either** `session_class` or `class_obj` query param (line 1891-1892, at least one required, line 1896-1897); filters `StudentEnrollment` by whichever was given (lines 1916-1919); each result row echoes back both `enrollment.class_obj_id` and `enrollment.session_class_id` (lines 1955-1956) — this endpoint is one of the few that correctly supports section-level filtering end-to-end.
- `POST /api/examinations/student-term-assessments/bulk-save/` — `StudentTermAssessmentBulkSaveView` (`examinations/views.py:1969`).
- `POST /api/examinations/student-term-assessments/ai-remark/` — `StudentTermAssessmentAIRemarkView` (`examinations/views.py:2088`).

### `finance` app (`backend/finance/views.py`)
- `GET/POST /api/finance/fee-structures/` — `get_queryset` (lines ~150-207) accepts `class_id` or `session_class_id`; if `session_class_id` given, resolves it to `class_obj_id` via `resolve_class_scope` (line 192-195) then filters `FeeStructure` by `Q(class_obj_id=class_id) | Q(student__class_obj_id=class_id)` (line 197) — always Master-Class-level in the end, consistent with `FeeStructure` having no `session_class` field.

### `academics` app (`backend/academics/views.py`)
- Two call sites of `resolve_class_scope` at lines 248 and 736 (subject/timetable-adjacent viewsets) — same "accept session_class_id, resolve down to class_obj_id" pattern.

### `face_attendance` app (`backend/face_attendance/views.py`)
- Three call sites (lines 130, 179, 471) resolving class scope for enrollment/roster endpoints ahead of face-recognition matching.

### `lms` app (`backend/lms/views.py`)
- Seven call sites (lines 234, 614, 648, 841, 1381, 1501, 1836) all pass `class_param_names=('class_id','class_obj')` to `resolve_class_scope`, used across lesson-plan listing/creation and curriculum endpoints. Given the `LessonPlan.session_class` field was added only in migration `0017` (2026-07-31), some of these call sites may predate full session-aware filtering — not independently verified line-by-line for this doc; flagged as an open question (Section 8).

---

## 4. Cross-App Usage

- **Attendance** — `attendance/models.py`: `AttendanceUpload` has both `class_obj` (line 29) and `session_class` (line 43) with mutually-exclusive uniqueness constraints (lines 136-146: `unique_upload_per_session_class_date` when `session_class` set, else `unique_upload_per_class_date`). `AttendanceRecord`-type ordering (line 336) sorts by `student__class_obj`. `attendance/models.py:499` has a further `class_obj` FK (a different model in the file, not fully inspected).
- **Notifications** — `backend/notifications/triggers.py` is heavily Master-Class-oriented even where the driving assignment is section-scoped:
  - Absence/fee-pending digests (lines 146-166, 271-289, 448-464, 627-637) group and label by `student.class_obj` only.
  - `class-teacher-attendance-reminder-11am` trigger (lines 920-1004): iterates `ClassTeacherAssignment.objects.select_related(..., 'class_obj', 'session_class')` (line 927), but then does `class_obj = assignment.class_obj; if not class_obj: continue` (937-939) and builds the student/attendance querysets keyed on `class_obj` alone — in the `academic_year_id` branch, `enrollments__class_obj_id=class_obj.id` (line 965/970), and in the fallback branch, `student__class_obj=class_obj` (974-975). **`assignment.session_class` is read only to build the human-readable label** (`class_label`, lines 982-984) — it is never used to scope which students/attendance rows count. See Section 7 for the concrete bug scenario this creates.
- **Examinations** — `Exam`/`ExamPaper` reference `class_obj` only (Section 1/3). `ExamViewSet.perform_create` (`examinations/views.py:1033-1049`) auto-creates `ExamSubject` rows from `ClassSubject.objects.filter(class_obj=exam.class_obj, ...)` — i.e. it pulls subjects assigned at the Master-Class level even though `ClassSubject` itself is actually keyed by `session_class` for uniqueness (Section 1) — potential subject-set mismatch between sections is not reconciled here (not independently confirmed as a live bug; flagged as open question).
- **Fee/Finance** — `FeeStructure` filtering always resolves down to `class_obj_id` (Section 3); `notifications/triggers.py` fee-pending digest (`class_totals.setdefault(student.class_obj_id, ...)`, lines 283-289, 463-464) is likewise Master-Class-grouped.
- **Promotion/Graduation** — `academic_sessions.PromotionOperation`/`PromotionEvent` (Section 1) explicitly track both `source_class`/`target_class` and `source_session_class`/`target_session_class` in parallel, so promotion history is one of the more complete dual-tracking implementations in the codebase.
- **Teacher assignment / scope resolution** — `backend/core/permissions.py`:
  - `get_teacher_class_scope` (lines ~40-73, referenced) returns Master-Class ids from `ClassTeacherAssignment.values_list('class_obj_id', ...)`.
  - `get_teacher_session_class_scope` (lines 76-106) returns **Session Class ids** from the same model where `session_class__isnull=False` (line 99) — explicit section-level scope, docstring: "Use this for true section-scoped access control."
  - `get_teacher_subject_scope` (lines 110-140) is Master-Class-level only (`class_obj_id`, line 134).
  - `get_teacher_combined_scope` (lines 156-188) merges all three into `full_class_ids` (master), `full_session_class_ids` (session), `subject_class_ids` (master), documented as "Master class level (for backward compatibility)" / "Session class level (for section-scoped filtering)" (lines 179-182).
  - `teacher_has_student_access` (lines 191-200) prefers session-class-scoped membership (`_get_session_class_student_ids`) and falls back to `student.class_obj_id in scope['full_class_ids']` only if no session ids are present — a reasonable session-first/master-fallback pattern, reused by `StudentViewSet.get_queryset` per its own comment (`students/views.py`, around lines 170-198).
- **Reports** — `backend/reports/generators/base.py`, `academic.py`, `attendance.py`, `fee.py`, `student.py` all reference `class_obj`/`session_class` per their grep hits (Section 4 file list above); not individually read line-by-line for this doc — flagged as a gap in Section 8.
- **LMS / Curriculum** — `LessonPlan.session_class` (Section 1/2) is the newest addition; `lms/views.py` resolves scope through `resolve_class_scope` at 7 call sites (Section 3).

---

## 5. Frontend Usage

Central plumbing:
- `frontend/src/hooks/useSessionClasses.js:1-26` — React Query hook fetching `sessionsApi.getSessionClasses({ school_id, academic_year, is_active: true })`; 5-minute `staleTime` with an explicit comment that "Session/class rosters rarely change mid-session" (line 18-20).
- `frontend/src/utils/classScope.js:1-171` — the core reconciliation utility on the frontend, mirroring `core/class_scope.py` conceptually:
  - `getClassSelectorScope(activeAcademicYearId)` (line 3-5): scope is `'session'` if an academic year is active, else `'master'` — i.e. **the UI mode (session-aware vs legacy) is driven purely by whether an academic year context is set**, not by any explicit user choice or school-level flag.
  - `getResolvedMasterClassId` / `resolveClassIdToMasterClassId` (lines 7-20): look up a `session_class.id` in a locally-fetched list and return its `class_obj`.
  - `buildStudentClassFilterParams` (lines 28-48): builds request params with **both** `class_id` (resolved master) and `session_class_id` simultaneously when a session context exists.
  - `buildSessionLabeledMasterClassOptions` (lines 50-125): **groups multiple `SessionClass` rows under a single Master-Class dropdown option**, labeling it e.g. "Class 5 (Sections: A, B)" when more than one section exists (lines 105-109). This is a **display-only aggregation** — it does not merge or write any data; see Section 6.
  - `buildSessionClassOptions` (lines 127-145): the flat, section-level option list (no aggregation).
- `frontend/src/components/ClassSelector.jsx:1-66` — a single `<select>` component with a `scope` prop (`'master'` or `'session'`, default `'master'`, line 18) that switches between `useClasses` (Master) and `useSessionClasses` (Session) as its data source (lines 21-40). Any page using this component with the wrong `scope` value would silently show/submit the wrong kind of id — worth checking call sites individually if a bug is suspected (not exhaustively audited here).
- `frontend/src/pages/ClassesGradesPage.jsx` — the Master Class management page. Has a `classScope` local state (`'master'`|`'session'`, line 36) toggling the whole page's view, plus a **"link master class picker" modal** (`linkPickerModal`, lines 51-52, 978-1014) that lets an admin manually pick a `Class` to link to an orphaned `SessionClass` (calls a `linkSessionClassMut` mutation with `{ id: sessionClass.id, classObjId }`, line 1010) — this is a **one-at-a-time manual link/repair UI**, not a merge of two Session Classes.
- `frontend/src/pages/school-setup/SessionClassesStep.jsx` — session class setup step of the school onboarding wizard (uses the `initialize`/session-class endpoints from Section 3; not read in full for this doc).
- Other pages found referencing `session_class`/`class_obj`/scope selection (grep hits, not individually read in full): `examinations/ExamWizard.jsx`, `examinations/MarksEntryPage.jsx`, `examinations/ExamPapersPage.jsx`, `lms/LessonPlansPage.jsx`, `lms/LessonPlanWizard.jsx`, `lms/BulkLessonPlansModal.jsx`, `fee-collection/*` (FeeCollectPage, FeeSetupPage, MonthlyChargesTab, FeeGenerationSurface), `academics/TimetablePage.jsx`, `academics/AssessmentsPage.jsx`, `sessions/PromotionPage.jsx`, `hooks/useTeacherScopedClasses.js`, `hooks/useClassSubjects.js`, `components/teacher/TeacherScopeBadge.jsx`/`TeacherScopeSummary.jsx`, `components/BatchConvertModal.jsx`, `AttendanceRecordsPage.jsx`, `ManualEntryPage.jsx`, `RegisterPage.jsx`. Given the volume (92 files matched), these were located via `Grep` but not individually read line-by-line — flagged as a coverage gap in Section 8 rather than asserted as consistent or inconsistent.

**Potential conflation point flagged for follow-up:** `ClassSelector.jsx`'s `scope` prop defaults to `'master'` (line 18) — any call site that omits the prop but is used inside a session-scoped form (e.g. an exam/fee/lesson-plan create form gated by `activeAcademicYearId`) would present Master Class options while the surrounding form logic (per `classScope.js`'s `getClassSelectorScope`) expects session-scope. This was not confirmed against a concrete misuse in the 92-file list within this investigation's scope — it is a structural risk in the API surface (an easy default to forget to override), not a proven bug.

---

## 6. Merge Behavior

**No real "merge two Session Classes into one" feature exists anywhere in the codebase.** Searched broadly for `merge`/`merged`/`combine`/`merged_into`/`is_merged`/`merge_class`/`SessionClassMerge` etc. across `backend/` (37 files matched generically for "merge", none related to class merging — hits were sibling-detection in `finance/sibling_detection.py`/`sibling_confirmation.py`, dict `.update()`-style merges, and OCR pipeline voting logic in the deprecated attendance OCR code) and found nothing implementing class merge semantics.

What **does** exist, and could be mistaken for merge functionality:

1. **`SessionClassViewSet.assign_unassigned`** (`academic_sessions/views.py:505-532`) — reassigns *orphaned enrollments* (same master class + year, `session_class IS NULL`) onto one target `SessionClass`. This repairs enrollments that lost their session-class link (e.g. from pre-session-tracking promotions), it does **not** combine two existing, already-linked `SessionClass` rows.
2. **`SessionClassViewSet.initialize`** (`academic_sessions/views.py:534-615`) — `get_or_create`s exactly one `SessionClass` per Master `Class` for a target year, optionally copying from a source year. It cannot produce a many-to-one merge; the cardinality is always 1 `SessionClass` per `Class` unless sections are created separately afterward.
3. **Manual "link master class" picker** (`frontend/src/pages/ClassesGradesPage.jsx:51-52,978-1014`) — lets an admin attach one orphaned `SessionClass` to a chosen `Class`, one at a time. Still not a merge of two `SessionClass` rows into each other.
4. **`buildSessionLabeledMasterClassOptions`** (`frontend/src/utils/classScope.js:50-125`) — purely a **display-time grouping**: it groups N `SessionClass` rows that already share a `class_obj` into a single dropdown entry labeled "ClassName (Sections: A, B)". No backend write occurs; selecting this option only carries the resolved `class_obj` id forward. This is the closest thing in the UI to "session classes merged into one Master Class view" mentioned in the task background, but it is read-only aggregation, not a data merge.

The schema in fact *requires* multiple `SessionClass` rows to point at the same `class_obj` to represent multi-section classes at all (constraint permitting this was added by removing the one-per-year uniqueness in migration `0006_remove_sessionclass_master_link_unique.py`, Section 2) — so "merging" in this system is really just "linking multiple existing SessionClass rows to the same class_obj," which already happens implicitly whenever two sections of the same grade share a Master Class. There is no operation that takes two *different* `class_obj` rows and consolidates them (e.g. if two schools' data was set up with duplicate Master Classes by mistake) — no `Class`-to-`Class` merge tool was found either.

**Conclusion: merge is conceptual/absent as a first-class feature.** The nearest real mechanisms are the orphan-repair action (`assign_unassigned`) and the read-only UI grouping (`buildSessionLabeledMasterClassOptions`).

---

## 7. Known Issues / Inconsistencies

1. **Class-teacher attendance reminder ignores section scope despite reading it** — `backend/notifications/triggers.py:920-1004`. The query selects `session_class` (line 927) and uses it only for the notification's display label (lines 982-984: `class_label = f"{class_obj.name} - {assignment.session_class.section}"`), but the actual student roster and "has attendance already been marked" check are both scoped to `class_obj` alone:
   - Enrollment-scoped branch: `enrollments__class_obj_id=class_obj.id` (line 965) / `student__enrollments__class_obj_id=class_obj.id` (line 970) — **not** `enrollments__session_class_id=assignment.session_class_id`.
   - Legacy fallback branch: `student__class_obj=class_obj` (line 974) / `student__class_obj=class_obj` (line 975).
   - **Concrete failure scenario**: Master Class "Class 5" has two sections, both represented as separate `SessionClass` rows ("5-A", "5-B") sharing `class_obj`=Class 5. Teacher X is `ClassTeacherAssignment.session_class` = "5-A"; Teacher Y = "5-B". If section B's attendance is marked for the day but section A's is not, `attendance_qs.exists()` at line 979 will be `True` (because it only checks whether *any* `AttendanceRecord` exists for `class_obj`=Class 5 that day, not specifically for section A's students), so the reminder is **skipped for Teacher X even though section A's attendance was never taken.**

2. **Fee-pending / absence digest triggers group students by Master Class, not by section** — `backend/notifications/triggers.py:146-166, 271-289, 448-464, 627-637` all key `class_totals`/labels off `student.class_obj_id`/`student.class_obj.name`. If a school relies on `session_class`-level class-teacher assignments for these digests to be routed to the correct section's teacher, the current grouping conflates sections of the same grade. (Same root cause as #1: these are all Master-Class-only reads even where the recipient resolution walks through `ClassTeacherAssignment`, which does carry `session_class`.)

3. **`Exam`/`ExamPaper`/`StudentTermAssessment` never received a `session_class` field** (Section 1/2) — `ExamViewSet.get_queryset` (`examinations/views.py:987-1031`) resolves any incoming `session_class_id` down to `class_obj_id` via `resolve_class_scope` and filters only on `class_obj_id` (line 1011-1013). If two sections of "Class 5" are meant to sit separate exams (different question papers, different schedules), the current model has no way to represent "this Exam is for section A only" — every `Exam` row is implicitly whole-Master-Class. `StudentTermAssessmentRosterView` (Section 3) is the one exception that does support `session_class`-level rostering, by resolving through `StudentEnrollment.session_class`, not through the `Exam`/`StudentTermAssessment` models themselves.

4. **`FeeStructure` has no `session_class` field** (`backend/finance/models.py:312-339`) — fee amounts can only be set at Master-Class or per-student granularity; there is no way to charge Section A a different amount than Section B of the same Class without a per-student override for every affected student.

5. **`academics` Timetable model is Master-Class-only** (`backend/academics/models.py:223`, no `session_class` field) — while `ClassSubject`/`ClassTeacherAssignment` in the very same file were upgraded to be `session_class`-aware (Section 1), the timetable-slot model sitting alongside them was not, so a school with split sections cannot represent different timetables per section through this model as currently defined.

6. **Session-class backfill migrations silently drop ambiguous rows** — `academic_sessions/migrations/0007_studentenrollment_session_class.py:4-17` only links a `StudentEnrollment` to a `SessionClass` when *exactly one* `SessionClass` matches `(school, academic_year, class_obj)`; if a class had already been split into 2+ sections by the time this migration ran, those enrollments were left with `session_class=NULL` and depend on the runtime `unassigned_count` annotation / `assign_unassigned` action (Section 3/6) to ever get fixed. Similarly, `academics/migrations/0008_backfill_session_class.py:36-47` explicitly documents (comment, line 12-13): *"If multiple SessionClasses exist (different sections), use the first one"* when backfilling `ClassTeacherAssignment.session_class` — i.e., for any `ClassTeacherAssignment` created before this migration on an already-multi-section class, the backfill may have **linked the assignment to the wrong section** (whichever `SessionClass` happened to sort first by `-academic_year_id`), which would then silently feed into the section-scoped logic described in `get_teacher_session_class_scope` (`core/permissions.py:76-106`) and #1 above.

7. **`resolve_class_scope` hard-fails when a `SessionClass` isn't linked to a Master Class** (`backend/core/class_scope.py:84-87`) — since `SessionClass.class_obj` is nullable and orphan/unlinked `SessionClass` rows are a known, named condition in the code (`unassigned_count` annotation comment, `academic_sessions/views.py:474-475`: *"orphan rows from promotions done before session_class tracking was added"*), any endpoint routed through `resolve_class_scope` with such a `session_class_id` will return a 400-style `'invalid'` result rather than degrading gracefully to Master-Class-only filtering.

---

## 8. Open Questions

- **Is the Master-Class-only scoping in `notifications/triggers.py` (#1, #2 above) and `examinations` (`Exam`/`ExamPaper`, #3) intentional simplification, or an incomplete migration?** The `academics` app shows the pattern of upgrading `ClassSubject`/`ClassTeacherAssignment` to be section-aware while leaving `Timetable` behind in the same file — it's unclear whether `examinations`/`finance`/`notifications` are "not yet migrated" or "deliberately kept simple."
- **What is the intended UX/data model for a genuine "merge two Session Classes" operation** (e.g. a school that split a class into two sections mid-year and wants to recombine them, or merged two branches' cohorts)? No backend model or endpoint currently expresses this; only the read-only frontend grouping (`buildSessionLabeledMasterClassOptions`) approximates the concept visually. If the business actually needs this, it needs to be designed and built — it doesn't exist as partially-implemented code today.
- **How many orphaned (`session_class IS NULL`) enrollments exist in production**, given multiple historical migrations (`0007_studentenrollment_session_class.py`, `0008_backfill_session_class.py`) explicitly document ambiguous-backfill skip conditions? This would need a data query against production, not just code, to answer.
- **Is `ClassSelector.jsx`'s default `scope='master'` (line 18) actually always overridden correctly by every call site**, or are there forms embedded in session-aware flows that silently fall back to Master Class options? This investigation located 92 files referencing class/session-class concepts on the frontend but did not read all of them line-by-line to confirm every `<ClassSelector>` usage passes the right `scope`/`academicYearId` props — worth a targeted follow-up grep for `<ClassSelector` usages specifically.
- **Does `ExamViewSet.perform_create`'s auto-creation of `ExamSubject` from `ClassSubject.objects.filter(class_obj=exam.class_obj, ...)` (`examinations/views.py:1037-1042`) correctly account for `ClassSubject` being keyed by `session_class` for uniqueness** (Section 1)? If two sections of the same Master Class have different subject sets assigned via `ClassSubject.session_class`, filtering by `class_obj` alone would pull in subjects from *all* sections rather than the specific one the exam is for — flagged as a suspected but unconfirmed correctness gap, since `Exam` has no `session_class` field to disambiguate against in the first place.
- **Ownership of the `class_obj`-vs-`session_class` decision per new feature** doesn't appear to be documented anywhere (no `docs/` file found governing this) — CLAUDE.md doesn't mention Session Classes at all. A short ADR-style note stating which new models/endpoints must be session-aware from day one (vs. legitimately Master-Class-only) would prevent further apps from landing without `session_class` support and needing a later backfill migration, as happened with `academics` and `lms`.
