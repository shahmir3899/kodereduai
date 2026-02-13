# -*- coding: utf-8 -*-
"""
Phase 2 Comprehensive Test Script
==================================
Tests ALL Phase 2 features end-to-end without disturbing existing data.
Everything created here is cleaned up at the end (or on failure).

Usage:
    cd backend
    python manage.py shell -c "exec(open('test_phase2.py', encoding='utf-8').read())"

What it tests:
    T1: Notification Models (Template, Log, Preference, Config)
    T2: Notification Engine & Channels
    T3: Student Admission Fields & StudentDocument
    T4: Student Profile Endpoints (service-level)
    T5: Report Generators (attendance, fee, academic, student)
    T6: AI Student 360 Profile
    T7: AI Fee Collection Predictor
    T8: AI Notification Optimizer
    T9: Notification Triggers
    T10: Data Integrity (existing data untouched)
"""

import traceback
from datetime import date, time, timedelta
from decimal import Decimal
from django.utils import timezone

# --- Constants ---------------------------------------------------------------
SCHOOL_ID = 1  # The Focus Montessori Branch 1 (has real data)
TEST_PREFIX = "PHASE2_TEST_"  # All test objects use this prefix for easy cleanup

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
            obj_repr = repr(obj).encode('ascii', 'replace').decode('ascii')
            obj.delete()
            print(f"   Deleted: {obj_repr}")
        except Exception as e:
            err_msg = str(e).encode('ascii', 'replace').decode('ascii')
            print(f"   WARN: Failed to delete object: {err_msg}")
    print("[CLEANUP] Complete. No test data remains.\n")


