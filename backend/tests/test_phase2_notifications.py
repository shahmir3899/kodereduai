# -*- coding: utf-8 -*-
"""
Phase 2 Pytest Test Suite
=========================
Tests ALL Phase 2 features using proper pytest conventions.

Covers:
    - Notification Models (Template, Log, Preference, Config)
    - Notification Engine & Channels
    - Student Admission Fields & StudentDocument
    - Student Profile Summary (service-level)
    - Report Generators (attendance, fee, academic, student)
    - AI Student 360 Profile
    - AI Fee Collection Predictor
    - AI Notification Optimizer
    - Notification Triggers
    - Data Integrity
"""

from datetime import date
from decimal import Decimal

import pytest
from django.utils import timezone


# ---------------------------------------------------------------------------
# T1: Notification Models
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.phase2
class TestNotificationTemplates:

    def test_create_notification_template(self, seed_data, api):
        from notifications.models import NotificationTemplate

        school = seed_data['school_a']
        prefix = seed_data['prefix']

        tpl = NotificationTemplate.objects.create(
            school=school,
            name=f"{prefix}Absence Alert",
            event_type='ABSENCE',
            channel='IN_APP',
            subject_template='Absence: {{student_name}}',
            body_template='Dear parent, {{student_name}} of {{class_name}} was absent on {{date}}.',
            is_active=True,
        )
        assert tpl.id is not None, "Template should be created with an id"

    def test_template_event_type(self, seed_data, api):
        from notifications.models import NotificationTemplate

        school = seed_data['school_a']
        prefix = seed_data['prefix']

        tpl = NotificationTemplate.objects.create(
            school=school,
            name=f"{prefix}Absence Alert EventType",
            event_type='ABSENCE',
            channel='IN_APP',
            body_template='Test body',
            is_active=True,
        )
        assert tpl.event_type == 'ABSENCE', "Template event_type should be ABSENCE"

    def test_template_channel(self, seed_data, api):
        from notifications.models import NotificationTemplate

        school = seed_data['school_a']
        prefix = seed_data['prefix']

        tpl = NotificationTemplate.objects.create(
            school=school,
            name=f"{prefix}Absence Alert Channel",
            event_type='ABSENCE',
            channel='IN_APP',
            body_template='Test body',
            is_active=True,
        )
        assert tpl.channel == 'IN_APP', "Template channel should be IN_APP"

    def test_template_render_returns_dict(self, seed_data, api):
        from notifications.models import NotificationTemplate

        school = seed_data['school_a']
        prefix = seed_data['prefix']

        tpl = NotificationTemplate.objects.create(
            school=school,
            name=f"{prefix}Render Test",
            event_type='ABSENCE',
            channel='IN_APP',
            subject_template='Absence: {{student_name}}',
            body_template='Dear parent, {{student_name}} of {{class_name}} was absent on {{date}}.',
            is_active=True,
        )
        rendered = tpl.render({
            'student_name': 'Ali Khan',
            'class_name': '5-A',
            'date': '2026-02-13',
        })
        assert isinstance(rendered, dict), "Template render should return a dict"
        assert 'body' in rendered, "Rendered dict should contain 'body' key"

    def test_template_render_replaces_placeholders(self, seed_data, api):
        from notifications.models import NotificationTemplate

        school = seed_data['school_a']
        prefix = seed_data['prefix']

        tpl = NotificationTemplate.objects.create(
            school=school,
            name=f"{prefix}Render Placeholder Test",
            event_type='ABSENCE',
            channel='IN_APP',
            subject_template='Absence: {{student_name}}',
            body_template='Dear parent, {{student_name}} of {{class_name}} was absent on {{date}}.',
            is_active=True,
        )
        rendered = tpl.render({
            'student_name': 'Ali Khan',
            'class_name': '5-A',
            'date': '2026-02-13',
        })
        assert 'Ali Khan' in rendered.get('body', ''), "Rendered body should contain student name"
        assert '5-A' in rendered.get('body', ''), "Rendered body should contain class name"

    def test_system_wide_template(self, seed_data, api):
        from notifications.models import NotificationTemplate

        prefix = seed_data['prefix']

        sys_tpl = NotificationTemplate.objects.create(
            school=None,
            name=f"{prefix}System Welcome",
            event_type='GENERAL',
            channel='IN_APP',
            body_template='Welcome to the school platform!',
            is_active=True,
        )
        assert sys_tpl.school is None, "System-wide template should have school=None"


