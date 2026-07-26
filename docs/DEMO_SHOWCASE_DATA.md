# Demo data: public demo host + showcase graphs

## Public demo tenant (`demo.kodereduai.pk`)

Production-style URL **`https://demo.kodereduai.pk`** maps to the school whose **`subdomain` is `demo`** (in typical deployments this is **Demo School**, id **42**).

From `backend/`, run the **combined** seeder (creates academic year/terms/classes/students/staff if missing, sets admin `qaisar` password to **`Abcd1234`**, then applies showcase graph layers):

```bash
python manage.py seed_demo_portal
```

Refresh only the synthetic graph layer (keeps roster):

```bash
python manage.py seed_demo_portal --reset-showcase
```

Implementation: [`seed_demo_portal.py`](../backend/seed_demo_portal.py) and [`core/management/commands/seed_demo_portal.py`](../backend/core/management/commands/seed_demo_portal.py).

---

## Showcase graph seed only (`seed_showcase_graphs`)

Use this when the school **already** has classes, students, terms, and staff (e.g. **SEED_TEST** School Alpha id **37** after `seed_test_data.py`). It adds related rows across LMS, Examinations, Finance, HR, Academics, and attendance/dashboard data — see "What gets created" below.

```bash
python manage.py seed_showcase_graphs --school-id=<SCHOOL_ID>
python manage.py seed_showcase_graphs --school-id=<SCHOOL_ID> --reset
```

Code: [`seed_showcase_graphs.py`](../backend/seed_showcase_graphs.py), command [`core/management/commands/seed_showcase_graphs.py`](../backend/core/management/commands/seed_showcase_graphs.py).

## Preconditions

- Target **school** exists.
- At least one **academic year** (preferably `is_current=True`) and one **term**.
- Active **classes** and **students** (the script does **not** add or remove students or master `Class` rows).
- Optional but recommended: **staff** members for timetable teacher assignment, HR payslips, and staff attendance.

## What gets created

Most seeded rows are foundational and kept fresh in place via `get_or_create`/`update_or_create` on a stable key, using **plain, presentable names** (this seeder populates the public sales-demo tenant, so a literal "SHOWCASE_" prefix in a subject/account/exam name is a bug, not a feature). Only genuinely time-rolling data — rows keyed off "today" that would otherwise leave stale entries behind as the anchor date drifts forward (attendance, fee payments, staff attendance, payslips, attendance uploads) — is tagged with an internal `notes`/`image_url` marker and cleared by `--reset` before regenerating. Earlier runs used a `SHOWCASE_` name prefix on some rows; `_migrate_legacy_showcase_names` folds those into clean names in place, once, on every run.

| Area | Content |
|------|---------|
| Academic sessions | `SessionClass` per master class (plain display name); `StudentEnrollment` updated for current AY |
| Calendar | One short **off-day** window ("Spring Break") |
| Attendance | ~45 weekdays of `AttendanceRecord` with `source=MANUAL` (present/absent mix), dates clamped to the current academic year |
| Academics | Real `Subject` rows (reuses existing "Mathematics"/"English" if present), `TimetableSlot`/`TimetableEntry` (both subjects), `ClassSubject`, one `ClassTeacherAssignment` per class |
| Examinations | `ExamType`, per-class `Exam` (status `PUBLISHED` so it shows up on report cards), `ExamSubject` + `StudentMark` for every subject/student, `GradeScale` (A–F bands), `StudentTermAssessment` (skills/behaviour ratings + remarks) |
| Finance | `Account` (Cash + Bank), `MonthlyFeeCategory`, `FeeStructure` per class, `FeePayment` for five billing months (`notes` marker), a few `Expense`/`OtherIncome` rows, one `Discount` and one `Scholarship` with a `StudentDiscount` each |
| HR | `LeavePolicy`, sample `LeaveApplication`, `StaffAttendance`, `Payslip`, `SalaryStructure`, `StaffQualification`, `StaffDocument` per staff member, plus one non-teaching `StaffMember` (Accountant) |
| LMS | `Book`/`Chapter`/`Topic` per class/subject, `LessonPlan` (mix of draft/published, topics/free-form), `Assignment` + `AssignmentSubmission`, a few `Tag` rows |
| Attendance uploads | A few `AttendanceUpload` rows with distinct statuses and a marker `image_url` |

`seed_demo_portal.py`'s roster step also backfills each student's demographics (DOB, gender, blood group, address, admission number, guardian contact fields, placeholder `photo_url`) and adds a `StudentDocument` (Birth Certificate) — done there rather than in the showcase layer since it's roster-level data, not something `--reset` should ever touch.

Hostel, Library, Inventory, Transport, Admissions, Notifications, Parents, and Messaging are **not** covered by either seeder — those modules stay empty on the demo tenant until a follow-up seed is written for them.

## What must not change

Automated tests and phase scripts assume **SEED_TEST** School Alpha keeps its **three classes and ten students** in a stable order. The showcase seed **only adds related rows**; do not edit `seed_test_data.py` to add/remove those students when your goal is graph data.

## Reset scope

`--reset` only deletes the **time-rolling** rows that would otherwise leave stale entries behind as the anchor date ("today", clamped into the academic year) drifts forward across repeated runs:

- Manual `AttendanceRecord` rows for active students in the **last ~120 days** of the current academic year window. If you entered other manual attendance in that window on the same school, back it up first.
- `FeePayment`, `StaffAttendance`, and `Payslip` rows tagged with the internal seed marker.
- `AttendanceUpload` rows tagged with the seed marker `image_url`.
- `LeaveApplication` rows tied to the seeded "Casual Leave" policy.

Foundational setup rows (subjects, exam types, grade scales, fee structures, salary structures, lesson plans, assignments, books, etc.) are **not** deleted by `--reset` — they're kept correct in place by `get_or_create`/`update_or_create` on every run, so there's nothing to reset.

## Related: visitor demo email

When `DEMO_ACCESS_EMAIL_ENABLED` is set on the backend, successful demo form submissions also email login instructions to the visitor. See [`docs/ENV_AND_DEPLOYMENT.md`](ENV_AND_DEPLOYMENT.md) and [`LANDING_FORMS_EMAIL_IMPLEMENTATION_PLAN.md`](../LANDING_FORMS_EMAIL_IMPLEMENTATION_PLAN.md).