def run_tests():
    from schools.models import School
    from students.models import Student, Class, StudentDocument
    from notifications.models import (
        NotificationTemplate, NotificationLog,
        NotificationPreference, SchoolNotificationConfig,
    )
    from reports.models import GeneratedReport
    from finance.models import FeePayment, FeeStructure
    from attendance.models import AttendanceRecord
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

    # Snapshot existing counts for integrity checks at the end
    orig_students_b1 = Student.objects.filter(school_id=SCHOOL_ID, is_active=True).exclude(name__startswith=TEST_PREFIX).count()
    orig_classes_b1 = Class.objects.filter(school_id=SCHOOL_ID).exclude(name__startswith=TEST_PREFIX).count()
    orig_branch2 = Student.objects.filter(school_id=2, is_active=True).count()

    # ==================================================================
    print("=" * 60)
    print("  PHASE 2 COMPREHENSIVE TEST SUITE")
    print(f"  School: {school.name} (id={school.id})")
    print(f"  Admin: {admin_user.username if admin_user else 'N/A'}")
    print("=" * 60)

    # Get a test student (existing, for read-only queries)
    test_student = Student.objects.filter(school_id=SCHOOL_ID, is_active=True).first()
    # Get a test class
    test_class = Class.objects.filter(school_id=SCHOOL_ID).first()

    # ==================================================================
    # T1: Notification Models
    # ==================================================================
    print("\n[T1] Notification Models")

    # NotificationTemplate
    tpl = track(NotificationTemplate.objects.create(
        school=school,
        name=f"{TEST_PREFIX}Absence Alert",
        event_type='ABSENCE',
        channel='IN_APP',
        subject_template='Absence: {{student_name}}',
        body_template='Dear parent, {{student_name}} of {{class_name}} was absent on {{date}}.',
        is_active=True,
    ))
    check("Create NotificationTemplate", tpl.id is not None, f"id={tpl.id}")
    check("Template event_type", tpl.event_type == 'ABSENCE')
    check("Template channel", tpl.channel == 'IN_APP')

    # Test template rendering
    rendered = tpl.render({
        'student_name': 'Ali Khan',
        'class_name': '5-A',
        'date': '2026-02-13',
    })
    check("Template render returns dict", isinstance(rendered, dict) and 'body' in rendered)
    check("Template render replaces placeholders", 'Ali Khan' in rendered.get('body', '') and '5-A' in rendered.get('body', ''))

    # System-wide template (no school)
    sys_tpl = track(NotificationTemplate.objects.create(
        school=None,
        name=f"{TEST_PREFIX}System Welcome",
        event_type='GENERAL',
        channel='IN_APP',
        body_template='Welcome to the school platform!',
        is_active=True,
    ))
    check("System-wide template (school=null)", sys_tpl.school is None)

    # NotificationLog
    log1 = track(NotificationLog.objects.create(
        school=school,
        template=tpl,
        channel='IN_APP',
        event_type='ABSENCE',
        recipient_type='PARENT',
        recipient_identifier='parent-test',
        recipient_user=admin_user,
        student=test_student,
        title=f"{TEST_PREFIX}Test Absence Alert",
        body='Test body message',
        status='PENDING',
    ))
    check("Create NotificationLog (PENDING)", log1.id is not None)
    check("Log linked to template", log1.template_id == tpl.id)
    check("Log linked to student", log1.student_id == test_student.id)

    # Update log status
    log1.status = 'SENT'
    log1.sent_at = timezone.now()
    log1.save()
    log1.refresh_from_db()
    check("Log status updated to SENT", log1.status == 'SENT')
    check("Log sent_at set", log1.sent_at is not None)

    log2 = track(NotificationLog.objects.create(
        school=school,
        channel='IN_APP',
        event_type='GENERAL',
        recipient_type='ADMIN',
        recipient_identifier='admin-test',
        recipient_user=admin_user,
        title=f"{TEST_PREFIX}General Notice",
        body='Test general notice',
        status='READ',
        read_at=timezone.now(),
    ))
    check("Create NotificationLog (READ)", log2.status == 'READ')

    log3 = track(NotificationLog.objects.create(
        school=school,
        channel='WHATSAPP',
        event_type='FEE_DUE',
        recipient_type='PARENT',
        recipient_identifier='+923001234567',
        title=f"{TEST_PREFIX}Fee Reminder",
        body='Your fee is due',
        status='FAILED',
        metadata={'error': 'Test error'},
    ))
    check("Create NotificationLog (FAILED)", log3.status == 'FAILED')
    check("Log metadata stored", log3.metadata.get('error') == 'Test error')

    # NotificationPreference (use get_or_create to avoid unique constraint issues)
    pref, pref_created = NotificationPreference.objects.get_or_create(
        school=school,
        user=admin_user,
        channel='IN_APP',
        event_type='ABSENCE',
        defaults={'is_enabled': True},
    )
    if pref_created:
        track(pref)
    check("NotificationPreference exists", pref.id is not None)
    check("Preference is_enabled", pref.is_enabled == True)

    # SchoolNotificationConfig
    config, created = SchoolNotificationConfig.objects.get_or_create(
        school=school,
        defaults={
            'whatsapp_enabled': True,
            'sms_enabled': False,
            'in_app_enabled': True,
            'fee_reminder_day': 5,
        }
    )
    if created:
        track(config)
    check("SchoolNotificationConfig exists", config.id is not None)
    check("Config in_app_enabled", config.in_app_enabled == True)

    # ==================================================================
    # T2: Notification Engine & Channels
    # ==================================================================
    print("\n[T2] Notification Engine & Channels")

    try:
        from notifications.engine import NotificationEngine

        engine = NotificationEngine(school)
        check("NotificationEngine instantiated", engine is not None)

        # Test in-app channel send
        result = engine.send(
            event_type='GENERAL',
            channel='IN_APP',
            context={'student_name': 'Test Student', 'class_name': 'Test Class'},
            recipient_identifier='test-engine',
            recipient_type='ADMIN',
            title=f"{TEST_PREFIX}Engine Test",
            body=f"{TEST_PREFIX}Engine test message",
            recipient_user=admin_user,
        )
        if result:
            track(result)
        check("Engine.send() returns NotificationLog", result is not None and hasattr(result, 'id'))

        # Test channel abstraction
        from notifications.channels.in_app import InAppChannel
        from notifications.channels.whatsapp import WhatsAppChannel
        from notifications.channels.sms import SMSChannel

        in_app = InAppChannel(school)
        whatsapp = WhatsAppChannel(school)
        sms = SMSChannel(school)
        check("InAppChannel instantiable", in_app is not None)
        check("WhatsAppChannel instantiable", whatsapp is not None)
        check("SMSChannel instantiable", sms is not None)
    except Exception as e:
        check("Notification Engine", False, str(e))
        traceback.print_exc()

    # ==================================================================
    # T3: Student Admission Fields & StudentDocument
    # ==================================================================
    print("\n[T3] Student Admission Fields & StudentDocument")

    # Create a test student with all new fields
    test_student_new = track(Student.objects.create(
        school=school,
        class_obj=test_class,
        name=f"{TEST_PREFIX}Ahmed Khan",
        roll_number='999',
        admission_number=f"{TEST_PREFIX}ADM-001",
        admission_date=date(2025, 4, 1),
        date_of_birth=date(2012, 5, 15),
        gender='M',
        blood_group='B+',
        address='123 Test Street, Islamabad',
        previous_school=f"{TEST_PREFIX}Previous School",
        parent_phone='+923001234567',
        parent_name='Test Parent',
        guardian_name='Test Guardian',
        guardian_relation='Father',
        guardian_phone='+923007654321',
        guardian_email='test@test.com',
        guardian_occupation='Engineer',
        guardian_address='Same as above',
        emergency_contact='+923009999999',
        status='ACTIVE',
        is_active=True,
    ))
    check("Create student with admission fields", test_student_new.id is not None)
    check("Student admission_number", test_student_new.admission_number == f"{TEST_PREFIX}ADM-001")
    check("Student date_of_birth", test_student_new.date_of_birth == date(2012, 5, 15))
    check("Student gender", test_student_new.gender == 'M')
    check("Student blood_group", test_student_new.blood_group == 'B+')
    check("Student guardian_name", test_student_new.guardian_name == 'Test Guardian')
    check("Student guardian_email", test_student_new.guardian_email == 'test@test.com')
    check("Student status", test_student_new.status == 'ACTIVE')

    # Verify existing students not affected (new fields should be blank/null)
    existing = Student.objects.filter(school_id=SCHOOL_ID, is_active=True).exclude(
        name__startswith=TEST_PREFIX
    ).first()
    if existing:
        check("Existing student admission_number is blank", existing.admission_number == '')
        check("Existing student gender is blank", existing.gender == '')
    else:
        check("Existing student found for field check", False, "No existing students")

    # StudentDocument
    doc = track(StudentDocument.objects.create(
        school=school,
        student=test_student_new,
        document_type='PHOTO',
        title=f"{TEST_PREFIX}Profile Photo",
        file_url='https://example.com/test-photo.jpg',
        uploaded_by=admin_user,
    ))
    check("Create StudentDocument", doc.id is not None)
    check("Document type", doc.document_type == 'PHOTO')
    check("Document linked to student", doc.student_id == test_student_new.id)

    doc2 = track(StudentDocument.objects.create(
        school=school,
        student=test_student_new,
        document_type='BIRTH_CERT',
        title=f"{TEST_PREFIX}Birth Certificate",
        file_url='https://example.com/test-cert.pdf',
        uploaded_by=admin_user,
    ))
    check("Create second StudentDocument", doc2.id is not None)
    docs_count = StudentDocument.objects.filter(student=test_student_new).count()
    check("Student has 2 documents", docs_count == 2)

    # ==================================================================
    # T4: Student Profile Endpoints (service-level)
    # ==================================================================
    print("\n[T4] Student Profile Summary (service-level)")

    try:
        # Test profile summary aggregation for existing student
        from django.db.models import Sum, Avg, Count

        s = test_student

        att_total = AttendanceRecord.objects.filter(student=s, school_id=SCHOOL_ID).count()
        att_present = AttendanceRecord.objects.filter(student=s, school_id=SCHOOL_ID, status='PRESENT').count()
        check("Attendance records queryable", att_total >= 0, f"total={att_total}")

        fee_agg = FeePayment.objects.filter(student=s, school_id=SCHOOL_ID).aggregate(
            total_due=Sum('amount_due'), total_paid=Sum('amount_paid')
        )
        check("Fee ledger queryable", True, f"due={fee_agg['total_due']}, paid={fee_agg['total_paid']}")

        # Test enrollment history query
        from academic_sessions.models import StudentEnrollment
        enrollments = StudentEnrollment.objects.filter(student=s).count()
        check("Enrollment history queryable", enrollments >= 0, f"count={enrollments}")

    except Exception as e:
        check("Student Profile queries", False, str(e))

    # ==================================================================
    # T5: Report Generators
    # ==================================================================
    print("\n[T5] Report Generators")

    try:
        # Test attendance daily report
        from reports.generators.attendance import DailyAttendanceReportGenerator
        gen = DailyAttendanceReportGenerator(school, {'date': str(date.today())})
        data = gen.get_data()
        check("Attendance daily report get_data()", isinstance(data, dict))
        check("Report has title", 'title' in data)
        check("Report has table_headers", 'table_headers' in data)

        # Test PDF generation
        pdf_bytes = gen.generate(format='PDF')
        check("Attendance PDF generated", pdf_bytes is not None and len(pdf_bytes) > 0, f"size={len(pdf_bytes)} bytes")

        # Test Excel generation
        xlsx_bytes = gen.generate(format='XLSX')
        check("Attendance Excel generated", xlsx_bytes is not None and len(xlsx_bytes) > 0, f"size={len(xlsx_bytes)} bytes")

    except Exception as e:
        check("Attendance report generator", False, str(e))
        traceback.print_exc()

    try:
        # Test fee collection report
        from reports.generators.fee import FeeCollectionReportGenerator
        gen = FeeCollectionReportGenerator(school, {'month': 1, 'year': 2026})
        data = gen.get_data()
        check("Fee collection report get_data()", isinstance(data, dict))

        pdf_bytes = gen.generate(format='PDF')
        check("Fee collection PDF generated", pdf_bytes is not None and len(pdf_bytes) > 0)

    except Exception as e:
        check("Fee collection report", False, str(e))
        traceback.print_exc()

    try:
        # Test fee defaulters report
        from reports.generators.fee import FeeDefaultersReportGenerator
        gen = FeeDefaultersReportGenerator(school, {})
        data = gen.get_data()
        check("Fee defaulters report get_data()", isinstance(data, dict))
    except Exception as e:
        check("Fee defaulters report", False, str(e))

    try:
        # Test student comprehensive report
        from reports.generators.student import StudentComprehensiveReportGenerator
        gen = StudentComprehensiveReportGenerator(school, {'student_id': test_student.id})
        data = gen.get_data()
        check("Student comprehensive report get_data()", isinstance(data, dict))
        check("Report has sections", 'sections' in data or 'title' in data)

        pdf_bytes = gen.generate(format='PDF')
        check("Student comprehensive PDF generated", pdf_bytes is not None and len(pdf_bytes) > 0)

    except Exception as e:
        check("Student comprehensive report", False, str(e))
        traceback.print_exc()

    try:
        # Test class result report (may need an exam_id; test gracefully)
        from reports.generators.academic import ClassResultReportGenerator
        gen = ClassResultReportGenerator(school, {})
        data = gen.get_data()
        check("Class result report get_data() (no exam)", isinstance(data, dict))
    except Exception as e:
        check("Class result report", False, str(e))

    # Save a GeneratedReport record
    try:
        report_rec = track(GeneratedReport.objects.create(
            school=school,
            report_type='ATTENDANCE_DAILY',
            title=f"{TEST_PREFIX}Test Report",
            parameters={'date': '2026-02-13'},
            format='PDF',
            generated_by=admin_user,
        ))
        check("GeneratedReport record saved", report_rec.id is not None)
    except Exception as e:
        check("GeneratedReport model", False, str(e))

    # ==================================================================
    # T6: AI Student 360 Profile
    # ==================================================================
    print("\n[T6] AI Student 360 Profile")

    try:
        from students.ai_service import Student360Service
        svc = Student360Service(SCHOOL_ID, test_student.id)
        profile = svc.generate_profile()

        check("Student360 returns dict", isinstance(profile, dict))
        check("Has overall_risk", 'overall_risk' in profile)
        check("Has risk_score", 'risk_score' in profile)
        check("Has attendance section", 'attendance' in profile)
        check("Has academic section", 'academic' in profile)
        check("Has financial section", 'financial' in profile)
        check("Has ai_summary", 'ai_summary' in profile)
        check("Has recommendations", 'recommendations' in profile)
        check("overall_risk is valid", profile['overall_risk'] in ('LOW', 'MEDIUM', 'HIGH'))
        check("risk_score is number", isinstance(profile['risk_score'], (int, float)))

        # Check sub-sections
        att = profile.get('attendance', {})
        check("Attendance has rate", 'rate' in att)
        check("Attendance has trend", 'trend' in att)
        check("Attendance has risk", 'risk' in att)

        fin = profile.get('financial', {})
        check("Financial has paid_rate", 'paid_rate' in fin)
        check("Financial has outstanding", 'outstanding' in fin)

    except Exception as e:
        check("Student 360 Service", False, str(e))
        traceback.print_exc()

    # ==================================================================
    # T7: AI Fee Collection Predictor
    # ==================================================================
    print("\n[T7] AI Fee Collection Predictor")

    try:
        from finance.fee_predictor_service import FeeCollectionPredictorService
        svc = FeeCollectionPredictorService(SCHOOL_ID)
        result = svc.predict_defaults()

        check("Predictor returns dict", isinstance(result, dict))
        check("Has target_period", 'target_period' in result)
        check("Has total_students", 'total_students' in result)
        check("Has at_risk_count", 'at_risk_count' in result)
        check("Has predictions list", 'predictions' in result and isinstance(result['predictions'], list))

        if result['predictions']:
            pred = result['predictions'][0]
            check("Prediction has student_name", 'student_name' in pred)
            check("Prediction has risk_level", 'risk_level' in pred)
            check("Prediction has default_probability", 'default_probability' in pred)
            check("Prediction has recommended_action", 'recommended_action' in pred)
            check("Risk level is valid", pred['risk_level'] in ('HIGH', 'MEDIUM', 'LOW'))
        else:
            check("Predictions list (empty is OK)", True, "No at-risk students found")

    except Exception as e:
        check("Fee Predictor Service", False, str(e))
        traceback.print_exc()

    # ==================================================================
    # T8: AI Notification Optimizer
    # ==================================================================
    print("\n[T8] AI Notification Optimizer")

    try:
        from notifications.ai_service import NotificationOptimizerService
        svc = NotificationOptimizerService(SCHOOL_ID)

        # Delivery analytics
        analytics = svc.get_delivery_analytics()
        check("Delivery analytics returns dict", isinstance(analytics, dict))
        check("Analytics has channels key", 'channels' in analytics)

        # Optimal send time
        optimal = svc.get_optimal_send_time()
        check("Optimal send time returns dict", isinstance(optimal, dict))
        check("Has best_hour", 'best_hour' in optimal)
        check("Has best_window", 'best_window' in optimal)
        check("best_hour is int", isinstance(optimal['best_hour'], int))

    except Exception as e:
        check("Notification Optimizer", False, str(e))
        traceback.print_exc()

    # ==================================================================
    # T9: Notification Triggers
    # ==================================================================
    print("\n[T9] Notification Triggers")

    try:
        from notifications.triggers import (
            trigger_absence_notification,
            trigger_fee_reminder,
            trigger_general,
        )

        # Test trigger_general (creates IN_APP notifications)
        if admin_user:
            trigger_general(
                school=school,
                title=f"{TEST_PREFIX}General Trigger Test",
                body=f"{TEST_PREFIX}This is a test trigger",
                recipient_users=[admin_user],
            )

            trigger_logs = NotificationLog.objects.filter(
                school=school,
                title=f"{TEST_PREFIX}General Trigger Test",
            )
            trigger_count = trigger_logs.count()
            check("trigger_general creates logs", trigger_count > 0, f"created {trigger_count} logs")

            # Track for cleanup
            for log in trigger_logs:
                track(log)

        # Test trigger_fee_reminder (won't actually send WhatsApp in test)
        # Just verify it doesn't crash
        try:
            trigger_fee_reminder(school, month=2, year=2026)
            check("trigger_fee_reminder runs without error", True)
        except Exception as e:
            check("trigger_fee_reminder", False, str(e))

    except Exception as e:
        check("Notification Triggers", False, str(e))
        traceback.print_exc()

    # ==================================================================
    # T10: Data Integrity
    # ==================================================================
    print("\n[T10] Verify existing data is untouched")

    final_students_b1 = Student.objects.filter(
        school_id=SCHOOL_ID, is_active=True
    ).exclude(name__startswith=TEST_PREFIX).count()
    check("Branch 1 original students intact", final_students_b1 == orig_students_b1,
          f"expected {orig_students_b1}, found {final_students_b1}")

    final_classes_b1 = Class.objects.filter(
        school_id=SCHOOL_ID
    ).exclude(name__startswith=TEST_PREFIX).count()
    check("Branch 1 original classes intact", final_classes_b1 == orig_classes_b1,
          f"expected {orig_classes_b1}, found {final_classes_b1}")

    final_branch2 = Student.objects.filter(school_id=2, is_active=True).count()
    check("Branch 2 students untouched", final_branch2 == orig_branch2,
          f"expected {orig_branch2}, found {final_branch2}")

    # ==================================================================
    # Summary
    # ==================================================================
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
    from notifications.models import NotificationTemplate, NotificationLog, NotificationPreference
    from students.models import Student, StudentDocument
    from reports.models import GeneratedReport

    remaining = 0
    remaining += NotificationTemplate.objects.filter(name__startswith=TEST_PREFIX).count()
    remaining += NotificationLog.objects.filter(title__startswith=TEST_PREFIX).count()
    remaining += Student.objects.filter(name__startswith=TEST_PREFIX).count()
    remaining += StudentDocument.objects.filter(title__startswith=TEST_PREFIX).count()
    remaining += GeneratedReport.objects.filter(title__startswith=TEST_PREFIX).count()

    if remaining == 0:
        print("[VERIFIED] Zero test artifacts remain in database.")
    else:
        print(f"[WARNING] {remaining} test artifacts still in database! Manual cleanup needed.")