@pytest.mark.django_db
@pytest.mark.phase2
class TestNotificationLogs:

    def test_create_notification_log_pending(self, seed_data, api):
        from notifications.models import NotificationTemplate, NotificationLog

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']
        test_student = seed_data['students'][0]

        tpl = NotificationTemplate.objects.create(
            school=school,
            name=f"{prefix}Log Template",
            event_type='ABSENCE',
            channel='IN_APP',
            body_template='Test',
            is_active=True,
        )

        log = NotificationLog.objects.create(
            school=school,
            template=tpl,
            channel='IN_APP',
            event_type='ABSENCE',
            recipient_type='PARENT',
            recipient_identifier='parent-test',
            recipient_user=admin_user,
            student=test_student,
            title=f"{prefix}Test Absence Alert",
            body='Test body message',
            status='PENDING',
        )
        assert log.id is not None, "NotificationLog should be created with an id"

    def test_log_linked_to_template(self, seed_data, api):
        from notifications.models import NotificationTemplate, NotificationLog

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']
        test_student = seed_data['students'][0]

        tpl = NotificationTemplate.objects.create(
            school=school,
            name=f"{prefix}Log Link Template",
            event_type='ABSENCE',
            channel='IN_APP',
            body_template='Test',
            is_active=True,
        )
        log = NotificationLog.objects.create(
            school=school,
            template=tpl,
            channel='IN_APP',
            event_type='ABSENCE',
            recipient_type='PARENT',
            recipient_identifier='parent-test',
            recipient_user=admin_user,
            student=test_student,
            title=f"{prefix}Link Test",
            body='Test body message',
            status='PENDING',
        )
        assert log.template_id == tpl.id, "Log should be linked to template"

    def test_log_linked_to_student(self, seed_data, api):
        from notifications.models import NotificationLog

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']
        test_student = seed_data['students'][0]

        log = NotificationLog.objects.create(
            school=school,
            channel='IN_APP',
            event_type='ABSENCE',
            recipient_type='PARENT',
            recipient_identifier='parent-test',
            recipient_user=admin_user,
            student=test_student,
            title=f"{prefix}Student Link Test",
            body='Test body message',
            status='PENDING',
        )
        assert log.student_id == test_student.id, "Log should be linked to student"

    def test_log_status_update_to_sent(self, seed_data, api):
        from notifications.models import NotificationLog

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']

        log = NotificationLog.objects.create(
            school=school,
            channel='IN_APP',
            event_type='ABSENCE',
            recipient_type='PARENT',
            recipient_identifier='parent-test',
            recipient_user=admin_user,
            title=f"{prefix}Status Update Test",
            body='Test body message',
            status='PENDING',
        )
        log.status = 'SENT'
        log.sent_at = timezone.now()
        log.save()
        log.refresh_from_db()
        assert log.status == 'SENT', "Log status should be updated to SENT"

    def test_log_sent_at_set(self, seed_data, api):
        from notifications.models import NotificationLog

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']

        log = NotificationLog.objects.create(
            school=school,
            channel='IN_APP',
            event_type='ABSENCE',
            recipient_type='PARENT',
            recipient_identifier='parent-test',
            recipient_user=admin_user,
            title=f"{prefix}SentAt Test",
            body='Test body message',
            status='PENDING',
        )
        log.status = 'SENT'
        log.sent_at = timezone.now()
        log.save()
        log.refresh_from_db()
        assert log.sent_at is not None, "Log sent_at should be set"

    def test_create_notification_log_read(self, seed_data, api):
        from notifications.models import NotificationLog

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']

        log = NotificationLog.objects.create(
            school=school,
            channel='IN_APP',
            event_type='GENERAL',
            recipient_type='ADMIN',
            recipient_identifier='admin-test',
            recipient_user=admin_user,
            title=f"{prefix}General Notice",
            body='Test general notice',
            status='READ',
            read_at=timezone.now(),
        )
        assert log.status == 'READ', "Log status should be READ"

    def test_create_notification_log_failed(self, seed_data, api):
        from notifications.models import NotificationLog

        school = seed_data['school_a']
        prefix = seed_data['prefix']

        log = NotificationLog.objects.create(
            school=school,
            channel='WHATSAPP',
            event_type='FEE_DUE',
            recipient_type='PARENT',
            recipient_identifier='+923001234567',
            title=f"{prefix}Fee Reminder",
            body='Your fee is due',
            status='FAILED',
            metadata={'error': 'Test error'},
        )
        assert log.status == 'FAILED', "Log status should be FAILED"

    def test_log_metadata_stored(self, seed_data, api):
        from notifications.models import NotificationLog

        school = seed_data['school_a']
        prefix = seed_data['prefix']

        log = NotificationLog.objects.create(
            school=school,
            channel='WHATSAPP',
            event_type='FEE_DUE',
            recipient_type='PARENT',
            recipient_identifier='+923001234567',
            title=f"{prefix}Fee Reminder Metadata",
            body='Your fee is due',
            status='FAILED',
            metadata={'error': 'Test error'},
        )
        assert log.metadata.get('error') == 'Test error', "Log metadata should store error"


