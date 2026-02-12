# Implementation Plan: 4 Priority Modules for Smart-Attendance ERP

## Context

The mind map analysis revealed our app covers ~30% of the full ERP vision. The 4 most critical gaps are: Academic Year/Session Management, Sections within Classes, Examination & Results, and Parent Portal. These modules are foundational — exams need sessions, report cards need exams, parents need all of the above.

**Implementation Order (dependency-driven):**
```
Phase 1 (Academic Year) ──┐
                          ├──> Phase 3 (Exams) ──> Phase 4 (Parent Portal)
Phase 2 (Sections) ───────┘
```

---

## Phase 1: Academic Year / Session Management

**New app:** `backend/sessions/`

### 1.1 Models (`backend/sessions/models.py`)

**AcademicYear** — represents "2025-2026"
| Field | Type | Notes |
|-------|------|-------|
| school | FK(School, CASCADE) | Multi-tenant |
| name | CharField(50) | e.g. "2025-2026" |
| start_date | DateField | |
| end_date | DateField | |
| is_current | BooleanField | Only 1 per school (DB constraint) |
| is_active | BooleanField | Soft delete |
| created_at / updated_at | Auto timestamps | |

Constraints: `unique_together: (school, name)` + `UniqueConstraint(fields=['school'], condition=Q(is_current=True))`

Override `save()` to clear other `is_current=True` rows for the same school.

**Term** — represents "Term 1", "Semester 2" within a year
| Field | Type | Notes |
|-------|------|-------|
| school | FK(School, CASCADE) | |
| academic_year | FK(AcademicYear, CASCADE) | |
| name | CharField(50) | e.g. "Term 1" |
| term_type | CharField(10) choices: TERM/SEMESTER/QUARTER | |
| order | PositiveIntegerField | Sort within year |
| start_date / end_date | DateField | |
| is_current | BooleanField | |
| is_active | BooleanField | Soft delete |

Constraints: `unique_together: (school, academic_year, name)`

**StudentEnrollment** — links student to class for a specific year
| Field | Type | Notes |
|-------|------|-------|
| school | FK(School, CASCADE) | |
| student | FK(Student, CASCADE) | related_name='enrollments' |
| academic_year | FK(AcademicYear, CASCADE) | |
| class_obj | FK(Class, CASCADE) | related_name='enrollments' |
| roll_number | CharField(20) | Can differ between years |
| status | CharField(20) choices: ACTIVE/PROMOTED/RETAINED/TRANSFERRED/WITHDRAWN | |
| is_active | BooleanField | |

Constraints: `unique_together: (school, student, academic_year)` + Index on `(school, academic_year, class_obj)`

### 1.2 Migration Strategy

**Key decision:** Keep `Student.class_obj` and `Student.roll_number` as-is (represents "current" class). `StudentEnrollment` is additive — provides session-aware historical view. No existing code breaks.

**Data migration:**
1. For each school, create a default AcademicYear "2025-2026" with `is_current=True`
2. For each active student, create a StudentEnrollment linking to their current `class_obj`
3. Add nullable `academic_year` FK to existing models that benefit from year-scoping (additive only, no breaking changes):
   - `students.Class` — optional, for year-specific class creation
   - `finance.FeeStructure` — to tie fee plans to academic years
   - `finance.FeePayment` — to tie payments to academic years

### 1.3 Serializers (`backend/sessions/serializers.py`)

Follow dual-serializer pattern:
- `AcademicYearSerializer` (read) — includes `terms_count`, `student_count`
- `AcademicYearCreateSerializer` (write) — validates `start_date < end_date`, name uniqueness per school
- `TermSerializer` / `TermCreateSerializer` — validates date range within parent year, unique order
- `StudentEnrollmentSerializer` (read) — includes `student_name`, `class_name`, `academic_year_name`
- `StudentEnrollmentCreateSerializer` — validates student belongs to same school
- `BulkPromoteSerializer` — accepts `{ source_year, target_year, promotions: [{student_id, target_class_id, new_roll_number}] }`

### 1.4 ViewSets (`backend/sessions/views.py`)

All extend `TenantQuerySetMixin, viewsets.ModelViewSet` with `[IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]`

