"""
"Where is this student now" lookups use the current enrollment's section.

Class 2 has sections A and B sharing one master class. Messaging and teacher
scoping keyed on the master class (and the Student.class_obj snapshot) let a
section A parent or teacher reach section B's teachers and families; portal
content keyed on master class alone also showed a previous cohort's exams.
"""
from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from academic_sessions.models import AcademicYear, SessionClass, StudentEnrollment
from academic_sessions.roster import current_year_q, placement_scope
from academics.models import ClassSubject, ClassTeacherAssignment, Subject
from examinations.models import Exam, ExamType
from hr.models import StaffMember
from messaging.views import _class_subjects_for_student, _students_taught_by, _teacher_has_student_access
from schools.models import Organization, School, UserSchoolMembership
from students.models import Class, Student

User = get_user_model()


class TestSectionScopedPlacement(TestCase):
    @classmethod
    def setUpTestData(cls):
        org = Organization.objects.create(name='Msg Org', slug='msg-section-org')
        cls.school = School.objects.create(organization=org, name='Msg School', subdomain='msg-section-school')
        cls.last_year = AcademicYear.objects.create(
            school=cls.school, name='2025-2026',
            start_date=date(2025, 4, 1), end_date=date(2026, 3, 31),
            is_current=False, is_active=True,
        )
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

        def enroll(name, section):
            student = Student.objects.create(school=cls.school, class_obj=cls.master, name=name, roll_number='1')
            StudentEnrollment.objects.create(
                school=cls.school, student=student, academic_year=cls.year,
                class_obj=cls.master, session_class=section, roll_number='1',
                status='ACTIVE', is_active=True,
            )
            return student

        cls.a1 = enroll('A One', cls.section_a)
        cls.b1 = enroll('B One', cls.section_b)

        subject = Subject.objects.create(school=cls.school, name='Maths', code='MTH')

        def teacher(username, section):
            user = User.objects.create_user(
                username=username, email=f'{username}@test.com', password='test12345', role='TEACHER',
            )
            UserSchoolMembership.objects.create(user=user, school=cls.school, role='TEACHER', is_default=True)
            staff = StaffMember.objects.create(
                school=cls.school, user=user, first_name=username, last_name='T', employee_id=username,
            )
            ClassSubject.objects.create(
                school=cls.school, academic_year=cls.year, session_class=section,
                class_obj=cls.master, subject=subject, teacher=staff,
            )
            ClassTeacherAssignment.objects.create(
                school=cls.school, academic_year=cls.year, session_class=section,
                class_obj=cls.master, teacher=staff,
            )
            return user, staff

        cls.teacher_a_user, cls.teacher_a = teacher('msg_teacher_a', cls.section_a)
        cls.teacher_b_user, cls.teacher_b = teacher('msg_teacher_b', cls.section_b)

    def test_parent_sees_only_their_childs_section_teachers(self):
        class_subjects, label = _class_subjects_for_student(self.a1, self.school.id)
        self.assertEqual(set(class_subjects.values_list('teacher_id', flat=True)), {self.teacher_a.id})
        self.assertEqual(label, 'Class 2 - A')

    def test_teacher_recipients_are_their_section_only(self):
        students, labels = _students_taught_by(self.teacher_a, self.school.id)
        self.assertEqual(set(students.values_list('id', flat=True)), {self.a1.id})
        self.assertEqual(labels[self.a1.id], 'Class 2 - A')

    def test_teacher_access_check_is_section_scoped(self):
        self.assertTrue(_teacher_has_student_access(self.teacher_a_user, self.a1.id, self.school.id))
        self.assertFalse(_teacher_has_student_access(self.teacher_a_user, self.b1.id, self.school.id))

    def test_teacher_student_list_does_not_reopen_other_section(self):
        client = APIClient()
        client.force_authenticate(self.teacher_a_user)
        response = client.get('/api/students/', {'page_size': 50}, HTTP_X_SCHOOL_ID=str(self.school.id))

        self.assertEqual(response.status_code, 200, response.content[:300])
        data = response.json()
        rows = data.get('results', data)
        self.assertEqual({r['id'] for r in rows}, {self.a1.id})

    def test_portal_exam_scope_hides_previous_cohorts_exams(self):
        exam_type = ExamType.objects.create(school=self.school, name='Term')
        this_year = Exam.objects.create(
            school=self.school, academic_year=self.year, exam_type=exam_type,
            class_obj=self.master, name='Term 1 2026-27',
        )
        Exam.objects.create(
            school=self.school, academic_year=self.last_year, exam_type=exam_type,
            class_obj=self.master, name='Term 1 2025-26',
        )

        class_obj_id, year_id = placement_scope(self.a1)
        visible = Exam.objects.filter(class_obj_id=class_obj_id).filter(current_year_q(year_id))

        self.assertEqual(list(visible), [this_year])