@pytest.mark.django_db
@pytest.mark.phase2
class TestNotificationPreferences:

    def test_notification_preference_exists(self, seed_data, api):
        from notifications.models import NotificationPreference

        school = seed_data['school_a']
        admin_user = seed_data['users']['admin']

        pref, _ = NotificationPreference.objects.get_or_create(
            school=school,
            user=admin_user,
            channel='IN_APP',
            event_type='ABSENCE',
            defaults={'is_enabled': True},
        )
        assert pref.id is not None, "NotificationPreference should exist"

    def test_notification_preference_is_enabled(self, seed_data, api):
        from notifications.models import NotificationPreference

        school = seed_data['school_a']
        admin_user = seed_data['users']['admin']

        pref, _ = NotificationPreference.objects.get_or_create(
            school=school,
            user=admin_user,
            channel='IN_APP',
            event_type='ABSENCE',
            defaults={'is_enabled': True},
        )
        assert pref.is_enabled is True, "Preference is_enabled should be True"


@pytest.mark.django_db
@pytest.mark.phase2
class TestSchoolNotificationConfig:

    def test_school_notification_config_exists(self, seed_data, api):
        from notifications.models import SchoolNotificationConfig

        school = seed_data['school_a']

        config, _ = SchoolNotificationConfig.objects.get_or_create(
            school=school,
            defaults={
                'whatsapp_enabled': True,
                'sms_enabled': False,
                'in_app_enabled': True,
                'fee_reminder_day': 5,
            },
        )
        assert config.id is not None, "SchoolNotificationConfig should exist"

    def test_school_notification_config_in_app_enabled(self, seed_data, api):
        from notifications.models import SchoolNotificationConfig

        school = seed_data['school_a']

        config, _ = SchoolNotificationConfig.objects.get_or_create(
            school=school,
            defaults={
                'whatsapp_enabled': True,
                'sms_enabled': False,
                'in_app_enabled': True,
                'fee_reminder_day': 5,
            },
        )
        assert config.in_app_enabled is True, "Config in_app_enabled should be True"


# ---------------------------------------------------------------------------
# T2: Notification Engine & Channels
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.phase2
class TestNotificationEngine:

    def test_engine_instantiation(self, seed_data, api):
        from notifications.engine import NotificationEngine

        school = seed_data['school_a']
        engine = NotificationEngine(school)
        assert engine is not None, "NotificationEngine should be instantiated"

    def test_engine_send_returns_log(self, seed_data, api):
        from notifications.engine import NotificationEngine

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']

        engine = NotificationEngine(school)
        result = engine.send(
            event_type='GENERAL',
            channel='IN_APP',
            context={'student_name': 'Test Student', 'class_name': 'Test Class'},
            recipient_identifier='test-engine',
            recipient_type='ADMIN',
            title=f"{prefix}Engine Test",
            body=f"{prefix}Engine test message",
            recipient_user=admin_user,
        )
        assert result is not None, "Engine.send() should return a result"
        assert hasattr(result, 'id'), "Engine.send() should return a NotificationLog"

    def test_in_app_channel_instantiable(self, seed_data, api):
        from notifications.channels.in_app import InAppChannel

        school = seed_data['school_a']
        in_app = InAppChannel(school)
        assert in_app is not None, "InAppChannel should be instantiable"

    def test_whatsapp_channel_instantiable(self, seed_data, api):
        from notifications.channels.whatsapp import WhatsAppChannel

        school = seed_data['school_a']
        whatsapp = WhatsAppChannel(school)
        assert whatsapp is not None, "WhatsAppChannel should be instantiable"

    def test_sms_channel_instantiable(self, seed_data, api):
        from notifications.channels.sms import SMSChannel

        school = seed_data['school_a']
        sms = SMSChannel(school)
        assert sms is not None, "SMSChannel should be instantiable"


