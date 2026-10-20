"""
Admissions conversion is section-aware: the section chosen is the section the
student lands in (it used to fall back to the first section of the master class),
and roll numbers are numbered within that section.
"""
import pytest

from academic_sessions.models import SessionClass, StudentEnrollment

pytestmark = [pytest.mark.django_db]

URL = '/api/admissions/enquiries/batch-convert/'


def _section(seed_data, letter):
    master = seed_data['classes'][0]
    return SessionClass.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        class_obj=master, display_name=master.name, section=letter,
        grade_level=master.grade_level, is_active=True,
    )


def _confirmed_enquiry(seed_data, api, label):
    token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
    resp = api.post('/api/admissions/enquiries/', {
        'name': f"{seed_data['prefix']}{label}", 'father_name': f"{seed_data['prefix']}P{label}",
        'mobile': '03001234567', 'applying_for_grade_level': '1', 'source': 'WALK_IN',
    }, token, sid)
    assert resp.status_code == 201, resp.content[:200]
    enq_id = resp.json()['id']
    resp = api.patch(f'/api/admissions/enquiries/{enq_id}/update-status/',
                     {'status': 'CONFIRMED'}, token, sid)
    assert resp.status_code == 200, resp.content[:200]
    return enq_id


def test_convert_lands_in_chosen_section(seed_data, api):
    token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
    section_a, section_b = _section(seed_data, 'A'), _section(seed_data, 'B')
    enq = _confirmed_enquiry(seed_data, api, 'SecB')

    resp = api.post(URL, {
        'enquiry_ids': [enq], 'academic_year_id': seed_data['academic_year'].id,
        'session_class_id': section_b.id,
    }, token, sid)
    assert resp.status_code == 201, resp.content[:300]

    student_id = resp.json()['converted'][0]['student_id']
    enrollment = StudentEnrollment.objects.get(
        student_id=student_id, academic_year=seed_data['academic_year'])
    assert enrollment.session_class_id == section_b.id
    assert enrollment.session_class_id != section_a.id
    assert enrollment.class_obj_id == section_b.class_obj_id


def test_rolls_are_numbered_per_section(seed_data, api):
    token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
    section_a, section_b = _section(seed_data, 'A'), _section(seed_data, 'B')
    year = seed_data['academic_year']
    # Section A already holds roll 1; B is empty, so B's first admission gets 1.
    StudentEnrollment.objects.create(
        school=seed_data['school_a'], student=seed_data['students'][0], academic_year=year,
        class_obj=section_a.class_obj, session_class=section_a, roll_number='1',
        status='ACTIVE', is_active=True,
    )
    enq = _confirmed_enquiry(seed_data, api, 'RollB')
    resp = api.post(URL, {
        'enquiry_ids': [enq], 'academic_year_id': year.id, 'session_class_id': section_b.id,
    }, token, sid)
    assert resp.status_code == 201, resp.content[:300]
    assert resp.json()['converted'][0]['roll_number'] == '1'


def test_ambiguous_class_id_is_rejected(seed_data, api):
    token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
    _section(seed_data, 'A'), _section(seed_data, 'B')
    enq = _confirmed_enquiry(seed_data, api, 'Ambig')
    resp = api.post(URL, {
        'enquiry_ids': [enq], 'academic_year_id': seed_data['academic_year'].id,
        'class_id': seed_data['classes'][0].id,
    }, token, sid)
    assert resp.status_code == 400
    assert 'section' in resp.json()['detail'].lower()


def test_section_from_another_year_is_rejected(seed_data, api):
    from academic_sessions.models import AcademicYear
    from datetime import date
    token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
    other = AcademicYear.objects.create(
        school=seed_data['school_a'], name=f"{seed_data['prefix']}2031",
        start_date=date(2031, 4, 1), end_date=date(2032, 3, 31), is_current=False, is_active=True)
    section = _section(seed_data, 'A')
    enq = _confirmed_enquiry(seed_data, api, 'WrongYear')
    resp = api.post(URL, {
        'enquiry_ids': [enq], 'academic_year_id': other.id, 'session_class_id': section.id,
    }, token, sid)
    assert resp.status_code == 400