| ViewSet | Custom Actions |
|---------|---------------|
| AcademicYearViewSet | `set_current` (POST detail), `summary` (GET detail) |
| TermViewSet | Filter by `?academic_year=` |
| StudentEnrollmentViewSet | `bulk_promote` (POST), `by_class` (GET ?class_id=&academic_year_id=) |

### 1.5 API Endpoints

```
/api/sessions/academic-years/           GET, POST
/api/sessions/academic-years/{id}/      GET, PUT, PATCH, DELETE
/api/sessions/academic-years/{id}/set_current/   POST
/api/sessions/academic-years/{id}/summary/       GET
/api/sessions/terms/                    GET, POST
/api/sessions/terms/{id}/               GET, PUT, PATCH, DELETE
/api/sessions/enrollments/              GET, POST
/api/sessions/enrollments/{id}/         GET, PUT, PATCH, DELETE
/api/sessions/enrollments/bulk_promote/ POST
/api/sessions/enrollments/by_class/     GET
```

### 1.6 Frontend

**New pages:**
- `frontend/src/pages/sessions/AcademicYearsPage.jsx` — CRUD for years + inline terms management (tab-based: Years tab with term sub-list, similar to SubjectsPage)
- `frontend/src/pages/sessions/PromotionPage.jsx` — Wizard: select source year → select target year → review students with target class picker → bulk promote

**API module** — add `sessionsApi` to `frontend/src/services/api.js` with ~15 methods

**Routing** (`App.jsx`): `/academics/sessions`, `/academics/promotion`

**Sidebar** (`Layout.jsx`): Under Academics group, add "Sessions" (CalendarIcon) and "Promotion" (ArrowUpIcon)

### 1.7 Files Summary

| Action | File |
|--------|------|
| CREATE | `backend/sessions/__init__.py`, `apps.py`, `models.py`, `serializers.py`, `views.py`, `urls.py`, `admin.py` |
| CREATE | `frontend/src/pages/sessions/AcademicYearsPage.jsx`, `PromotionPage.jsx` |
| MODIFY | `backend/config/settings.py` — add `'sessions'` to INSTALLED_APPS |
| MODIFY | `backend/config/urls.py` — add `path('api/sessions/', include('sessions.urls'))` |
| MODIFY | `backend/students/models.py` — add nullable `academic_year` FK to Class |
| MODIFY | `backend/finance/models.py` — add nullable `academic_year` FK to FeeStructure, FeePayment |
| MODIFY | `frontend/src/services/api.js` — add `sessionsApi` |
| MODIFY | `frontend/src/App.jsx` — add 2 routes |
| MODIFY | `frontend/src/components/Layout.jsx` — add 2 sidebar items |

### 1.8 Verification

- Create academic year → verify is_current constraint (only 1 per school)
- Create terms → verify date validation and ordering
- Run data migration → verify all existing students get enrollments
- Existing attendance/fee/timetable endpoints → verify zero breakage (null academic_year is fine)
- Bulk promote students → verify new enrollments created, old marked PROMOTED
- `python manage.py check` passes, `npx vite build` succeeds

---

## Phase 2: Sections within Classes

**No new app** — extends `backend/students/`

### 2.1 Design Decision

Add a `Grade` model + `section` field to Class. Do NOT create a separate Section model. Every existing FK to Class continues to work unchanged — a "section" is just a Class that belongs to a Grade.

### 2.2 Models

**Grade** (new model in `backend/students/models.py`)
| Field | Type | Notes |
|-------|------|-------|
| school | FK(School, CASCADE) | related_name='grades' |
| name | CharField(50) | "Playgroup", "Nursery", "Class 5" |
| numeric_level | IntegerField | 0=Playgroup, 1=Nursery, 2=Prep, 3=Class1, ... 12=Class10 |
| is_active | BooleanField | Soft delete |
| created_at / updated_at | Auto timestamps | |

Constraints: `unique_together: (school, numeric_level)`, ordering: `['numeric_level']`

**Class modifications:**
```python
# ADD to existing Class model:
grade = FK(Grade, SET_NULL, null=True, blank=True, related_name='classes')
section = CharField(max_length=10, blank=True, default='')
```

Add constraint: `UniqueConstraint(fields=['school', 'grade', 'section'], condition=Q(grade__isnull=False), name='unique_grade_section_per_school')`