# ---------------------------------------------------------------------------
# T3: Student Admission Fields & StudentDocument
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.phase2
class TestStudentAdmissionFields:

    def test_create_student_with_admission_fields(self, seed_data, api):
        from students.models import Student

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        test_class = seed_data['classes'][0]

        student = Student.objects.create(
            school=school,
            class_obj=test_class,
            name=f"{prefix}Ahmed Khan",
            roll_number='999',
            admission_number=f"{prefix}ADM-001",
            admission_date=date(2025, 4, 1),
            date_of_birth=date(2012, 5, 15),
            gender='M',
            blood_group='B+',
            address='123 Test Street, Islamabad',
            previous_school=f"{prefix}Previous School",
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
        )
        assert student.id is not None, "Student with admission fields should be created"

    def test_student_admission_number(self, seed_data, api):
        from students.models import Student

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        test_class = seed_data['classes'][0]

        student = Student.objects.create(
            school=school,
            class_obj=test_class,
            name=f"{prefix}AdmNum Student",
            roll_number='998',
            admission_number=f"{prefix}ADM-002",
            status='ACTIVE',
            is_active=True,
        )
        assert student.admission_number == f"{prefix}ADM-002", "Student admission_number should match"

    def test_student_date_of_birth(self, seed_data, api):
        from students.models import Student

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        test_class = seed_data['classes'][0]

        student = Student.objects.create(
            school=school,
            class_obj=test_class,
            name=f"{prefix}DOB Student",
            roll_number='997',
            date_of_birth=date(2012, 5, 15),
            status='ACTIVE',
            is_active=True,
        )
        assert student.date_of_birth == date(2012, 5, 15), "Student date_of_birth should match"

    def test_student_gender(self, seed_data, api):
        from students.models import Student

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        test_class = seed_data['classes'][0]

        student = Student.objects.create(
            school=school,
            class_obj=test_class,
            name=f"{prefix}Gender Student",
            roll_number='996',
            gender='M',
            status='ACTIVE',
            is_active=True,
        )
        assert student.gender == 'M', "Student gender should be M"

    def test_student_blood_group(self, seed_data, api):
        from students.models import Student

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        test_class = seed_data['classes'][0]

        student = Student.objects.create(
            school=school,
            class_obj=test_class,
            name=f"{prefix}BloodGroup Student",
            roll_number='995',
            blood_group='B+',
            status='ACTIVE',
            is_active=True,
        )
        assert student.blood_group == 'B+', "Student blood_group should be B+"

    def test_student_guardian_name(self, seed_data, api):
        from students.models import Student

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        test_class = seed_data['classes'][0]

        student = Student.objects.create(
            school=school,
            class_obj=test_class,
            name=f"{prefix}Guardian Student",
            roll_number='994',
            guardian_name='Test Guardian',
            status='ACTIVE',
            is_active=True,
        )
        assert student.guardian_name == 'Test Guardian', "Student guardian_name should match"

    def test_student_guardian_email(self, seed_data, api):
        from students.models import Student

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        test_class = seed_data['classes'][0]

        student = Student.objects.create(
            school=school,
            class_obj=test_class,
            name=f"{prefix}GuardianEmail Student",
            roll_number='993',
            guardian_email='test@test.com',
            status='ACTIVE',
            is_active=True,
        )
        assert student.guardian_email == 'test@test.com', "Student guardian_email should match"

    def test_student_status_active(self, seed_data, api):
        from students.models import Student

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        test_class = seed_data['classes'][0]

        student = Student.objects.create(
            school=school,
            class_obj=test_class,
            name=f"{prefix}Status Student",
            roll_number='992',
            status='ACTIVE',
            is_active=True,
        )
        assert student.status == 'ACTIVE', "Student status should be ACTIVE"

    def test_existing_student_admission_number_is_blank(self, seed_data, api):
        """Verify that seed_data students (created without admission fields) have blank defaults."""
        existing = seed_data['students'][0]
        assert existing.admission_number == '', "Existing student admission_number should be blank"

    def test_existing_student_gender_is_blank(self, seed_data, api):
        """Verify that seed_data students (created without gender) have blank defaults."""
        existing = seed_data['students'][0]
        assert existing.gender == '', "Existing student gender should be blank"


@pytest.mark.django_db
@pytest.mark.phase2
class TestStudentDocuments:

    def test_create_student_document(self, seed_data, api):
        from students.models import StudentDocument

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']
        test_student = seed_data['students'][0]

        doc = StudentDocument.objects.create(
            school=school,
            student=test_student,
            document_type='PHOTO',
            title=f"{prefix}Profile Photo",
            file_url='https://example.com/test-photo.jpg',
            uploaded_by=admin_user,
        )
        assert doc.id is not None, "StudentDocument should be created"

    def test_document_type(self, seed_data, api):
        from students.models import StudentDocument

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']
        test_student = seed_data['students'][0]

        doc = StudentDocument.objects.create(
            school=school,
            student=test_student,
            document_type='PHOTO',
            title=f"{prefix}Photo Type Test",
            file_url='https://example.com/test-photo.jpg',
            uploaded_by=admin_user,
        )
        assert doc.document_type == 'PHOTO', "Document type should be PHOTO"

    def test_document_linked_to_student(self, seed_data, api):
        from students.models import StudentDocument

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']
        test_student = seed_data['students'][0]

        doc = StudentDocument.objects.create(
            school=school,
            student=test_student,
            document_type='PHOTO',
            title=f"{prefix}Link Test Doc",
            file_url='https://example.com/test-photo.jpg',
            uploaded_by=admin_user,
        )
        assert doc.student_id == test_student.id, "Document should be linked to student"

    def test_student_has_multiple_documents(self, seed_data, api):
        from students.models import StudentDocument

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']
        test_student = seed_data['students'][0]

        StudentDocument.objects.create(
            school=school,
            student=test_student,
            document_type='PHOTO',
            title=f"{prefix}Multi Doc 1",
            file_url='https://example.com/test-photo.jpg',
            uploaded_by=admin_user,
        )
        StudentDocument.objects.create(
            school=school,
            student=test_student,
            document_type='BIRTH_CERT',
            title=f"{prefix}Multi Doc 2",
            file_url='https://example.com/test-cert.pdf',
            uploaded_by=admin_user,
        )
        docs_count = StudentDocument.objects.filter(
            student=test_student,
            title__startswith=prefix,
        ).count()
        assert docs_count == 2, "Student should have 2 documents"


