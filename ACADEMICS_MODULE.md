# Academics Module: Subjects & Timetable

## Overview

New `academics` Django app providing subject management, class-subject assignments, time slot configuration, and a grid-based timetable builder. This module enables schools to define their curriculum structure and build weekly class schedules with teacher conflict detection.

---

## Backend

### Models (`backend/academics/models.py`)

| Model | Purpose | Key Fields | Constraints |
|---|---|---|---|
| **Subject** | School-wide subject catalog | name, code(20), description, is_elective, is_active | unique_together: (school, code) |
| **ClassSubject** | Assigns a subject + teacher to a class | class_obj FK, subject FK, teacher FK (nullable), periods_per_week | unique_together: (school, class_obj, subject) |
| **TimetableSlot** | Defines daily period structure | name, slot_type (PERIOD/BREAK/ASSEMBLY/LUNCH), start_time, end_time, order | unique_together: (school, order) |
| **TimetableEntry** | Single cell in the timetable grid | class_obj FK, day (MON-SAT), slot FK, subject FK (nullable), teacher FK (nullable), room | unique_together: (school, class_obj, day, slot) |

All models have a `school` FK for multi-tenant isolation.

### Serializers (`backend/academics/serializers.py`)

8 serializers (Read + Create pairs for each model):

- **SubjectCreateSerializer** — auto-uppercases `code`, validates uniqueness per school
- **ClassSubjectSerializer** — computed fields: `class_name`, `subject_name`, `subject_code`, `teacher_name`
- **TimetableSlotCreateSerializer** — validates `start_time < end_time`, unique `order` per school
- **TimetableEntryCreateSerializer** — validates unique (class, day, slot) + **teacher conflict detection** (prevents double-booking a teacher in the same slot)

### ViewSets (`backend/academics/views.py`)

| ViewSet | Filters | Custom Actions |
|---|---|---|
| **SubjectViewSet** | search, is_elective, is_active | -- |
| **ClassSubjectViewSet** | class_obj, subject, teacher | `by_class` (GET) — returns all assignments for a class |
| **TimetableSlotViewSet** | is_active | -- |
| **TimetableEntryViewSet** | class_obj, day | `by_class` (GET) — full timetable grid for a class |
| | | `bulk_save` (POST) — delete-then-create per class+day |
| | | `teacher_conflicts` (GET) — check teacher availability |

All ViewSets use `TenantQuerySetMixin`, `IsSchoolAdminOrReadOnly`, and `HasSchoolAccess`. Soft delete pattern (`is_active=False`) for Subject and TimetableSlot.

### URLs (`backend/academics/urls.py`)

```
/api/academics/subjects/
/api/academics/class-subjects/
/api/academics/timetable-slots/
/api/academics/timetable-entries/
```

Registered in `backend/config/urls.py` via `path('api/academics/', include('academics.urls'))`.

---

## Frontend

### API Methods (`frontend/src/services/api.js`)

New `academicsApi` export with 18 methods:

- **Subjects:** get, getOne, create, update, delete (5)
- **ClassSubjects:** get, create, update, delete, byClass (5)
- **TimetableSlots:** get, create, update, delete (4)
- **TimetableEntries:** get, create, update, delete, byClass, bulkSave, teacherConflicts (7) *(getOne not needed)*

### Pages

#### SubjectsPage (`/academics/subjects`)

Two-tab interface:

**Subjects Tab:**
- Card grid layout with code badge, name, description, elective tag
- Search filter
- CRUD modal: name*, code* (auto-uppercase on blur), description, is_elective toggle

**Class Assignments Tab:**
- Table layout: Class, Subject, Teacher, Periods/Week, Actions
- Filter by class dropdown
- CRUD modal: class*, subject*, teacher dropdown (from active staff), periods_per_week

#### TimetablePage (`/academics/timetable`)

Grid-based timetable builder:

**Top Controls:**
- Class selector dropdown
- "Manage Time Slots" button (opens slot management modal)
- "Save All" button (bulk saves all changes)

**Time Slots Modal (sub-CRUD):**
- List existing slots with edit/delete
- Add form: name, type (PERIOD/BREAK/ASSEMBLY/LUNCH), start_time, end_time, order

**Desktop Timetable Grid:**
- `<table>` with rows = time slots, columns = days (Mon–Sat)
- PERIOD cells: show subject + teacher or "+" placeholder; click to edit
- BREAK/LUNCH/ASSEMBLY cells: gray, non-clickable, display slot name
- Unsaved changes indicator (yellow highlight)

**Cell Edit Modal:**
- Subject dropdown (filtered to subjects assigned to the selected class)
- Teacher dropdown (auto-filled from ClassSubject assignment when subject is selected)
- Room text input
- Teacher conflict warning (queries `teacher_conflicts` endpoint)

**Mobile Layout:**
- Day accordion with slot list cards
- Same edit functionality via modal

**Bulk Save Strategy:**
- Iterates all 6 days, collects entries per day
- Calls `bulk_save` endpoint for each day with changes
- Backend deletes existing entries for that class+day, then creates new ones

### Routing & Navigation

**App.jsx:** 2 new routes — `/academics/subjects`, `/academics/timetable`

**Layout.jsx:** New "Academics" sidebar group with:
- Subjects (BookOpenIcon)
- Timetable (ClockIcon)

Visible to all authenticated school users.

---

## Files Summary

### Created (9 files)

| File | Purpose |
|---|---|
| `backend/academics/__init__.py` | App init |
| `backend/academics/apps.py` | App config |
| `backend/academics/models.py` | 4 models |
| `backend/academics/admin.py` | Django admin registration |
| `backend/academics/serializers.py` | 8 serializers with validation |
| `backend/academics/views.py` | 4 ViewSets with custom actions |
| `backend/academics/urls.py` | Router with 4 registrations |
| `frontend/src/pages/academics/SubjectsPage.jsx` | Subjects + Class Assignments |
| `frontend/src/pages/academics/TimetablePage.jsx` | Grid-based timetable builder |

### Modified (5 files)

| File | Change |
|---|---|
| `backend/config/settings.py` | Added `'academics'` to INSTALLED_APPS |
| `backend/config/urls.py` | Added academics URL include + api_root entry |
| `frontend/src/services/api.js` | Added `academicsApi` with 18 methods |
| `frontend/src/App.jsx` | Added 2 page imports + 2 routes |
| `frontend/src/components/Layout.jsx` | Added BookOpenIcon, ClockIcon + Academics sidebar group |

---

## Verification

- `python manage.py check` — System check identified no issues
- `npx vite build` — Built successfully (1085 modules transformed)
- Migration `academics/0001_initial` created and applied (4 tables)
