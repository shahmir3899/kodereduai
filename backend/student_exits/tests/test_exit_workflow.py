"""Student exit workflow: clearance, waivers, finalization, permissions, tenancy.

Reuses the shared seed_data fixture (School Alpha + Beta in one organization).
"""
from datetime import date, time, timedelta
from decimal import Decimal

import pytest
from django.test import override_settings

from academic_sessions.models import StudentEnrollment
from finance.models import Account, FeePayment, MonthlyFeeCategory
from finance.student_balance import student_pending_fees
from schools.models import Organization, School, UserSchoolMembership
from student_exits import services
from student_exits.models import ExitClearanceItem, StudentExit

URL = '/api/student-exits/'
LEAVING = date(2026, 3, 1)


# ── helpers ──────────────────────────────────────────────────────────────────

@pytest.fixture
def ctx(seed_data):
    """Student 0 of School Alpha with an active enrollment this year."""
    student = seed_data['students'][0]
    StudentEnrollment.objects.create(
        school=seed_data['school_a'], student=student, academic_year=seed_data['academic_year'],
        class_obj=student.class_obj, roll_number=student.roll_number, status='ACTIVE',
    )
    return {**seed_data, 'student': student}


def start(api, ctx, who='admin', **overrides):
    body = {
        'student': ctx['student'].id, 'exit_type': 'WITHDRAWN',
        'leaving_date': LEAVING.isoformat(), 'reason': 'Family relocated',
    }
    body.update(overrides)
    return api.post(URL, body, ctx['tokens'][who], ctx['SID_A'])


def _account(ctx):
    account, _ = Account.objects.get_or_create(
        school=ctx['school_a'], name='Cash', defaults={'account_type': 'CASH'},
    )
    return account


def monthly_payment(ctx, category, month, due, paid, year=2026):
    paid = Decimal(paid)
    extra = {'payment_date': date(year, month, 5), 'account': _account(ctx)} if paid else {}
    return FeePayment.objects.create(
        school=ctx['school_a'], academic_year=ctx['academic_year'], student=ctx['student'],
        fee_type='MONTHLY', monthly_category=category, month=month, year=year,
        amount_due=Decimal(due), amount_paid=paid,
        status='PAID' if Decimal(due) == paid else ('PARTIAL' if paid else 'UNPAID'),
        **extra,
    )


@pytest.fixture
def category(ctx):
    return MonthlyFeeCategory.objects.create(school=ctx['school_a'], name='Tuition')


def item(exit_case, kind):
    return exit_case.items.get(kind=kind)


# ── pending fee calculation ──────────────────────────────────────────────────

class TestPendingFees:
    def test_cumulative_monthly_rows_are_not_double_counted(self, ctx, category):
        # January 1000 unpaid; February's due already carries it: 1000 + 1000.
        monthly_payment(ctx, category, 1, '1000', '0')
        monthly_payment(ctx, category, 2, '2000', '500')
        result = student_pending_fees(ctx['student'])
        assert result['total'] == Decimal('1500')
        assert len(result['items']) == 1

    def test_each_category_counts_once_and_other_fee_types_add(self, ctx, category):
        other = MonthlyFeeCategory.objects.create(school=ctx['school_a'], name='Transport')
        monthly_payment(ctx, category, 2, '1000', '0')
        monthly_payment(ctx, other, 2, '300', '100')
        FeePayment.objects.create(
            school=ctx['school_a'], academic_year=ctx['academic_year'], student=ctx['student'],
            fee_type='ANNUAL', month=0, year=2026, amount_due=Decimal('800'), amount_paid=Decimal('0'),
        )
        assert student_pending_fees(ctx['student'])['total'] == Decimal('2000')

    def test_paid_up_and_credit_rows_owe_nothing(self, ctx, category):
        monthly_payment(ctx, category, 1, '1000', '1000')
        assert student_pending_fees(ctx['student'])['total'] == Decimal('0')
        monthly_payment(ctx, category, 2, '1000', '1500')
        assert student_pending_fees(ctx['student'])['total'] == Decimal('0')


# ── permissions and tenancy ──────────────────────────────────────────────────