# ---------------------------------------------------------------------------
# T4: Student Profile Summary (service-level)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.phase2
class TestStudentProfileSummary:

    def test_attendance_records_queryable(self, seed_data, api):
        from attendance.models import AttendanceRecord

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        att_total = AttendanceRecord.objects.filter(
            student=test_student, school_id=school.id,
        ).count()
        assert att_total >= 0, "Attendance records should be queryable"

    def test_fee_ledger_queryable(self, seed_data, api):
        from django.db.models import Sum
        from finance.models import FeePayment

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        fee_agg = FeePayment.objects.filter(
            student=test_student, school_id=school.id,
        ).aggregate(
            total_due=Sum('amount_due'),
            total_paid=Sum('amount_paid'),
        )
        # Aggregation should succeed even if no payments exist
        assert True, "Fee ledger should be queryable"

    def test_enrollment_history_queryable(self, seed_data, api):
        from academic_sessions.models import StudentEnrollment

        test_student = seed_data['students'][0]

        enrollments = StudentEnrollment.objects.filter(student=test_student).count()
        assert enrollments >= 0, "Enrollment history should be queryable"


# ---------------------------------------------------------------------------
# T5: Report Generators
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.phase2
class TestReportGenerators:

    def test_attendance_daily_report_get_data(self, seed_data, api):
        from reports.generators.attendance import DailyAttendanceReportGenerator

        school = seed_data['school_a']
        gen = DailyAttendanceReportGenerator(school, {'date': str(date.today())})
        data = gen.get_data()
        assert isinstance(data, dict), "Attendance daily report get_data() should return dict"

    def test_attendance_daily_report_has_title(self, seed_data, api):
        from reports.generators.attendance import DailyAttendanceReportGenerator

        school = seed_data['school_a']
        gen = DailyAttendanceReportGenerator(school, {'date': str(date.today())})
        data = gen.get_data()
        assert 'title' in data, "Report should have title"

    def test_attendance_daily_report_has_table_headers(self, seed_data, api):
        from reports.generators.attendance import DailyAttendanceReportGenerator

        school = seed_data['school_a']
        gen = DailyAttendanceReportGenerator(school, {'date': str(date.today())})
        data = gen.get_data()
        assert 'table_headers' in data, "Report should have table_headers"

    def test_attendance_pdf_generated(self, seed_data, api):
        from reports.generators.attendance import DailyAttendanceReportGenerator

        school = seed_data['school_a']
        gen = DailyAttendanceReportGenerator(school, {'date': str(date.today())})
        pdf_bytes = gen.generate(format='PDF')
        assert pdf_bytes is not None, "Attendance PDF should be generated"
        assert len(pdf_bytes) > 0, "Attendance PDF should have content"

    def test_attendance_excel_generated(self, seed_data, api):
        from reports.generators.attendance import DailyAttendanceReportGenerator

        school = seed_data['school_a']
        gen = DailyAttendanceReportGenerator(school, {'date': str(date.today())})
        xlsx_bytes = gen.generate(format='XLSX')
        assert xlsx_bytes is not None, "Attendance Excel should be generated"
        assert len(xlsx_bytes) > 0, "Attendance Excel should have content"

    def test_fee_collection_report_get_data(self, seed_data, api):
        from reports.generators.fee import FeeCollectionReportGenerator

        school = seed_data['school_a']
        gen = FeeCollectionReportGenerator(school, {'month': 1, 'year': 2026})
        data = gen.get_data()
        assert isinstance(data, dict), "Fee collection report get_data() should return dict"

    def test_fee_collection_pdf_generated(self, seed_data, api):
        from reports.generators.fee import FeeCollectionReportGenerator

        school = seed_data['school_a']
        gen = FeeCollectionReportGenerator(school, {'month': 1, 'year': 2026})
        pdf_bytes = gen.generate(format='PDF')
        assert pdf_bytes is not None, "Fee collection PDF should be generated"
        assert len(pdf_bytes) > 0, "Fee collection PDF should have content"

    def test_fee_defaulters_report_get_data(self, seed_data, api):
        from reports.generators.fee import FeeDefaultersReportGenerator

        school = seed_data['school_a']
        gen = FeeDefaultersReportGenerator(school, {})
        data = gen.get_data()
        assert isinstance(data, dict), "Fee defaulters report get_data() should return dict"

    def test_student_comprehensive_report_get_data(self, seed_data, api):
        from reports.generators.student import StudentComprehensiveReportGenerator

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        gen = StudentComprehensiveReportGenerator(school, {'student_id': test_student.id})
        data = gen.get_data()
        assert isinstance(data, dict), "Student comprehensive report get_data() should return dict"

    def test_student_comprehensive_report_has_sections(self, seed_data, api):
        from reports.generators.student import StudentComprehensiveReportGenerator

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        gen = StudentComprehensiveReportGenerator(school, {'student_id': test_student.id})
        data = gen.get_data()
        assert 'sections' in data or 'title' in data, "Report should have sections or title"

    def test_student_comprehensive_pdf_generated(self, seed_data, api):
        from reports.generators.student import StudentComprehensiveReportGenerator

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        gen = StudentComprehensiveReportGenerator(school, {'student_id': test_student.id})
        pdf_bytes = gen.generate(format='PDF')
        assert pdf_bytes is not None, "Student comprehensive PDF should be generated"
        assert len(pdf_bytes) > 0, "Student comprehensive PDF should have content"

    def test_class_result_report_get_data(self, seed_data, api):
        from reports.generators.academic import ClassResultReportGenerator

        school = seed_data['school_a']
        gen = ClassResultReportGenerator(school, {})
        data = gen.get_data()
        assert isinstance(data, dict), "Class result report get_data() should return dict"

    def test_generated_report_record_saved(self, seed_data, api):
        from reports.models import GeneratedReport

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']

        report_rec = GeneratedReport.objects.create(
            school=school,
            report_type='ATTENDANCE_DAILY',
            title=f"{prefix}Test Report",
            parameters={'date': '2026-02-13'},
            format='PDF',
            generated_by=admin_user,
        )
        assert report_rec.id is not None, "GeneratedReport record should be saved"


