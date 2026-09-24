"""
Enrollment placement stays consistent: session_class (the section) is the
source of truth and class_obj must always be its master class. Covers the two
writers that used to drift (student edit, section allocator) plus the shared
resolver and the model-level guard.
"""
import pytest

from academic_sessions.enrollment_service import move_student, resolve_session_class
from academic_sessions.models import SessionClass, StudentEnrollment
from academic_sessions.section_allocator_service import SectionAllocatorService
from students.models import Class, Student


pytestmark = [pytest.mark.django_db]


def _session_class(school, year, class_obj, section=''):
    return SessionClass.objects.create(
        school=school,
        academic_year=year,
        class_obj=class_obj,
        display_name=class_obj.name,
        section=section,
        grade_level=class_obj.grade_level,
        is_active=True,
    )


def _enroll(student, year, session_class, roll='1'):
    return StudentEnrollment.objects.create(
        school=student.school,
        student=student,
        academic_year=year,
        class_obj=session_class.class_obj,
        session_class=session_class,
        roll_number=roll,
        status='ACTIVE',
        is_active=True,
    )


def _assert_consistent(enrollment):
    enrollment.refresh_from_db()
    assert enrollment.session_class_id is not None
    assert enrollment.class_obj_id == enrollment.session_class.class_obj_id


class TestStudentEditKeepsSectionInSync:
    def test_changing_class_moves_session_class_too(self, seed_data, api):
        school, year = seed_data['school_a'], seed_data['academic_year']
        class_1, class_2 = seed_data['classes'][0], seed_data['classes'][1]
        student = seed_data['students'][0]
        sc_1 = _session_class(school, year, class_1)
        sc_2 = _session_class(school, year, class_2)
        enrollment = _enroll(student, year, sc_1, roll=student.roll_number)

        resp = api.patch(
            f'/api/students/{student.id}/',
            {'class_obj': class_2.id, 'roll_number': '77'},
            seed_data['tokens']['admin'],
            seed_data['SID_A'],
        )

        assert resp.status_code == 200, resp.content[:300]
        _assert_consistent(enrollment)
        assert enrollment.session_class_id == sc_2.id
        assert enrollment.roll_number == '77'

    def test_ambiguous_target_clears_section_instead_of_guessing(self, seed_data, api):
        school, year = seed_data['school_a'], seed_data['academic_year']
        class_1, class_2 = seed_data['classes'][0], seed_data['classes'][1]
        student = seed_data['students'][0]
        sc_1 = _session_class(school, year, class_1)
        # Two sections sharing one master class: a master class alone can't pick one.
        _session_class(school, year, class_2, section='A')
        _session_class(school, year, class_2, section='B')
        enrollment = _enroll(student, year, sc_1, roll=student.roll_number)

        resp = api.patch(
            f'/api/students/{student.id}/',
            {'class_obj': class_2.id},
            seed_data['tokens']['admin'],
            seed_data['SID_A'],
        )

        assert resp.status_code == 200, resp.content[:300]
        enrollment.refresh_from_db()
        assert enrollment.class_obj_id == class_2.id
        assert enrollment.session_class_id is None


class TestReclassify:
    def test_master_class_only_resolves_section(self, seed_data, api):
        school, year = seed_data['school_a'], seed_data['academic_year']
        class_1, class_2 = seed_data['classes'][0], seed_data['classes'][1]
        student = seed_data['students'][0]
        sc_1 = _session_class(school, year, class_1)
        sc_2 = _session_class(school, year, class_2)
        enrollment = _enroll(student, year, sc_1, roll=student.roll_number)

        resp = api.post(
            f'/api/students/{student.id}/reclassify/',
            {'academic_year_id': year.id, 'target_class_id': class_2.id, 'reason': 'test move'},
            seed_data['tokens']['admin'],
            seed_data['SID_A'],
        )

        assert resp.status_code == 200, resp.content[:300]
        assert resp.json()['target_session_class_id'] == sc_2.id
        _assert_consistent(enrollment)
        student.refresh_from_db()
        assert student.class_obj_id == class_2.id
        assert student.roll_number == enrollment.roll_number


class TestSectionAllocatorKeepsSectionInSync:
    def test_split_creates_session_classes_and_moves_enrollments(self, seed_data):
        school, year = seed_data['school_a'], seed_data['academic_year']
        source = Class.objects.create(school=school, name='Split Source', grade_level=7)
        source_sc = _session_class(school, year, source)
        students = [
            Student.objects.create(school=school, class_obj=source, roll_number=str(i), name=f'Split {i}')
            for i in range(1, 5)
        ]
        enrollments = [_enroll(s, year, source_sc, roll=s.roll_number) for s in students]

        allocation = {'sections': [
            {'section_name': 'A', 'students': [{'student_id': s.id} for s in students[:2]]},
            {'section_name': 'B', 'students': [{'student_id': s.id} for s in students[2:]]},
        ]}
        result = SectionAllocatorService(school.id).apply_allocation(
            academic_year_id=year.id, allocation_data=allocation, class_id=source.id,
        )

        assert result['success'], result
        assert result['errors'] == []
        for section, group in (('A', enrollments[:2]), ('B', enrollments[2:])):
            section_class = Class.objects.get(school=school, name=f'Split Source-{section}')
            section_sc = SessionClass.objects.get(school=school, academic_year=year, class_obj=section_class)
            for enrollment in group:
                _assert_consistent(enrollment)
                assert enrollment.session_class_id == section_sc.id
                enrollment.student.refresh_from_db()
                assert enrollment.student.class_obj_id == section_class.id


class TestPlacementPrimitives:
    def test_resolver_keeps_preferred_and_refuses_to_guess(self, seed_data):
        school, year = seed_data['school_a'], seed_data['academic_year']
        class_2 = seed_data['classes'][1]
        sc_a = _session_class(school, year, class_2, section='A')
        _session_class(school, year, class_2, section='B')

        kwargs = dict(school_id=school.id, academic_year_id=year.id, class_obj_id=class_2.id)
        assert resolve_session_class(**kwargs) is None
        assert resolve_session_class(**kwargs, prefer_id=sc_a.id) == sc_a

    def test_move_student_by_master_class_keeps_current_section(self, seed_data):
        school, year = seed_data['school_a'], seed_data['academic_year']
        class_2 = seed_data['classes'][1]
        student = seed_data['students'][4]
        sc_a = _session_class(school, year, class_2, section='A')
        _session_class(school, year, class_2, section='B')
        enrollment = _enroll(student, year, sc_a, roll=student.roll_number)

        move_student(enrollment, class_obj=class_2, roll_number='9')

        _assert_consistent(enrollment)
        assert enrollment.session_class_id == sc_a.id
        student.refresh_from_db()
        assert student.roll_number == '9'

    def test_model_save_derives_class_obj_from_session_class(self, seed_data):
        school, year = seed_data['school_a'], seed_data['academic_year']
        class_1, class_2 = seed_data['classes'][0], seed_data['classes'][1]
        student = seed_data['students'][0]
        sc_1 = _session_class(school, year, class_1)
        enrollment = _enroll(student, year, sc_1, roll=student.roll_number)

        # A writer that only touches class_obj (the old drift) is overruled.
        enrollment.class_obj = class_2
        enrollment.save(update_fields=['status'])

        _assert_consistent(enrollment)
        assert enrollment.class_obj_id == class_1.id
