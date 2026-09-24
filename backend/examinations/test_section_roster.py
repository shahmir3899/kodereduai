"""
Exam rosters are per section. Exams are keyed by master class, so two
sections sharing one master class ("Class 2 - A"/"Class 2 - B") used to be
listed, ranked and averaged as a single class.
"""
from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from academic_sessions.models import AcademicYear, SessionClass, StudentEnrollment
from examinations.models import Exam, ExamType
from examinations.views import _class_roster
from schools.models import Organization, School
from students.models import Class, Student


class TestExamSectionRoster(TestCase):
    @classmethod
    def setUpTestData(cls):
        org = Organization.objects.create(name='Exam Org', slug='exam-section-org')
        cls.school = School.objects.create(organization=org, name='Exam School', subdomain='exam-section-school')
        cls.year = AcademicYear.objects.create(
            school=cls.school, name='2026-2027',
            start_date=date(2026, 4, 1), end_date=date(2027, 3, 31),
            is_current=True, is_active=True,
        )
        cls.master = Class.objects.create(school=cls.school, name='Class 2', grade_level=4)
        cls.other_master = Class.objects.create(school=cls.school, name='Class 3', grade_level=5)
        cls.section_a = SessionClass.objects.create(
            school=cls.school, academic_year=cls.year, class_obj=cls.master,
            display_name='Class 2', section='A', grade_level=4,
        )
        cls.section_b = SessionClass.objects.create(
            school=cls.school, academic_year=cls.year, class_obj=cls.master,
            display_name='Class 2', section='B', grade_level=4,
        )
        cls.other_section = SessionClass.objects.create(
            school=cls.school, academic_year=cls.year, class_obj=cls.other_master,
            display_name='Class 3', section='', grade_level=5,
        )

        cls.students = {}
        for section, names in ((cls.section_a, ('A1', 'A2')), (cls.section_b, ('B1', 'B2', 'B3'))):
            for roll, name in enumerate(names, start=1):
                student = Student.objects.create(
                    school=cls.school, class_obj=cls.master, name=name, roll_number=str(roll),
                )
                StudentEnrollment.objects.create(
                    school=cls.school, student=student, academic_year=cls.year,
                    class_obj=cls.master, session_class=section, roll_number=str(roll),
                    status='ACTIVE', is_active=True,
                )
                cls.students[name] = student

        exam_type = ExamType.objects.create(school=cls.school, name='Term')
        cls.exam = Exam.objects.create(
            school=cls.school, academic_year=cls.year, exam_type=exam_type,
            class_obj=cls.master, name='Term 1 - Class 2', start_date=date(2026, 9, 1),
        )
        cls.user = get_user_model().objects.create_superuser(
            username='exam_section_admin', email='exam_section_admin@test.com', password='test12345',
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.headers = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def _names(self, students):
        return sorted(s.name for s in students)

    def test_roster_without_section_keeps_master_class_scope(self):
        students, _ = _class_roster(self.school.id, self.master.id, self.year.id)
        self.assertEqual(self._names(students), ['A1', 'A2', 'B1', 'B2', 'B3'])

    def test_roster_with_section_lists_only_that_section(self):
        students, rolls = _class_roster(
            self.school.id, self.master.id, self.year.id, session_class_id=self.section_b.id,
        )
        self.assertEqual(self._names(students), ['B1', 'B2', 'B3'])
        self.assertEqual(rolls[self.students['B3'].id], '3')

    def test_empty_section_does_not_fall_back_to_whole_master_class(self):
        empty = SessionClass.objects.create(
            school=self.school, academic_year=self.year, class_obj=self.master,
            display_name='Class 2', section='C', grade_level=4,
        )
        students, _ = _class_roster(
            self.school.id, self.master.id, self.year.id, session_class_id=empty.id,
        )
        self.assertEqual(students, [])

    def test_results_endpoint_scopes_to_requested_section(self):
        url = f'/api/examinations/exams/{self.exam.id}/results/'

        whole = self.client.get(url, **self.headers)
        section_a = self.client.get(url, {'session_class_id': self.section_a.id}, **self.headers)

        self.assertEqual(whole.status_code, 200, whole.content[:300])
        self.assertEqual(section_a.status_code, 200, section_a.content[:300])
        self.assertEqual(len(whole.json()['results']), 5)
        self.assertEqual(len(section_a.json()['results']), 2)

    def test_results_endpoint_rejects_section_of_another_class(self):
        response = self.client.get(
            f'/api/examinations/exams/{self.exam.id}/results/',
            {'session_class_id': self.other_section.id},
            **self.headers,
        )
        self.assertIn(response.status_code, (400, 404))