# ---------------------------------------------------------------------------
# T6: AI Student 360 Profile
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.phase2
class TestAIStudent360Profile:

    def test_student360_returns_dict(self, seed_data, api):
        from students.ai_service import Student360Service

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        svc = Student360Service(school.id, test_student.id)
        profile = svc.generate_profile()
        assert isinstance(profile, dict), "Student360 should return a dict"

    def test_student360_has_overall_risk(self, seed_data, api):
        from students.ai_service import Student360Service

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        svc = Student360Service(school.id, test_student.id)
        profile = svc.generate_profile()
        assert 'overall_risk' in profile, "Profile should have overall_risk"

    def test_student360_has_risk_score(self, seed_data, api):
        from students.ai_service import Student360Service

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        svc = Student360Service(school.id, test_student.id)
        profile = svc.generate_profile()
        assert 'risk_score' in profile, "Profile should have risk_score"

    def test_student360_has_attendance_section(self, seed_data, api):
        from students.ai_service import Student360Service

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        svc = Student360Service(school.id, test_student.id)
        profile = svc.generate_profile()
        assert 'attendance' in profile, "Profile should have attendance section"

    def test_student360_has_academic_section(self, seed_data, api):
        from students.ai_service import Student360Service

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        svc = Student360Service(school.id, test_student.id)
        profile = svc.generate_profile()
        assert 'academic' in profile, "Profile should have academic section"

    def test_student360_has_financial_section(self, seed_data, api):
        from students.ai_service import Student360Service

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        svc = Student360Service(school.id, test_student.id)
        profile = svc.generate_profile()
        assert 'financial' in profile, "Profile should have financial section"

    def test_student360_has_ai_summary(self, seed_data, api):
        from students.ai_service import Student360Service

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        svc = Student360Service(school.id, test_student.id)
        profile = svc.generate_profile()
        assert 'ai_summary' in profile, "Profile should have ai_summary"

    def test_student360_has_recommendations(self, seed_data, api):
        from students.ai_service import Student360Service

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        svc = Student360Service(school.id, test_student.id)
        profile = svc.generate_profile()
        assert 'recommendations' in profile, "Profile should have recommendations"

    def test_student360_overall_risk_is_valid(self, seed_data, api):
        from students.ai_service import Student360Service

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        svc = Student360Service(school.id, test_student.id)
        profile = svc.generate_profile()
        assert profile['overall_risk'] in ('LOW', 'MEDIUM', 'HIGH'), \
            "overall_risk should be LOW, MEDIUM, or HIGH"

    def test_student360_risk_score_is_number(self, seed_data, api):
        from students.ai_service import Student360Service

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        svc = Student360Service(school.id, test_student.id)
        profile = svc.generate_profile()
        assert isinstance(profile['risk_score'], (int, float)), \
            "risk_score should be a number"

    def test_student360_attendance_has_rate(self, seed_data, api):
        from students.ai_service import Student360Service

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        svc = Student360Service(school.id, test_student.id)
        profile = svc.generate_profile()
        att = profile.get('attendance', {})
        assert 'rate' in att, "Attendance section should have rate"

    def test_student360_attendance_has_trend(self, seed_data, api):
        from students.ai_service import Student360Service

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        svc = Student360Service(school.id, test_student.id)
        profile = svc.generate_profile()
        att = profile.get('attendance', {})
        assert 'trend' in att, "Attendance section should have trend"

    def test_student360_attendance_has_risk(self, seed_data, api):
        from students.ai_service import Student360Service

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        svc = Student360Service(school.id, test_student.id)
        profile = svc.generate_profile()
        att = profile.get('attendance', {})
        assert 'risk' in att, "Attendance section should have risk"

    def test_student360_financial_has_paid_rate(self, seed_data, api):
        from students.ai_service import Student360Service

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        svc = Student360Service(school.id, test_student.id)
        profile = svc.generate_profile()
        fin = profile.get('financial', {})
        assert 'paid_rate' in fin, "Financial section should have paid_rate"

    def test_student360_financial_has_outstanding(self, seed_data, api):
        from students.ai_service import Student360Service

        school = seed_data['school_a']
        test_student = seed_data['students'][0]

        svc = Student360Service(school.id, test_student.id)
        profile = svc.generate_profile()
        fin = profile.get('financial', {})
        assert 'outstanding' in fin, "Financial section should have outstanding"


