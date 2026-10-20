"""
Adding a student places them in the section chosen. A class with several sections
needs one chosen: the server no longer saves the student with no section.
"""
import pytest

from academic_sessions.models import SessionClass, StudentEnrollment

pytestmark = [pytest.mark.django_db]

URL = '/api/students/'


def _sections(seed_data, letters=('A', 'B')):
    master = seed_data['classes'][0]
    return [
        SessionClass.objects.create(
            school=seed_data['school_a'], academic_year=seed_data['academic_year'],
            class_obj=master, display_name=master.name, section=letter,
            grade_level=master.grade_level, is_active=True,
        ) for letter in letters
    ]


def _body(seed_data, roll, **extra):
    return {
        'school': seed_data['school_a'].id, 'class_obj': seed_data['classes'][0].id,
        'roll_number': roll, 'name': f"{seed_data['prefix']}Sec{roll}", **extra,
    }


def _enrollment(seed_data, roll):
    return StudentEnrollment.objects.get(
        student__name=f"{seed_data['prefix']}Sec{roll}", academic_year=seed_data['academic_year'])


def test_student_lands_in_chosen_section(seed_data, api):
    token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
    section_a, section_b = _sections(seed_data)
    resp = api.post(URL, _body(seed_data, '901', session_class_id=section_b.id), token, sid)
    assert resp.status_code == 201, resp.content[:300]
    enrollment = _enrollment(seed_data, '901')
    assert enrollment.session_class_id == section_b.id != section_a.id


def test_ambiguous_class_is_rejected(seed_data, api):
    token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
    _sections(seed_data)
    resp = api.post(URL, _body(seed_data, '902'), token, sid)
    assert resp.status_code == 400
    assert 'session_class_id' in resp.json()


def test_same_roll_allowed_in_different_sections(seed_data, api):
    token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
    section_a, section_b = _sections(seed_data)
    first = api.post(URL, _body(seed_data, '903', session_class_id=section_a.id), token, sid)
    second = api.post(URL, {**_body(seed_data, '903', session_class_id=section_b.id),
                            'name': f"{seed_data['prefix']}SecTwin"}, token, sid)
    assert first.status_code == 201, first.content[:300]
    assert second.status_code == 201, second.content[:300]
    dupe = api.post(URL, {**_body(seed_data, '903', session_class_id=section_a.id),
                          'name': f"{seed_data['prefix']}SecDupe"}, token, sid)
    assert dupe.status_code == 400


def test_section_of_another_class_is_rejected(seed_data, api):
    token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
    other = seed_data['classes'][1]
    foreign = SessionClass.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        class_obj=other, display_name=other.name, section='A',
        grade_level=other.grade_level, is_active=True)
    resp = api.post(URL, _body(seed_data, '904', session_class_id=foreign.id), token, sid)
    assert resp.status_code == 400


def test_single_section_class_needs_no_choice(seed_data, api):
    token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
    (only,) = _sections(seed_data, letters=('A',))
    resp = api.post(URL, _body(seed_data, '905'), token, sid)
    assert resp.status_code == 201, resp.content[:300]
    assert _enrollment(seed_data, '905').session_class_id == only.id
