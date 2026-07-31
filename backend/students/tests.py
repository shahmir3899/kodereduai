from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from academic_sessions.models import AcademicYear
from academics.models import ClassTeacherAssignment
from attendance.models import AttendanceRecord
from finance.models import Account, FeePayment
from hr.models import StaffMember
from schools.models import Organization, School, UserSchoolMembership

from .models import Class, Student, StudentProfile


def _make_school():
    org = Organization.objects.create(name='Student Test Org', slug='student-test-org')
    return School.objects.create(
        organization=org,
        name='Student Test School',
        subdomain='student-test-school',
    )


class StudentPhotoUploadTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.class_obj = Class.objects.create(school=cls.school, name='Class 5', grade_level=5)
        cls.student = Student.objects.create(
            school=cls.school, class_obj=cls.class_obj, roll_number='1', name='Ali Khan',
        )
        cls.user = get_user_model().objects.create_superuser(
            username='student_photo_admin',
            email='student_photo_admin@test.com',
            password='test12345',
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.school_header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    @patch('core.storage.storage_service.upload_student_photo')
    def test_upload_photo_sets_url(self, mock_upload):
        mock_upload.return_value = 'https://supabase.example/storage/students/1/1.jpg'
        file = SimpleUploadedFile('photo.jpg', b'fake-image-bytes', content_type='image/jpeg')

        response = self.client.post(
            f'/api/students/{self.student.id}/upload_photo/',
            {'file': file},
            format='multipart',
            **self.school_header,
        )

        self.assertEqual(response.status_code, 200)
        self.student.refresh_from_db()
        self.assertEqual(self.student.photo_url, mock_upload.return_value)

    def test_upload_photo_rejects_bad_content_type(self):
        file = SimpleUploadedFile('doc.pdf', b'%PDF-1.4', content_type='application/pdf')

        response = self.client.post(
            f'/api/students/{self.student.id}/upload_photo/',
            {'file': file},
            format='multipart',
            **self.school_header,
        )

        self.assertEqual(response.status_code, 400)

    @patch('core.storage.storage_service.delete_file')
    def test_remove_photo_clears_url(self, mock_delete):
        self.student.photo_url = 'https://supabase.example/storage/students/1/1.jpg'
        self.student.save(update_fields=['photo_url'])

        response = self.client.post(
            f'/api/students/{self.student.id}/remove_photo/',
            **self.school_header,
        )

        self.assertEqual(response.status_code, 200)
        self.student.refresh_from_db()
        self.assertEqual(self.student.photo_url, '')
        mock_delete.assert_called_once()


class StudentComprehensiveReportGeneratorTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.class_obj = Class.objects.create(school=cls.school, name='Class 6', grade_level=6)
        cls.student = Student.objects.create(
            school=cls.school, class_obj=cls.class_obj, roll_number='2', name='Sara Ahmed',
        )

        # Attendance: 2 records inside the report window, 1 outside it.
        AttendanceRecord.objects.create(
            school=cls.school, student=cls.student, date=date(2026, 2, 5), status='PRESENT',
        )
        AttendanceRecord.objects.create(
            school=cls.school, student=cls.student, date=date(2026, 2, 10), status='ABSENT',
        )
        AttendanceRecord.objects.create(
            school=cls.school, student=cls.student, date=date(2026, 1, 1), status='PRESENT',
        )

        # Fees: one payment inside the Feb attendance window, one outside (Jan) —
        # the fee chart always shows the whole academic year regardless of date
        # range, so both payments count toward fee_due/fee_paid either way.
        cls.account = Account.objects.create(school=cls.school, name='Cash', account_type='CASH')
        FeePayment.objects.create(
            school=cls.school, student=cls.student, month=2, year=2026,
            amount_due=Decimal('5000'), amount_paid=Decimal('5000'),
            payment_date=date(2026, 2, 6), account=cls.account,
        )
        FeePayment.objects.create(
            school=cls.school, student=cls.student, month=1, year=2026,
            amount_due=Decimal('5000'), amount_paid=Decimal('0'),
        )
        cls.academic_year = AcademicYear.objects.create(
            school=cls.school, name='2025-2026',
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), is_current=True,
        )

    def test_date_range_filters_attendance_but_not_fees(self):
        from reports.generators.student import StudentComprehensiveReportGenerator

        generator = StudentComprehensiveReportGenerator(
            school=self.school,
            parameters={
                'student_id': self.student.id,
                'date_from': '2026-02-01',
                'date_to': '2026-02-28',
            },
        )
        data = generator.get_data()

        self.assertEqual(data['present_count'], 1)
        self.assertEqual(data['absent_count'], 1)
        # Fees are always the full academic-year total, independent of date range.
        self.assertEqual(data['fee_due'], Decimal('10000'))
        self.assertEqual(data['fee_paid'], Decimal('5000'))
        self.assertIn('01 Feb 2026', data['report_period_label'])

    def test_no_date_range_falls_back_to_full_history(self):
        from reports.generators.student import StudentComprehensiveReportGenerator

        generator = StudentComprehensiveReportGenerator(
            school=self.school,
            parameters={'student_id': self.student.id},
        )
        data = generator.get_data()

        self.assertEqual(data['present_count'], 2)
        self.assertEqual(data['absent_count'], 1)
        self.assertEqual(data['fee_due'], Decimal('10000'))

    def test_month_range_q_spans_multiple_years(self):
        from reports.generators.student import _month_range_q

        q = _month_range_q(date(2025, 11, 15), date(2026, 2, 15))
        matching = FeePayment.objects.filter(q, student=self.student)
        # Both Jan and Feb 2026 payments fall within Nov 2025 - Feb 2026.
        self.assertEqual(matching.count(), 2)


