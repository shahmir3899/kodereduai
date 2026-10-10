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
- **Attendance register (screen + PDF):**
  - student API `left_date` (annotated year or current placement);
  - register shades Sundays/holidays from `calendar-entries/month-view`, shows a "Left <date>" band from the leaving day, an amber dot on unmarked past school days the class was marked, two-line weekday/day headers, and "N + M left" in the Students card;
  - the PDF does the same via `build_student_off_day_set`, with enrollment rolls sorted as numbers.
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

## Full-suite baseline 2026-10-10: one line per failing test

From `backend/` with `python -m pytest --continue-on-collection-errors -q -p no:cacheprovider`: **1810 passed, 113 failed, 30 errors, 21 skipped.**
None of these come from the 2026-10 speed work; the same tests fail on the code before it.
Notes: the `test_*.py` scripts in the backend root (`test_phase1.py`, `test_audit_trail_enforcement.py`, ...) are old one-off scripts, not tests: they touch the database on import (errors) or use fields that no longer exist (`School(code=...)`). Some `tests/` files resolve to `D:\Personal\smart-attendance`, an older copy of the project.

### `.py` (18)
- `test_apply_toc_fix` (setup error): collection failure
- `test_phase1` (setup error): collection failure
- `test_phase10_notifications` (setup error): collection failure
- `test_phase11_reports` (setup error): collection failure
- `test_phase12_lms` (setup error): collection failure
- `test_phase13_library` (setup error): collection failure
- `test_phase14_transport` (setup error): collection failure
- `test_phase15_admissions` (setup error): collection failure
- `test_phase17_inventory` (setup error): collection failure
- `test_phase18_attendance` (setup error): collection failure
- `test_phase19_schools` (setup error): collection failure
- `test_phase2` (setup error): collection failure
- `test_phase20_auth` (setup error): collection failure
- `test_phase21_user_conversion` (setup error): collection failure
- `test_phase5_hr` (setup error): collection failure
- `test_phase6_examinations` (setup error): collection failure
- `test_phase9_parents` (setup error): collection failure
- `tests.test_whatsapp_delivery` (setup error): collection failure

### `finance/test_account_snapshot_boundary/TestAccountSnapshotBoundary.py` (3)
- `test_annual_fee_description_falls_back_to_uncategorized`: AttributeError: 'WSGIRequest' object has no attribute 'query_params'
- `test_annual_fee_description_uses_category_name`: AttributeError: 'WSGIRequest' object has no attribute 'query_params'
- `test_monthly_fee_description_uses_month_and_year`: AttributeError: 'WSGIRequest' object has no attribute 'query_params'

### `test_audit_trail_enforcement/ExpenseAuditTrailTests.py` (3)
- `test_expense_recorded_by_requires_actual_user`: TypeError: School() got unexpected keyword arguments: 'code'
- `test_expense_with_recorded_by_saves`: TypeError: School() got unexpected keyword arguments: 'code'
- `test_expense_without_recorded_by_raises_error`: TypeError: School() got unexpected keyword arguments: 'code'

### `test_audit_trail_enforcement/OtherIncomeAuditTrailTests.py` (2)
- `test_other_income_with_recorded_by_saves`: TypeError: School() got unexpected keyword arguments: 'code'
- `test_other_income_without_recorded_by_raises_error`: TypeError: School() got unexpected keyword arguments: 'code'

### `test_audit_trail_enforcement/TransferAuditTrailTests.py` (2)
- `test_transfer_with_recorded_by_saves`: TypeError: School() got unexpected keyword arguments: 'code'
- `test_transfer_without_recorded_by_raises_error`: TypeError: School() got unexpected keyword arguments: 'code'

### `test_plan1_smoke.py` (3)
- `test_is_data_restricted_user_includes_principal`: TypeError: Organization() got unexpected keyword arguments: 'code'
- `test_principal_cannot_see_sensitive_expenses`: TypeError: Organization() got unexpected keyword arguments: 'code'
- `test_staff_cannot_see_sensitive_expenses`: TypeError: Organization() got unexpected keyword arguments: 'code'

