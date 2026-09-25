"""
Section-only exams (Exam.session_class). A class split into sections gets one
exam per section, with that section's subjects, roster and audience; a
whole-class exam (session_class null) still covers every section. Builds on
seed_data/seed_sections (Class_1A split into sections A and B).
"""
from datetime import date

import pytest

from academic_sessions.models import SessionClass
from academic_sessions.roster import own_section_q
from academics.models import ClassSubject, ClassTeacherAssignment
from examinations.models import Exam, ExamType
from examinations.views import _report_exams_for
from rest_framework.exceptions import ValidationError


pytestmark = pytest.mark.django_db


@pytest.fixture
def setup(seed_data, seed_sections):
    """A teaches Maths (staff 0, also A's class teacher); B teaches Urdu (staff 1)."""
    school, year = seed_data['school_a'], seed_data['academic_year']
    maths, urdu = seed_data['subjects']
    for section, subject, staff in (
        (seed_sections['section_a'], maths, seed_data['staff'][0]),
        (seed_sections['section_b'], urdu, seed_data['staff'][1]),
    ):
        ClassSubject.objects.create(
            school=school, academic_year=year, session_class=section,
            class_obj=seed_sections['master'], subject=subject, teacher=staff,
        )
    ClassTeacherAssignment.objects.create(
        school=school, academic_year=year, session_class=seed_sections['section_a'],
        class_obj=seed_sections['master'], teacher=seed_data['staff'][0],
    )
    return {'exam_type': ExamType.objects.create(school=school, name='Term'), 'maths': maths, 'urdu': urdu}


def _wizard(api, seed_data, setup, **targets):
    return api.post('/api/examinations/exam-groups/wizard-create/', {
        'academic_year': seed_data['academic_year'].id,
        'exam_type': setup['exam_type'].id,
        'name': 'Term 1',
        'start_date': '2025-09-01',
        'end_date': '2025-09-10',
        **targets,
    }, seed_data['tokens']['admin'], seed_data['SID_A'])


def test_wizard_creates_one_exam_per_section_with_its_own_subjects(seed_data, seed_sections, setup, api):
    a, b = seed_sections['section_a'], seed_sections['section_b']
    response = _wizard(api, seed_data, setup, session_class_ids=[a.id, b.id])

    assert response.status_code == 201, response.content[:300]
    exams = {e.session_class_id: e for e in Exam.objects.filter(class_obj=seed_sections['master'])}
    assert set(exams) == {a.id, b.id}
    assert list(exams[a.id].exam_subjects.values_list('subject_id', flat=True)) == [setup['maths'].id]
    assert list(exams[b.id].exam_subjects.values_list('subject_id', flat=True)) == [setup['urdu'].id]
    assert exams[a.id].name == f'Term 1 - {a.label}'


def test_only_section_of_a_class_gets_a_whole_class_exam(seed_data, setup, api):
    master = seed_data['classes'][1]
    only = SessionClass.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'], class_obj=master,
        display_name=master.name, section='', grade_level=master.grade_level,
    )
    response = _wizard(api, seed_data, setup, session_class_ids=[only.id])

    assert response.status_code == 201, response.content[:300]
    assert Exam.objects.get(class_obj=master).session_class_id is None


def test_whole_class_exam_blocks_a_section_exam_of_same_type(seed_data, seed_sections, setup, api):
    _wizard(api, seed_data, setup, class_ids=[seed_sections['master'].id])
    response = _wizard(api, seed_data, setup, session_class_ids=[seed_sections['section_a'].id])
    assert response.status_code == 409


def test_section_exam_results_use_its_section_without_a_param(seed_data, seed_sections, setup, api):
    _wizard(api, seed_data, setup, session_class_ids=[seed_sections['section_a'].id, seed_sections['section_b'].id])
    exam_a = Exam.objects.get(session_class=seed_sections['section_a'])

    response = api.get(f'/api/examinations/exams/{exam_a.id}/results/', seed_data['tokens']['admin'], seed_data['SID_A'])

    assert response.status_code == 200, response.content[:300]
    assert {r['student_id'] for r in response.json()['results']} == {s.id for s in seed_sections['a_students']}


def test_exam_list_for_a_section_hides_sibling_section_exams(seed_data, seed_sections, setup, api):
    _wizard(api, seed_data, setup, session_class_ids=[seed_sections['section_a'].id, seed_sections['section_b'].id])

    response = api.get(
        f"/api/examinations/exams/?session_class_id={seed_sections['section_b'].id}&page_size=50",
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )

    assert response.status_code == 200, response.content[:300]
    data = response.json()
    rows = data.get('results', data)
    assert {r['session_class'] for r in rows} == {seed_sections['section_b'].id}


def test_teacher_of_other_section_does_not_see_section_exam(seed_data, seed_sections, setup, api):
    _wizard(api, seed_data, setup, session_class_ids=[seed_sections['section_a'].id, seed_sections['section_b'].id])

    token_b = api.login(seed_data['staff'][1].user.username)
    response = api.get('/api/examinations/exams/?page_size=50', token_b, seed_data['SID_A'])

    assert response.status_code == 200, response.content[:300]
    data = response.json()
    rows = data.get('results', data)
    assert {r['session_class'] for r in rows} == {seed_sections['section_b'].id}


def test_student_sees_whole_class_and_own_section_exams_only(seed_data, seed_sections, setup):
    school, year, master = seed_data['school_a'], seed_data['academic_year'], seed_sections['master']
    whole = Exam.objects.create(school=school, academic_year=year, exam_type=setup['exam_type'], class_obj=master, name='Whole')
    own = Exam.objects.create(
        school=school, academic_year=year, exam_type=setup['exam_type'], class_obj=master,
        session_class=seed_sections['section_a'], name='A only',
    )
    Exam.objects.create(
        school=school, academic_year=year, exam_type=setup['exam_type'], class_obj=master,
        session_class=seed_sections['section_b'], name='B only',
    )

    visible = Exam.objects.filter(class_obj=master).filter(own_section_q(seed_sections['a_students'][0]))

    assert set(visible) == {whole, own}


def test_report_card_rejects_sibling_section_exam(seed_data, seed_sections, setup):
    school, year, master = seed_data['school_a'], seed_data['academic_year'], seed_sections['master']
    exam_b = Exam.objects.create(
        school=school, academic_year=year, exam_type=setup['exam_type'], class_obj=master,
        session_class=seed_sections['section_b'], name='B only', start_date=date(2025, 9, 1),
    )
    with pytest.raises(ValidationError):
        _report_exams_for(school.id, master.id, year.id, [exam_b.id], session_class_id=seed_sections['section_a'].id)