class TestAccess:
    @pytest.mark.parametrize('who', ['admin', 'principal'])
    def test_admin_and_principal_can_start_an_exit(self, api, ctx, who):
        resp = start(api, ctx, who)
        assert resp.status_code == 201, resp.content
        assert resp.json()['status'] == 'OPEN'

    @pytest.mark.parametrize('who', ['teacher', 'manager', 'accountant', 'staff'])
    def test_other_roles_are_refused(self, api, ctx, who):
        assert start(api, ctx, who).status_code == 403
        assert api.get(URL, ctx['tokens'][who], ctx['SID_A']).status_code == 403

    def test_another_school_cannot_see_or_start_an_exit(self, api, ctx):
        created = start(api, ctx).json()
        other = ctx['tokens']['admin_b']
        assert api.get(f"{URL}{created['id']}/", other, ctx['SID_B']).status_code == 404
        assert api.get(URL, other, ctx['SID_B']).json()['count'] == 0
        resp = api.post(URL, {
            'student': ctx['student'].id, 'exit_type': 'WITHDRAWN', 'leaving_date': LEAVING.isoformat(),
        }, other, ctx['SID_B'])
        assert resp.status_code == 404

    def test_unauthenticated_is_refused(self, api_client, db):
        assert api_client.get(URL).status_code in (401, 403)


# ── opening an exit ──────────────────────────────────────────────────────────

class TestOpen:
    def test_open_creates_clearance_items_for_every_kind(self, api, ctx):
        data = start(api, ctx).json()
        assert {i['kind'] for i in data['items']} == {'FEES', 'LIBRARY', 'GATE_PASS'}
        assert all(i['state'] == 'CLEAR' for i in data['items'])
        assert data['open_item_count'] == 0

    def test_only_one_open_exit_per_student(self, api, ctx):
        assert start(api, ctx).status_code == 201
        resp = start(api, ctx)
        assert resp.status_code == 400
        assert 'already has an exit in progress' in resp.json()['detail']

    def test_a_cancelled_exit_does_not_block_a_new_one(self, api, ctx):
        first = start(api, ctx).json()
        assert api.post(f"{URL}{first['id']}/cancel/", {'reason': 'Changed their mind'},
                        ctx['tokens']['admin'], ctx['SID_A']).status_code == 200
        assert start(api, ctx).status_code == 201

    def test_a_student_who_already_left_cannot_start_another(self, api, ctx):
        ctx['student'].status = 'WITHDRAWN'
        ctx['student'].save()
        resp = start(api, ctx)
        assert resp.status_code == 400
        assert 'already left' in resp.json()['detail']

    def test_leaving_date_is_required(self, api, ctx):
        resp = api.post(URL, {'student': ctx['student'].id, 'exit_type': 'WITHDRAWN'},
                        ctx['tokens']['admin'], ctx['SID_A'])
        assert resp.status_code == 400

    def test_fee_item_opens_with_the_pending_amount(self, api, ctx, category):
        monthly_payment(ctx, category, 1, '1000', '0')
        monthly_payment(ctx, category, 2, '2000', '500')
        data = start(api, ctx).json()
        fees = next(i for i in data['items'] if i['kind'] == 'FEES')
        assert fees['state'] == 'OPEN'
        assert Decimal(fees['amount']) == Decimal('1500')
        assert '1,500' in fees['summary']

    def test_fee_summary_keeps_the_cents(self, api, ctx, category):
        monthly_payment(ctx, category, 3, '3847.50', '0')
        fees = next(i for i in start(api, ctx).json()['items'] if i['kind'] == 'FEES')
        assert fees['summary'] == 'PKR 3,847.50 pending'

    def test_records_after_the_leaving_date_are_reported_in_the_dialogs_shape(self, api, ctx):
        from attendance.models import AttendanceRecord
        AttendanceRecord.objects.create(
            school=ctx['school_a'], academic_year=ctx['academic_year'], student=ctx['student'],
            date=LEAVING + timedelta(days=3), status='PRESENT',
        )
        resp = start(api, ctx)
        assert resp.status_code == 400
        body = resp.json()
        assert body['code'] == 'records_after_leaving'
        assert body['attendance']['count'] == 1
        assert body['suggested_leaving_date'] == (LEAVING + timedelta(days=4)).isoformat()

    def test_records_can_be_marked_for_removal_instead(self, api, ctx):
        from attendance.models import AttendanceRecord
        AttendanceRecord.objects.create(
            school=ctx['school_a'], academic_year=ctx['academic_year'], student=ctx['student'],
            date=LEAVING + timedelta(days=3), status='PRESENT',
        )
        assert start(api, ctx, remove_records_after_leaving=True).status_code == 201