### 2.3 Migration Strategy

1. Create Grade model
2. Add `grade` FK + `section` field to Class (both nullable, no existing data breaks)
3. Data migration:
   - Parse existing class names: "5-A" → grade=Class 5, section="A"; "Playgroup" → grade=Playgroup, section=""
   - Create Grade records from existing `grade_level` values per school
   - Use the predefined Pakistani grade map: `{0: 'Playgroup', 1: 'Nursery', 2: 'Prep', 3-12: 'Class 1'-'Class 10'}`
   - Set `grade` FK and `section` on parsed classes; leave unmapped classes with `grade=null`

### 2.4 Serializers

- `GradeSerializer` (read) — includes `class_count` (computed)
- `GradeCreateSerializer` (write) — validates numeric_level uniqueness per school
- Update `ClassSerializer` — add `grade`, `grade_name`, `section` fields
- Update `ClassCreateSerializer` — add optional `grade`, `section` fields

### 2.5 ViewSets

**GradeViewSet** — standard CRUD + `classes` action (GET detail: returns all sections for a grade)

**ClassViewSet update** — add `?grade_id=` filter parameter

### 2.6 API Endpoints

```
/api/grades/                  GET, POST
/api/grades/{id}/             GET, PUT, PATCH, DELETE
/api/grades/{id}/classes/     GET  (all sections for this grade)
/api/classes/?grade_id=X      GET  (existing endpoint, new filter)
```

### 2.7 Frontend

**New page:**
- `frontend/src/pages/GradesPage.jsx` — Grade management with expandable sections. Each grade row expands to show its Class/Section children. Create grade → auto-create single class, or create with sections (A, B, C).

**Modifications:**
- `ClassesPage.jsx` — Add grade dropdown filter; when creating a class, optionally select a grade and section
- `api.js` — Add `gradesApi` export

**Routing:** `/grades`
**Sidebar:** Add "Grades & Sections" under Management group (before Classes)

### 2.8 Files Summary

| Action | File |
|--------|------|
| CREATE | `frontend/src/pages/GradesPage.jsx` |
| MODIFY | `backend/students/models.py` — add Grade model, add grade FK + section to Class |
| MODIFY | `backend/students/serializers.py` — add GradeSerializer/CreateSerializer, update ClassSerializer |
| MODIFY | `backend/students/views.py` — add GradeViewSet, update ClassViewSet with grade filter |
| MODIFY | `backend/students/urls.py` — register grades route |
| MODIFY | `frontend/src/services/api.js` — add `gradesApi` |
| MODIFY | `frontend/src/App.jsx` — add grades route |
| MODIFY | `frontend/src/components/Layout.jsx` — add Grades sidebar item |
| MODIFY | `frontend/src/pages/ClassesPage.jsx` — add grade filter/selector |

### 2.9 Verification

- Create grades → verify numeric_level uniqueness per school
- Create class with grade + section → verify constraint works
- Data migration → verify existing "5-A" parsed correctly
- All existing views (attendance upload, fee collection, timetable) → verify they still work with unchanged Class FK
- `?grade_id=` filter → returns only classes in that grade

---

## Phase 3: Examination & Results

**New app:** `backend/examinations/`

### 3.1 Models (`backend/examinations/models.py`)

**ExamType** — defines exam categories
| Field | Type | Notes |
|-------|------|-------|
| school | FK(School, CASCADE) | |
| name | CharField(100) | "Mid-Term", "Final Exam", "Unit Test" |
| weight | DecimalField(5,2) | Weightage % for GPA (default 100) |
| is_active / timestamps | | Standard pattern |

Constraints: `unique_together: (school, name)`

**Exam** — specific exam instance for a class
| Field | Type | Notes |
|-------|------|-------|
| school | FK(School, CASCADE) | |
| academic_year | FK(AcademicYear, CASCADE) | From Phase 1 |
| term | FK(Term, CASCADE, null=True) | Optional term association |
| exam_type | FK(ExamType, CASCADE) | |
| class_obj | FK(Class, CASCADE) | Per-section exam |
| name | CharField(200) | "Mid-Term 2025 - Class 5-A" |
| start_date / end_date | DateField (nullable) | |
| status | CharField(20) | SCHEDULED → IN_PROGRESS → MARKS_ENTRY → COMPLETED → PUBLISHED |
| is_active / timestamps | | |

