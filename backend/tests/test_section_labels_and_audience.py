"""A class with several sections is labelled as the class, and a class-wide
broadcast audience follows this year's enrollments, not the Student snapshot."""
import pytest

from academic_sessions.models import SessionClass, StudentEnrollment
from academic_sessions.utils import get_session_class_label_map, resolve_class_display_name

pytestmark = [pytest.mark.django_db]


def _section(seed_data, master, letter):
    return SessionClass.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        class_obj=master, display_name=master.name, section=letter,
        grade_level=master.grade_level, is_active=True)


def test_label_does_not_pick_one_of_two_sections(seed_data):
    master = seed_data['classes'][0]
    _section(seed_data, master, 'A')
    _section(seed_data, master, 'B')
    school_id, year_id = seed_data['school_a'].id, seed_data['academic_year'].id
    labels = get_session_class_label_map(school_id, year_id, [master.id])
    assert labels[master.id]['section'] == ''
    assert resolve_class_display_name(school_id, year_id, master) == master.name


def test_label_keeps_section_when_class_has_one(seed_data):
    master = seed_data['classes'][0]
    _section(seed_data, master, 'A')
    school_id, year_id = seed_data['school_a'].id, seed_data['academic_year'].id
    assert get_session_class_label_map(school_id, year_id, [master.id])[master.id]['section'] == 'A'
    assert resolve_class_display_name(school_id, year_id, master) == f'{master.name} - A'


def test_audience_follows_enrollment_not_snapshot(seed_data):
    from notifications.views import _build_filtered_students_qs
    master, other = seed_data['classes'][0], seed_data['classes'][1]
    student = seed_data['students'][0]
    # Snapshot says `other`; this year's enrollment says `master`.
    student.class_obj = other
    student.save(update_fields=['class_obj'])
    StudentEnrollment.objects.create(
        school=seed_data['school_a'], student=student, academic_year=seed_data['academic_year'],
        class_obj=master, roll_number='77', status='ACTIVE', is_active=True)
    ids = set(_build_filtered_students_qs(
        seed_data['school_a'].id, {'class_obj_id': master.id}).values_list('id', flat=True))
    assert student.id in ids