class TestTransferDestination:
    def test_transfer_needs_a_destination(self, api, ctx):
        resp = start(api, ctx, exit_type='TRANSFERRED')
        assert resp.status_code == 400
        assert 'Choose the branch' in resp.json()['detail']

    def test_transfer_to_a_school_of_the_same_organization(self, api, ctx):
        resp = start(api, ctx, exit_type='TRANSFERRED', destination_school=ctx['SID_B'])
        assert resp.status_code == 201, resp.content
        assert resp.json()['destination_school_name'] == ctx['school_b'].name

    def test_transfer_to_the_same_school_is_refused(self, api, ctx):
        resp = start(api, ctx, exit_type='TRANSFERRED', destination_school=ctx['SID_A'])
        assert resp.status_code == 400

    def test_transfer_outside_the_organization_is_refused(self, api, ctx):
        outsider = School.objects.create(
            organization=Organization.objects.create(name='Other Org', slug='other-org'),
            name='Elsewhere', subdomain='elsewhere',
        )
        resp = start(api, ctx, exit_type='TRANSFERRED', destination_school=outsider.id)
        assert resp.status_code == 400
        assert 'same organization' in resp.json()['detail']

    def test_a_destination_on_a_withdrawal_is_refused(self, api, ctx):
        assert start(api, ctx, destination_school=ctx['SID_B']).status_code == 400


# ── waivers ──────────────────────────────────────────────────────────────────

class TestWaivers:
    def open_with_fees(self, api, ctx, category):
        monthly_payment(ctx, category, 2, '1000', '0')
        return start(api, ctx).json()

    def waive(self, api, ctx, exit_id, kind='FEES', reason='Hardship case approved by the board'):
        return api.post(f'{URL}{exit_id}/items/{kind}/waive/', {'reason': reason},
                        ctx['tokens']['admin'], ctx['SID_A'])

    def test_waiving_records_reason_person_and_time(self, api, ctx, category):
        exit_id = self.open_with_fees(api, ctx, category)['id']
        resp = self.waive(api, ctx, exit_id)
        assert resp.status_code == 200, resp.content
        fees = next(i for i in resp.json()['items'] if i['kind'] == 'FEES')
        assert fees['state'] == 'WAIVED'
        assert fees['waiver_reason'] == 'Hardship case approved by the board'
        assert fees['waived_by_name'] == ctx['users']['admin'].username
        assert fees['waived_at']

    def test_a_short_reason_is_refused(self, api, ctx, category):
        exit_id = self.open_with_fees(api, ctx, category)['id']
        resp = self.waive(api, ctx, exit_id, reason='no')
        assert resp.status_code == 400
        assert 'at least 10 characters' in resp.json()['detail']

    def test_a_clear_item_cannot_be_waived(self, api, ctx):
        exit_id = start(api, ctx).json()['id']
        resp = self.waive(api, ctx, exit_id, kind='LIBRARY')
        assert resp.status_code == 400
        assert 'already clear' in resp.json()['detail']

    def test_unknown_item_is_404(self, api, ctx):
        exit_id = start(api, ctx).json()['id']
        assert self.waive(api, ctx, exit_id, kind='NOPE').status_code == 404

    def test_unwaive_reopens_the_item(self, api, ctx, category):
        exit_id = self.open_with_fees(api, ctx, category)['id']
        self.waive(api, ctx, exit_id)
        resp = api.post(f'{URL}{exit_id}/items/FEES/unwaive/', {}, ctx['tokens']['admin'], ctx['SID_A'])
        fees = next(i for i in resp.json()['items'] if i['kind'] == 'FEES')
        assert fees['state'] == 'OPEN'
        assert fees['waiver_reason'] == ''

    def test_a_waiver_lapses_when_the_situation_changes(self, api, ctx, category):
        exit_id = self.open_with_fees(api, ctx, category)['id']
        self.waive(api, ctx, exit_id)
        monthly_payment(ctx, category, 3, '2000', '0')  # more fees generated after the waiver
        resp = api.post(f'{URL}{exit_id}/refresh/', {}, ctx['tokens']['admin'], ctx['SID_A'])
        fees = next(i for i in resp.json()['items'] if i['kind'] == 'FEES')
        assert fees['state'] == 'OPEN'
        assert Decimal(fees['amount']) == Decimal('2000')

    def test_a_waiver_survives_a_refresh_when_nothing_changed(self, api, ctx, category):
        exit_id = self.open_with_fees(api, ctx, category)['id']
        self.waive(api, ctx, exit_id)
        resp = api.post(f'{URL}{exit_id}/refresh/', {}, ctx['tokens']['admin'], ctx['SID_A'])
        assert next(i for i in resp.json()['items'] if i['kind'] == 'FEES')['state'] == 'WAIVED'

    def test_paying_the_fees_clears_the_item_by_itself(self, api, ctx, category):
        payment = None
        monthly_payment(ctx, category, 1, '1000', '0')
        exit_id = start(api, ctx).json()['id']
        payment = FeePayment.objects.get(student=ctx['student'], month=1)
        payment.amount_paid = payment.amount_due
        payment.payment_date = date(2026, 2, 1)
        payment.account = _account(ctx)
        payment.status = 'PAID'
        payment.save()
        resp = api.post(f'{URL}{exit_id}/refresh/', {}, ctx['tokens']['admin'], ctx['SID_A'])
        assert next(i for i in resp.json()['items'] if i['kind'] == 'FEES')['state'] == 'CLEAR'