Constraints: `unique_together: (school, exam_type, class_obj, term)` + indexes on `(school, academic_year)`, `(school, class_obj)`

**ExamSubject** — subjects included in an exam with marks config
| Field | Type | Notes |
|-------|------|-------|
| school | FK(School, CASCADE) | |
| exam | FK(Exam, CASCADE) | related_name='exam_subjects' |
| subject | FK(Subject, CASCADE) | From academics module |
| total_marks | DecimalField(6,2) | Default 100 |
| passing_marks | DecimalField(6,2) | Default 33 |
| exam_date | DateField (nullable) | Per-subject exam date |
| is_active / timestamps | | |

Constraints: `unique_together: (school, exam, subject)`

**StudentMark** — individual marks per student per subject
| Field | Type | Notes |
|-------|------|-------|
| school | FK(School, CASCADE) | |
| exam_subject | FK(ExamSubject, CASCADE) | related_name='student_marks' |
| student | FK(Student, CASCADE) | related_name='marks' |
| marks_obtained | DecimalField(6,2, nullable) | null = not entered yet |
| is_absent | BooleanField | Default False |
| remarks | CharField(200, blank) | |
| timestamps | | |

Constraints: `unique_together: (school, exam_subject, student)` + Index on `(school, student)`

Properties: `percentage` (computed), `is_pass` (computed)

**GradeScale** — school-specific letter grade mapping
| Field | Type | Notes |
|-------|------|-------|
| school | FK(School, CASCADE) | |
| grade_label | CharField(5) | "A+", "A", "B", "F" |
| min_percentage / max_percentage | DecimalField(5,2) | |
| gpa_points | DecimalField(3,1) | e.g. 4.0 |
| order | PositiveIntegerField | |
| is_active / timestamps | | |

Constraints: `unique_together: (school, grade_label)`

### 3.2 Serializers (`backend/examinations/serializers.py`)

Standard dual-serializer pattern for all 5 models, plus:
- `StudentMarkBulkEntrySerializer` — input: `{ exam_subject_id, marks: [{student_id, marks_obtained, is_absent}] }` for grid-based marks entry
- `ExamResultSerializer` — read-only: per-student aggregation with total, percentage, grade (computed from GradeScale), rank
- `ReportCardSerializer` — read-only: student info + all subjects x all exams for a term/year

### 3.3 ViewSets (`backend/examinations/views.py`)

| ViewSet | Permissions | Custom Actions |
|---------|-------------|----------------|
| ExamTypeViewSet | IsSchoolAdminOrReadOnly | -- |
| ExamViewSet | IsSchoolAdminOrReadOnly | `publish` (POST detail), `results` (GET detail), `class_summary` (GET detail) |
| ExamSubjectViewSet | IsSchoolAdminOrReadOnly | Filter by `?exam=` |
| StudentMarkViewSet | IsSchoolAdminOrReadOnly | `bulk_entry` (POST), `by_student` (GET ?student_id=) |
| GradeScaleViewSet | IsSchoolAdmin | -- |
| ReportCardView (APIView) | IsSchoolAdminOrReadOnly | GET with ?student_id, ?academic_year_id, ?term_id |
| ReportCardPDFView (APIView) | IsSchoolAdminOrReadOnly | Returns PDF blob |

**`publish` action** — changes status to PUBLISHED, making results visible to parents
**`results` action** — returns all students with per-subject marks, totals, percentages, grades, ranks
**`class_summary` action** — returns pass/fail count, class average, topper, subject-wise averages
**`bulk_entry` action** — upserts marks for all students in a class for one exam_subject

### 3.4 Report Card PDF

Use `reportlab` (add to `backend/requirements.txt`). Build in `backend/examinations/report_card.py`:
- Gather: student info, class, all exam_subjects for the term/year
- Calculate: per-subject marks, total, percentage, grade (from GradeScale), rank in class
- Render: Table layout with school header, student details, marks grid, summary
- Return: `HttpResponse(content_type='application/pdf')`

### 3.5 API Endpoints

