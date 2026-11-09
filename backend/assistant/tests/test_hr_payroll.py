"""Payroll through the assistant: reads, and generate / approve / mark paid / delete with preview cards.
Reads and writes go through the real PayslipViewSet as the signed-in user."""
from datetime import timedelta

import pytest
from django.utils import timezone

from assistant import engine, registry
from assistant.tests.test_hr_tools import _all_agents_offered, _approve, _card, _run, hr  # noqa: F401  (shared fixtures)

pytestmark = pytest.mark.django_db

TODAY = timezone.localdate()
M, Y = TODAY.month, TODAY.year


def _slip(hr, who='ali', status='DRAFT', net=50000, month=M, year=Y):
    from hr.models import Payslip
    s = hr[who]
    return Payslip.objects.create(school=s.school, staff_member=s, month=month, year=year, basic_salary=net, net_salary=net, status=status)


class TestReads:
    def test_summary_counts_by_status(self, seed_data, hr):
        _slip(hr, 'ali', 'DRAFT')
        _slip(hr, 'sara', 'PAID', 30000)
        out = _run(seed_data, 'get_payroll_summary', 'principal')['data']
        assert out['payslips'] == 2 and out['draft'] == 1 and out['paid'] == 1 and out['total_net'] == 80000

    def test_summary_is_not_for_teachers(self, seed_data, hr):
        assert 'error' in _run(seed_data, 'get_payroll_summary', user=hr['ali'].user)

    def test_list_filters_by_status(self, seed_data, hr):
        _slip(hr, 'ali', 'DRAFT')
        _slip(hr, 'sara', 'PAID')
        out = _run(seed_data, 'list_payslips', status='PAID')['data']
        assert [p['staff_id'] for p in out['payslips']] == [hr['sara'].id]

    def test_my_payslip_is_always_own(self, seed_data, hr):
        _slip(hr, 'ali', 'APPROVED')
        _slip(hr, 'sara', 'APPROVED', 99999)
        out = _run(seed_data, 'get_my_payslip', user=hr['ali'].user)['data']
        assert out['net'] == 50000 and out['staff_id'] == hr['ali'].id

    def test_my_payslip_when_none(self, seed_data, hr):
        assert 'note' in _run(seed_data, 'get_my_payslip', user=hr['usman'].user)['data']

    def test_pending_shows_who_can_be_generated_for(self, seed_data, hr):
        out = _run(seed_data, 'get_payroll_pending')['data']
        assert out['without_payslip'] == 3 and out['can_generate_for'] == 1 and len(out['without_payslip_and_salary']) == 2


class TestGenerate:
    def test_preview_saves_nothing_then_approve_creates_drafts(self, seed_data, hr):
        from hr.models import Payslip
        card = _card(_run(seed_data, 'generate_payslips'))
        assert not Payslip.objects.exists()
        assert card.preview['totals']['count'] == 1 and any('no salary' in w for w in card.preview['warnings'])
        _approve(card, seed_data, seed_data['users']['admin'])
        made = Payslip.objects.get()
        assert made.staff_member_id == hr['ali'].id and made.status == 'DRAFT'

    def test_nothing_to_generate_is_refused(self, seed_data, hr):
        _slip(hr, 'ali')
        assert 'error' in _run(seed_data, 'generate_payslips')

    def test_teacher_cannot_generate(self, seed_data, hr):
        assert 'error' in _run(seed_data, 'generate_payslips', user=hr['ali'].user)

    def test_bad_month_refused(self, seed_data, hr):
        assert 'error' in _run(seed_data, 'generate_payslips', month=13)