### `tests/test_face_attendance_api/TestReprocess.py` (1)
- `test_reprocess_resets_and_dispatches`: AssertionError: assert 'FAILED' == 'PROCESSING'

### `tests/test_fee_types/TestFeePaymentFeeType.py` (7)
- `test_create_monthly_payment`: AssertionError: B1 Create MONTHLY payment: 400 b'{"monthly_category":["Monthly category is required for monthly fees."]}'
- `test_create_annual_payment_month_zero`: AssertionError: B2 Create ANNUAL: 400 b'{"annual_category":["Annual category is required for annual fees."]}'
- `test_filter_payments_by_fee_type`: AssertionError: B6 Expected at least 1 ANNUAL payment
- `test_unique_together_allows_different_fee_types`: AssertionError: B7 Create ANNUAL: 400 b'{"annual_category":["Annual category is required for annual fees."]}'
- `test_duplicate_same_fee_type_rejected`: AssertionError: B8 Duplicate expected 400/409/500: 201
- `test_default_fee_type_on_payment`: AssertionError: B9 Default: 400 b'{"monthly_category":["Monthly category is required for monthly fees."]}'
- `test_read_payment_has_display_field`: assert 0 >= 1

### `tests/test_fee_types/TestGenerateOnetimeFees.py` (4)
- `test_generate_admission_and_annual`: AssertionError: D1 Generate: 400 b'{"fee_types":["MONTHLY and ANNUAL generation require category selection. Use dedicated monthly/annual generation en
- `test_generate_skips_duplicates`: KeyError: 'created'
- `test_generate_no_structure_tracked`: KeyError: 'created'
- `test_generate_monthly_with_specific_month`: AssertionError: D5 Generate MONTHLY: 400