```
/api/examinations/exam-types/                    CRUD
/api/examinations/exams/                         CRUD
/api/examinations/exams/{id}/publish/            POST
/api/examinations/exams/{id}/results/            GET
/api/examinations/exams/{id}/class_summary/      GET
/api/examinations/exam-subjects/                 CRUD
/api/examinations/marks/                         CRUD
/api/examinations/marks/bulk_entry/              POST
/api/examinations/marks/by_student/              GET
/api/examinations/grade-scales/                  CRUD
/api/examinations/report-card/                   GET
/api/examinations/report-card/pdf/               GET (blob)
```

### 3.6 Frontend

**New pages (6):**
| Page | Path | Description |
|------|------|-------------|
| `ExamTypesPage.jsx` | `/academics/exam-types` | CRUD for exam type definitions (card grid) |
| `ExamsPage.jsx` | `/academics/exams` | Create/manage exams, filter by year/term/class, status badges |
| `MarksEntryPage.jsx` | `/academics/marks-entry` | Select exam+subject -> spreadsheet-style grid: rows=students, cols=marks/absent/remarks. Bulk save. |
| `ResultsPage.jsx` | `/academics/results` | Select exam -> ranked results table with pass/fail, averages, charts (Recharts) |
| `ReportCardPage.jsx` | `/academics/report-cards` | Select student -> view report card -> download PDF button |
| `GradeScalePage.jsx` | `/academics/grade-scale` | CRUD table for grade boundaries |

**API module** — add `examinationsApi` to `api.js` with ~20 methods

**Sidebar** — Expand Academics group:
```
Academics
  ├── Subjects
  ├── Timetable
  ├── Sessions        (Phase 1)
  ├── Promotion       (Phase 1)
  ├── Exam Types      (Phase 3)
  ├── Exams           (Phase 3)
  ├── Marks Entry     (Phase 3)
  ├── Results         (Phase 3)
  ├── Report Cards    (Phase 3)
  └── Grade Scale     (Phase 3)
```

### 3.7 Files Summary

| Action | File |
|--------|------|
| CREATE | `backend/examinations/__init__.py`, `apps.py`, `models.py`, `serializers.py`, `views.py`, `urls.py`, `admin.py`, `report_card.py`, `utils.py` |
| CREATE | `frontend/src/pages/examinations/` — 6 page files |
| MODIFY | `backend/config/settings.py` — add `'examinations'` |
| MODIFY | `backend/config/urls.py` — add examinations include |
| MODIFY | `backend/requirements.txt` — add `reportlab` |
| MODIFY | `frontend/src/services/api.js` — add `examinationsApi` |
| MODIFY | `frontend/src/App.jsx` — add 6 routes |
| MODIFY | `frontend/src/components/Layout.jsx` — add 6 sidebar items |

### 3.8 Verification

- Create exam type → create exam → add exam subjects → verify uniqueness
- Bulk enter marks for a class → verify upsert behavior
- Results endpoint → verify grades calculated correctly against GradeScale
- Class summary → verify averages, topper, pass/fail counts
- Publish exam → verify status transition
- Report card → verify all subjects aggregated, PDF downloads correctly
- MarksEntryPage → verify grid saves/loads, absent toggle works
- `python manage.py check` + `npx vite build`

---

## Phase 4: Parent Portal

**New app:** `backend/parent_portal/` (views only, no models — models go in `students`)

### 4.1 Model Changes

**Add PARENT role** to both:
- `backend/users/models.py` → `User.Role`: add `PARENT = 'PARENT', 'Parent'`
- `backend/schools/models.py` → `UserSchoolMembership.Role`: add `PARENT = 'PARENT', 'Parent'`

**ParentStudent** (new in `backend/students/models.py`)
| Field | Type | Notes |
|-------|------|-------|
| school | FK(School, CASCADE) | |
| parent_user | FK(User, CASCADE) | related_name='children_links' |
| student | FK(Student, CASCADE) | related_name='parent_links' |
| relationship | CharField(20) | FATHER/MOTHER/GUARDIAN/OTHER |
| is_primary | BooleanField | Primary contact for this student |
| is_active / timestamps | | |

Constraints: `unique_together: (school, parent_user, student)`

