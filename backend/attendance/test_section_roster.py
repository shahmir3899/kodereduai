"""
Attendance rosters are per section and go through academic_sessions.roster.

Two sections share one master class here ("Class 2 - A"/"Class 2 - B"), which
is the case where master-class scoping pooled both sections.
"""
from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from academic_sessions.models import AcademicYear, SessionClass, StudentEnrollment
from attendance.models import AttendanceRecord
from schools.models import Organization, School
from students.models import Class, Student


class TestAttendanceSectionRoster(TestCase):
    @classmethod
    def setUpTestData(cls):
        org = Organization.objects.create(name='Att Org', slug='att-section-org')
        cls.school = School.objects.create(organization=org, name='Att School', subdomain='att-section-school')
        cls.year = AcademicYear.objects.create(
            school=cls.school, name='2026-2027',
            start_date=date(2026, 4, 1), end_date=date(2027, 3, 31),
            is_current=True, is_active=True,
        )
        cls.master = Class.objects.create(school=cls.school, name='Class 2', grade_level=4)
        cls.section_a = SessionClass.objects.create(
            school=cls.school, academic_year=cls.year, class_obj=cls.master,
            display_name='Class 2', section='A', grade_level=4,
        )
        cls.section_b = SessionClass.objects.create(
            school=cls.school, academic_year=cls.year, class_obj=cls.master,
            display_name='Class 2', section='B', grade_level=4,
        )

        def enroll(name, roll, section, **enrollment_kwargs):
            student = Student.objects.create(
                school=cls.school, class_obj=cls.master, name=name, roll_number=roll,
            )
            StudentEnrollment.objects.create(
                school=cls.school, student=student, academic_year=cls.year,
                class_obj=cls.master, session_class=section, roll_number=roll,
                **{'status': 'ACTIVE', 'is_active': True, **enrollment_kwargs},
            )
            return student

        cls.a1 = enroll('A1', '1', cls.section_a)
        cls.b1 = enroll('B1', '1', cls.section_b)
        # Left section A in October; September records must still show.
        cls.a_left = enroll(
            'A Left', '2', cls.section_a,
            status='WITHDRAWN', is_active=False, left_date=date(2026, 10, 5),
        )

        for student in (cls.a1, cls.b1, cls.a_left):
            AttendanceRecord.objects.create(
                school=cls.school, student=student, academic_year=cls.year,
                date=date(2026, 9, 1), status=AttendanceRecord.AttendanceStatus.PRESENT,
            )

        cls.user = get_user_model().objects.create_superuser(
            username='att_section_admin', email='att_section_admin@test.com', password='test12345',
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.headers = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def test_register_data_is_section_scoped_and_keeps_withdrawn_student(self):
        response = self.client.get(
            '/api/attendance/records/register_data/',
            {
                'session_class_id': self.section_a.id,
                'academic_year': self.year.id,
                'date_from': '2026-09-01',
                'date_to': '2026-09-30',
            },
            **self.headers,
        )

        self.assertEqual(response.status_code, 200, response.content[:300])
        self.assertEqual(
            sorted(r['student_id'] for r in response.json()),
            sorted([self.a1.id, self.a_left.id]),
        )

    def test_records_list_section_filter_keeps_withdrawn_students_records(self):
        response = self.client.get(
            '/api/attendance/records/',
            {'session_class_id': self.section_a.id, 'academic_year': self.year.id, 'page_size': 50},
            **self.headers,
        )

        self.assertEqual(response.status_code, 200, response.content[:300])
        data = response.json()
        rows = data.get('results', data)
        student_ids = sorted(r['student'] if isinstance(r['student'], int) else r['student']['id'] for r in rows)
        self.assertEqual(student_ids, sorted([self.a1.id, self.a_left.id]))

    def test_bulk_entry_rejects_student_from_another_section(self):
        response = self.client.post(
            '/api/attendance/records/bulk_entry/',
            {
                'session_class_id': self.section_a.id,
                'date': '2026-09-02',
                'entries': [
                    {'student_id': self.a1.id, 'status': 'PRESENT'},
                    {'student_id': self.b1.id, 'status': 'ABSENT'},
                ],
            },
            format='json',
            **self.headers,
        )

        self.assertLess(response.status_code, 500, response.content[:300])
        self.assertTrue(AttendanceRecord.objects.filter(student=self.a1, date=date(2026, 9, 2)).exists())
        self.assertFalse(AttendanceRecord.objects.filter(student=self.b1, date=date(2026, 9, 2)).exists())
