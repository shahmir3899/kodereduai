"""Deleting a student hides them but keeps every row that points at them, and a
School Admin can restore them. A hard delete used to cascade away attendance,
marks and enrollments with no way back (Muhammad Abbas Jan, 2026-10-08)."""
from datetime import date

import pytest

from academic_sessions.models import AcademicYear, StudentEnrollment
from attendance.models import AttendanceRecord
from core.models import AdminActionLog
from finance.models import FeePayment
from students.models import Student


@pytest.fixture
def ctx(seed_data):
    student = seed_data['students'][0]
    school, year = seed_data['school_a'], seed_data['academic_year']
    enrollment = StudentEnrollment.objects.create(
        school=school, student=student, academic_year=year, class_obj=student.class_obj,
        roll_number=student.roll_number, status='ACTIVE',
    )
    old_year = AcademicYear.objects.create(
        school=school, name='Old Year', start_date=date(2024, 4, 1), end_date=date(2025, 3, 31),
        is_current=False,
    )
    closed = StudentEnrollment.objects.create(
        school=school, student=student, academic_year=old_year, class_obj=student.class_obj,
        roll_number=student.roll_number, status='PROMOTED', is_active=False,
    )
    fee = FeePayment.objects.create(
        school=school, student=student, fee_type='MONTHLY', month=1, year=2026, amount_due=500,
    )
    attendance = AttendanceRecord.objects.create(
        school=school, student=student, academic_year=year, date=date(2026, 1, 5), status='PRESENT',
    )
    return {**seed_data, 'student': student, 'enrollment': enrollment, 'closed': closed,
            'fee': fee, 'attendance': attendance}


def url(student, suffix=''):
    return f'/api/students/{student.id}/{suffix}'


def delete(api, ctx, student, **body):
    return api.client.delete(
        url(student), HTTP_AUTHORIZATION=f"Bearer {ctx['tokens']['admin']}",
        HTTP_X_SCHOOL_ID=str(ctx['SID_A']), data=body, content_type='application/json',
    )


def deleted_ids(api, ctx, token='admin', sid='SID_A'):
    body = api.get('/api/students/deleted/', ctx['tokens'][token], ctx[sid]).json()
    return {r['id']: r for r in body['results']}


@pytest.mark.django_db
class TestSoftDelete:
    def test_delete_hides_the_student_but_keeps_their_records(self, api, ctx):
        student = ctx['student']

        assert delete(api, ctx, student, reason='duplicate entry').status_code == 204

        assert not Student.objects.filter(id=student.id).exists()
        kept = Student.all_objects.get(id=student.id)
        assert kept.deleted_at is not None
        assert kept.deleted_by == ctx['users']['admin']
        assert kept.deleted_reason == 'duplicate entry'
        assert StudentEnrollment.objects.filter(id=ctx['enrollment'].id).exists()
        assert FeePayment.objects.get(id=ctx['fee'].id).student_id == student.id
        assert AttendanceRecord.objects.filter(id=ctx['attendance'].id).exists()

    def test_delete_works_with_no_request_body(self, api, ctx):
        # The reason is optional; a bare DELETE must not fail on the empty body.
        resp = api.delete(url(ctx['student']), ctx['tokens']['admin'], ctx['SID_A'])

        assert resp.status_code == 204, resp.content
        assert Student.all_objects.get(id=ctx['student'].id).deleted_reason == ''

    def test_a_deleted_student_is_gone_from_the_api_and_reverse_relations(self, api, ctx):
        student = ctx['student']
        delete(api, ctx, student)

        assert api.get(url(student), ctx['tokens']['admin'], ctx['SID_A']).status_code == 404
        listed = api.get('/api/students/?page_size=9999', ctx['tokens']['admin'], ctx['SID_A']).json()
        rows = listed['results'] if isinstance(listed, dict) else listed
        assert student.id not in {r['id'] for r in rows}
        assert not student.class_obj.students.filter(id=student.id).exists()

    def test_fee_payments_still_resolve_their_deleted_student(self, api, ctx):
        delete(api, ctx, ctx['student'])
        assert FeePayment.objects.get(id=ctx['fee'].id).student.name == ctx['student'].name

    def test_enrollment_is_closed_so_rosters_drop_them(self, api, ctx):
        delete(api, ctx, ctx['student'])
        assert not StudentEnrollment.objects.get(id=ctx['enrollment'].id).is_active

    def test_queryset_delete_is_soft_and_hard_delete_really_removes(self, ctx):
        student = ctx['student']
        Student.objects.filter(id=student.id).delete()
        assert Student.all_objects.filter(id=student.id).exists()

        Student.all_objects.get(id=student.id).hard_delete()
        assert not Student.all_objects.filter(id=student.id).exists()
        assert not AttendanceRecord.objects.filter(id=ctx['attendance'].id).exists()


@pytest.mark.django_db
class TestRestore:
    def test_deleted_list_shows_who_and_when(self, api, ctx):
        delete(api, ctx, ctx['student'], reason='oops')

        row = deleted_ids(api, ctx)[ctx['student'].id]

        assert row['deleted_by'] == ctx['users']['admin'].username
        assert row['deleted_reason'] == 'oops'
        assert row['deleted_at']

    def test_restore_brings_back_the_student_and_only_their_open_enrollments(self, api, ctx):
        student = ctx['student']
        delete(api, ctx, student)

        resp = api.post(url(student, 'restore/'), {}, ctx['tokens']['admin'], ctx['SID_A'])

        assert resp.status_code == 200, resp.content
        restored = Student.objects.get(id=student.id)
        assert restored.deleted_at is None and restored.deleted_by is None
        assert StudentEnrollment.objects.get(id=ctx['enrollment'].id).is_active
        # An enrollment that was already closed before the delete stays closed.
        assert not StudentEnrollment.objects.get(id=ctx['closed'].id).is_active
        assert AdminActionLog.objects.filter(action='student_restore', target_id=str(student.id)).exists()
        assert student.id not in deleted_ids(api, ctx)

    def test_restore_refuses_a_roll_number_that_was_reused(self, api, ctx):
        student = ctx['student']
        delete(api, ctx, student)
        other = Student.objects.create(
            school=ctx['school_a'], class_obj=student.class_obj, roll_number=student.roll_number,
            name='New Kid', status='ACTIVE',
        )

        resp = api.post(url(student, 'restore/'), {}, ctx['tokens']['admin'], ctx['SID_A'])
        assert resp.status_code == 409
        assert resp.json()['code'] == 'roll_conflict'
        assert Student.all_objects.get(id=student.id).deleted_at is not None

        ok = api.post(url(student, 'restore/'), {'roll_number': '999'}, ctx['tokens']['admin'], ctx['SID_A'])
        assert ok.status_code == 200
        assert Student.objects.get(id=student.id).roll_number == '999'
        assert other.roll_number != '999'

    def test_a_teacher_cannot_list_or_restore_deleted_students(self, api, ctx):
        student = ctx['student']
        delete(api, ctx, student)

        assert api.get('/api/students/deleted/', ctx['tokens']['teacher'], ctx['SID_A']).status_code == 403
        assert api.post(url(student, 'restore/'), {}, ctx['tokens']['teacher'], ctx['SID_A']).status_code == 403

    def test_another_schools_admin_cannot_see_or_restore_them(self, api, ctx):
        student = ctx['student']
        delete(api, ctx, student)

        assert student.id not in deleted_ids(api, ctx, token='admin_b', sid='SID_B')
        resp = api.post(url(student, 'restore/'), {}, ctx['tokens']['admin_b'], ctx['SID_B'])
        assert resp.status_code == 404
