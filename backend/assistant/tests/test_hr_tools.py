"""HR through the assistant: staff directory, leave, staff attendance, salary, and the four writes.
The model is mocked; reads and writes go through the real HR API as the signed-in user."""
from datetime import date, timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from assistant import engine, registry
from assistant.models import AgentAction, AgentConversation

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _all_agents_offered():
    with patch('assistant.router.pick_agents', lambda by_agent, message, recent=(): list(by_agent)):
        yield


@pytest.fixture
def hr(seed_data):
    from hr.models import LeaveApplication, LeavePolicy, SalaryStructure

    school = seed_data['school_a']
    school.enabled_modules = {**(school.enabled_modules or {}), 'hr': True}
    school.save(update_fields=['enabled_modules'])
    org = school.organization
    org.allowed_modules = {**(org.allowed_modules or {}), 'hr': True}
    org.save(update_fields=['allowed_modules'])
    casual = LeavePolicy.objects.create(school=school, name='Casual Leave', leave_type='CASUAL', days_allowed=10)
    sick = LeavePolicy.objects.create(school=school, name='Sick Leave', leave_type='SICK', days_allowed=5)
    ali, sara, usman = seed_data['staff']
    today = timezone.localdate()
    leave = LeaveApplication.objects.create(school=school, staff_member=sara, leave_policy=casual,
                                            start_date=today, end_date=today + timedelta(days=1), reason='Family event')
    SalaryStructure.objects.create(school=school, staff_member=ali, basic_salary=50000, effective_from=date(2024, 1, 1))
    return {'ali': ali, 'sara': sara, 'usman': usman, 'leave': leave, 'casual': casual, 'sick': sick}


def _ctx(user, seed):
    return registry.ToolContext(user=user, school_id=seed['SID_A'], role=user.role)


def _run(seed, tool, uname='admin', user=None, **args):
    ctx = _ctx(user or seed['users'][uname], seed)
    ctx.conversation = AgentConversation.objects.create(school_id=ctx.school_id, user=ctx.user)
    return registry.execute(ctx, tool, args)


def _card(out):
    assert 'proposal' in out, out
    return AgentAction.objects.get(pk=out['proposal']['action_id'])


def _approve(card, seed, user):
    return engine.approve(card.id, user, seed['SID_A'])


def _last_workday():
    day = timezone.localdate()
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return day.isoformat()


_WORKDAY = _last_workday()


class TestReads:
    def test_directory_finds_by_name_for_admin_with_contact_fields(self, seed_data, hr):
        out = _run(seed_data, 'list_staff', search='Sara')['data']
        assert out['count'] == 1 and out['staff'][0]['staff_id'] == hr['sara'].id
        assert out['staff'][0]['employee_id']

    def test_directory_for_teacher_is_trimmed(self, seed_data, hr):
        out = _run(seed_data, 'list_staff', user=hr['ali'].user)['data']
        others = [s for s in out['staff'] if s['staff_id'] != hr['ali'].id]
        assert others and all('employee_id' not in s and 'phone' not in s for s in others)

    def test_manager_has_no_directory(self, seed_data, hr):
        assert 'error' in _run(seed_data, 'list_staff', 'manager')

    def test_leave_today_lists_approved_leave_only(self, seed_data, hr):
        assert _run(seed_data, 'get_leave_today')['data']['count'] == 0
        hr['leave'].status = 'APPROVED'
        hr['leave'].save()
        out = _run(seed_data, 'get_leave_today')['data']
        assert [r['staff_id'] for r in out['on_leave']] == [hr['sara'].id]

    def test_pending_requests_for_admin(self, seed_data, hr):
        out = _run(seed_data, 'list_leave_requests', status='PENDING')['data']
        assert out['count'] == 1 and out['leave'][0]['leave_id'] == hr['leave'].id

    def test_teacher_sees_only_own_leave(self, seed_data, hr):
        assert _run(seed_data, 'list_leave_requests', user=hr['ali'].user)['data']['count'] == 0
        assert _run(seed_data, 'list_leave_requests', user=hr['sara'].user)['data']['count'] == 1

    def test_leave_balance_counts_approved_days(self, seed_data, hr):
        hr['leave'].status = 'APPROVED'
        hr['leave'].save()
        out = _run(seed_data, 'get_leave_balance', staff_name='Sara')['data']
        casual = next(b for b in out['balances'] if b['policy'] == 'Casual Leave')
        assert casual['used'] == 2 and casual['remaining'] == 8

    def test_teacher_balance_is_always_their_own(self, seed_data, hr):
        out = _run(seed_data, 'get_leave_balance', user=hr['ali'].user, staff_name='Sara')['data']
        assert out['staff'].endswith('Khan')

    def test_staff_attendance_lists_who_is_not_marked(self, seed_data, hr):
        from hr.models import StaffAttendance
        StaffAttendance.objects.create(school=hr['ali'].school, staff_member=hr['ali'], date=timezone.localdate(), status='PRESENT')
        out = _run(seed_data, 'get_staff_attendance')['data']
        assert out['counts']['PRESENT'] == 1 and out['not_marked'] == 2

    def test_salary_visible_to_principal_not_to_teacher(self, seed_data, hr):
        out = _run(seed_data, 'get_staff_salary', 'principal', staff_name='Ali')['data']
        assert float(out['basic']) == 50000
        assert 'error' in _run(seed_data, 'get_staff_salary', user=hr['ali'].user, staff_name='Ali')

    def test_ambiguous_name_asks(self, seed_data, hr):
        out = _run(seed_data, 'get_staff_salary', staff_name='PYTEST')
        assert 'error' in out and 'staff_id' in out['error']