# ── finalize ─────────────────────────────────────────────────────────────────

class TestFinalize:
    def finalize(self, api, ctx, exit_id, who='admin'):
        return api.post(f'{URL}{exit_id}/finalize/', {}, ctx['tokens'][who], ctx['SID_A'])

    def test_finalize_is_blocked_until_open_items_are_cleared_or_waived(self, api, ctx, category):
        monthly_payment(ctx, category, 1, '1000', '0')
        exit_id = start(api, ctx).json()['id']
        resp = self.finalize(api, ctx, exit_id)
        assert resp.status_code == 400
        assert resp.json()['code'] == 'clearance_incomplete'
        assert resp.json()['open_items'] == ['FEES']
        ctx['student'].refresh_from_db()
        assert ctx['student'].status == 'ACTIVE'
        assert StudentExit.objects.get(pk=exit_id).status == 'OPEN'

    def test_finalize_after_a_waiver_applies_the_departure(self, api, ctx, category):
        monthly_payment(ctx, category, 1, '1000', '0')
        exit_id = start(api, ctx).json()['id']
        api.post(f'{URL}{exit_id}/items/FEES/waive/', {'reason': 'Fee concession granted by principal'},
                 ctx['tokens']['principal'], ctx['SID_A'])
        resp = self.finalize(api, ctx, exit_id, who='principal')
        assert resp.status_code == 200, resp.content
        data = resp.json()
        assert data['status'] == 'FINALIZED'
        assert data['finalized_by_name'] == ctx['users']['principal'].username

        student = ctx['student']
        student.refresh_from_db()
        assert student.status == 'WITHDRAWN'
        assert student.status_date == LEAVING
        assert student.status_reason == 'Family relocated'
        enrollment = StudentEnrollment.objects.get(student=student)
        assert enrollment.is_active is False
        assert enrollment.status == 'WITHDRAWN'
        assert enrollment.left_date == LEAVING

    def test_the_snapshot_keeps_the_waiver_and_the_audit_log_records_it(self, api, ctx, category):
        from core.models import AdminActionLog
        monthly_payment(ctx, category, 1, '1000', '0')
        exit_id = start(api, ctx).json()['id']
        api.post(f'{URL}{exit_id}/items/FEES/waive/', {'reason': 'Fee concession granted by principal'},
                 ctx['tokens']['admin'], ctx['SID_A'])
        data = self.finalize(api, ctx, exit_id).json()
        fees = next(c for c in data['snapshot']['clearance'] if c['kind'] == 'FEES')
        assert fees['state'] == 'WAIVED'
        assert fees['waiver_reason'] == 'Fee concession granted by principal'
        assert Decimal(data['snapshot']['pending_fees']) == Decimal('1000')
        log = AdminActionLog.objects.get(action='student_exit_finalized')
        assert log.metadata['exit_id'] == exit_id

    def test_finalize_closes_hostel_transport_and_unused_gate_passes(self, api, ctx):
        from hostel.models import GatePass, Hostel, HostelAllocation, Room
        from transport.models import TransportAssignment, TransportRoute, TransportStop
        hostel = Hostel.objects.create(school=ctx['school_a'], name='H1', hostel_type='BOYS')
        room = Room.objects.create(hostel=hostel, room_number='1')
        allocation = HostelAllocation.objects.create(
            school=ctx['school_a'], student=ctx['student'], room=room, academic_year=ctx['academic_year'],
        )
        pending_pass = GatePass.objects.create(
            school=ctx['school_a'], student=ctx['student'], allocation=allocation, pass_type='HOME_VISIT',
            reason='x', going_to='home', departure_date=date(2026, 3, 5), expected_return=date(2026, 3, 6),
            status='APPROVED',
        )
        route = TransportRoute.objects.create(
            school=ctx['school_a'], name='R1', start_location='a', end_location='b', distance_km=Decimal('3'),
            estimated_duration_minutes=10,
        )
        stop = TransportStop.objects.create(
            route=route, name='S1', latitude=Decimal('1'), longitude=Decimal('1'), stop_order=1,
            pickup_time=time(7, 30), drop_time=time(14, 0),
        )
        assignment = TransportAssignment.objects.create(
            school=ctx['school_a'], academic_year=ctx['academic_year'], student=ctx['student'],
            route=route, stop=stop, transport_type='BOTH',
        )
        exit_id = start(api, ctx).json()['id']
        assert self.finalize(api, ctx, exit_id).status_code == 200

        allocation.refresh_from_db()
        assert allocation.is_active is False
        assert allocation.vacated_date == LEAVING
        assignment.refresh_from_db()
        assert assignment.is_active is False
        pending_pass.refresh_from_db()
        assert pending_pass.status == 'EXPIRED'

    def test_finalize_turns_off_the_students_login_at_this_school_only(self, api, ctx):
        from students.models import StudentProfile
        from users.models import User
        login = User.objects.create_user(
            username='SEED_stud_login', email='s@test.com', password='x', role='STUDENT',
            school=ctx['school_a'], organization=ctx['org'],
        )
        membership = UserSchoolMembership.objects.create(user=login, school=ctx['school_a'], role='STUDENT')
        StudentProfile.objects.create(user=login, student=ctx['student'], school=ctx['school_a'])
        exit_id = start(api, ctx).json()['id']
        assert self.finalize(api, ctx, exit_id).status_code == 200
        membership.refresh_from_db()
        assert membership.is_active is False
        login.refresh_from_db()
        assert login.is_active is True  # the user may have other roles

    def test_parent_links_are_left_alone(self, api, ctx):
        from parents.models import ParentChild, ParentProfile
        from users.models import User
        parent_user = User.objects.create_user(
            username='SEED_parent', email='p@test.com', password='x', role='PARENT',
            school=ctx['school_a'], organization=ctx['org'],
        )
        profile = ParentProfile.objects.create(user=parent_user, phone='+923001234567')
        link = ParentChild.objects.create(
            parent=profile, student=ctx['student'], school=ctx['school_a'], relation='FATHER',
        )
        exit_id = start(api, ctx).json()['id']
        assert self.finalize(api, ctx, exit_id).status_code == 200
        assert ParentChild.objects.filter(pk=link.pk).exists()

    def test_a_transfer_finalizes_as_transferred_and_keeps_the_destination(self, api, ctx):
        from .transfer_helpers import destination_placement, placement_body
        placement = destination_placement(ctx)
        exit_id = start(
            api, ctx, exit_type='TRANSFERRED', destination_school=ctx['SID_B'], **placement_body(placement),
        ).json()['id']
        data = self.finalize(api, ctx, exit_id).json()
        ctx['student'].refresh_from_db()
        assert ctx['student'].status == 'TRANSFERRED'
        assert data['destination_school'] == ctx['SID_B']

    def test_finalize_removes_records_after_the_leaving_date_when_asked(self, api, ctx):
        from attendance.models import AttendanceRecord
        AttendanceRecord.objects.create(
            school=ctx['school_a'], academic_year=ctx['academic_year'], student=ctx['student'],
            date=LEAVING + timedelta(days=2), status='PRESENT',
        )
        before = AttendanceRecord.objects.create(
            school=ctx['school_a'], academic_year=ctx['academic_year'], student=ctx['student'],
            date=LEAVING - timedelta(days=2), status='PRESENT',
        )
        exit_id = start(api, ctx, remove_records_after_leaving=True).json()['id']
        assert self.finalize(api, ctx, exit_id).status_code == 200
        remaining = list(AttendanceRecord.objects.filter(student=ctx['student']).values_list('id', flat=True))
        assert remaining == [before.id]

    def test_a_failure_part_way_rolls_everything_back(self, api, ctx, monkeypatch):
        exit_id = start(api, ctx).json()['id']

        def boom(*args, **kwargs):
            raise RuntimeError('database went away')

        monkeypatch.setattr(services, '_deactivate_portal_login', boom)
        with pytest.raises(RuntimeError):
            services.finalize_exit(StudentExit.objects.get(pk=exit_id), ctx['users']['admin'])
        ctx['student'].refresh_from_db()
        assert ctx['student'].status == 'ACTIVE'
        enrollment = StudentEnrollment.objects.get(student=ctx['student'])
        assert enrollment.is_active is True
        assert StudentExit.objects.get(pk=exit_id).status == 'OPEN'

    def test_a_finalized_exit_cannot_be_finalized_or_cancelled_again(self, api, ctx):
        exit_id = start(api, ctx).json()['id']
        assert self.finalize(api, ctx, exit_id).status_code == 200
        assert self.finalize(api, ctx, exit_id).status_code == 400
        assert api.post(f'{URL}{exit_id}/cancel/', {}, ctx['tokens']['admin'], ctx['SID_A']).status_code == 400

    def test_a_teacher_cannot_finalize(self, api, ctx):
        exit_id = start(api, ctx).json()['id']
        assert self.finalize(api, ctx, exit_id, who='teacher').status_code == 403


