# Phase 5 — Known failures and side issues

Tracked during the student-storage cleanup (phases 1–4). None of these were caused by
that work. Every full-suite run was compared against this list, and no new failures appeared.
Fix them group by group in Phase 5. Report real app bugs before fixing them.

Full-suite command (from `backend/`):

```
python -m pytest tests academics admissions attendance core examinations finance lms messaging notifications parents schools students users --ignore=tests/test_whatsapp_delivery.py -q -p no:cacheprovider -rfE
```

Latest run (2026-09-25): 1327 passed, 100 failed, 12 errors, 18 skipped.

## Failing tests (112 = 100 failed + 12 setup errors)

| Group | Count | Notes |
|---|---|---|
| `tests/test_phase5_hr.py` | 25 | Staff, departments, designations, payslips, leave, appraisals; mostly school-B isolation and manager write access |
| `tests/test_phase15_admissions.py` | 24 | 12 are setup errors (`TestEnquiries`, `TestConversion`, `TestDocumentsAndNotes`); sessions, analytics, permissions |
| `tests/test_phase1_sessions.py` | 18 | Session health service, term import, term integrity validation, setup service, class subject/timetable create |
| `tests/test_fee_types.py` | 14 | `TestFeePaymentFeeType` (7), `TestGenerateOnetimeFees` (4), `TestFeeGenerationConflicts` (3) |
| `tests/test_transport_route_journey.py` | 7 | Driver journeys, my-vehicle, location update, capacity annotation |
| `tests/test_phase16_lms_curriculum.py` | 5 | AI retrieval, large-text stream chunking, teacher read-only books |
| `tests/test_phase6_examinations.py` | 5 | Publish, publish-all and its notifications, teacher-forbidden checks |
| `tests/test_phase12_lms.py` | 4 | Teacher create/update/delete permissions on lessons and assignments |
| `finance/test_account_snapshot_boundary.py` | 3 | Fee description text |
| `tests/test_phase2_notifications.py` | 2 | WhatsApp channel (deprecated feature); student report sections |
| `tests/test_report_historical_scope.py` | 1 | `test_student_comprehensive_...`: the test expects a `summary` key that the student report no longer returns, so the test is out of date |
| `tests/test_phase13_library.py` | 1 | A duplicate category name returns **500** on `/api/library/categories/` instead of a 400 (real app bug) |
| `tests/test_phase4_academics.py` | 1 | Class-subject soft delete |
| `tests/test_face_attendance_api.py` | 1 | Reprocess: the eager task fails inside the face pipeline |
| `tests/test_attendance_absence_notifications.py` | 1 | OCR confirm path (OCR is parked) |

Already fixed along the way: two annual-fee tests in `tests/test_fee_types.py` (`TestBulkFeeStructure::test_annual_student_override_by_category_used_in_generation`, `TestFeeGenerationConflicts::test_annual_generation_update_conflict_updates_existing_record`).

## Test-setup housekeeping

- Configure pytest so it doesn't collect the one-off root `backend/test_*.py` scripts or the deprecated WhatsApp test.
- The first test in a run spends about 48 s on test-DB setup. That setup time is normal; it isn't a slow test.

## Tests owed from Phase 4 stage 2 (built without tests at the user's request)

- **Students:**
  - class `student_count` from this year's enrollment (with the snapshot fallback);
  - `by_class` grouping;
  - study helper: section and year scoping of lessons, assignments and exams, plus the exam schedule limited to the student's own class.
- **Reports:**
  - attendance reports keep withdrawn students' earlier days;
  - defaulters sorted by the resolved class and roll;
  - student report takes holidays and lessons from the report year's class and own section.
- **academic_sessions:**
  - at-risk students limited to the year's enrollments, with section label, roll and off-day class;
  - promotion history roll from the source enrollment;
  - section allocator roll.
- **Notifications:**
  - parent absence digest roll from the cohort's enrollment;
  - class-teacher attendance reminder scoped via one enrollment subquery (section, class in the year, or current year);
  - AI assistant student class/roll from the current placement, class count from enrollments, assignment status limited to own section and current year;
  - `{{class_name}}` personalisation from the current section label.
