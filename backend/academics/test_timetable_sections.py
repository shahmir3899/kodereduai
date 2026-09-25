"""
Section timetables: a section's override entries replace the class's shared
entry at the same day/slot, and every other slot follows the shared timetable.
Before, the (school, class_obj, day, slot) uniqueness meant two sections of one
master class could never have different timetables. Builds on
seed_data/seed_sections (Class_1A split into sections A and B).
"""
from datetime import time

import pytest
from django.db import IntegrityError, transaction

from academics.models import TimetableEntry, TimetableSlot
from academics.timetable_scope import student_timetable


pytestmark = pytest.mark.django_db


@pytest.fixture
def grid(seed_data, seed_sections):
    """Shared Monday: P1 Maths (staff 0), P2 Urdu (staff 1)."""
    school = seed_data['school_a']
    maths, urdu = seed_data['subjects']
    p1 = TimetableSlot.objects.create(
        school=school, name='P1', slot_type='PERIOD', start_time=time(8, 0), end_time=time(8, 40), order=1,
    )
    p2 = TimetableSlot.objects.create(
        school=school, name='P2', slot_type='PERIOD', start_time=time(8, 40), end_time=time(9, 20), order=2,
    )
    for slot, subject, teacher in ((p1, maths, seed_data['staff'][0]), (p2, urdu, seed_data['staff'][1])):
        TimetableEntry.objects.create(
            school=school, academic_year=seed_data['academic_year'], class_obj=seed_sections['master'],
            day='MON', slot=slot, subject=subject, teacher=teacher,
        )
    return {'p1': p1, 'p2': p2, 'maths': maths, 'urdu': urdu}


def _by_class(api, seed_data, seed_sections, section=None):
    url = f"/api/academics/timetable-entries/by_class/?class_id={seed_sections['master'].id}"
    if section is not None:
        url += f'&session_class_id={section.id}'
    response = api.get(url, seed_data['tokens']['admin'], seed_data['SID_A'])
    assert response.status_code == 200, response.content[:300]
    return {(e['day'], e['slot']): e for e in response.json()['entries']}


def _save_monday(api, seed_data, seed_sections, entries, section=None):
    payload = {'class_obj': seed_sections['master'].id, 'day': 'MON', 'entries': entries}
    if section is not None:
        payload['session_class'] = section.id
    return api.post(
        '/api/academics/timetable-entries/bulk_save/', payload,
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )


def test_section_override_replaces_only_its_slot(seed_data, seed_sections, grid, api):
    response = _save_monday(api, seed_data, seed_sections, [
        {'slot': grid['p1'].id, 'subject': grid['urdu'].id, 'teacher': seed_data['staff'][2].id},
    ], section=seed_sections['section_a'])
    assert response.status_code == 200, response.content[:300]

    a = _by_class(api, seed_data, seed_sections, seed_sections['section_a'])
    b = _by_class(api, seed_data, seed_sections, seed_sections['section_b'])
    shared = _by_class(api, seed_data, seed_sections)

    assert a[('MON', grid['p1'].id)]['subject'] == grid['urdu'].id
    assert a[('MON', grid['p1'].id)]['is_section_override'] is True
    assert a[('MON', grid['p2'].id)]['is_section_override'] is False  # P2 still shared
    assert b[('MON', grid['p1'].id)]['subject'] == grid['maths'].id
    assert all(not e['is_section_override'] for e in shared.values())
    assert len(shared) == 2


def test_saving_shared_day_keeps_section_overrides(seed_data, seed_sections, grid, api):
    _save_monday(api, seed_data, seed_sections, [
        {'slot': grid['p1'].id, 'subject': grid['urdu'].id, 'teacher': seed_data['staff'][2].id},
    ], section=seed_sections['section_a'])

    response = _save_monday(api, seed_data, seed_sections, [
        {'slot': grid['p1'].id, 'subject': grid['maths'].id},
        {'slot': grid['p2'].id, 'subject': grid['maths'].id},
    ])

    assert response.status_code == 200, response.content[:300]
    assert TimetableEntry.objects.filter(session_class=seed_sections['section_a'], day='MON').count() == 1