# ── editing and cancelling ───────────────────────────────────────────────────

class TestEditAndCancel:
    def test_date_and_reason_can_change_while_open(self, api, ctx):
        exit_id = start(api, ctx).json()['id']
        resp = api.patch(f'{URL}{exit_id}/', {'leaving_date': '2026-03-10', 'reason': 'Moved city'},
                         ctx['tokens']['admin'], ctx['SID_A'])
        assert resp.status_code == 200, resp.content
        assert resp.json()['leaving_date'] == '2026-03-10'
        assert resp.json()['reason'] == 'Moved city'

    def test_a_new_date_is_checked_against_existing_records(self, api, ctx):
        from attendance.models import AttendanceRecord
        AttendanceRecord.objects.create(
            school=ctx['school_a'], academic_year=ctx['academic_year'], student=ctx['student'],
            date=date(2026, 3, 20), status='PRESENT',
        )
        exit_id = start(api, ctx, leaving_date='2026-03-25').json()['id']  # after the last record: fine
        resp = api.patch(f'{URL}{exit_id}/', {'leaving_date': '2026-03-10'}, ctx['tokens']['admin'], ctx['SID_A'])
        assert resp.status_code == 400
        assert resp.json()['code'] == 'records_after_leaving'
        assert StudentExit.objects.get(pk=exit_id).leaving_date == date(2026, 3, 25)

    def test_cancel_records_who_and_why_and_leaves_the_student_untouched(self, api, ctx):
        exit_id = start(api, ctx).json()['id']
        resp = api.post(f'{URL}{exit_id}/cancel/', {'reason': 'Family stayed'}, ctx['tokens']['admin'], ctx['SID_A'])
        assert resp.status_code == 200
        assert resp.json()['status'] == 'CANCELLED'
        assert resp.json()['cancel_reason'] == 'Family stayed'
        ctx['student'].refresh_from_db()
        assert ctx['student'].status == 'ACTIVE'

    def test_a_cancelled_exit_cannot_be_edited(self, api, ctx):
        exit_id = start(api, ctx).json()['id']
        api.post(f'{URL}{exit_id}/cancel/', {}, ctx['tokens']['admin'], ctx['SID_A'])
        resp = api.patch(f'{URL}{exit_id}/', {'reason': 'x'}, ctx['tokens']['admin'], ctx['SID_A'])
        assert resp.status_code == 400

    def test_list_filters_by_student_and_status(self, api, ctx):
        start(api, ctx)
        listed = api.get(f"{URL}?student={ctx['student'].id}&status=OPEN", ctx['tokens']['admin'], ctx['SID_A']).json()
        assert listed['count'] == 1
        none = api.get(f"{URL}?status=FINALIZED", ctx['tokens']['admin'], ctx['SID_A']).json()
        assert none['count'] == 0