class TeacherStudentEditScopeTests(TestCase):
    """
    TEACHER role can edit basic profile fields (+ photo, covered elsewhere)
    and create portal accounts, but only for students in classes where they
    hold a ClassTeacherAssignment — and cannot touch lifecycle/class fields
    or perform admin-only actions (create, delete) even for their own
    students.
    """

    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.class_a = Class.objects.create(school=cls.school, name='Class A', grade_level=1)
        cls.class_b = Class.objects.create(school=cls.school, name='Class B', grade_level=2)
        cls.student_a = Student.objects.create(
            school=cls.school, class_obj=cls.class_a, roll_number='1', name='Student A',
        )
        cls.student_b = Student.objects.create(
            school=cls.school, class_obj=cls.class_b, roll_number='1', name='Student B',
        )

        cls.teacher_user = get_user_model().objects.create_user(
            username='scoped_teacher',
            email='scoped_teacher@test.com',
            password='test12345',
            role='TEACHER',
        )
        UserSchoolMembership.objects.create(
            user=cls.teacher_user, school=cls.school, role='TEACHER',
            is_default=True, is_active=True,
        )
        staff = StaffMember.objects.create(
            school=cls.school, user=cls.teacher_user, first_name='Scoped', last_name='Teacher',
        )
        # academic_year left null so the assignment matches regardless of
        # whether a current AcademicYear exists (see _resolve_scope_academic_year_id).
        ClassTeacherAssignment.objects.create(
            school=cls.school, class_obj=cls.class_a, teacher=staff, is_active=True,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.teacher_user)
        self.school_header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def test_teacher_can_edit_own_student_basic_fields(self):
        response = self.client.patch(
            f'/api/students/{self.student_a.id}/',
            {'name': 'Student A Updated', 'parent_phone': '+923001234567'},
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.student_a.refresh_from_db()
        self.assertEqual(self.student_a.name, 'Student A Updated')
        self.assertEqual(self.student_a.parent_phone, '+923001234567')

    def test_teacher_cannot_change_status_or_class_via_edit(self):
        response = self.client.patch(
            f'/api/students/{self.student_a.id}/',
            {
                'name': 'Student A',
                'is_active': False,
                'status': 'WITHDRAWN',
                'class_obj': self.class_b.id,
            },
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.student_a.refresh_from_db()
        self.assertTrue(self.student_a.is_active)
        self.assertEqual(self.student_a.status, 'ACTIVE')
        self.assertEqual(self.student_a.class_obj_id, self.class_a.id)

    def test_teacher_cannot_edit_student_outside_scope(self):
        response = self.client.patch(
            f'/api/students/{self.student_b.id}/',
            {'name': 'Student B Updated'},
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 404)
        self.student_b.refresh_from_db()
        self.assertEqual(self.student_b.name, 'Student B')

    def test_teacher_cannot_create_student(self):
        response = self.client.post(
            '/api/students/',
            {
                'school': self.school.id, 'class_obj': self.class_a.id,
                'roll_number': '99', 'name': 'New Student',
            },
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 403)

    def test_teacher_cannot_delete_own_student(self):
        response = self.client.delete(
            f'/api/students/{self.student_a.id}/',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 403)
        self.assertTrue(Student.objects.filter(id=self.student_a.id).exists())

    def test_teacher_can_create_user_account_for_own_student(self):
        response = self.client.post(
            f'/api/students/{self.student_a.id}/create-user-account/',
            {'username': 'student_a_login', 'password': 'testpass123', 'confirm_password': 'testpass123'},
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(StudentProfile.objects.filter(student=self.student_a).exists())

    def test_teacher_cannot_create_user_account_outside_scope(self):
        response = self.client.post(
            f'/api/students/{self.student_b.id}/create-user-account/',
            {'username': 'student_b_login', 'password': 'testpass123', 'confirm_password': 'testpass123'},
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 404)

    def test_teacher_bulk_create_accounts_scoped_to_own_students(self):
        response = self.client.post(
            '/api/students/bulk-create-accounts/',
            {'student_ids': [self.student_a.id, self.student_b.id], 'default_password': 'testpass123'},
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['created_count'], 1)
        self.assertEqual(response.data['created'][0]['student_id'], self.student_a.id)
        self.assertFalse(StudentProfile.objects.filter(student=self.student_b).exists())
