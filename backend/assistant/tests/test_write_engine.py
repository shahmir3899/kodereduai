"""Write engine: proposals, preview, edit/approve/reject, and the fee-payment tool on top.

The model is mocked. The real fee API (FeePaymentViewSet.bulk_update) is NOT mocked: these
tests check that approving a card really writes through it.
"""
import json
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.utils import timezone

from assistant import engine, llm, orchestrator, registry
from assistant.models import AgentAction, AgentAuditLog, AgentConversation

pytestmark = pytest.mark.django_db

ACTIONS = '/api/assistant/actions/'


@pytest.fixture(autouse=True)
def _all_agents_offered():
    with patch('assistant.router.pick_agents', lambda by_agent, message, recent=(): list(by_agent)):
        yield


@pytest.fixture
def fees(seed_data):
    """Three students in one class, each owing 2000 for the current month, one Cash account."""
    from finance.models import Account, FeePayment
    from students.models import Student

    school = seed_data['school_a']
    school.enabled_modules = {**(school.enabled_modules or {}), 'finance': True}
    school.save(update_fields=['enabled_modules'])
    org = school.organization
    org.allowed_modules = {**(org.allowed_modules or {}), 'finance': True}
    org.save(update_fields=['allowed_modules'])

    klass = seed_data['classes'][0]
    students = seed_data['students'][:3]
    for st, name in zip(students, ['Ahmad Khan', 'Akram Ali', 'Sara Noor']):
        Student.objects.filter(pk=st.pk).update(class_obj=klass, name=name)
        st.refresh_from_db()
    today = timezone.localdate()
    payments = [FeePayment.objects.create(
        school=school, student=st, month=today.month, year=today.year, amount_due=Decimal('2000'),
    ) for st in students]
    account = Account.objects.create(school=school, organization=org, name='Cash Box', opening_balance=Decimal('1000'))
    return {'class_name': klass.name, 'students': students, 'payments': payments, 'account': account,
            'month': today.month, 'year': today.year}


def _ctx(seed, uname='admin', conv=None):
    user = seed['users'][uname]
    return registry.ToolContext(user=user, school_id=seed['SID_A'], role=user.role, conversation=conv)


def _conv(seed, uname='admin'):
    return AgentConversation.objects.create(school=seed['school_a'], user=seed['users'][uname])


def _propose(seed, fees, uname='admin', **extra):
    args = {'class_name': fees['class_name'], 'account_id': fees['account'].id, **extra}
    out = registry.execute(_ctx(seed, uname, _conv(seed, uname)), 'record_fee_payments', args)
    return out


def _action(out):
    return AgentAction.objects.get(pk=out['proposal']['action_id'])


def _paid(fees):
    from finance.models import FeePayment
    return {p.student.name: (p.amount_paid, p.status) for p in FeePayment.objects.filter(id__in=[x.id for x in fees['payments']]).select_related('student')}