# ---------------------------------------------------------------------------
# T7: AI Fee Collection Predictor
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.phase2
class TestAIFeeCollectionPredictor:

    def test_predictor_returns_dict(self, seed_data, api):
        from finance.fee_predictor_service import FeeCollectionPredictorService

        school = seed_data['school_a']
        svc = FeeCollectionPredictorService(school.id)
        result = svc.predict_defaults()
        assert isinstance(result, dict), "Predictor should return a dict"

    def test_predictor_has_target_period(self, seed_data, api):
        from finance.fee_predictor_service import FeeCollectionPredictorService

        school = seed_data['school_a']
        svc = FeeCollectionPredictorService(school.id)
        result = svc.predict_defaults()
        assert 'target_period' in result, "Result should have target_period"

    def test_predictor_has_total_students(self, seed_data, api):
        from finance.fee_predictor_service import FeeCollectionPredictorService

        school = seed_data['school_a']
        svc = FeeCollectionPredictorService(school.id)
        result = svc.predict_defaults()
        assert 'total_students' in result, "Result should have total_students"

    def test_predictor_has_at_risk_count(self, seed_data, api):
        from finance.fee_predictor_service import FeeCollectionPredictorService

        school = seed_data['school_a']
        svc = FeeCollectionPredictorService(school.id)
        result = svc.predict_defaults()
        assert 'at_risk_count' in result, "Result should have at_risk_count"

    def test_predictor_has_predictions_list(self, seed_data, api):
        from finance.fee_predictor_service import FeeCollectionPredictorService

        school = seed_data['school_a']
        svc = FeeCollectionPredictorService(school.id)
        result = svc.predict_defaults()
        assert 'predictions' in result, "Result should have predictions"
        assert isinstance(result['predictions'], list), "predictions should be a list"

    def test_prediction_entry_has_student_name(self, seed_data, api):
        from finance.fee_predictor_service import FeeCollectionPredictorService

        school = seed_data['school_a']
        svc = FeeCollectionPredictorService(school.id)
        result = svc.predict_defaults()
        if result['predictions']:
            pred = result['predictions'][0]
            assert 'student_name' in pred, "Prediction should have student_name"
        else:
            # Empty predictions list is acceptable (no at-risk students)
            assert True, "No at-risk students found (empty predictions is OK)"

    def test_prediction_entry_has_risk_level(self, seed_data, api):
        from finance.fee_predictor_service import FeeCollectionPredictorService

        school = seed_data['school_a']
        svc = FeeCollectionPredictorService(school.id)
        result = svc.predict_defaults()
        if result['predictions']:
            pred = result['predictions'][0]
            assert 'risk_level' in pred, "Prediction should have risk_level"

    def test_prediction_entry_has_default_probability(self, seed_data, api):
        from finance.fee_predictor_service import FeeCollectionPredictorService

        school = seed_data['school_a']
        svc = FeeCollectionPredictorService(school.id)
        result = svc.predict_defaults()
        if result['predictions']:
            pred = result['predictions'][0]
            assert 'default_probability' in pred, "Prediction should have default_probability"

    def test_prediction_entry_has_recommended_action(self, seed_data, api):
        from finance.fee_predictor_service import FeeCollectionPredictorService

        school = seed_data['school_a']
        svc = FeeCollectionPredictorService(school.id)
        result = svc.predict_defaults()
        if result['predictions']:
            pred = result['predictions'][0]
            assert 'recommended_action' in pred, "Prediction should have recommended_action"

    def test_prediction_risk_level_is_valid(self, seed_data, api):
        from finance.fee_predictor_service import FeeCollectionPredictorService

        school = seed_data['school_a']
        svc = FeeCollectionPredictorService(school.id)
        result = svc.predict_defaults()
        if result['predictions']:
            pred = result['predictions'][0]
            assert pred['risk_level'] in ('HIGH', 'MEDIUM', 'LOW'), \
                "Risk level should be HIGH, MEDIUM, or LOW"


