"""Removal rules, steps 3-4: no bare status changes, departed students visible to read roles, guarded enrollment endpoint, and permanent delete only with no records."""
import json
from datetime import date

import pytest

from academic_sessions.models import StudentEnrollment
from attendance.models import AttendanceRecord
from core.models import AdminActionLog
from students.models import Student


@pytest.fixture
def fresh(seed_data):
    """A student with only the enrollment that creating one makes."""
    base = seed_data['students'][0]
    student = Student.objects.create(
        school=seed_data['school_a'], class_obj=base.class_obj, roll_number='990', name='Fresh Student',
    )
    StudentEnrollment.objects.create(
        school=seed_data['school_a'], student=student, academic_year=seed_data['academic_year'],
        class_obj=base.class_obj, roll_number='990', status='ACTIVE',
    )
    return student


def auth(ctx, token='admin'):
    return {'HTTP_AUTHORIZATION': f"Bearer {ctx['tokens'][token]}", 'HTTP_X_SCHOOL_ID': str(ctx['SID_A'])}


def patch(api, ctx, student, token='admin', **body):
    return api.client.patch(
        f'/api/students/{student.id}/', data=json.dumps(body), content_type='application/json', **auth(ctx, token),
    )


def attendance(ctx, student):
    return AttendanceRecord.objects.create(
        school=ctx['school_a'], student=student, academic_year=ctx['academic_year'],
        date=date(2026, 1, 5), status='PRESENT',
    )


@pytest.mark.django_db
class TestNoBareStatusChange:
    @pytest.mark.parametrize('new_status', ['WITHDRAWN', 'TRANSFERRED', 'GRADUATED', 'REPEAT'])
    def test_status_change_refused(self, api, seed_data, new_status):
        student = seed_data['students'][0]
        resp = patch(api, seed_data, student, status=new_status)
        assert resp.status_code == 400 and 'status' in resp.json()
        assert Student.objects.get(pk=student.pk).status == 'ACTIVE'

    def test_is_active_change_refused(self, api, seed_data):
        resp = patch(api, seed_data, seed_data['students'][0], is_active=False)
        assert resp.status_code == 400 and 'is_active' in resp.json()

    def test_resending_current_status_and_normal_edits_still_work(self, api, seed_data):
        resp = patch(api, seed_data, seed_data['students'][0], status='ACTIVE', parent_phone='0300-1234567')
        assert resp.status_code == 200, resp.content


@pytest.mark.django_db
class TestDepartedVisibleToReadRoles:
    """Teachers, managers and accountants are read-only, not blind: they see every
    filter, including students who left or graduated."""

    @pytest.mark.parametrize('token', ['teacher', 'manager', 'accountant'])
    def test_read_roles_can_list_departed_students(self, api, seed_data, token):
        student = seed_data['students'][0]
        StudentEnrollment.objects.update_or_create(
            school=seed_data['school_a'], student=student, academic_year=seed_data['academic_year'],
            defaults={'class_obj': student.class_obj, 'roll_number': student.roll_number,
                      'status': 'WITHDRAWN', 'is_active': False, 'left_date': date(2026, 1, 1)},
        )
        Student.objects.filter(pk=student.pk).update(status='WITHDRAWN')
        resp = api.get(
            '/api/students/?status_scope=left&page_size=200', seed_data['tokens'][token], seed_data['SID_A'],
        )
        # A teacher only sees students in their own scope, so only assert for roles with the full roster.
        assert resp.status_code == 200
        if token != 'teacher':
            assert student.id in {r['id'] for r in resp.json()['results']}

    @pytest.mark.parametrize('token', ['teacher', 'manager', 'accountant'])
    def test_read_roles_cannot_change_status(self, api, seed_data, token):
        resp = api.post(
            f"/api/students/{seed_data['students'][0].id}/outcome/",
            {'outcome': 'GRADUATED', 'reason': 'x'}, seed_data['tokens'][token], seed_data['SID_A'],
        )
        assert resp.status_code == 403


@pytest.mark.django_db
class TestEnrollmentEndpoint:
    def test_delete_refused_when_year_has_attendance(self, api, seed_data):
        student = seed_data['students'][1]
        enrollment, _ = StudentEnrollment.objects.get_or_create(
            school=seed_data['school_a'], student=student, academic_year=seed_data['academic_year'],
            defaults={'class_obj': student.class_obj, 'roll_number': student.roll_number, 'status': 'ACTIVE'},
        )
        attendance(seed_data, student)
        resp = api.client.delete(f'/api/sessions/enrollments/{enrollment.id}/', **auth(seed_data))
        assert resp.status_code == 409 and resp.json()['code'] == 'enrollment_has_records'
        assert StudentEnrollment.objects.filter(pk=enrollment.pk).exists()

    def test_delete_without_records_is_logged(self, api, seed_data, fresh):
        enrollment = StudentEnrollment.objects.get(student=fresh)
        resp = api.client.delete(f'/api/sessions/enrollments/{enrollment.id}/', **auth(seed_data))
        assert resp.status_code == 204
        assert AdminActionLog.objects.filter(action='enrollment_delete', target_id=str(enrollment.id)).exists()


@pytest.mark.django_db
class TestPurge:
    def remove(self, ctx, student):
        from django.test import Client
        return Client().delete(
            f'/api/students/{student.id}/', data={'reason': 'entered twice'}, content_type='application/json',
            **auth(ctx),
        )

    def purge(self, api, ctx, student, token='admin', **body):
        return api.post(f'/api/students/{student.id}/purge/', body, ctx['tokens'][token], ctx['SID_A'])

    def test_student_without_records_can_be_erased_after_removal(self, api, seed_data, fresh):
        assert self.remove(seed_data, fresh).status_code == 204
        resp = self.purge(api, seed_data, fresh, confirm_name=fresh.name)
        assert resp.status_code == 204, resp.content
        assert not Student.all_objects.filter(pk=fresh.pk).exists()
        assert AdminActionLog.objects.filter(action='student_purge', target_id=str(fresh.id)).exists()

    def test_student_with_records_is_refused(self, api, seed_data):
        student = seed_data['students'][0]
        attendance(seed_data, student)
        assert self.remove(seed_data, student).status_code == 204
        resp = self.purge(api, seed_data, student, confirm_name=student.name)
        assert resp.status_code == 409 and resp.json()['code'] == 'has_history'
        assert Student.all_objects.filter(pk=student.pk).exists()

    def test_not_removed_wrong_name_and_teacher_refused(self, api, seed_data, fresh):
        assert self.purge(api, seed_data, fresh, confirm_name=fresh.name).status_code == 404
        self.remove(seed_data, fresh)
        assert self.purge(api, seed_data, fresh, confirm_name='nope').status_code == 400
        assert self.purge(api, seed_data, fresh, token='teacher', confirm_name=fresh.name).status_code == 403
        assert Student.all_objects.filter(pk=fresh.pk).exists()