class TestProposal:
    def test_proposing_changes_nothing(self, seed_data, fees):
        out = _propose(seed_data, fees)
        assert out['status'] == 'awaiting_user_approval' and 'NOTHING has been changed' in out['instruction']
        assert all(v[0] == 0 for v in _paid(fees).values())
        action = _action(out)
        assert action.status == 'pending' and action.preview['totals'] == {'count': 3, 'paying': 6000.0}

    def test_preview_has_rows_total_and_projected_balance(self, seed_data, fees):
        pv = _action(_propose(seed_data, fees)).preview
        assert {r['student'] for r in pv['rows']} == {'Ahmad Khan', 'Akram Ali', 'Sara Noor'}
        assert pv['account']['name'] == 'Cash Box'
        assert pv['account']['balance_after'] == pv['account']['balance_before'] + 6000.0
        assert pv['summary'].startswith('3 students')

    def test_everyone_except_named_students(self, seed_data, fees):
        pv = _action(_propose(seed_data, fees, exclude_names=['Ahmad', 'akram'])).preview
        assert [r['student'] for r in pv['rows']] == ['Sara Noor']

    def test_misspelled_name_still_matches(self, seed_data, fees):
        pv = _action(_propose(seed_data, fees, exclude_names=['Ahmed'])).preview
        assert 'Ahmad Khan' not in {r['student'] for r in pv['rows']}

    def test_ambiguous_name_asks_instead_of_guessing(self, seed_data, fees):
        from students.models import Student
        Student.objects.filter(pk=fees['students'][2].pk).update(name='Ahmad Raza')
        out = _propose(seed_data, fees, exclude_names=['Ahmad'])
        assert 'error' in out and 'Ask the user which one' in out['error']
        assert AgentAction.objects.count() == 0

    def test_unknown_name_is_an_error_listing_students(self, seed_data, fees):
        out = _propose(seed_data, fees, exclude_names=['Zubair'])
        assert 'error' in out and 'Sara Noor' in out['error']

    def test_missing_account_with_several_accounts_asks(self, seed_data, fees):
        from finance.models import Account
        Account.objects.create(school=seed_data['school_a'], organization=seed_data['org'], name='Bank', account_type='BANK')
        out = registry.execute(_ctx(seed_data, conv=_conv(seed_data)), 'record_fee_payments', {'class_name': fees['class_name']})
        assert 'error' in out and 'Which account' in out['error'] and 'Bank' in out['error']

    def test_single_account_is_used_automatically(self, seed_data, fees):
        out = registry.execute(_ctx(seed_data, conv=_conv(seed_data)), 'record_fee_payments', {'class_name': fees['class_name']})
        assert _action(out).preview['account']['name'] == 'Cash Box'

    def test_nothing_unpaid_is_an_error(self, seed_data, fees):
        out = registry.execute(_ctx(seed_data, conv=_conv(seed_data)), 'record_fee_payments',
                               {'class_name': 'No Such Class', 'account_id': fees['account'].id})
        assert 'error' in out

    def test_same_request_twice_gives_one_card(self, seed_data, fees):
        ctx = _ctx(seed_data, conv=_conv(seed_data))
        args = {'class_name': fees['class_name'], 'account_id': fees['account'].id}
        a = registry.execute(ctx, 'record_fee_payments', args)['proposal']['action_id']
        b = registry.execute(ctx, 'record_fee_payments', args)['proposal']['action_id']
        assert a == b and AgentAction.objects.count() == 1

    def test_proposal_is_audited_as_a_write(self, seed_data, fees):
        _propose(seed_data, fees)
        log = AgentAuditLog.objects.get(tool_name='record_fee_payments')
        assert log.kind == AgentAuditLog.Kind.WRITE and log.ok

    def test_find_pending_lists_ids_and_totals(self, seed_data, fees):
        out = registry.execute(_ctx(seed_data), 'find_pending_fee_payments', {'class_name': fees['class_name']})
        assert out['data']['count'] == 3 and out['data']['total_remaining'] == 6000.0
        assert {s['student'] for s in out['data']['students']} == {'Ahmad Khan', 'Akram Ali', 'Sara Noor'}


class TestRoles:
    def test_only_admins_are_offered_the_write_tool(self, seed_data, fees):
        for uname, expected in [('admin', True), ('principal', True), ('accountant', False),
                                ('teacher', False), ('manager', False), ('staff', False)]:
            names = {t.name for t in registry.tools_for(_ctx(seed_data, uname))}
            assert ('record_fee_payments' in names) is expected, uname

    def test_accountant_can_read_but_not_propose(self, seed_data, fees):
        assert 'data' in registry.execute(_ctx(seed_data, 'accountant'), 'find_pending_fee_payments', {})
        out = _propose(seed_data, fees, uname='accountant')
        assert out['error'].startswith('You do not have permission')

    def test_write_tools_cannot_be_given_to_parents_or_students(self):
        bad = registry.Tool(name='x', description='', parameters={'type': 'object', 'properties': {}},
                            handler=lambda c: {}, sub_agent='finance', module=None, roles=('STUDENT',),
                            kind='write', revise=lambda *a: {}, apply=lambda *a: {})
        with pytest.raises(ValueError):
            registry.register(bad)

    def test_write_tool_needs_revise_and_apply(self):
        with pytest.raises(ValueError):
            registry.register(registry.Tool(name='y', description='', parameters={'type': 'object', 'properties': {}},
                                            handler=lambda c: {}, sub_agent='finance', module=None,
                                            roles=registry.ADMINS, kind='write'))


