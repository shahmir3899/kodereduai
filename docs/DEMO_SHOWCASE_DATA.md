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

Use this when the school **already** has classes, students, terms, and staff (e.g. **SEED_TEST** School Alpha id **37** after `seed_test_data.py`). It adds **only** `SHOWCASE_`-tagged rows for charts.

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

All named entities use the prefix **`SHOWCASE_`** (or a fixed marker string on rows without a name field) so `--reset` can delete them safely.

| Area | Content |
|------|---------|
| Academic sessions | `SessionClass` per master class; `StudentEnrollment` updated for current AY |
| Calendar | One short **off-day** window (`SHOWCASE_` name) |
| Attendance | ~45 weekdays of `AttendanceRecord` with `source=MANUAL` (present/absent mix), dates clamped to the current academic year |
| Finance | `MonthlyFeeCategory`, `Account`, `FeePayment` rows for five billing months (`notes` marker) |
| Examinations | `ExamType`, per-class `Exam`, `ExamSubject`, `StudentMark` |
| Academics | `Subject`, `TimetableSlot`, `TimetableEntry`, `ClassSubject` |
| HR | `LeavePolicy`, sample `LeaveApplication`, `StaffAttendance`, `Payslip` |
| Attendance uploads | A few `AttendanceUpload` rows with distinct statuses and a marker `image_url` |

## What must not change

Automated tests and phase scripts assume **SEED_TEST** School Alpha keeps its **three classes and ten students** in a stable order. The showcase seed **only adds related rows**; do not edit `seed_test_data.py` to add/remove those students when your goal is graph data.

## Reset scope

`--reset` deletes showcase-tagged rows for the school, including:

- Manual `AttendanceRecord` rows for active students in the **last ~120 days** of the current academic year window (to clear prior seed runs). If you entered other manual attendance in that window on the same school, back it up first.

## Related: visitor demo email

When `DEMO_ACCESS_EMAIL_ENABLED` is set on the backend, successful demo form submissions also email login instructions to the visitor. See [`docs/ENV_AND_DEPLOYMENT.md`](ENV_AND_DEPLOYMENT.md) and [`LANDING_FORMS_EMAIL_IMPLEMENTATION_PLAN.md`](../LANDING_FORMS_EMAIL_IMPLEMENTATION_PLAN.md).