- **Examinations:**
  - marks Excel template uses the exam roster (year, own section for section exams, year's rolls), no longer the snapshot class plus any-class enrollment;
  - academic at-risk limited to the year's enrollments with that year's label/roll;
  - mark rows' `student_roll_number` from the mark's enrollment;
  - report card roll fallbacks via the helper (`current_class` intentionally stays the snapshot = latest placement).
- **Academics analytics:**
  - subject-by-weekday, teacher effectiveness and monthly trends group records by the record-year placement (`annotate_record_placement`);
  - sections follow their own timetable plus unoverridden shared slots;
  - teacher rates per section for section entries;
  - trends labelled by section.
- **Parents and messaging:**
  - parent-child link `class_name` / `student_roll_number` from the current-year enrollment (bulk);
  - child overview and admin parents list from the current placement;
  - parent-to-teacher recipients no longer skip enrolled children whose snapshot class is empty.
- **Transport, hostel, lms, core:**
  - transport assignment/attendance, hostel allocation and gate pass, LMS submission rows: roll/class from the record-year (or current) enrollment via `serializer_placement`;
  - LMS submit validation checks the assignment-year enrollment's class and section (it used to block submissions right after promotion and ignored the section);
  - `core.permissions.teacher_has_student_access` master-class fallback uses the current placement.
- **Stage 3 (student API):**
  - `StudentSerializer` without an academic year returns class/section/roll from the current-year enrollment (bulk; also when nested, e.g. chronic absentees);
  - edit form: a partial update without class/roll leaves the enrollment alone, and the snapshot is re-synced to the latest enrollment after saving;
  - `class_id` list filter goes through the enrollment for the requested/current year;
  - roll search also matches the year's enrollment roll;
  - the year annotation picks the active/latest enrollment row.
- **Leaving safeguards (`academic_sessions/leaving.py`):**
  - Update Status: refuses a leaving date with attendance or marks on or after it. The response carries the full summary (counts, dates, exams, suggested date). With `remove_records_after_leaving` it backs the records up to `AdminActionLog`, deletes them, and moves the enrollment's `left_date` when only the date changes.
  - Attendance: bulk entry refuses students who had left by the date (and still allows back-fill before it); face writer skips them; the parked OCR confirm skips them; enrollments take `active_on`; ManualEntryPage passes the date.
  - Exams: `_exam_roster(for_entry=True)` drops departed students (Excel template); the results roster keeps a departed student only if they left after the exam started and have marks; marks create/update/bulk refuse departed students.
  - Marks Entry page: section-aware roster, and the grid is built from the roster merged with saved marks.
  - Drift: the `records_after_leaving` check.
- Add to this list every later module built without tests.

## Side issues noticed (not test failures)

- **Attendance anomalies** (`attendance/tasks.py`): bulk absence is counted per master class, and the streak details use the snapshot. Deferred until the feature is used; `AttendanceAnomaly.class_obj` is master-class only.
- **Face attendance**: still per master class. Deferred (CLASS_SYSTEM_GUIDE §4 item 11).
- **Timetable**: `bulk_save` deletes rows across years, and the session copy moves entries instead of copying them.
- **AI timetable tools** aren't section-aware.
- **Academics analytics** maps weekday to subject using timetable entries from every year, not the record's own year.
- `attendance/services.py` (parked OCR matching, deprecated WhatsApp alerts) still reads the snapshot. Nothing live imports it.
- **Manual attendance entry lists withdrawn students** (`ManualEntryPage.jsx` → `/api/sessions/enrollments/`, no active/left-date filter). Found 2026-09-25: Rayyan Abbas (Focus Branch 1, withdrew 1 Sep 2026) is offered for marking on 25 Sep. The register only includes him through September, the month he left.
- **Exam results vs marks entry disagree for students who left mid-month.** The results roster uses month-precision cutoffs, so Rayyan (left 1 Sep) is in the results for "1st Term Exam 2026-27 - Class 1" (started 14 Sep), with 6 blank or absent marks. The Marks Entry list (`is_active=true`) excludes him. Decide whether exam rosters should drop students whose `left_date` falls before the exam start date.
- **Marks Entry page ignores sections**: it lists students with `class_id` (master class) + year, so a section-only exam's grid shows every section's students.
