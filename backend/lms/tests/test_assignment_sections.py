"""
Section-only assignments (Assignment.session_class). Null = whole class; a
section's own assignments are hidden from its sibling section's list, teachers
and students. Builds on seed_data/seed_sections (Class_1A split into A and B).
"""
from datetime import datetime, timezone

import pytest

from academic_sessions.roster import own_section_q
from academics.models import ClassSubject
from lms.models import Assignment


pytestmark = pytest.mark.django_db


@pytest.fixture
def section_b_teacher(seed_data, seed_sections):
    """staff 1 teaches Maths to section B only (subject teacher, no class-teacher role)."""
    ClassSubject.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        session_class=seed_sections['section_b'], class_obj=seed_sections['master'],
        subject=seed_data['subjects'][0], teacher=seed_data['staff'][1],
    )
    return seed_data['staff'][1]


def _assignment(seed_data, seed_sections, title, section=None):
    return Assignment.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        class_obj=seed_sections['master'], session_class=section,
        subject=seed_data['subjects'][0], teacher=seed_data['staff'][0], title=title, description='Do it',
        due_date=datetime(2025, 9, 15, tzinfo=timezone.utc), status=Assignment.Status.PUBLISHED,
    )


def _titles(response):
    data = response.json()
    rows = data.get('results', data)
    return {r['title'] for r in rows}


def test_create_section_assignment_and_list_by_section(seed_data, seed_sections, api):
    token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
    response = api.post('/api/lms/assignments/', {
        'school': sid,
        'teacher': seed_data['staff'][0].id,
        'class_obj': seed_sections['master'].id,
        'session_class': seed_sections['section_a'].id,
        'subject': seed_data['subjects'][0].id,
        'title': 'A homework', 'description': 'Read chapter 1',
        'assignment_type': 'HOMEWORK', 'requires_submission': True,
        'due_date': '2025-09-15T10:00:00Z',
    }, token, sid)
    assert response.status_code == 201, response.content[:300]
    _assignment(seed_data, seed_sections, 'Whole class')

    a = api.get(f"/api/lms/assignments/?session_class_id={seed_sections['section_a'].id}&page_size=50", token, sid)
    b = api.get(f"/api/lms/assignments/?session_class_id={seed_sections['section_b'].id}&page_size=50", token, sid)

    assert _titles(a) == {'A homework', 'Whole class'}
    assert _titles(b) == {'Whole class'}


def test_section_must_belong_to_the_class(seed_data, seed_sections, api):
    response = api.post('/api/lms/assignments/', {
        'school': seed_data['SID_A'],
        'teacher': seed_data['staff'][0].id,
        'class_obj': seed_data['classes'][1].id,
        'session_class': seed_sections['section_a'].id,
        'subject': seed_data['subjects'][0].id,
        'title': 'Wrong', 'description': 'x',
        'assignment_type': 'HOMEWORK', 'requires_submission': True,
        'due_date': '2025-09-15T10:00:00Z',
    }, seed_data['tokens']['admin'], seed_data['SID_A'])
    assert response.status_code == 400


def test_other_sections_subject_teacher_does_not_see_section_assignment(seed_data, seed_sections, section_b_teacher, api):
    _assignment(seed_data, seed_sections, 'A only', seed_sections['section_a'])
    _assignment(seed_data, seed_sections, 'B only', seed_sections['section_b'])
    _assignment(seed_data, seed_sections, 'Whole class')

    token = api.login(section_b_teacher.user.username)
    response = api.get('/api/lms/assignments/?page_size=50', token, seed_data['SID_A'])

    assert response.status_code == 200, response.content[:300]
    assert _titles(response) == {'B only', 'Whole class'}


def test_student_sees_whole_class_and_own_section_assignments(seed_data, seed_sections):
    whole = _assignment(seed_data, seed_sections, 'Whole class')
    own = _assignment(seed_data, seed_sections, 'A only', seed_sections['section_a'])
    _assignment(seed_data, seed_sections, 'B only', seed_sections['section_b'])

    visible = Assignment.objects.filter(own_section_q(seed_sections['a_students'][0]))

    assert set(visible) == {whole, own}