class TestDecideLeave:
    def test_proposing_changes_nothing(self, seed_data, hr):
        card = _card(_run(seed_data, 'decide_leave', decision='APPROVE', staff_name='Sara'))
        hr['leave'].refresh_from_db()
        assert hr['leave'].status == 'PENDING' and card.preview['kind'] == 'leave_decision'

    def test_approve_updates_leave_and_records_who(self, seed_data, hr):
        card = _card(_run(seed_data, 'decide_leave', decision='APPROVE', leave_id=hr['leave'].id, remarks='Fine'))
        _approve(card, seed_data, seed_data['users']['admin'])
        hr['leave'].refresh_from_db()
        assert hr['leave'].status == 'APPROVED' and hr['leave'].admin_remarks == 'Fine'
        assert hr['leave'].approved_by_id == seed_data['users']['admin'].id

    def test_reject(self, seed_data, hr):
        card = _card(_run(seed_data, 'decide_leave', 'principal', decision='REJECT', all_pending=True))
        _approve(card, seed_data, seed_data['users']['principal'])
        hr['leave'].refresh_from_db()
        assert hr['leave'].status == 'REJECTED'

    def test_teacher_cannot_decide(self, seed_data, hr):
        assert 'error' in _run(seed_data, 'decide_leave', user=hr['ali'].user, decision='APPROVE', all_pending=True)

    def test_nothing_pending_is_refused(self, seed_data, hr):
        hr['leave'].status = 'APPROVED'
        hr['leave'].save()
        assert 'error' in _run(seed_data, 'decide_leave', decision='APPROVE', staff_name='Sara')

    def test_already_decided_by_approve_time_is_not_redone(self, seed_data, hr):
        card = _card(_run(seed_data, 'decide_leave', decision='APPROVE', leave_id=hr['leave'].id))
        hr['leave'].status = 'REJECTED'
        hr['leave'].save()
        with pytest.raises(engine.ActionError) as exc:
            _approve(card, seed_data, seed_data['users']['admin'])
        hr['leave'].refresh_from_db()
        assert hr['leave'].status == 'REJECTED' and exc.value.status == 409


class TestApplyLeave:
    def test_teacher_applies_for_themself(self, seed_data, hr):
        from hr.models import LeaveApplication
        tomorrow = (timezone.localdate() + timedelta(days=3)).isoformat()
        card = _card(_run(seed_data, 'apply_leave', user=hr['ali'].user, start_date=tomorrow, reason='Sick', leave_type='sick'))
        assert not LeaveApplication.objects.filter(staff_member=hr['ali']).exists()
        _approve(card, seed_data, hr['ali'].user)
        made = LeaveApplication.objects.get(staff_member=hr['ali'])
        assert made.status == 'PENDING' and made.leave_policy_id == hr['sick'].id and made.end_date.isoformat() == tomorrow

    def test_user_without_staff_profile_is_refused(self, seed_data, hr):
        assert 'error' in _run(seed_data, 'apply_leave', 'teacher', start_date='2030-01-01', reason='x', leave_type='sick')

    def test_unclear_type_asks(self, seed_data, hr):
        out = _run(seed_data, 'apply_leave', user=hr['ali'].user, start_date='2030-01-01', reason='x')
        assert 'error' in out and 'Casual Leave' in out['error']

    def test_overlap_is_warned(self, seed_data, hr):
        card = _card(_run(seed_data, 'apply_leave', user=hr['sara'].user, start_date=timezone.localdate().isoformat(),
                          reason='again', leave_type='casual'))
        assert any('overlaps' in w for w in card.preview['warnings'])