**StudentLeaveApplication** (new in `backend/students/models.py`)
| Field | Type | Notes |
|-------|------|-------|
| school | FK(School, CASCADE) | |
| student | FK(Student, CASCADE) | related_name='leave_applications' |
| applied_by | FK(User, CASCADE) | The parent who applied |
| start_date / end_date | DateField | |
| reason | TextField | |
| status | CharField(20) | PENDING → APPROVED / REJECTED |
| admin_remarks | TextField(blank) | |
| reviewed_by | FK(User, SET_NULL, nullable) | Admin who reviewed |
| is_active / timestamps | | |

Property: `total_days` (computed from date range)

### 4.2 Permission Changes (`backend/core/permissions.py`)

Add:
```python
PARENT_ROLES = ('PARENT',)

class IsParent(BasePermission):
    """Only PARENT role users."""

class IsParentOrAdmin(BasePermission):
    """Parents get read-only, admins get full access."""
```

Add utility:
```python
def verify_parent_student_access(user, student_id, school_id):
    """Returns True if parent has a link to this student. CRITICAL for data isolation."""
```

### 4.3 Backend Views (`backend/parent_portal/views.py`)

All views verify parent-student link before returning data.

| View | Method | Description |
|------|--------|-------------|
| ParentDashboardView | GET | Aggregates all children: student info, attendance summary (last 30d), fee summary (current year), recent exam results |
| ParentChildAttendanceView | GET | Monthly attendance calendar for one child. Params: `?student_id=&month=&year=` |
| ParentChildFeesView | GET | Fee payment history for one child |
| ParentChildTimetableView | GET | Weekly timetable for child's class (reuses timetable data) |
| ParentChildResultsView | GET | All exam results for one child. Params: `?student_id=&academic_year_id=` |
| StudentLeaveApplicationViewSet | CRUD | Parents create/view their leave apps; admins approve/reject all |

**Admin-side views** (in `backend/students/views.py`):
| ViewSet | Description |
|---------|-------------|
| ParentStudentViewSet | CRUD parent-student links + `create_parent_account` action (creates User + Membership + Link in one call) |

### 4.4 API Endpoints

```
# Parent-facing (read-only + leave applications)
/api/parent/dashboard/                  GET
/api/parent/attendance/                 GET ?student_id, month, year
/api/parent/fees/                       GET ?student_id
/api/parent/timetable/                  GET ?student_id
/api/parent/results/                    GET ?student_id, academic_year_id
/api/parent/leave-applications/         GET, POST
/api/parent/leave-applications/{id}/    GET, DELETE (only own, only PENDING)

# Admin-facing (manage parent accounts)
/api/students/parent-links/                     GET, POST
/api/students/parent-links/{id}/                GET, PUT, DELETE
/api/students/parent-links/create_parent_account/  POST
```

### 4.5 Frontend

**New pages (7):**
| Page | Path | Description |
|------|------|-------------|
| `ParentDashboard.jsx` | `/parent` | Cards per child: photo/name, attendance %, fee balance, recent results. Click card -> child detail. |
| `ChildDetailPage.jsx` | `/parent/child/:studentId` | Tabbed view: Attendance, Fees, Results, Timetable |
| `ChildAttendancePage.jsx` | `/parent/child/:studentId/attendance` | Calendar view with green (present) / red (absent) dots. Monthly summary stats. |
| `ChildFeesPage.jsx` | `/parent/child/:studentId/fees` | Table of monthly payments: due, paid, status badges. Total summary card. |
| `ChildResultsPage.jsx` | `/parent/child/:studentId/results` | Exam results table per term. Download report card PDF button. |
| `ChildTimetablePage.jsx` | `/parent/child/:studentId/timetable` | Read-only weekly timetable grid (reuse TimetablePage grid layout) |
| `LeaveApplicationPage.jsx` | `/parent/leave` | Form to apply for leave + list of past applications with status |

**Route guard:**
```jsx
function ParentRoute({ children }) {
  const { effectiveRole } = useAuth()
  if (effectiveRole !== 'PARENT') return <Navigate to="/dashboard" />
  return children
}
```

**Root redirect logic** (update in App.jsx):
- If PARENT role → redirect to `/parent`
- If admin/staff → redirect to `/dashboard` (existing)

**Layout.jsx changes:**
- When `isParent`, show simplified sidebar: Dashboard, Leave Application only
- Children are navigated from the dashboard, not sidebar

**AuthContext.jsx changes:**
- Add `isParent: effectiveRole === 'PARENT'` to the exported context