class TestApprove:
    def test_approve_all_drafts(self, seed_data, hr):
        a, b = _slip(hr, 'ali'), _slip(hr, 'sara', net=30000)
        card = _card(_run(seed_data, 'approve_payslips'))
        assert card.preview['totals'] == {'count': 2, 'net': 80000.0}
        _approve(card, seed_data, seed_data['users']['admin'])
        a.refresh_from_db(); b.refresh_from_db()
        assert a.status == b.status == 'APPROVED'

    def test_one_person_only(self, seed_data, hr):
        a, b = _slip(hr, 'ali'), _slip(hr, 'sara')
        _approve(_card(_run(seed_data, 'approve_payslips', staff_name='Sara')), seed_data, seed_data['users']['admin'])
        a.refresh_from_db(); b.refresh_from_db()
        assert (a.status, b.status) == ('DRAFT', 'APPROVED')

    def test_removing_a_row_on_the_card_leaves_it_draft(self, seed_data, hr):
        a, b = _slip(hr, 'ali'), _slip(hr, 'sara')
        card = _card(_run(seed_data, 'approve_payslips'))
        engine.edit(card.id, seed_data['users']['admin'], seed_data['SID_A'], {'remove_ids': [a.id]})
        _approve(card, seed_data, seed_data['users']['admin'])
        a.refresh_from_db(); b.refresh_from_db()
        assert (a.status, b.status) == ('DRAFT', 'APPROVED')

    def test_nothing_changes_before_approval(self, seed_data, hr):
        a = _slip(hr, 'ali')
        _card(_run(seed_data, 'approve_payslips'))
        a.refresh_from_db()
        assert a.status == 'DRAFT'

    def test_no_drafts_is_refused(self, seed_data, hr):
        _slip(hr, 'ali', 'PAID')
        assert 'error' in _run(seed_data, 'approve_payslips')

    def test_teacher_cannot_approve(self, seed_data, hr):
        _slip(hr, 'ali')
        assert 'error' in _run(seed_data, 'approve_payslips', user=hr['ali'].user)

    def test_changed_since_preview_is_a_conflict(self, seed_data, hr):
        a = _slip(hr, 'ali')
        card = _card(_run(seed_data, 'approve_payslips'))
        a.status = 'APPROVED'; a.save()
        with pytest.raises(engine.ActionError) as exc:
            _approve(card, seed_data, seed_data['users']['admin'])
        assert exc.value.status == 409


class TestMarkPaid:
    def test_only_approved_are_paid_and_drafts_are_not_offered(self, seed_data, hr):
        a, b = _slip(hr, 'ali', 'APPROVED'), _slip(hr, 'sara', 'DRAFT')
        card = _card(_run(seed_data, 'mark_payslips_paid', 'principal'))
        assert [r['id'] for r in card.preview['rows']] == [a.id]
        _approve(card, seed_data, seed_data['users']['principal'])
        a.refresh_from_db(); b.refresh_from_db()
        assert a.status == 'PAID' and a.payment_date == TODAY and b.status == 'DRAFT'

    def test_payment_date_is_recorded(self, seed_data, hr):
        a = _slip(hr, 'ali', 'APPROVED')
        day = (TODAY - timedelta(days=2)).isoformat()
        _approve(_card(_run(seed_data, 'mark_payslips_paid', payment_date=day)), seed_data, seed_data['users']['admin'])
        a.refresh_from_db()
        assert a.payment_date.isoformat() == day

    def test_future_date_refused(self, seed_data, hr):
        _slip(hr, 'ali', 'APPROVED')
        assert 'error' in _run(seed_data, 'mark_payslips_paid', payment_date=(TODAY + timedelta(days=3)).isoformat())

    def test_card_states_total_and_that_no_money_moves(self, seed_data, hr):
        _slip(hr, 'ali', 'APPROVED')
        card = _card(_run(seed_data, 'mark_payslips_paid'))
        assert card.preview['totals']['net'] == 50000.0 and any('does not send any money' in w for w in card.preview['warnings'])

    def test_only_drafts_left_is_refused(self, seed_data, hr):
        _slip(hr, 'ali', 'DRAFT')
        assert 'error' in _run(seed_data, 'mark_payslips_paid')


class TestDelete:
    def test_deletes_drafts_only(self, seed_data, hr):
        from hr.models import Payslip
        a, b = _slip(hr, 'ali', 'DRAFT'), _slip(hr, 'sara', 'APPROVED')
        card = _card(_run(seed_data, 'delete_draft_payslips'))
        assert Payslip.objects.count() == 2 and card.preview['kind'] == 'delete_payslips'
        _approve(card, seed_data, seed_data['users']['admin'])
        assert list(Payslip.objects.values_list('id', flat=True)) == [b.id]

    def test_approved_payslip_is_never_offered(self, seed_data, hr):
        _slip(hr, 'ali', 'PAID')
        assert 'error' in _run(seed_data, 'delete_draft_payslips')


class TestLeftOut:
    def test_no_tool_edits_salaries_or_single_payslips(self, seed_data, hr):
        names = {t.name for t in registry.all_tools() if t.sub_agent == 'hr'}
        assert not [n for n in names if any(w in n for w in ('salary_structure', 'set_salary', 'edit_payslip', 'role', 'permission'))]