def test_clear_section_day_returns_to_shared(seed_data, seed_sections, grid, api):
    _save_monday(api, seed_data, seed_sections, [
        {'slot': grid['p1'].id, 'subject': grid['urdu'].id, 'teacher': seed_data['staff'][2].id},
    ], section=seed_sections['section_a'])

    response = api.post(
        '/api/academics/timetable-entries/clear_section_day/',
        {'session_class': seed_sections['section_a'].id, 'day': 'MON'},
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )

    assert response.status_code == 200, response.content[:300]
    a = _by_class(api, seed_data, seed_sections, seed_sections['section_a'])
    assert a[('MON', grid['p1'].id)]['subject'] == grid['maths'].id


def test_override_conflicts_with_shared_entry_still_used_by_other_section(seed_data, seed_sections, grid, api):
    # staff 0 teaches shared P1 (which section B still follows), so putting
    # them into section A's P1 would double-book them.
    response = _save_monday(api, seed_data, seed_sections, [
        {'slot': grid['p1'].id, 'subject': grid['urdu'].id, 'teacher': seed_data['staff'][0].id},
    ], section=seed_sections['section_a'])

    assert response.status_code == 400


def test_one_override_per_section_slot(seed_data, seed_sections, grid):
    fields = dict(
        school=seed_data['school_a'], class_obj=seed_sections['master'],
        session_class=seed_sections['section_a'], day='MON', slot=grid['p1'],
    )
    TimetableEntry.objects.create(**fields)
    with pytest.raises(IntegrityError), transaction.atomic():
        TimetableEntry.objects.create(**fields)


def test_split_gives_each_section_its_own_timetable(seed_data, seed_sections, grid, api):
    # Section A already has its own Monday P1; the split must not overwrite it.
    _save_monday(api, seed_data, seed_sections, [
        {'slot': grid['p1'].id, 'subject': grid['urdu'].id, 'teacher': seed_data['staff'][2].id},
    ], section=seed_sections['section_a'])

    response = api.post(
        '/api/academics/timetable-entries/split_for_sections/',
        {'class_obj': seed_sections['master'].id},
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )

    assert response.status_code == 200, response.content[:300]
    result = response.json()
    assert result['removed_shared'] == 2
    assert result['created'] == 3  # A gets P2; B gets P1 + P2
    # staff 1 teaches P2 in both sections now: one clash to fix.
    assert result['teacher_clashes'] == 1
    assert not TimetableEntry.objects.filter(class_obj=seed_sections['master'], session_class__isnull=True).exists()

    a = _by_class(api, seed_data, seed_sections, seed_sections['section_a'])
    b = _by_class(api, seed_data, seed_sections, seed_sections['section_b'])
    assert a[('MON', grid['p1'].id)]['subject'] == grid['urdu'].id
    assert b[('MON', grid['p1'].id)]['subject'] == grid['maths'].id
    assert all(e['is_section_override'] for e in list(a.values()) + list(b.values()))


def test_split_refuses_single_section_class(seed_data, api):
    response = api.post(
        '/api/academics/timetable-entries/split_for_sections/',
        {'class_obj': seed_data['classes'][2].id},
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )
    assert response.status_code == 400


def test_student_portal_sees_their_sections_timetable(seed_data, seed_sections, grid, api):
    _save_monday(api, seed_data, seed_sections, [
        {'slot': grid['p1'].id, 'subject': grid['urdu'].id, 'teacher': seed_data['staff'][2].id},
    ], section=seed_sections['section_a'])

    a_subjects = {e.slot_id: e.subject_id for e in student_timetable(seed_sections['a_students'][0])}
    b_subjects = {e.slot_id: e.subject_id for e in student_timetable(seed_sections['b_students'][0])}

    assert a_subjects == {grid['p1'].id: grid['urdu'].id, grid['p2'].id: grid['urdu'].id}
    assert b_subjects == {grid['p1'].id: grid['maths'].id, grid['p2'].id: grid['urdu'].id}