### `tests/test_fee_types/TestFeeGenerationConflicts.py` (3)
- `test_annual_generation_delete_recreate_replaces_record`: django.core.exceptions.ValidationError: ['Cannot record payment without: payment_date, account. amount_paid=3000.00 requires both payment_date and acc
- `test_monthly_generation_update_conflict_updates_existing_record`: django.core.exceptions.ValidationError: ['Cannot record payment without: payment_date, account. amount_paid=100.00 requires both payment_date and acco
- `test_monthly_generation_delete_recreate_replaces_record`: django.core.exceptions.ValidationError: ['Cannot record payment without: payment_date, account. amount_paid=100.00 requires both payment_date and acco

### `tests/test_phase12_lms/TestLessonPlans.py` (1)
- `test_teacher_cannot_create_lesson_plan`: AssertionError: Expected 403, got 201

### `tests/test_phase12_lms/TestAssignments.py` (1)
- `test_teacher_cannot_create_assignment`: AssertionError: Expected 403, got 400

### `tests/test_phase12_lms/TestPermissions.py` (2)
- `test_teacher_cannot_update_assignment`: AssertionError: Expected 403, got 404
- `test_teacher_cannot_delete_assignment`: AssertionError: Expected 403, got 404

### `tests/test_phase13_library/TestBookCategories.py` (1)
- `test_a3_duplicate_category_name_rejected`: django.db.utils.IntegrityError: UNIQUE constraint failed: library_bookcategory.school_id, library_bookcategory.name

### `tests/test_phase15_admissions/TestAdmissionSessions.py` (6)
- `test_admin_can_create_session`: AssertionError: A1 Create session failed: status=404
- `test_teacher_cannot_create_session`: AssertionError: A2 Teacher create session: status=404
- `test_list_sessions`: AssertionError: A3 List sessions: status=404
- `test_active_sessions`: AssertionError: A4 Active sessions: status=404
- `test_update_session`: AssertionError: A5 setup: create session failed
- `test_school_b_isolation_sessions`: AssertionError: A6 School B isolation: status=404

### `tests/test_phase15_admissions/TestEnquiries.py` (6)
- `test_admin_can_create_enquiry` (setup error): failed on setup with "assert 404 == 201
- `test_create_second_enquiry_without_session`: AssertionError: B2 Create second enquiry: status=400
- `test_list_enquiries` (setup error): failed on setup with "assert 404 == 201
- `test_retrieve_enquiry_detail` (setup error): failed on setup with "assert 404 == 201
- `test_filter_by_stage` (setup error): failed on setup with "assert 404 == 201
- `test_filter_by_source` (setup error): failed on setup with "assert 404 == 201

### `tests/test_phase15_admissions/TestConversion.py` (3)
- `test_update_stage_to_contacted` (setup error): failed on setup with "assert 404 == 201
- `test_update_stage_to_form_submitted` (setup error): failed on setup with "assert 404 == 201
- `test_convert_enquiry_to_student` (setup error): failed on setup with "assert 404 == 201

### `tests/test_phase15_admissions/TestDocumentsAndNotes.py` (4)
- `test_add_document` (setup error): failed on setup with "assert 404 == 201
- `test_list_documents` (setup error): failed on setup with "assert 404 == 201
- `test_add_note` (setup error): failed on setup with "assert 404 == 201
- `test_list_notes` (setup error): failed on setup with "assert 404 == 201

### `tests/test_phase15_admissions/TestAnalyticsAndFollowups.py` (3)
- `test_pipeline_analytics`: AssertionError: E1 Pipeline analytics: status=404
- `test_analytics_has_expected_fields`: AssertionError: E2 Analytics request failed
- `test_teacher_cannot_access_analytics`: AssertionError: E5 Teacher analytics: status=404

### `tests/test_phase15_admissions/TestPermissions.py` (2)
- `test_teacher_cannot_update_enquiry`: assert 404 == 201
- `test_teacher_cannot_delete_session`: assert 404 == 201

### `tests/test_phase16_lms_curriculum/TestPermissionsAndIsolation.py` (1)
- `test_teacher_read_only_books`: assert 201 == 403

### `tests/test_phase16_lms_curriculum/TestPhase5LargeTextReliability.py` (1)
- `test_stream_endpoint_custom_chunk_size_produces_multiple_chunks`: assert 400 == 200

### `tests/test_phase16_lms_curriculum/TestPhase6AIRetrieval.py` (3)
- `test_generate_exam_questions_no_matching_topics`: assert 202 == 400
- `test_generate_exam_questions_no_api_key_returns_503`: assert 202 == 503
- `test_generate_exam_questions_success`: assert 202 == 200

### `tests/test_phase1_sessions/TestTermImportAPI.py` (5)
- `test_import_preview_returns_expected_counts`: KeyError: 'admin_a'
- `test_import_apply_creates_terms`: KeyError: 'admin_a'
- `test_import_apply_update_mode_updates_existing_term`: KeyError: 'admin_a'
- `test_import_preview_rejects_same_source_and_target`: KeyError: 'admin_a'
- `test_import_apply_blocks_when_order_conflict_exists`: KeyError: 'admin_a'

### `tests/test_phase1_sessions/TestTermIntegrityValidation.py` (3)
- `test_create_term_blocks_duplicate_order`: KeyError: 'admin_a'
- `test_create_term_blocks_date_overlap`: KeyError: 'admin_a'
- `test_create_term_blocks_dates_outside_academic_year`: KeyError: 'admin_a'

### `tests/test_phase1_sessions/TestTimetableAndClassSubject.py` (2)
- `test_create_subject`: django.db.utils.IntegrityError: UNIQUE constraint failed: academics_subject.school_id, academics_subject.code
- `test_create_timetable_entry_with_academic_year`: django.db.utils.IntegrityError: UNIQUE constraint failed: academics_subject.school_id, academics_subject.code

### `tests/test_phase1_sessions/TestSessionHealthService.py` (6)
- `test_health_report_has_enrollment`: django.core.exceptions.ValidationError: ['Cannot record payment without: payment_date, account. amount_paid=5000 requires both payment_date and accoun
- `test_health_report_has_attendance`: django.core.exceptions.ValidationError: ['Cannot record payment without: payment_date, account. amount_paid=5000 requires both payment_date and accoun
- `test_health_report_has_fee_collection`: django.core.exceptions.ValidationError: ['Cannot record payment without: payment_date, account. amount_paid=5000 requires both payment_date and accoun
- `test_health_report_has_exam_performance`: django.core.exceptions.ValidationError: ['Cannot record payment without: payment_date, account. amount_paid=5000 requires both payment_date and accoun
- `test_health_report_has_ai_summary`: django.core.exceptions.ValidationError: ['Cannot record payment without: payment_date, account. amount_paid=5000 requires both payment_date and accoun
- `test_health_report_success_flag`: django.core.exceptions.ValidationError: ['Cannot record payment without: payment_date, account. amount_paid=5000 requires both payment_date and accoun

### `tests/test_phase1_sessions/TestSessionSetupService.py` (2)
- `test_setup_preview_has_fee_structures`: AssertionError: Preview should have 'fee_structures' key
- `test_setup_apply_fee_increase`: TypeError: SessionSetupService.generate_setup_preview() got an unexpected keyword argument 'fee_increase_percent'

### `tests/test_phase2_notifications/TestNotificationEngine.py` (1)
- `test_whatsapp_channel_instantiable`: ModuleNotFoundError: No module named 'notifications.channels.whatsapp'

### `tests/test_phase2_notifications/TestReportGenerators.py` (1)
- `test_student_comprehensive_report_has_sections`: AssertionError: Report should have sections or title

### `tests/test_phase4_academics/TestClassSubjectAssignments.py` (1)
- `test_c11_soft_delete_assignment`: AssertionError: C11 ClassSubject row should still exist

### `tests/test_phase5_hr/TestDepartmentsAPI.py` (4)
- `test_a2_create_department_manager`: AssertionError: A2 Create department (Manager)
- `test_a5_list_departments`: AttributeError: 'str' object has no attribute 'get'
- `test_a8_soft_delete_department`: AssertionError: A8b is_active=False
- `test_a9_school_b_isolation`: AttributeError: 'str' object has no attribute 'get'

### `tests/test_phase5_hr/TestDesignationsAPI.py` (3)
- `test_b6_list_designations`: AttributeError: 'str' object has no attribute 'get'
- `test_b7_filter_by_department`: AttributeError: 'str' object has no attribute 'get'
- `test_b10_school_b_isolation`: AttributeError: 'str' object has no attribute 'get'

### `tests/test_phase5_hr/TestStaffAPI.py` (5)
- `test_c2_create_staff_manager`: AssertionError: C2 Create staff member (Manager)
- `test_c6_list_staff_members`: AttributeError: 'str' object has no attribute 'get'
- `test_c8_filter_by_department`: AttributeError: 'str' object has no attribute 'get'
- `test_c10_filter_by_employment_type`: AttributeError: 'str' object has no attribute 'get'
- `test_c15_school_b_isolation`: AttributeError: 'str' object has no attribute 'get'

### `tests/test_phase5_hr/TestSalaryStructuresAPI.py` (1)
- `test_d10_school_b_isolation`: AssertionError: D10 School B isolation (empty)

### `tests/test_phase5_hr/TestPayslipsAPI.py` (3)
- `test_e4_bulk_generate_payslips`: AssertionError: E4 Bulk generate payslips created
- `test_e5_bulk_generate_skips_existing`: AssertionError: E5 Bulk generate skips existing count
- `test_e12_school_b_isolation`: AssertionError: E12 School B isolation (empty)

### `tests/test_phase5_hr/TestLeavePoliciesAPI.py` (2)
- `test_f4_list_policies`: AttributeError: 'str' object has no attribute 'get'
- `test_f7_school_b_isolation`: AttributeError: 'str' object has no attribute 'get'

### `tests/test_phase5_hr/TestLeaveApplicationsAPI.py` (1)
- `test_g11_school_b_isolation`: AssertionError: G11 School B isolation (empty)

### `tests/test_phase5_hr/TestStaffAttendanceAPI.py` (1)
- `test_h12_school_b_isolation`: AssertionError: H12 School B isolation (empty)

### `tests/test_phase5_hr/TestPerformanceAppraisalsAPI.py` (1)
- `test_i6_school_b_isolation`: AssertionError: I6 School B isolation (empty)

### `tests/test_phase5_hr/TestStaffQualificationsAPI.py` (1)
- `test_j8_school_b_isolation`: AssertionError: J8 School B isolation (empty)

### `tests/test_phase5_hr/TestStaffDocumentsAPI.py` (1)
- `test_k7_school_b_isolation`: AssertionError: K7 School B isolation (empty)

### `tests/test_phase5_hr/TestCrossCutting.py` (2)
- `test_l3_wrong_school_header_no_data`: AttributeError: 'str' object has no attribute 'get'
- `test_l4_manager_write_access`: AssertionError: L4 Manager write access

### `tests/test_phase6_examinations/TestExams.py` (1)
- `test_b11_publish_exam`: AssertionError: status=400

### `tests/test_phase6_examinations/TestExamGroupWizardAndPublishAll.py` (3)
- `test_g3_group_actions_teacher_forbidden`: AssertionError: status=200
- `test_g4_publish_all_sets_status_on_all_child_exams`: assert 0 == 2
- `test_g5_publish_all_notifies_admins_per_exam`: AssertionError: before=0 after=0

### `tests/test_phase6_examinations/TestDateSheetGrid.py` (1)
- `test_h5_pdf_download_teacher_forbidden`: AssertionError: status=200

### `tests/test_phase6_examinations/TestResultsAndReportCard.py` (2)
- `test_f3_class_summary`: AssertionError: status=404
- `test_f4_class_summary_stats_fields`: assert 404 == 200

### `tests/test_report_historical_scope.py` (1)
- `test_student_comprehensive_uses_historical_summary_class_and_roll`: KeyError: 'summary'

### `tests/test_transport_route_journey/TestCapacityAnnotation.py` (1)
- `test_total_capacity_on_route_list`: AssertionError: create vehicle failed: b'{"driver_name":["This field is required."],"driver_phone":["This field is required."]}'

### `tests/test_transport_route_journey/TestRouteJourneyDriver.py` (3)
- `test_driver_can_start_journey`: ImportError: cannot import name 'APIHelper' from 'conftest' (D:\personal\EducationAI\backend\lms\tests\conftest.py)
- `test_driver_can_end_journey`: ImportError: cannot import name 'APIHelper' from 'conftest' (D:\personal\EducationAI\backend\lms\tests\conftest.py)
- `test_cannot_start_duplicate_active_journey`: ImportError: cannot import name 'APIHelper' from 'conftest' (D:\personal\EducationAI\backend\lms\tests\conftest.py)

### `tests/test_transport_route_journey/TestLocationUpdate.py` (1)
- `test_update_location`: ImportError: cannot import name 'APIHelper' from 'conftest' (D:\personal\EducationAI\backend\lms\tests\conftest.py)

### `tests/test_transport_route_journey/TestMyVehicle.py` (2)
- `test_driver_gets_assigned_vehicle`: ImportError: cannot import name 'APIHelper' from 'conftest' (D:\personal\EducationAI\backend\lms\tests\conftest.py)
- `test_no_vehicle_returns_404`: ImportError: cannot import name 'APIHelper' from 'conftest' (D:\personal\EducationAI\backend\lms\tests\conftest.py)

### `test_apply_toc_e2e.py` (1)
- `test_apply_toc`: RuntimeError: Database access not allowed, use the "django_db" mark, or the "db" or "transactional_db" fixtures to enable it.

### `tests/test_student_snapshot_guard.py` (1)
- `test_no_new_student_snapshot_reads`: AssertionError: New reads of the Student.class_obj/roll_number snapshot. Use the enrollment (academic_sessions.roster) instead:

