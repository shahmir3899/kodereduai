"""Re-admission: the same student record comes back, the months away stay empty."""
from datetime import date, timedelta

import pytest

from academic_sessions.models import AcademicYear, SessionClass, StudentEnrollment
from attendance.models import AttendanceRecord
from core.models import AdminActionLog
from schools.models import UserSchoolMembership
from student_exits.models import EnrollmentBreak, StudentExit
from students.models import StudentProfile
from users.models import User

URL = '/api/student-exits/'
LEFT = date(2026, 3, 1)       # inside the seed year 2025-04-01 .. 2026-03-31
BACK_SAME_YEAR = date(2026, 3, 20)


@pytest.fixture
def ctx(seed_data):
    student = seed_data['students'][0]
    enrollment = StudentEnrollment.objects.create(
        school=seed_data['school_a'], student=student, academic_year=seed_data['academic_year'],
        class_obj=student.class_obj, roll_number=student.roll_number, status='ACTIVE',
    )
    return {**seed_data, 'student': student, 'enrollment': enrollment}


@pytest.fixture
def next_year(ctx):
    year = AcademicYear.objects.create(
        school=ctx['school_a'], name='PYTEST_2026-2027', start_date=date(2026, 4, 1),
        end_date=date(2027, 3, 31), is_current=False, is_active=True,
    )
    section = SessionClass.objects.create(
        school=ctx['school_a'], academic_year=year, class_obj=ctx['classes'][1],
        display_name='Class 2', section='B',
    )
    return {'year': year, 'section': section}


def leave(api, ctx, left=LEFT):
    created = api.post(URL, {
        'student': ctx['student'].id, 'exit_type': 'WITHDRAWN', 'leaving_date': left.isoformat(), 'reason': 'Moved',
    }, ctx['tokens']['admin'], ctx['SID_A']).json()
    resp = api.post(f"{URL}{created['id']}/finalize/", {}, ctx['tokens']['admin'], ctx['SID_A'])
    assert resp.status_code == 200, resp.content
    ctx['student'].refresh_from_db()


def readmit(api, ctx, who='admin', **body):
    data = {'student': ctx['student'].id, 'return_date': BACK_SAME_YEAR.isoformat(), 'reason': 'Returned home'}
    data.update(body)
    return api.post(f'{URL}readmit/', data, ctx['tokens'][who], ctx['SID_A'])


# ── same academic year ───────────────────────────────────────────────────────

class TestSameYear:
    def test_the_student_comes_back_with_the_same_record_class_and_roll(self, api, ctx):
        leave(api, ctx)
        resp = readmit(api, ctx)
        assert resp.status_code == 200, resp.content

        student = ctx['student']
        student.refresh_from_db()
        assert student.status == 'ACTIVE'
        assert student.status_date == BACK_SAME_YEAR
        assert student.status_reason == ''
        enrollment = StudentEnrollment.objects.get(student=student)
        assert enrollment.pk == ctx['enrollment'].pk  # the same row, not a new one
        assert (enrollment.is_active, enrollment.status, enrollment.left_date) == (True, 'ACTIVE', None)
        assert enrollment.roll_number == ctx['enrollment'].roll_number

    def test_the_break_is_closed_not_deleted_and_records_who_and_why(self, api, ctx):
        leave(api, ctx)
        body = readmit(api, ctx).json()
        brk = EnrollmentBreak.objects.get(student=ctx['student'])
        assert (brk.start_date, brk.end_date) == (LEFT, BACK_SAME_YEAR)
        assert brk.reason == 'Returned home'
        assert brk.readmitted_by == ctx['users']['admin']
        assert brk.readmitted_at is not None
        assert body['break']['start_date'] == '2026-03-01' and body['break']['end_date'] == '2026-03-20'
        assert body['break']['readmitted_by_name'] == ctx['users']['admin'].username

    def test_old_data_stays_attached_and_the_gap_stays_empty(self, api, ctx):
        record = AttendanceRecord.objects.create(
            school=ctx['school_a'], academic_year=ctx['academic_year'], student=ctx['student'],
            date=date(2026, 2, 10), status='PRESENT',
        )
        leave(api, ctx)
        readmit(api, ctx)
        assert AttendanceRecord.objects.filter(pk=record.pk, student=ctx['student']).exists()
        # a day inside the gap is refused, a day after the return is accepted
        def bulk(day):
            return api.post('/api/attendance/records/bulk_entry/', {
                'class_id': ctx['student'].class_obj_id, 'date': day.isoformat(),
                'entries': [{'student_id': ctx['student'].id, 'status': 'PRESENT'}],
            }, ctx['tokens']['admin'], ctx['SID_A']).json()
        assert bulk(date(2026, 3, 10))['created'] == 0
        assert bulk(date(2026, 3, 23))['created'] == 1

    def test_a_new_section_and_roll_can_be_chosen_on_return(self, api, ctx):
        section = SessionClass.objects.create(
            school=ctx['school_a'], academic_year=ctx['academic_year'], class_obj=ctx['classes'][1],
            display_name='Class 2', section='A',
        )
        leave(api, ctx)
        assert readmit(api, ctx, session_class=section.id, roll_number='40').status_code == 200
        enrollment = StudentEnrollment.objects.get(student=ctx['student'])
        assert enrollment.session_class_id == section.id
        assert enrollment.class_obj_id == ctx['classes'][1].id
        assert enrollment.roll_number == '40'
        ctx['student'].refresh_from_db()
        assert (ctx['student'].class_obj_id, ctx['student'].roll_number) == (ctx['classes'][1].id, '40')

    def test_a_roll_already_taken_in_the_target_section_is_refused_and_nothing_changes(self, api, ctx):
        section = SessionClass.objects.create(
            school=ctx['school_a'], academic_year=ctx['academic_year'], class_obj=ctx['classes'][1],
            display_name='Class 2', section='A',
        )
        other = ctx['students'][4]
        StudentEnrollment.objects.create(
            school=ctx['school_a'], student=other, academic_year=ctx['academic_year'], class_obj=ctx['classes'][1],
            session_class=section, roll_number='40', status='ACTIVE',
        )
        leave(api, ctx)
        resp = readmit(api, ctx, session_class=section.id, roll_number='40')
        assert resp.status_code == 400
        assert "Roll number '40' is already taken" in resp.json()['detail']
        ctx['student'].refresh_from_db()
        assert ctx['student'].status == 'WITHDRAWN'
        assert EnrollmentBreak.objects.get(student=ctx['student']).end_date is None

    def test_the_audit_log_records_the_return(self, api, ctx):
        leave(api, ctx)
        readmit(api, ctx)
        log = AdminActionLog.objects.get(action='student_readmitted')
        assert log.metadata['return_date'] == '2026-03-20'
        assert log.metadata['away_since'] == '2026-03-01'


# ── validation ───────────────────────────────────────────────────────────────

class TestValidation:
    def test_a_student_who_has_not_left_cannot_be_readmitted(self, api, ctx):
        resp = readmit(api, ctx)
        assert resp.status_code == 400
        assert 'nothing to re-admit' in resp.json()['detail']

    @pytest.mark.parametrize('back', [LEFT, LEFT - timedelta(days=5)])
    def test_the_return_date_must_be_after_the_leaving_date(self, api, ctx, back):
        leave(api, ctx)
        resp = readmit(api, ctx, return_date=back.isoformat())
        assert resp.status_code == 400
        assert 'must be after the day they left (2026-03-01)' in resp.json()['detail']
        ctx['student'].refresh_from_db()
        assert ctx['student'].status == 'WITHDRAWN'

    def test_a_class_from_another_year_is_refused(self, api, ctx, next_year):
        leave(api, ctx)
        resp = readmit(api, ctx, session_class=next_year['section'].id, roll_number='1')
        assert resp.status_code == 400
        assert 'Choose a class of' in resp.json()['detail']

    def test_a_class_that_does_not_exist_is_refused(self, api, ctx):
        leave(api, ctx)
        assert readmit(api, ctx, session_class=999999).status_code == 400

    def test_the_return_date_is_required(self, api, ctx):
        leave(api, ctx)
        resp = api.post(f'{URL}readmit/', {'student': ctx['student'].id}, ctx['tokens']['admin'], ctx['SID_A'])
        assert resp.status_code == 400


# ── a later academic year ────────────────────────────────────────────────────

class TestLaterYear:
    BACK = date(2026, 8, 3)

    def test_a_class_and_roll_are_needed_when_there_is_no_enrollment_that_year(self, api, ctx, next_year):
        leave(api, ctx)
        resp = readmit(api, ctx, return_date=self.BACK.isoformat())
        assert resp.status_code == 400
        assert 'Choose a class and a roll number' in resp.json()['detail']

    def test_a_new_enrollment_is_created_and_the_old_year_is_left_as_it_was(self, api, ctx, next_year):
        leave(api, ctx)
        resp = readmit(api, ctx, return_date=self.BACK.isoformat(), session_class=next_year['section'].id, roll_number='7')
        assert resp.status_code == 200, resp.content

        new = StudentEnrollment.objects.get(student=ctx['student'], academic_year=next_year['year'])
        assert (new.session_class_id, new.roll_number, new.is_active, new.status) == (next_year['section'].id, '7', True, 'ACTIVE')
        assert new.class_obj_id == ctx['classes'][1].id
        old = StudentEnrollment.objects.get(pk=ctx['enrollment'].pk)
        assert (old.is_active, old.status, old.left_date) == (False, 'WITHDRAWN', LEFT)  # last year's record is history
        brk = EnrollmentBreak.objects.get(student=ctx['student'])
        assert (brk.start_date, brk.end_date) == (LEFT, self.BACK)
        ctx['student'].refresh_from_db()
        assert ctx['student'].status == 'ACTIVE'
        assert (ctx['student'].class_obj_id, ctx['student'].roll_number) == (ctx['classes'][1].id, '7')


