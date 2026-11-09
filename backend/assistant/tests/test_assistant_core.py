"""Phase 0: registry, orchestrator, memory and API of the unified assistant.

The model is always mocked (`assistant.llm.complete`); these tests never call Groq.
"""
from unittest.mock import patch

import pytest

from assistant import llm, memory, orchestrator, registry
from assistant.models import AgentAuditLog, AgentConversation, AgentMessage

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _all_agents_offered():
    """These tests script the model's replies one by one, so the router must not take one
    of them. Router behaviour has its own tests (test_router_and_ports.py)."""
    with patch('assistant.router.pick_agents', lambda by_agent, message, recent=(): list(by_agent)):
        yield

BASE = '/api/assistant/conversations/'


def _ctx(seed, uname, conv=None):
    user = seed['users'][uname]
    return registry.ToolContext(user=user, school_id=seed['SID_A'], role=user.role, conversation=conv)


def _enable_finance(seed):
    school = seed['school_a']
    school.enabled_modules = {**(school.enabled_modules or {}), 'finance': True}
    school.save(update_fields=['enabled_modules'])
    org = school.organization
    org.allowed_modules = {**(org.allowed_modules or {}), 'finance': True}
    org.save(update_fields=['allowed_modules'])


def _finance(ctx):
    return [t for t in registry.tools_for(ctx) if t.sub_agent == 'finance']


def _conv(seed, uname='admin'):
    return AgentConversation.objects.create(school=seed['school_a'], user=seed['users'][uname])


def _script(*replies):
    """Make llm.complete return the given replies in order."""
    it = iter(replies)
    return lambda *a, **k: next(it)


def _call(name, args, call_id='c1'):
    import json
    return llm.LLMReply(tool_calls=[{
        'id': call_id, 'name': name, 'arguments': args, 'raw_arguments': json.dumps(args),
    }])


class TestRegistry:
    def test_write_tools_are_not_registrable(self):
        bad = registry.Tool(
            name='x_write', description='', parameters={'type': 'object', 'properties': {}},
            handler=lambda ctx: {}, sub_agent='finance', module='finance',
            roles=registry.ADMINS, kind='write',
        )
        with pytest.raises(ValueError):
            registry.register(bad)

    def test_finance_tools_are_registered(self):
        names = {t.name for t in registry.all_tools()}
        assert {'get_pending_fees', 'get_account_balances', 'get_top_expenses'} <= names
        assert len([t for t in registry.all_tools() if t.sub_agent == 'finance']) == 26

    def test_tool_visibility_follows_role(self, seed_data):
        _enable_finance(seed_data)
        assert registry.tools_for(_ctx(seed_data, 'admin'))
        assert registry.tools_for(_ctx(seed_data, 'accountant'))
        assert _finance(_ctx(seed_data, 'teacher')) == []
        assert _finance(_ctx(seed_data, 'staff')) == []

    def test_module_disabled_hides_tools(self, seed_data):
        school = seed_data['school_a']
        school.enabled_modules = {**(school.enabled_modules or {}), 'finance': False}
        school.save(update_fields=['enabled_modules'])
        assert _finance(_ctx(seed_data, 'admin')) == []

    def test_execute_denied_for_wrong_role_is_audited(self, seed_data):
        _enable_finance(seed_data)
        result = registry.execute(_ctx(seed_data, 'teacher'), 'get_balance', {})
        assert 'error' in result
        log = AgentAuditLog.objects.get(tool_name='get_balance')
        assert log.kind == AgentAuditLog.Kind.DENIED and not log.ok

    def test_execute_runs_for_allowed_role_and_audits(self, seed_data):
        _enable_finance(seed_data)
        result = registry.execute(_ctx(seed_data, 'accountant'), 'get_balance', {})
        assert 'data' in result, result
        log = AgentAuditLog.objects.get(tool_name='get_balance')
        assert log.kind == AgentAuditLog.Kind.READ and log.ok

    def test_unknown_arguments_are_ignored_not_fatal(self, seed_data):
        _enable_finance(seed_data)
        result = registry.execute(_ctx(seed_data, 'admin'), 'get_balance', {'bogus': 1})
        assert result.get('ignored_arguments') == ['bogus']

    def test_unknown_tool(self, seed_data):
        result = registry.execute(_ctx(seed_data, 'admin'), 'drop_tables', {})
        assert 'error' in result


