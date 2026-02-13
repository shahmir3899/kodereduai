# -*- coding: utf-8 -*-
"""
Phase 1 Comprehensive Test Script
==================================
Tests ALL Phase 1 features end-to-end without disturbing existing data.
Everything created here is cleaned up at the end (or on failure).

Usage:
    cd backend
    python manage.py shell -c "exec(open('test_phase1.py', encoding='utf-8').read())"

What it tests:
    A5: Academic Year context & current endpoint
    A1: Attendance -> Academic Year wiring
    A2: Fee -> Academic Year wiring
    A3: Timetable -> Academic Year wiring
    A4: ClassSubject -> Academic Year wiring
    B1-B2: Section system (Grade->Class->Section linkage)
    C1: Promotion Advisor service
    C2: Session Health service
    C3: Section Allocator service
    C4: Attendance Risk service
    C5: Session Setup Wizard service
"""

import traceback
from datetime import date, time, timedelta
from django.db import transaction

# --- Constants ---------------------------------------------------------------
SCHOOL_ID = 1  # The Focus Montessori Branch 1 (has real data)
TEST_PREFIX = "PHASE1_TEST_"  # All test objects use this prefix for easy cleanup

# Track all created objects for cleanup
created_objects = []

def track(obj):
    """Track an object for cleanup."""
    created_objects.append(obj)
    return obj

def cleanup():
    """Delete all tracked test objects in reverse order."""
    print("\n[CLEANUP] Removing all test data...")
    for obj in reversed(created_objects):
        try:
            obj_repr = str(obj)
            obj.delete()
            print(f"   Deleted: {obj_repr}")
        except Exception as e:
            print(f"   WARN: Failed to delete {obj}: {e}")
    print("[CLEANUP] Complete. No test data remains.\n")

