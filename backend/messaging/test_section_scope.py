"""
"Where is this student now" lookups use the current enrollment's section.

Messaging and teacher scoping keyed on the master class (and the
Student.class_obj snapshot) let a section A parent or teacher reach section
B's teachers and families; portal content keyed on master class alone also
showed a previous cohort's exams. Builds on seed_data/seed_sections.
"""
from datetime import date

import pytest

from academic_sessions.models import AcademicYear
from academic_sessions.roster import current_year_q, placement_scope
from academics.models import ClassSubject, ClassTeacherAssignment
from examinations.models import Exam, ExamType
from messaging.views import _class_subjects_for_student, _students_taught_by, _teacher_has_student_access


pytestmark = pytest.mark.django_db


@pytest.fixture
def section_teachers(seed_data, seed_sections):
    """seed staff[0] teaches and class-teaches section A, staff[1] section B."""
    school, year = seed_data['school_a'], seed_data['academic_year']
    subject = seed_data['subjects'][0]
    pairs = ((seed_data['staff'][0], seed_sections['section_a']), (seed_data['staff'][1], seed_sections['section_b']))
    for staff, section in pairs:
        ClassSubject.objects.create(
            school=school, academic_year=year, session_class=section,
            class_obj=seed_sections['master'], subject=subject, teacher=staff,
        )
        ClassTeacherAssignment.objects.create(
            school=school, academic_year=year, session_class=section,
            class_obj=seed_sections['master'], teacher=staff,
        )
    return {'teacher_a': seed_data['staff'][0], 'teacher_b': seed_data['staff'][1]}


def test_parent_sees_only_their_childs_section_teachers(seed_data, seed_sections, section_teachers):
    child = seed_sections['a_students'][0]
    class_subjects, label = _class_subjects_for_student(child, seed_data['SID_A'])
    assert set(class_subjects.values_list('teacher_id', flat=True)) == {section_teachers['teacher_a'].id}
    assert label == seed_sections['section_a'].label


def test_teacher_recipients_are_their_section_only(seed_data, seed_sections, section_teachers):
    students, labels = _students_taught_by(section_teachers['teacher_a'], seed_data['SID_A'])
    assert set(students.values_list('id', flat=True)) == {s.id for s in seed_sections['a_students']}
    assert labels[seed_sections['a_students'][0].id] == seed_sections['section_a'].label


def test_teacher_access_check_is_section_scoped(seed_data, seed_sections, section_teachers):
    user_a = section_teachers['teacher_a'].user
    assert _teacher_has_student_access(user_a, seed_sections['a_students'][0].id, seed_data['SID_A'])
    assert not _teacher_has_student_access(user_a, seed_sections['b_students'][0].id, seed_data['SID_A'])


def test_teacher_student_list_does_not_reopen_other_section(seed_data, seed_sections, section_teachers, api):
    token = api.login(section_teachers['teacher_a'].user.username)
    response = api.get('/api/students/?page_size=50', token, seed_data['SID_A'])

    assert response.status_code == 200, response.content[:300]
    data = response.json()
    rows = data.get('results', data)
    assert {r['id'] for r in rows} == {s.id for s in seed_sections['a_students']}


def test_portal_exam_scope_hides_previous_cohorts_exams(seed_data, seed_sections):
    school, master = seed_data['school_a'], seed_sections['master']
    last_year = AcademicYear.objects.create(
        school=school, name='PYTEST_2024-2025',
        start_date=date(2024, 4, 1), end_date=date(2025, 3, 31),
        is_current=False, is_active=True,
    )
    exam_type = ExamType.objects.create(school=school, name='Term')
    this_year = Exam.objects.create(
        school=school, academic_year=seed_data['academic_year'], exam_type=exam_type,
        class_obj=master, name='Term 1 2025-26',
    )
    Exam.objects.create(
        school=school, academic_year=last_year, exam_type=exam_type,
        class_obj=master, name='Term 1 2024-25',
    )

    class_obj_id, year_id = placement_scope(seed_sections['a_students'][0])
    visible = Exam.objects.filter(class_obj_id=class_obj_id).filter(current_year_q(year_id))

    assert list(visible) == [this_year]


def test_teacher_cannot_message_a_student(seed_data, seed_sections, section_teachers, api):
    """The student portal has no Messages page, so students are not offered as recipients."""
    from students.models import StudentProfile
    from users.models import User

    child = seed_sections['a_students'][0]
    student_user = User.objects.create_user(
        username='PYTEST_student_msg', email='pytest_student_msg@test.com', password='Abcd1234', role='STUDENT', school=seed_data['school_a'],
    )
    StudentProfile.objects.create(user=student_user, student=child, school=seed_data['school_a'])

    token = api.login(section_teachers['teacher_a'].user.username)
    sid = seed_data['SID_A']
    rows = api.get('/api/messaging/recipients/', token, sid).json()
    assert student_user.id not in {r['id'] for r in rows}
    assert 'STUDENT' not in {r['role'] for r in rows}

    response = api.post(
        '/api/messaging/threads/',
        {'recipient_user_id': student_user.id, 'student_id': child.id, 'message': 'Hello', 'message_type': 'TEACHER_STUDENT'},
        token, sid,
    )
    assert response.status_code == 403, response.content[:200]