class TestOrchestrator:
    def test_tool_round_trip_records_sub_agent(self, seed_data):
        _enable_finance(seed_data)
        conv = _conv(seed_data)
        replies = _script(_call('get_balance', {}), llm.LLMReply(content='Balance is fine.'))
        with patch('assistant.llm.complete', replies):
            result = orchestrator.run_turn(conv, 'balance kya hai?', _ctx(seed_data, 'admin', conv))
        assert result.content == 'Balance is fine.'
        assert result.sub_agents == ['finance']
        assert result.tool_calls[0]['name'] == 'get_balance' and result.tool_calls[0]['ok']
        roles = list(conv.messages.values_list('role', flat=True))
        assert roles == ['user', 'assistant']
        assert conv.messages.last().sub_agent == 'finance'
        conv.refresh_from_db()
        assert conv.title.startswith('balance')

    def test_teacher_gets_no_finance_tools_even_if_model_asks(self, seed_data):
        _enable_finance(seed_data)
        conv = _conv(seed_data, 'teacher')
        replies = _script(_call('get_balance', {}), llm.LLMReply(content='Sorry, not allowed.'))
        with patch('assistant.llm.complete', replies):
            result = orchestrator.run_turn(conv, 'show balance', _ctx(seed_data, 'teacher', conv))
        assert result.tool_calls[0]['ok'] is False
        assert AgentAuditLog.objects.filter(kind=AgentAuditLog.Kind.DENIED).exists()

    def test_malformed_tool_arguments_let_the_model_retry(self, seed_data):
        _enable_finance(seed_data)
        conv = _conv(seed_data)
        bad = llm.LLMReply(tool_calls=[{'id': 'c1', 'name': 'get_balance', 'arguments': None, 'raw_arguments': '{oops'}])
        replies = _script(bad, _call('get_balance', {}, 'c2'), llm.LLMReply(content='ok'))
        with patch('assistant.llm.complete', replies):
            result = orchestrator.run_turn(conv, 'x', _ctx(seed_data, 'admin', conv))
        assert [s['ok'] for s in result.tool_calls] == [False, True]
        assert result.content == 'ok'

    def test_llm_down_returns_friendly_message(self, seed_data):
        conv = _conv(seed_data)

        def boom(*a, **k):
            raise llm.LLMUnavailable('down')

        with patch('assistant.llm.complete', boom):
            result = orchestrator.run_turn(conv, 'hello', _ctx(seed_data, 'admin', conv))
        assert result.content == orchestrator.UNAVAILABLE
        assert conv.messages.count() == 2

    def test_endless_tool_calls_stop_after_max_rounds(self, seed_data):
        _enable_finance(seed_data)
        conv = _conv(seed_data)
        calls = {'n': 0}

        def always_tool(messages, tools=None, **k):
            if tools is None:
                return llm.LLMReply(content='final')
            calls['n'] += 1
            return _call('get_balance', {}, f'c{calls["n"]}')

        with patch('assistant.llm.complete', always_tool):
            result = orchestrator.run_turn(conv, 'loop', _ctx(seed_data, 'admin', conv))
        assert calls['n'] == orchestrator.MAX_ROUNDS
        assert result.content