# ── old path enforcement and header data ─────────────────────────────────────

class TestOldPathAndSummary:
    def patch_status(self, api, ctx, status):
        return api.patch(f"/api/students/{ctx['student'].id}/", {'status': status, 'status_date': LEAVING.isoformat()},
                         ctx['tokens']['admin'], ctx['SID_A'])

    @pytest.mark.parametrize('status', ['WITHDRAWN', 'TRANSFERRED', 'GRADUATED', 'REPEAT'])
    def test_a_bare_status_change_is_refused(self, api, ctx, status):
        resp = self.patch_status(api, ctx, status)
        assert resp.status_code == 400
        assert 'Status & exit' in str(resp.json())

    def test_profile_summary_shows_pending_fee_and_the_waiver(self, api, ctx, category):
        monthly_payment(ctx, category, 1, '1000', '0')
        monthly_payment(ctx, category, 2, '2000', '500')
        exit_id = start(api, ctx).json()['id']
        api.post(f'{URL}{exit_id}/items/FEES/waive/', {'reason': 'Fee concession granted by principal'},
                 ctx['tokens']['admin'], ctx['SID_A'])
        api.post(f'{URL}{exit_id}/finalize/', {}, ctx['tokens']['admin'], ctx['SID_A'])

        summary = api.get(f"/api/students/{ctx['student'].id}/profile_summary/", ctx['tokens']['admin'], ctx['SID_A']).json()
        assert summary['pending_fee'] == 1500.0
        assert summary['outstanding'] == 1500.0  # no double counting of the carried balance
        latest = summary['latest_exit']
        assert latest['status'] == 'FINALIZED'
        fees = next(i for i in latest['items'] if i['kind'] == 'FEES')
        assert fees['state'] == 'WAIVED' and fees['waiver_reason'] == 'Fee concession granted by principal'

    def test_teachers_do_not_see_exit_details_in_the_profile_summary(self, api, ctx):
        start(api, ctx)
        summary = api.get(f"/api/students/{ctx['student'].id}/profile_summary/", ctx['tokens']['teacher'], ctx['SID_A'])
        if summary.status_code == 200:
            assert summary.json()['latest_exit'] is None


class TestDestinations:
    def test_lists_the_other_schools_of_the_organization(self, api, ctx):
        resp = api.get(f'{URL}destinations/', ctx['tokens']['admin'], ctx['SID_A'])
        assert resp.status_code == 200
        assert resp.json() == [{'id': ctx['SID_B'], 'name': ctx['school_b'].name}]

    def test_inactive_schools_and_other_organizations_are_left_out(self, api, ctx):
        ctx['school_b'].is_active = False
        ctx['school_b'].save()
        School.objects.create(
            organization=Organization.objects.create(name='Other Org', slug='other-org'),
            name='Elsewhere', subdomain='elsewhere',
        )
        assert api.get(f'{URL}destinations/', ctx['tokens']['admin'], ctx['SID_A']).json() == []

    def test_other_roles_are_refused(self, api, ctx):
        assert api.get(f'{URL}destinations/', ctx['tokens']['teacher'], ctx['SID_A']).status_code == 403
