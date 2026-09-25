"""
Exam rosters are per section. Exams are keyed by master class, so two
sections sharing one master class used to be listed, ranked and averaged as a
single class. Builds on the shared seed_data/seed_sections fixtures.
"""
from datetime import date

import pytest

from academic_sessions.models import SessionClass
from examinations.models import Exam, ExamType
from examinations.views import _class_roster


pytestmark = pytest.mark.django_db


@pytest.fixture
def exam(seed_data, seed_sections):
    exam_type = ExamType.objects.create(school=seed_data['school_a'], name='Term')
    return Exam.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        exam_type=exam_type, class_obj=seed_sections['master'],
        name='Term 1 - Class 1', start_date=date(2025, 9, 1),
    )


def _ids(students):
    return {s.id for s in students}


def test_roster_without_section_keeps_master_class_scope(seed_data, seed_sections):
    students, _ = _class_roster(
        seed_data['SID_A'], seed_sections['master'].id, seed_data['academic_year'].id,
    )
    assert _ids(students) == _ids(seed_sections['a_students'] + seed_sections['b_students'])


def test_roster_with_section_lists_only_that_section(seed_data, seed_sections):
    students, rolls = _class_roster(
        seed_data['SID_A'], seed_sections['master'].id, seed_data['academic_year'].id,
        session_class_id=seed_sections['section_b'].id,
    )
    assert _ids(students) == _ids(seed_sections['b_students'])
    last = seed_sections['b_students'][-1]
    assert rolls[last.id] == last.roll_number


def test_empty_section_does_not_fall_back_to_whole_master_class(seed_data, seed_sections):
    empty = SessionClass.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        class_obj=seed_sections['master'], display_name=seed_sections['master'].name,
        section='C', grade_level=seed_sections['master'].grade_level,
    )
    students, _ = _class_roster(
        seed_data['SID_A'], seed_sections['master'].id, seed_data['academic_year'].id,
        session_class_id=empty.id,
    )
    assert students == []


def test_results_endpoint_scopes_to_requested_section(seed_data, seed_sections, exam, api):
    token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
    url = f'/api/examinations/exams/{exam.id}/results/'

    whole = api.get(url, token, sid)
    section_a = api.get(f"{url}?session_class_id={seed_sections['section_a'].id}", token, sid)

    assert whole.status_code == 200, whole.content[:300]
    assert section_a.status_code == 200, section_a.content[:300]
    assert len(whole.json()['results']) == 4
    assert len(section_a.json()['results']) == 2


def test_results_endpoint_rejects_section_of_another_class(seed_data, seed_sections, exam, api):
    other = SessionClass.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        class_obj=seed_data['classes'][1], display_name=seed_data['classes'][1].name,
        section='', grade_level=seed_data['classes'][1].grade_level,
    )
    response = api.get(
        f'/api/examinations/exams/{exam.id}/results/?session_class_id={other.id}',
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )
    assert response.status_code in (400, 404)