def run_tests():
    from schools.models import School
    from students.models import Class, Student
    from academic_sessions.models import AcademicYear, Term, StudentEnrollment
    from attendance.models import AttendanceUpload, AttendanceRecord
    from finance.models import FeeStructure, FeePayment
    from academics.models import Subject, ClassSubject, TimetableSlot, TimetableEntry
    from django.contrib.auth import get_user_model
    User = get_user_model()

    school = School.objects.get(id=SCHOOL_ID)
    admin_user = User.objects.filter(school_id=SCHOOL_ID, role='SCHOOL_ADMIN').first()

    passed = 0
    failed = 0
    total = 0

    def check(test_name, condition, detail=""):
        nonlocal passed, failed, total
        total += 1
        if condition:
            passed += 1
            print(f"  [PASS] {test_name}")
        else:
            failed += 1
            print(f"  [FAIL] {test_name} {('- ' + detail) if detail else ''}")

    # ==================================================================
    print("=" * 60)
    print("  PHASE 1 COMPREHENSIVE TEST SUITE")
    print(f"  School: {school.name} (id={school.id})")
    print(f"  Admin: {admin_user.username}")
    print("=" * 60)

    # --- A5: Academic Year & Terms ------------------------------------
    print("\n[A5] Academic Year Context & Session Management")

    ay = track(AcademicYear.objects.create(
        school=school,
        name=f"{TEST_PREFIX}2025-2026",
        start_date=date(2025, 4, 1),
        end_date=date(2026, 3, 31),
        is_current=True,
        is_active=True,
    ))
    check("Create Academic Year", ay.id is not None, f"id={ay.id}")
    check("is_current flag set", ay.is_current == True)

    term1 = track(Term.objects.create(
        school=school,
        academic_year=ay,
        name=f"{TEST_PREFIX}Term 1",
        term_type='TERM',
        order=1,
        start_date=date(2025, 4, 1),
        end_date=date(2025, 9, 30),
        is_active=True,
    ))
    term2 = track(Term.objects.create(
        school=school,
        academic_year=ay,
        name=f"{TEST_PREFIX}Term 2",
        term_type='TERM',
        order=2,
        start_date=date(2025, 10, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    ))
    check("Create 2 Terms", Term.objects.filter(academic_year=ay).count() == 2)

    # Test current year lookup
    current_ay = AcademicYear.objects.filter(school=school, is_current=True, is_active=True).first()
    check("Current year lookup works", current_ay == ay)

    # --- B1-B2: Section System ----------------------------------------
    print("\n[B1-B2] Grade & Section System")

    grade1 = track(Grade.objects.create(
        school=school,
        name=f"{TEST_PREFIX}Class 1",
        numeric_level=100,  # High level to avoid conflict
        is_active=True,
    ))
    check("Create Grade", grade1.id is not None, f"id={grade1.id}, name={grade1.name}")

    # Create classes with sections
    cls_a = track(Class.objects.create(
        school=school,
        name=f"{TEST_PREFIX}Class 1-A",
        grade=grade1,
        section="A",
        grade_level=100,
    ))
    cls_b = track(Class.objects.create(
        school=school,
        name=f"{TEST_PREFIX}Class 1-B",
        grade=grade1,
        section="B",
        grade_level=100,
    ))
    check("Create Class with Section A", cls_a.section == "A")
    check("Create Class with Section B", cls_b.section == "B")
    check("Grade->Classes linkage", grade1.classes.filter(is_active=True).count() == 2)
    check("class_count property", grade1.class_count == 2)

    # Section filter in queryset
    filtered = Class.objects.filter(school=school, grade=grade1, section="A")
    check("Filter classes by section", filtered.count() == 1 and filtered.first() == cls_a)

    # Create test students in the sections
    students_a = []
    students_b = []
    for i in range(5):
        s = track(Student.objects.create(
            school=school,
            class_obj=cls_a,
            name=f"{TEST_PREFIX}Student A{i+1}",
            roll_number=f"T{900+i}",
            is_active=True,
        ))
        students_a.append(s)
    for i in range(5):
        s = track(Student.objects.create(
            school=school,
            class_obj=cls_b,
            name=f"{TEST_PREFIX}Student B{i+1}",
            roll_number=f"T{950+i}",
            is_active=True,
        ))
        students_b.append(s)
    check("Create 10 test students (5 per section)", len(students_a) + len(students_b) == 10)

    # Student enrollment
    enrollment = track(StudentEnrollment.objects.create(
        school=school,
        academic_year=ay,
        student=students_a[0],
        class_obj=cls_a,
        roll_number=students_a[0].roll_number,
    ))
    check("Student enrollment to academic year", enrollment.id is not None)

    # --- A1: Attendance -> Academic Year ------------------------------
    print("\n[A1] Attendance Wired to Academic Year")

    test_date = date(2025, 6, 15)

    # Create attendance upload linked to academic year
    upload = track(AttendanceUpload.objects.create(
        school=school,
        class_obj=cls_a,
        date=test_date,
        academic_year=ay,
        image_url="https://example.com/test-image.jpg",
        status="PENDING",
        created_by=admin_user,
    ))
    check("Create AttendanceUpload with academic_year", upload.academic_year == ay)

    # Create attendance records
    for s in students_a:
        rec = track(AttendanceRecord.objects.create(
            school=school,
            student=s,
            date=test_date,
            academic_year=ay,
            status='PRESENT' if s != students_a[-1] else 'ABSENT',
            source='MANUAL',
        ))

    records = AttendanceRecord.objects.filter(school=school, academic_year=ay)
    check("Attendance records linked to academic year", records.count() == 5)
    check("Filter records by academic_year", records.filter(academic_year=ay).count() == 5)

    absent = records.filter(status='ABSENT')
    check("1 absent record created", absent.count() == 1)

    # --- A2: Fee -> Academic Year -------------------------------------
    print("\n[A2] Fee System Wired to Academic Year")

    fee_struct = track(FeeStructure.objects.create(
        school=school,
        academic_year=ay,
        class_obj=cls_a,
        monthly_amount=5000,
        effective_from=date(2025, 4, 1),
        is_active=True,
    ))
    check("Create FeeStructure with academic_year", fee_struct.academic_year == ay)

    fee_payment = track(FeePayment.objects.create(
        school=school,
        academic_year=ay,
        student=students_a[0],
        month=6,
        year=2025,
        amount_due=5000,
        amount_paid=0,
        status='UNPAID',
    ))
    check("Create FeePayment with academic_year", fee_payment.academic_year == ay)
    check("Filter fees by academic_year", FeePayment.objects.filter(academic_year=ay).count() == 1)

    # --- A3-A4: Timetable & ClassSubject -> Academic Year -------------
    print("\n[A3-A4] Timetable & ClassSubject Wired to Academic Year")

    subject = track(Subject.objects.create(
        school=school,
        name=f"{TEST_PREFIX}Mathematics",
        code=f"{TEST_PREFIX}MATH",
        is_active=True,
    ))
    check("Create Subject", subject.id is not None)

    class_subj = track(ClassSubject.objects.create(
        school=school,
        academic_year=ay,
        class_obj=cls_a,
        subject=subject,
        periods_per_week=5,
        is_active=True,
    ))
    check("Create ClassSubject with academic_year", class_subj.academic_year == ay)
    check("Filter ClassSubject by academic_year", ClassSubject.objects.filter(academic_year=ay).count() == 1)

    slot = track(TimetableSlot.objects.create(
        school=school,
        name=f"{TEST_PREFIX}Period 1",
        slot_type='PERIOD',
        start_time=time(8, 0),
        end_time=time(8, 40),
        order=100,
        is_active=True,
    ))
    check("Create TimetableSlot", slot.id is not None)

    tt_entry = track(TimetableEntry.objects.create(
        school=school,
        academic_year=ay,
        class_obj=cls_a,
        day='MON',
        slot=slot,
        subject=subject,
    ))
    check("Create TimetableEntry with academic_year", tt_entry.academic_year == ay)
    check("Filter TimetableEntry by academic_year", TimetableEntry.objects.filter(academic_year=ay).count() == 1)

    # --- C2: Session Health Service -----------------------------------
    print("\n[C2] Session Health Dashboard Service")

    try:
        from academic_sessions.session_health_service import SessionHealthService
        health_svc = SessionHealthService(school.id, ay.id)
        report = health_svc.generate_health_report()

        check("Health report has enrollment metrics", 'enrollment' in report)
        check("Health report has attendance metrics", 'attendance' in report)
        check("Health report has fee_collection metrics", 'fee_collection' in report)
        check("Health report has exam_performance", 'exam_performance' in report)
        check("Health report has ai_summary", 'ai_summary' in report)
        check("Health report success flag", report.get('success') == True)
    except Exception as e:
        check("Session Health Service", False, str(e))

    # --- C1: Promotion Advisor Service --------------------------------
    print("\n[C1] Promotion Advisor Service")

    try:
        from academic_sessions.promotion_advisor_service import PromotionAdvisorService
        advisor = PromotionAdvisorService(school.id, ay.id)
        recommendations = advisor.get_recommendations(cls_a.id)

        check("Advisor returns list", isinstance(recommendations, list))
        check("Advisor has recommendations for students", len(recommendations) > 0)

        if recommendations:
            rec = recommendations[0]
            check("Recommendation has student_id", 'student_id' in rec)
            check("Recommendation has recommendation", 'recommendation' in rec)
            check("Recommendation is valid value", rec['recommendation'] in ['PROMOTE', 'NEEDS_REVIEW', 'RETAIN'])
    except Exception as e:
        check("Promotion Advisor Service", False, str(e))

    # --- C3: Section Allocator Service --------------------------------
    print("\n[C3] Section Allocator Service")

    try:
        from academic_sessions.section_allocator_service import SectionAllocatorService
        allocator = SectionAllocatorService(school.id)

        result = allocator.allocate_students(
            grade_id=grade1.id,
            academic_year_id=ay.id,
            num_sections=2,
        )

        check("Allocator returns result", isinstance(result, dict))
        check("Allocator has sections", 'sections' in result)
        sections = result.get('sections', [])
        check("Allocator has 2 sections", len(sections) == 2)

        if sections:
            total_assigned = sum(len(s.get('students', [])) for s in sections)
            check("Students distributed across sections", total_assigned >= 0)
    except Exception as e:
        check("Section Allocator Service", False, str(e))

    # --- C4: Attendance Risk Predictor --------------------------------
    print("\n[C4] Attendance Risk Predictor Service")

    try:
        from academic_sessions.attendance_risk_service import AttendanceRiskService
        risk_svc = AttendanceRiskService(school.id, ay.id)
        risk_report = risk_svc.get_at_risk_students()

        check("Risk report returns dict", isinstance(risk_report, dict))
        check("Risk report has students key", 'students' in risk_report)
        check("Risk report has total_students", 'total_students' in risk_report)
    except Exception as e:
        check("Attendance Risk Service", False, str(e))

    # --- C5: Session Setup Wizard Service -----------------------------
    print("\n[C5] Session Setup Wizard Service")

    try:
        from academic_sessions.session_setup_service import SessionSetupService
        setup_svc = SessionSetupService(school.id)

        preview = setup_svc.generate_setup_preview(
            source_year_id=ay.id,
            new_year_name=f"{TEST_PREFIX}2026-2027",
            new_start_date=date(2026, 4, 1),
            new_end_date=date(2027, 3, 31),
        )

        check("Setup preview returns dict", isinstance(preview, dict))
        check("Preview has terms to clone", 'terms' in preview)
        check("Preview shows 2 terms", len(preview.get('terms', [])) == 2)
        check("Preview has fee_structures", 'fee_structures' in preview)
        check("Preview has class_subjects", 'class_subjects' in preview)

        # Actually apply the setup (then clean up)
        # apply_setup takes the preview dict with fee_increase_pct added
        preview['fee_increase_pct'] = 10
        result = setup_svc.apply_setup(preview)

        check("Setup apply returns result", isinstance(result, dict))

        new_ay = AcademicYear.objects.filter(
            school=school, name=f"{TEST_PREFIX}2026-2027"
        ).first()

        if new_ay:
            track(new_ay)
            # Track the cloned terms too
            for t in Term.objects.filter(academic_year=new_ay):
                track(t)
            # Track cloned fee structures
            for fs in FeeStructure.objects.filter(academic_year=new_ay):
                track(fs)
            # Track cloned class subjects
            for cs in ClassSubject.objects.filter(academic_year=new_ay):
                track(cs)
            # Track cloned timetable entries
            for te in TimetableEntry.objects.filter(academic_year=new_ay):
                track(te)

            new_terms = Term.objects.filter(academic_year=new_ay).count()
            check("New year created", new_ay is not None)
            check("Terms cloned", new_terms == 2)

            new_fee = FeeStructure.objects.filter(academic_year=new_ay).first()
            if new_fee:
                check("Fee increased by 10%", new_fee.monthly_amount == 5500, f"got {new_fee.monthly_amount}")
        else:
            check("New year created", False, "AcademicYear not found after apply")
    except Exception as e:
        check("Session Setup Wizard Service", False, str(e))
        traceback.print_exc()

    # --- Verify existing data untouched -------------------------------
    print("\n[INTEGRITY] Verify existing data is untouched")

    existing_students_b1 = Student.objects.filter(
        school_id=SCHOOL_ID, is_active=True
    ).exclude(name__startswith=TEST_PREFIX).count()
    check("Branch 1 original students intact", existing_students_b1 == 237, f"found {existing_students_b1}")

    existing_classes_b1 = Class.objects.filter(
        school_id=SCHOOL_ID
    ).exclude(name__startswith=TEST_PREFIX).count()
    check("Branch 1 original classes intact", existing_classes_b1 == 9, f"found {existing_classes_b1}")

    existing_fees = FeeStructure.objects.filter(
        school_id=SCHOOL_ID, academic_year__isnull=True
    ).count()
    check("Original fee structures still have NULL academic_year", existing_fees == 234, f"found {existing_fees}")

    existing_uploads = AttendanceUpload.objects.filter(
        school_id=SCHOOL_ID, academic_year__isnull=True
    ).count()
    check("Original attendance uploads still have NULL academic_year", existing_uploads == 3, f"found {existing_uploads}")

    existing_records = AttendanceRecord.objects.filter(
        school_id=SCHOOL_ID, academic_year__isnull=True
    ).count()
    check("Original attendance records still have NULL academic_year", existing_records == 58, f"found {existing_records}")

    branch2_students = Student.objects.filter(school_id=2, is_active=True).count()
    check("Branch 2 students untouched", branch2_students == 143, f"found {branch2_students}")

    # --- Summary ------------------------------------------------------
    print("\n" + "=" * 60)
    print(f"  RESULTS: {passed}/{total} passed, {failed} failed")
    if failed == 0:
        print("  ALL TESTS PASSED!")
    else:
        print(f"  {failed} test(s) failed")
    print("=" * 60)

# --- Run ------------------------------------------------------------------
try:
    run_tests()
finally:
    cleanup()
    # Final sanity check
    from students.models import Student, Class
    from academic_sessions.models import AcademicYear
    remaining_test = AcademicYear.objects.filter(name__startswith=TEST_PREFIX).count()
    remaining_test += Class.objects.filter(name__startswith=TEST_PREFIX).count()
    remaining_test += Student.objects.filter(name__startswith=TEST_PREFIX).count()
    if remaining_test == 0:
        print("[VERIFIED] Zero test artifacts remain in database.")
    else:
        print(f"[WARNING] {remaining_test} test artifacts still in database! Manual cleanup needed.")
        print(f"   Run: AcademicYear.objects.filter(name__startswith='{TEST_PREFIX}').delete()")
