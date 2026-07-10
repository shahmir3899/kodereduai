from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from academic_sessions.models import AcademicYear
from attendance.models import AttendanceRecord
from finance.models import Account, FeePayment
from schools.models import Organization, School

from .models import Class, Student


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