class TestMemory:
    def test_window_and_counter_cap_at_ten(self, seed_data):
        conv = _conv(seed_data)
        for i in range(14):
            AgentMessage.objects.create(conversation=conv, role='user' if i % 2 == 0 else 'assistant', content=f'm{i}')
        window = memory.window_messages(conv)
        assert [m.content for m in window] == [f'm{i}' for i in range(4, 14)]
        assert memory.counter(conv) == {'used': 10, 'limit': 10}

    def test_counter_counts_up_below_ten(self, seed_data):
        conv = _conv(seed_data)
        for i in range(3):
            AgentMessage.objects.create(conversation=conv, role='user', content=str(i))
        assert memory.counter(conv) == {'used': 3, 'limit': 10}

    def test_overflow_is_summarized(self, seed_data):
        conv = _conv(seed_data)
        for i in range(16):
            AgentMessage.objects.create(conversation=conv, role='user', content=f'm{i}')
        with patch('assistant.llm.complete', lambda *a, **k: llm.LLMReply(content='SUMMARY')):
            memory.maybe_summarize(conv)
        conv.refresh_from_db()
        assert conv.summary == 'SUMMARY' and conv.summarized_count == 6

    def test_summary_failure_is_not_fatal(self, seed_data):
        conv = _conv(seed_data)
        for i in range(16):
            AgentMessage.objects.create(conversation=conv, role='user', content=f'm{i}')

        def boom(*a, **k):
            raise llm.LLMUnavailable('x')

        with patch('assistant.llm.complete', boom):
            memory.maybe_summarize(conv)
        conv.refresh_from_db()
        assert conv.summary == '' and conv.summarized_count == 0

    def test_state_survives_beyond_window(self, seed_data):
        conv = _conv(seed_data)
        memory.merge_state(conv, {'working_set': {'type': 'fee_payments', 'ids': [1, 2, 3]}})
        memory.merge_state(conv, {'class': '5'})
        conv.refresh_from_db()
        assert conv.state['working_set']['ids'] == [1, 2, 3] and conv.state['class'] == '5'


class TestApi:
    def _post(self, api, url, data, seed, uname='admin'):
        return api.post(url, data, seed['tokens'][uname], seed['SID_A'])

    def test_create_list_rename_delete(self, seed_data, api):
        r = self._post(api, BASE, {}, seed_data)
        assert r.status_code == 201
        cid = r.json()['id']
        assert api.get(BASE, seed_data['tokens']['admin'], seed_data['SID_A']).json()[0]['id'] == cid
        r = api.patch(f'{BASE}{cid}/', {'title': 'Fees', 'pinned': True}, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert r.json()['title'] == 'Fees' and r.json()['pinned'] is True
        r = api.delete(f'{BASE}{cid}/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert r.status_code == 204

    def test_send_message_returns_counter_and_sub_agents(self, seed_data, api):
        _enable_finance(seed_data)
        cid = self._post(api, BASE, {}, seed_data).json()['id']
        replies = _script(_call('get_balance', {}), llm.LLMReply(content='All good.'))
        with patch('assistant.llm.complete', replies):
            r = self._post(api, f'{BASE}{cid}/messages/', {'message': 'balance?'}, seed_data)
        assert r.status_code == 200, r.content
        body = r.json()
        assert body['response'] == 'All good.'
        assert body['sub_agents'] == ['finance']
        assert body['memory'] == {'used': 2, 'limit': 10}
        history = api.get(f'{BASE}{cid}/messages/', seed_data['tokens']['admin'], seed_data['SID_A']).json()
        assert [m['role'] for m in history['messages']] == ['user', 'assistant']

    def test_empty_and_too_long_messages_rejected(self, seed_data, api):
        cid = self._post(api, BASE, {}, seed_data).json()['id']
        assert self._post(api, f'{BASE}{cid}/messages/', {'message': '  '}, seed_data).status_code == 400
        assert self._post(api, f'{BASE}{cid}/messages/', {'message': 'a' * 2001}, seed_data).status_code == 400

    def test_conversations_are_private_to_their_owner(self, seed_data, api):
        cid = self._post(api, BASE, {}, seed_data).json()['id']
        other = api.get(f'{BASE}{cid}/messages/', seed_data['tokens']['principal'], seed_data['SID_A'])
        assert other.status_code == 404

    def test_conversations_are_isolated_between_schools(self, seed_data, api):
        cid = self._post(api, BASE, {}, seed_data).json()['id']
        r = api.get(f'{BASE}{cid}/messages/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert r.status_code == 404
        assert api.get(BASE, seed_data['tokens']['admin_b'], seed_data['SID_B']).json() == []

    def test_requires_login(self, api_client):
        assert api_client.get(BASE).status_code in (401, 403)