# ---------------------------------------------------------------------------
# T8: AI Notification Optimizer
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.phase2
class TestAINotificationOptimizer:

    def test_delivery_analytics_returns_dict(self, seed_data, api):
        from notifications.ai_service import NotificationOptimizerService

        school = seed_data['school_a']
        svc = NotificationOptimizerService(school.id)
        analytics = svc.get_delivery_analytics()
        assert isinstance(analytics, dict), "Delivery analytics should return a dict"

    def test_delivery_analytics_has_channels(self, seed_data, api):
        from notifications.ai_service import NotificationOptimizerService

        school = seed_data['school_a']
        svc = NotificationOptimizerService(school.id)
        analytics = svc.get_delivery_analytics()
        assert 'channels' in analytics, "Analytics should have channels key"

    def test_optimal_send_time_returns_dict(self, seed_data, api):
        from notifications.ai_service import NotificationOptimizerService

        school = seed_data['school_a']
        svc = NotificationOptimizerService(school.id)
        optimal = svc.get_optimal_send_time()
        assert isinstance(optimal, dict), "Optimal send time should return a dict"

    def test_optimal_send_time_has_best_hour(self, seed_data, api):
        from notifications.ai_service import NotificationOptimizerService

        school = seed_data['school_a']
        svc = NotificationOptimizerService(school.id)
        optimal = svc.get_optimal_send_time()
        assert 'best_hour' in optimal, "Optimal result should have best_hour"

    def test_optimal_send_time_has_best_window(self, seed_data, api):
        from notifications.ai_service import NotificationOptimizerService

        school = seed_data['school_a']
        svc = NotificationOptimizerService(school.id)
        optimal = svc.get_optimal_send_time()
        assert 'best_window' in optimal, "Optimal result should have best_window"

    def test_optimal_send_time_best_hour_is_int(self, seed_data, api):
        from notifications.ai_service import NotificationOptimizerService

        school = seed_data['school_a']
        svc = NotificationOptimizerService(school.id)
        optimal = svc.get_optimal_send_time()
        assert isinstance(optimal['best_hour'], int), "best_hour should be an int"


# ---------------------------------------------------------------------------
# T9: Notification Triggers
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.phase2
class TestNotificationTriggers:

    def test_trigger_general_creates_logs(self, seed_data, api):
        from notifications.models import NotificationLog
        from notifications.triggers import trigger_general

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']

        trigger_general(
            school=school,
            title=f"{prefix}General Trigger Test",
            body=f"{prefix}This is a test trigger",
            recipient_users=[admin_user],
        )

        trigger_count = NotificationLog.objects.filter(
            school=school,
            title=f"{prefix}General Trigger Test",
        ).count()
        assert trigger_count > 0, "trigger_general should create notification logs"

    def test_trigger_fee_reminder_runs_without_error(self, seed_data, api):
        from notifications.triggers import trigger_fee_reminder

        school = seed_data['school_a']

        # Should not raise an exception even without real WhatsApp config
        trigger_fee_reminder(school, month=2, year=2026)
        assert True, "trigger_fee_reminder should run without error"


# ---------------------------------------------------------------------------
# T10: Data Integrity
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.phase2
class TestDataIntegrity:

    def test_school_a_students_intact(self, seed_data, api):
        """Verify that no extra students leak into school_a beyond what seed_data created."""
        from students.models import Student

        prefix = seed_data['prefix']
        school_a = seed_data['school_a']
        expected_count = len(seed_data['students'])

        actual_count = Student.objects.filter(
            school=school_a,
            is_active=True,
            name__startswith=prefix,
        ).count()
        assert actual_count == expected_count, (
            f"School A should have {expected_count} seeded students, found {actual_count}"
        )

    def test_school_b_students_untouched(self, seed_data, api):
        """Verify that school_b has no students (none were seeded for it)."""
        from students.models import Student

        school_b = seed_data['school_b']
        count = Student.objects.filter(school=school_b, is_active=True).count()
        assert count == 0, f"School B should have 0 students, found {count}"

    def test_school_a_classes_intact(self, seed_data, api):
        """Verify that no extra classes leak into school_a beyond what seed_data created."""
        from students.models import Class

        prefix = seed_data['prefix']
        school_a = seed_data['school_a']
        expected_count = len(seed_data['classes'])

        actual_count = Class.objects.filter(
            school=school_a,
            name__startswith=prefix,
        ).count()
        assert actual_count == expected_count, (
            f"School A should have {expected_count} seeded classes, found {actual_count}"
        )