# ── future dates ─────────────────────────────────────────────────────────────

class TestFutureReturn:
    def test_a_future_return_date_is_allowed_and_the_days_before_it_stay_closed(self, api, ctx):
        leave(api, ctx)
        back = date.today() + timedelta(days=30)
        assert readmit(api, ctx, return_date=back.isoformat()).status_code == 200
        ctx['student'].refresh_from_db()
        assert ctx['student'].status == 'ACTIVE'
        assert EnrollmentBreak.objects.get(student=ctx['student']).end_date == back
        resp = api.post('/api/attendance/records/bulk_entry/', {
            'class_id': ctx['student'].class_obj_id, 'date': (date.today() + timedelta(days=1)).isoformat(),
            'entries': [{'student_id': ctx['student'].id, 'status': 'PRESENT'}],
        }, ctx['tokens']['admin'], ctx['SID_A'])
        assert resp.json()['created'] == 0


# ── accounts ─────────────────────────────────────────────────────────────────

class TestLogin:
    def test_the_students_own_login_comes_back_with_them(self, api, ctx):
        login = User.objects.create_user(
            username='SEED_pupil', email='pupil@test.com', password='x', role='STUDENT',
            school=ctx['school_a'], organization=ctx['org'],
        )
        membership = UserSchoolMembership.objects.create(user=login, school=ctx['school_a'], role='STUDENT')
        StudentProfile.objects.create(user=login, student=ctx['student'], school=ctx['school_a'])
        leave(api, ctx)
        membership.refresh_from_db()
        assert membership.is_active is False
        readmit(api, ctx)
        membership.refresh_from_db()
        assert membership.is_active is True


# ── exits that predate breaks, and the old status dialog ─────────────────────

class TestLegacyAndOldPath:
    def withdrawn_without_a_break(self, ctx):
        """How a student looked after Stage 1 or earlier: departed, enrollment closed, no break."""
        ctx['student'].status = 'WITHDRAWN'
        ctx['student'].status_date = LEFT
        ctx['student'].save()
        ctx['enrollment'].is_active = False
        ctx['enrollment'].status = 'WITHDRAWN'
        ctx['enrollment'].left_date = LEFT
        ctx['enrollment'].save()

    def test_readmitting_a_student_with_no_break_records_the_gap_from_the_enrollment(self, api, ctx):
        self.withdrawn_without_a_break(ctx)
        assert readmit(api, ctx).status_code == 200
        brk = EnrollmentBreak.objects.get(student=ctx['student'])
        assert (brk.start_date, brk.end_date, brk.exit_id) == (LEFT, BACK_SAME_YEAR, None)

    def test_a_student_with_no_recorded_leaving_date_is_refused(self, api, ctx):
        ctx['student'].status = 'WITHDRAWN'
        ctx['student'].status_date = None
        ctx['student'].save()
        resp = readmit(api, ctx)
        assert resp.status_code == 400
        assert "can't tell when this student left" in resp.json()['detail']

    def patch_status(self, api, ctx, status, day):
        """What the Update Status dialog used to do. A bare PATCH of status is now refused,
        but sync_enrollment_status still runs for any other caller that changes it, so the
        break bookkeeping is exercised directly."""
        from academic_sessions.leaving import sync_enrollment_status

        student = ctx['student']
        student.refresh_from_db()
        previous_status, previous_date = student.status, student.status_date
        student.status, student.status_date = status, day
        student.save()
        sync_enrollment_status(student, previous_status, previous_date)

        class Ok:
            status_code = 200
        return Ok()

    def test_a_bare_status_patch_is_refused(self, api, ctx):
        resp = api.patch(f"/api/students/{ctx['student'].id}/", {'status': 'WITHDRAWN'},
                         ctx['tokens']['admin'], ctx['SID_A'])
        assert resp.status_code == 400

    def test_leaving_through_the_old_status_dialog_also_opens_a_break(self, api, ctx):
        assert self.patch_status(api, ctx, 'WITHDRAWN', LEFT).status_code == 200
        brk = EnrollmentBreak.objects.get(student=ctx['student'])
        assert (brk.start_date, brk.end_date) == (LEFT, None)

    def test_reactivating_through_the_old_status_dialog_closes_the_break(self, api, ctx):
        leave(api, ctx)
        assert self.patch_status(api, ctx, 'ACTIVE', BACK_SAME_YEAR).status_code == 200
        brk = EnrollmentBreak.objects.get(student=ctx['student'])
        assert (brk.start_date, brk.end_date) == (LEFT, BACK_SAME_YEAR)
        enrollment = StudentEnrollment.objects.get(student=ctx['student'])
        assert enrollment.is_active is True and enrollment.left_date is None

    def test_reactivating_an_old_exit_with_no_break_records_one(self, api, ctx):
        self.withdrawn_without_a_break(ctx)
        assert self.patch_status(api, ctx, 'ACTIVE', BACK_SAME_YEAR).status_code == 200
        brk = EnrollmentBreak.objects.get(student=ctx['student'])
        assert (brk.start_date, brk.end_date) == (LEFT, BACK_SAME_YEAR)

    def test_a_same_day_reactivation_still_records_a_one_day_break(self, api, ctx):
        leave(api, ctx)
        assert self.patch_status(api, ctx, 'ACTIVE', LEFT).status_code == 200
        brk = EnrollmentBreak.objects.get(student=ctx['student'])
        assert brk.end_date == LEFT + timedelta(days=1)


# ── access ───────────────────────────────────────────────────────────────────

class TestAccess:
    @pytest.mark.parametrize('who', ['teacher', 'manager', 'accountant', 'staff'])
    def test_only_principal_and_admins_can_readmit(self, api, ctx, who):
        leave(api, ctx)
        assert readmit(api, ctx, who=who).status_code == 403

    def test_principal_can_readmit(self, api, ctx):
        leave(api, ctx)
        assert readmit(api, ctx, who='principal').status_code == 200

    def test_another_schools_admin_cannot_readmit_the_student(self, api, ctx):
        leave(api, ctx)
        resp = api.post(f'{URL}readmit/', {
            'student': ctx['student'].id, 'return_date': BACK_SAME_YEAR.isoformat(),
        }, ctx['tokens']['admin_b'], ctx['SID_B'])
        assert resp.status_code == 404


# ── reading the gap ──────────────────────────────────────────────────────────

class TestAwayPeriods:
    def test_the_student_endpoint_lists_closed_and_open_breaks(self, api, ctx):
        leave(api, ctx)
        readmit(api, ctx)
        resp = api.get(f"/api/students/{ctx['student'].id}/away_periods/", ctx['tokens']['admin'], ctx['SID_A'])
        assert resp.status_code == 200
        assert [(b['start_date'], b['end_date'], b['reason']) for b in resp.json()] == [
            ('2026-03-01', '2026-03-20', 'Returned home'),
        ]

    def test_the_student_serializer_carries_away_periods_in_detail_and_list(self, api, ctx):
        leave(api, ctx)
        readmit(api, ctx)
        detail = api.get(f"/api/students/{ctx['student'].id}/", ctx['tokens']['admin'], ctx['SID_A']).json()
        assert detail['away_periods'] == [{'start': '2026-03-01', 'end': '2026-03-20', 'reason': 'Returned home', 'joined_from_transfer': False}]
        listing = api.get('/api/students/?page_size=50', ctx['tokens']['admin'], ctx['SID_A']).json()
        rows = {r['id']: r for r in listing['results']}
        assert rows[ctx['student'].id]['away_periods'] == [{'start': '2026-03-01', 'end': '2026-03-20', 'reason': 'Returned home', 'joined_from_transfer': False}]
        assert rows[ctx['students'][1].id]['away_periods'] == []

    def test_an_open_break_shows_with_no_end(self, api, ctx):
        leave(api, ctx)
        detail = api.get(f"/api/students/{ctx['student'].id}/", ctx['tokens']['admin'], ctx['SID_A']).json()
        assert detail['away_periods'] == [{'start': '2026-03-01', 'end': None, 'reason': '', 'joined_from_transfer': False}]

    def test_the_list_does_not_query_breaks_once_per_student(self, api, ctx, django_assert_max_num_queries):
        leave(api, ctx)
        readmit(api, ctx)
        url = '/api/students/?page_size=50'
        api.get(url, ctx['tokens']['admin'], ctx['SID_A'])  # warm caches (content types etc.)
        with django_assert_max_num_queries(60):
            assert api.get(url, ctx['tokens']['admin'], ctx['SID_A']).status_code == 200