**Admin-side UI:**
- Add "Parent Accounts" section to StudentsPage or a new `ParentManagementPage.jsx`
- Quick action: select student → "Create Parent Account" → enters phone/email → creates user + link

### 4.6 Files Summary

| Action | File |
|--------|------|
| CREATE | `backend/parent_portal/__init__.py`, `apps.py`, `views.py`, `serializers.py`, `urls.py` |
| CREATE | `frontend/src/pages/parent/` — 7 page files |
| MODIFY | `backend/users/models.py` — add PARENT to Role choices, add `is_parent` property |
| MODIFY | `backend/schools/models.py` — add PARENT to UserSchoolMembership.Role |
| MODIFY | `backend/students/models.py` — add ParentStudent, StudentLeaveApplication models |
| MODIFY | `backend/students/serializers.py` — add ParentStudent serializers, leave serializers |
| MODIFY | `backend/students/views.py` — add ParentStudentViewSet |
| MODIFY | `backend/students/urls.py` — register parent-links route |
| MODIFY | `backend/core/permissions.py` — add IsParent, IsParentOrAdmin, PARENT_ROLES, verify_parent_student_access |
| MODIFY | `backend/config/settings.py` — add `'parent_portal'` to INSTALLED_APPS |
| MODIFY | `backend/config/urls.py` — add parent_portal URL include |
| MODIFY | `frontend/src/services/api.js` — add `parentApi`, `parentLinksApi` |
| MODIFY | `frontend/src/App.jsx` — add 7 parent routes + ParentRoute guard + root redirect |
| MODIFY | `frontend/src/components/Layout.jsx` — add parent sidebar, isParent conditional |
| MODIFY | `frontend/src/contexts/AuthContext.jsx` — add isParent to context |

### 4.7 Verification

- Create parent user (PARENT role) + link to student → verify login shows parent dashboard
- Parent sees only their children → verify other students are NOT visible (data isolation)
- Parent cannot access admin endpoints → verify 403 on /api/students/, /api/finance/, etc.
- Attendance calendar → verify green/red rendering matches AttendanceRecord data
- Fee summary → verify totals match FeePayment records
- Results → verify marks display, report card PDF download works
- Timetable → verify read-only grid renders for child's class
- Leave application → create, admin approves, parent sees status update
- Mobile responsive → all parent pages work on mobile viewport
- Role switching → admin who is also a parent in another school works correctly

---

## Cross-Module Impact Summary

| Existing Module | Phase 1 Impact | Phase 2 Impact | Phase 3 Impact | Phase 4 Impact |
|----------------|----------------|----------------|----------------|----------------|
| students/Class | Add nullable academic_year FK | Add grade FK + section field | No change | No change |
| students/Student | No field change | No change | No change | Add ParentStudent + LeaveApplication |
| attendance/ | Add nullable academic_year FK to records (optional) | No change | No change | Parent reads via parent_portal |
| finance/ | Add nullable academic_year FK to FeeStructure + FeePayment | No change | No change | Parent reads via parent_portal |
| academics/ | No change | No change | Exam references Subject | Parent reads timetable via parent_portal |
| users/ | No change | No change | No change | Add PARENT role |
| schools/ | No change | No change | No change | Add PARENT to membership roles |
| core/permissions | No change | No change | No change | Add IsParent, IsParentOrAdmin |

---

## Total File Count

| Category | New Files | Modified Files |
|----------|-----------|----------------|
| Phase 1 | 9 (7 backend + 2 frontend) | 7 |
| Phase 2 | 1 frontend | 8 |
| Phase 3 | 15 (9 backend + 6 frontend) | 5 |
| Phase 4 | 12 (5 backend + 7 frontend) | 11 |
| **Total** | **37 new files** | **~25 modifications** |

---

## Implementation Approach Per Phase

For each phase, the implementation order within the phase is:
1. Backend models + migrations (including data migration)
2. Backend serializers
3. Backend views + URLs
4. Register in settings.py + config/urls.py
5. `python manage.py makemigrations && python manage.py migrate`
6. `python manage.py check` — verify no issues
7. Frontend API module additions
8. Frontend pages
9. Frontend routing + sidebar
10. `npx vite build` — verify build succeeds
