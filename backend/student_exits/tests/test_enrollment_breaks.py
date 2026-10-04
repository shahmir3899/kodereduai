"""EnrollmentBreak: the record of a student's absence between an exit and re-admission."""
from datetime import date

import pytest
from django.db import IntegrityError, transaction

from academic_sessions.models import StudentEnrollment
from student_exits import services
from student_exits.models import EnrollmentBreak, StudentExit

URL = '/api/student-exits/'
LEAVING = date(2026, 3, 1)


@pytest.fixture
def ctx(seed_data):
    student = seed_data['students'][0]
    StudentEnrollment.objects.create(
        school=seed_data['school_a'], student=student, academic_year=seed_data['academic_year'],
        class_obj=student.class_obj, roll_number=student.roll_number, status='ACTIVE',
    )
    return {**seed_data, 'student': student}


def make_break(ctx, start, end=None, **extra):
    return EnrollmentBreak.objects.create(
        school=ctx['school_a'], student=ctx['student'], start_date=start, end_date=end, **extra,
    )


def finalize(api, ctx):
    created = api.post(URL, {
        'student': ctx['student'].id, 'exit_type': 'WITHDRAWN', 'leaving_date': LEAVING.isoformat(),
        'reason': 'Moved away',
    }, ctx['tokens']['admin'], ctx['SID_A']).json()
    resp = api.post(f"{URL}{created['id']}/finalize/", {}, ctx['tokens']['admin'], ctx['SID_A'])
    assert resp.status_code == 200, resp.content
    return StudentExit.objects.get(pk=created['id'])


class TestFinalizeOpensABreak:
    def test_finalizing_an_exit_opens_a_break_at_the_leaving_date(self, api, ctx):
        exit_case = finalize(api, ctx)
        brk = EnrollmentBreak.objects.get(student=ctx['student'])
        assert brk.start_date == LEAVING
        assert brk.end_date is None
        assert brk.exit_id == exit_case.id
        assert brk.school_id == ctx['SID_A']

    def test_a_cancelled_or_open_exit_opens_no_break(self, api, ctx):
        api.post(URL, {
            'student': ctx['student'].id, 'exit_type': 'WITHDRAWN', 'leaving_date': LEAVING.isoformat(),
        }, ctx['tokens']['admin'], ctx['SID_A'])
        assert EnrollmentBreak.objects.count() == 0

    def test_a_failed_finalize_leaves_no_break_behind(self, api, ctx, monkeypatch):
        created = api.post(URL, {
            'student': ctx['student'].id, 'exit_type': 'WITHDRAWN', 'leaving_date': LEAVING.isoformat(),
        }, ctx['tokens']['admin'], ctx['SID_A']).json()
        monkeypatch.setattr(services, '_deactivate_portal_login', lambda *a, **k: (_ for _ in ()).throw(RuntimeError('x')))
        with pytest.raises(RuntimeError):
            services.finalize_exit(StudentExit.objects.get(pk=created['id']), ctx['users']['admin'])
        assert EnrollmentBreak.objects.count() == 0

    def test_a_stale_open_break_is_reused_not_duplicated(self, api, ctx):
        make_break(ctx, date(2026, 1, 1))  # something left an open break behind
        finalize(api, ctx)
        breaks = EnrollmentBreak.objects.filter(student=ctx['student'])
        assert breaks.count() == 1
        assert breaks.get().start_date == LEAVING


class TestBreakRules:
    def test_covers_is_start_inclusive_and_end_exclusive(self, ctx):
        brk = make_break(ctx, date(2026, 3, 1), date(2026, 8, 3))
        assert not brk.covers(date(2026, 2, 28))
        assert brk.covers(date(2026, 3, 1))
        assert brk.covers(date(2026, 8, 2))
        assert not brk.covers(date(2026, 8, 3))

    def test_an_open_break_covers_everything_from_its_start(self, ctx):
        brk = make_break(ctx, date(2026, 3, 1))
        assert not brk.covers(date(2026, 2, 28))
        assert brk.covers(date(2030, 1, 1))

    def test_only_one_open_break_per_student(self, ctx):
        make_break(ctx, date(2026, 3, 1))
        with pytest.raises(IntegrityError), transaction.atomic():
            make_break(ctx, date(2026, 6, 1))

    def test_a_closed_break_does_not_block_a_new_open_one(self, ctx):
        make_break(ctx, date(2026, 3, 1), date(2026, 5, 1))
        make_break(ctx, date(2026, 6, 1))
        assert EnrollmentBreak.objects.filter(student=ctx['student']).count() == 2

    def test_a_break_must_end_after_it_starts(self, ctx):
        for end in (date(2026, 3, 1), date(2026, 2, 1)):
            with pytest.raises(IntegrityError), transaction.atomic():
                make_break(ctx, date(2026, 3, 1), end)

    def test_deleting_the_exit_keeps_the_break(self, api, ctx):
        exit_case = finalize(api, ctx)
        exit_case.delete()
        brk = EnrollmentBreak.objects.get(student=ctx['student'])
        assert brk.exit_id is None