class TestStaffAttendance:
    def _entries(self):
        return [{'staff_name': 'Sara', 'status': 'ABSENT'}]

    def test_off_day_is_warned(self, seed_data, hr):
        from academic_sessions.calendar_rules import is_off_day_for_date
        day = timezone.localdate()
        while not is_off_day_for_date(seed_data['SID_A'], day, for_staff=True):
            day -= timedelta(days=1)
            if (timezone.localdate() - day).days > 14:
                pytest.skip('no off day in the last two weeks')
        card = _card(_run(seed_data, 'mark_staff_attendance', date=day.isoformat(), entries=self._entries()))
        assert any('ON_LEAVE' in w for w in card.preview['warnings'])

    def test_rest_present_fills_everyone_and_saves_nothing_yet(self, seed_data, hr):
        from hr.models import StaffAttendance
        card = _card(_run(seed_data, 'mark_staff_attendance', date=_WORKDAY, entries=self._entries(), rest='PRESENT'))
        assert len(card.preview['rows']) == 3 and not StaffAttendance.objects.exists()

    def test_approve_saves(self, seed_data, hr):
        from hr.models import StaffAttendance
        card = _card(_run(seed_data, 'mark_staff_attendance', date=_WORKDAY, entries=self._entries(), rest='PRESENT'))
        _approve(card, seed_data, seed_data['users']['admin'])
        saved = {a.staff_member_id: a.status for a in StaffAttendance.objects.all()}
        assert saved[hr['sara'].id] == 'ABSENT' and saved[hr['ali'].id] == 'PRESENT'

    def test_edit_status_on_the_card(self, seed_data, hr):
        card = _card(_run(seed_data, 'mark_staff_attendance', date=_WORKDAY, entries=self._entries()))
        out = engine.edit(card.id, seed_data['users']['admin'], seed_data['SID_A'], {'statuses': {str(hr['sara'].id): 'LATE'}})
        card.refresh_from_db()
        assert card.preview['rows'][0]['status'] == 'LATE', out

    def test_future_date_refused(self, seed_data, hr):
        future = (timezone.localdate() + timedelta(days=2)).isoformat()
        assert 'error' in _run(seed_data, 'mark_staff_attendance', date=future, entries=self._entries())

    def test_bad_status_refused(self, seed_data, hr):
        assert 'error' in _run(seed_data, 'mark_staff_attendance', entries=[{'staff_name': 'Sara', 'status': 'SLEEPING'}])

    def test_teacher_cannot_mark(self, seed_data, hr):
        assert 'error' in _run(seed_data, 'mark_staff_attendance', user=hr['ali'].user, entries=self._entries())


class TestContact:
    def test_shows_before_and_after_and_saves_on_approve(self, seed_data, hr):
        card = _card(_run(seed_data, 'update_staff_contact', staff_name='Sara', phone='0300-1112223'))
        assert card.preview['rows'][0]['to'] == '0300-1112223'
        hr['sara'].refresh_from_db()
        assert hr['sara'].phone == ''
        _approve(card, seed_data, seed_data['users']['admin'])
        hr['sara'].refresh_from_db()
        assert hr['sara'].phone == '0300-1112223'

    def test_only_contact_fields_exist_on_the_tool(self, seed_data, hr):
        props = registry.get_tool('update_staff_contact').parameters['properties']
        assert 'employment_status' not in props and 'employee_id' not in props and 'phone' in props

    def test_teacher_cannot_edit_contacts(self, seed_data, hr):
        assert 'error' in _run(seed_data, 'update_staff_contact', user=hr['ali'].user, staff_name='Sara', phone='1')

    def test_bad_email_refused(self, seed_data, hr):
        assert 'error' in _run(seed_data, 'update_staff_contact', staff_name='Sara', email='nope')

    def test_no_change_refused(self, seed_data, hr):
        assert 'error' in _run(seed_data, 'update_staff_contact', staff_name='Sara', phone='')


class TestLeftOut:
    def test_no_role_or_salary_structure_write_tools_exist(self, seed_data, hr):
        writes = {t.name for t in registry.all_tools() if t.sub_agent == 'hr' and t.kind == 'write'}
        assert writes == {'decide_leave', 'apply_leave', 'mark_staff_attendance', 'update_staff_contact',
                          'generate_payslips', 'approve_payslips', 'mark_payslips_paid', 'delete_draft_payslips'}