class TestApprove:
    def test_approve_writes_through_the_real_fee_api(self, seed_data, fees):
        action = _action(_propose(seed_data, fees))
        done = engine.approve(action.id, seed_data['users']['admin'], seed_data['SID_A'])
        assert done.status == 'executed' and done.result['updated'] == 3 and done.result['failed'] == 0
        assert done.result['total_paid'] == 6000.0
        assert all(amount == Decimal('2000') and status == 'PAID' for amount, status in _paid(fees).values())
        from finance.models import FeePayment
        p = FeePayment.objects.get(pk=fees['payments'][0].pk)
        assert p.account_id == fees['account'].id and p.payment_date == timezone.localdate()
        assert p.collected_by_id == seed_data['users']['admin'].id

    def test_balance_really_moves_by_the_previewed_amount(self, seed_data, fees):
        action = _action(_propose(seed_data, fees))
        before = action.preview['account']['balance_before']
        engine.approve(action.id, seed_data['users']['admin'], seed_data['SID_A'])
        from assistant.skills.finance_writes import _accounts
        after = next(a for a in _accounts(_ctx(seed_data)) if a['id'] == fees['account'].id)['balance']
        assert float(after) == action.preview['account']['balance_after'] == before + 6000.0

    def test_exclusions_are_respected_in_the_write(self, seed_data, fees):
        action = _action(_propose(seed_data, fees, exclude_names=['Ahmad Khan', 'Akram Ali']))
        engine.approve(action.id, seed_data['users']['admin'], seed_data['SID_A'])
        paid = _paid(fees)
        assert paid['Sara Noor'][1] == 'PAID' and paid['Ahmad Khan'][1] == 'UNPAID' and paid['Akram Ali'][1] == 'UNPAID'

    def test_second_approval_does_not_write_twice(self, seed_data, fees):
        action = _action(_propose(seed_data, fees))
        admin = seed_data['users']['admin']
        engine.approve(action.id, admin, seed_data['SID_A'])
        with pytest.raises(engine.ActionError) as exc:
            engine.approve(action.id, admin, seed_data['SID_A'])
        assert exc.value.status == 409
        assert sum(a for a, _ in _paid(fees).values()) == Decimal('6000')

    def test_rejected_card_cannot_be_approved(self, seed_data, fees):
        action = _action(_propose(seed_data, fees))
        admin = seed_data['users']['admin']
        engine.reject(action.id, admin, seed_data['SID_A'])
        with pytest.raises(engine.ActionError):
            engine.approve(action.id, admin, seed_data['SID_A'])
        assert all(v[0] == 0 for v in _paid(fees).values())

    def test_expired_card_cannot_be_approved(self, seed_data, fees):
        action = _action(_propose(seed_data, fees))
        AgentAction.objects.filter(pk=action.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        with pytest.raises(engine.ActionError) as exc:
            engine.approve(action.id, seed_data['users']['admin'], seed_data['SID_A'])
        assert exc.value.code == 'expired'
        action.refresh_from_db()
        assert action.status == 'expired'                      # persisted, not rolled back
        assert all(v[0] == 0 for v in _paid(fees).values())

    def test_other_users_cannot_see_or_act_on_the_card(self, seed_data, fees):
        action = _action(_propose(seed_data, fees))
        for who, sid in [('principal', seed_data['SID_A']), ('admin_b', seed_data['SID_B'])]:
            with pytest.raises(engine.ActionError) as exc:
                engine.approve(action.id, seed_data['users'][who], sid)
            assert exc.value.status == 404

    def test_role_is_rechecked_at_approval(self, seed_data, fees):
        action = _action(_propose(seed_data, fees))
        from schools.models import UserSchoolMembership
        UserSchoolMembership.objects.filter(user=seed_data['users']['admin'], school=seed_data['school_a']).update(role='TEACHER')
        seed_data['users']['admin'].role = 'TEACHER'
        with pytest.raises(engine.ActionError) as exc:
            engine.approve(action.id, seed_data['users']['admin'], seed_data['SID_A'])
        assert exc.value.status == 403
        assert all(v[0] == 0 for v in _paid(fees).values())

    def test_data_changed_since_the_card_blocks_the_write(self, seed_data, fees):
        action = _action(_propose(seed_data, fees))
        # Someone records Akram's fee while the card is open.
        p = fees['payments'][1]
        p.amount_paid, p.payment_date, p.account = Decimal('2000'), timezone.localdate(), fees['account']
        p.save()
        with pytest.raises(engine.ActionError) as exc:
            engine.approve(action.id, seed_data['users']['admin'], seed_data['SID_A'])
        assert exc.value.code == 'changed' and exc.value.status == 409
        card = exc.value.extra['action']['preview']
        assert card['totals']['count'] == 2 and any('already fully paid' in w for w in card['warnings'])
        assert _paid(fees)['Ahmad Khan'][0] == 0            # nothing else was written
        done = engine.approve(action.id, seed_data['users']['admin'], seed_data['SID_A'])   # approving the new card works
        assert done.status == 'executed' and done.result['updated'] == 2

    def test_api_refusal_marks_the_action_failed(self, seed_data, fees):
        action = _action(_propose(seed_data, fees))
        from assistant.internal_api import call as real_call

        def refuse_writes(user, school_id, viewset, mapping, method, path, data=None):
            if 'bulk_update' in path:
                return 403, {'detail': 'No permission'}
            return real_call(user, school_id, viewset, mapping, method, path, data)

        with patch('assistant.skills.finance_writes.call', refuse_writes):
            done = engine.approve(action.id, seed_data['users']['admin'], seed_data['SID_A'])
        assert done.status == 'failed' and 'No permission' in done.error
        assert all(v[0] == 0 for v in _paid(fees).values())


class TestEdit:
    def test_edit_changes_amount_and_removes_rows(self, seed_data, fees):
        action = _action(_propose(seed_data, fees))
        ids = {r['student']: r['id'] for r in action.preview['rows']}
        edited = engine.edit(action.id, seed_data['users']['admin'], seed_data['SID_A'],
                             {'remove_ids': [ids['Sara Noor']], 'amounts': {str(ids['Akram Ali']): '500'}})
        assert edited.status == 'edited'
        assert edited.preview['totals'] == {'count': 2, 'paying': 2500.0}
        assert any('less than the full' in w for w in edited.preview['warnings'])
        engine.approve(action.id, seed_data['users']['admin'], seed_data['SID_A'])
        paid = _paid(fees)
        assert paid['Akram Ali'] == (Decimal('500'), 'PARTIAL') and paid['Ahmad Khan'][1] == 'PAID' and paid['Sara Noor'][1] == 'UNPAID'

    def test_edit_account_method_and_date(self, seed_data, fees):
        from finance.models import Account
        bank = Account.objects.create(school=seed_data['school_a'], organization=seed_data['org'], name='Bank', account_type='BANK')
        action = _action(_propose(seed_data, fees))
        edited = engine.edit(action.id, seed_data['users']['admin'], seed_data['SID_A'],
                             {'account_id': bank.id, 'payment_method': 'BANK_TRANSFER', 'payment_date': '2026-01-05'})
        assert edited.preview['account']['name'] == 'Bank' and edited.preview['payment_method'] == 'BANK_TRANSFER'
        engine.approve(action.id, seed_data['users']['admin'], seed_data['SID_A'])
        from finance.models import FeePayment
        p = FeePayment.objects.get(pk=fees['payments'][0].pk)
        assert (p.account_id, p.payment_method, str(p.payment_date)) == (bank.id, 'BANK_TRANSFER', '2026-01-05')

    @pytest.mark.parametrize('edits', [
        {'amounts': {'999999': '10'}}, {'remove_ids': [999999]}, {'payment_method': 'BITCOIN'},
        {'payment_date': 'tomorrow'}, {'account_id': 999999},
    ])
    def test_bad_edits_are_rejected_and_keep_the_card(self, seed_data, fees, edits):
        action = _action(_propose(seed_data, fees))
        with pytest.raises(engine.ActionError) as exc:
            engine.edit(action.id, seed_data['users']['admin'], seed_data['SID_A'], edits)
        assert exc.value.status == 400
        action.refresh_from_db()
        assert action.status == 'pending' and action.preview['totals']['count'] == 3

    def test_amount_above_what_is_owed_is_clamped(self, seed_data, fees):
        action = _action(_propose(seed_data, fees))
        rid = action.preview['rows'][0]['id']
        edited = engine.edit(action.id, seed_data['users']['admin'], seed_data['SID_A'], {'amounts': {str(rid): '99999'}})
        assert edited.preview['totals']['paying'] == 6000.0

    def test_removing_every_row_is_an_error(self, seed_data, fees):
        action = _action(_propose(seed_data, fees))
        all_ids = [r['id'] for r in action.preview['rows']]
        with pytest.raises(engine.ActionError):
            engine.edit(action.id, seed_data['users']['admin'], seed_data['SID_A'], {'remove_ids': all_ids})


class TestEndToEnd:
    def test_model_prepares_card_user_approves_over_http(self, seed_data, fees, api):
        conv = _conv(seed_data)
        args = {'class_name': fees['class_name'], 'account_id': fees['account'].id, 'exclude_names': ['Ahmad Khan']}
        script = iter([
            llm.LLMReply(tool_calls=[{'id': 'c1', 'name': 'record_fee_payments', 'arguments': args,
                                      'raw_arguments': json.dumps(args)}]),
            llm.LLMReply(content='Prepared the payments for 2 students. Please review and approve.'),
        ])
        with patch('assistant.llm.complete', lambda *a, **k: next(script)):
            result = orchestrator.run_turn(conv, 'ahmad ke ilawa sab ki fee aa gai', _ctx(seed_data, conv=conv))
        assert result.sub_agents == ['finance'] and len(result.proposals) == 1
        assert result.tool_calls[0]['kind'] == 'write' and result.tool_calls[0]['ok']
        assert all(v[0] == 0 for v in _paid(fees).values())          # still nothing written
        assert AgentAction.objects.get(pk=result.proposals[0]).message_id is not None

        token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
        history = api.get(f'/api/assistant/conversations/{conv.id}/messages/', token, sid).json()
        card = history['messages'][-1]['actions'][0]
        assert card['status'] == 'pending' and card['can_act'] and card['preview']['totals']['count'] == 2

        r = api.post(f'{ACTIONS}{card["id"]}/approve/', {}, token, sid)
        assert r.status_code == 200 and r.json()['status'] == 'executed'
        paid = _paid(fees)
        assert paid['Ahmad Khan'][1] == 'UNPAID' and paid['Akram Ali'][1] == 'PAID' and paid['Sara Noor'][1] == 'PAID'
        again = api.post(f'{ACTIONS}{card["id"]}/approve/', {}, token, sid)
        assert again.status_code == 409

    def test_http_edit_reject_list_and_privacy(self, seed_data, fees, api):
        action = _action(_propose(seed_data, fees))
        token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
        assert [a['id'] for a in api.get(ACTIONS, token, sid).json()] == [action.id]
        r = api.post(f'{ACTIONS}{action.id}/edit/', {'edits': {'remove_ids': [action.preview['rows'][0]['id']]}}, token, sid)
        assert r.status_code == 200 and r.json()['preview']['totals']['count'] == 2
        other = seed_data['tokens']['principal']
        assert api.get(f'{ACTIONS}{action.id}/', other, sid).status_code == 404
        assert api.post(f'{ACTIONS}{action.id}/approve/', {}, other, sid).status_code == 404
        assert api.post(f'{ACTIONS}{action.id}/reject/', {}, token, sid).json()['status'] == 'rejected'
        assert api.get(ACTIONS, token, sid).json() == []
        assert all(v[0] == 0 for v in _paid(fees).values())

    def test_model_gets_no_card_for_a_non_admin_even_if_it_asks(self, seed_data, fees):
        conv = _conv(seed_data, 'accountant')
        args = {'class_name': fees['class_name'], 'account_id': fees['account'].id}
        script = iter([
            llm.LLMReply(tool_calls=[{'id': 'c1', 'name': 'record_fee_payments', 'arguments': args,
                                      'raw_arguments': json.dumps(args)}]),
            llm.LLMReply(content='Sorry, I cannot record payments for you.'),
        ])
        with patch('assistant.llm.complete', lambda *a, **k: next(script)):
            result = orchestrator.run_turn(conv, 'record fees', _ctx(seed_data, 'accountant', conv))
        assert result.proposals == [] and AgentAction.objects.count() == 0
        assert result.tool_calls[0]['ok'] is False
