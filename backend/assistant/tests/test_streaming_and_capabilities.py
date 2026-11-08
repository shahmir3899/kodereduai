"""Server-sent events for a turn (what the orb shows live) and the capabilities endpoint."""
import json
from unittest.mock import patch

import pytest

from assistant import llm, orchestrator, registry
from assistant.models import AgentConversation, AgentMessage

pytestmark = pytest.mark.django_db

CONV = '/api/assistant/conversations/'


@pytest.fixture(autouse=True)
def _all_agents_offered():
    with patch('assistant.router.pick_agents', lambda by_agent, message, recent=(): list(by_agent)):
        yield


@pytest.fixture
def modules(seed_data):
    school, org = seed_data['school_a'], seed_data['org']
    keys = {m: True for m in ('finance', 'academics', 'attendance', 'lms', 'notifications', 'students')}
    school.enabled_modules = {**(school.enabled_modules or {}), **keys}
    school.save(update_fields=['enabled_modules'])
    org.allowed_modules = {**(org.allowed_modules or {}), **keys}
    org.save(update_fields=['allowed_modules'])


@pytest.fixture
def probe_write_tool():
    """A throw-away write tool so the card event can be tested without finance data."""
    def propose(ctx, note='x'):
        return {'payload': {'note': note}, 'preview': {'kind': 'probe', 'summary': f'Probe {note}', 'rows': []}}

    tool = registry.Tool(name='probe_write', description='probe', parameters={'type': 'object', 'properties': {'note': {'type': 'string'}}},
                         handler=propose, sub_agent='finance', module=None, roles=registry.ADMINS, kind='write',
                         revise=lambda ctx, payload, edits: propose(ctx, payload['note']), apply=lambda ctx, payload: {'ok': True})
    registry.register(tool)
    yield tool
    registry._TOOLS.pop('probe_write', None)


def _call(name, args, call_id='c1'):
    return llm.LLMReply(tool_calls=[{'id': call_id, 'name': name, 'arguments': args, 'raw_arguments': json.dumps(args)}])


def _events(response):
    body = b''.join(response.streaming_content).decode()
    return [json.loads(chunk[len('data: '):]) for chunk in body.split('\n\n') if chunk.startswith('data: ')]


def _stream(api, seed, cid, message, uname='admin', sid=None):
    return api.client.post(f'{CONV}{cid}/stream/', data=json.dumps({'message': message}), content_type='application/json',
                           HTTP_AUTHORIZATION=f'Bearer {seed["tokens"][uname]}', HTTP_X_SCHOOL_ID=str(sid or seed['SID_A']))


def _new(api, seed, uname='admin'):
    return api.post(CONV, {}, seed['tokens'][uname], seed['SID_A']).json()['id']


class TestStream:
    def test_events_arrive_in_order_with_steps_and_a_final_message(self, seed_data, modules, api):
        cid = _new(api, seed_data)
        script = iter([_call('get_balance', {}), llm.LLMReply(content='Balance is fine.')])
        with patch('assistant.llm.complete', lambda *a, **k: next(script)):
            r = _stream(api, seed_data, cid, 'balance kya hai?')
            ev = _events(r)             # the stream is lazy: read it while the mock is active
        assert r.status_code == 200 and r['Content-Type'].startswith('text/event-stream')
        assert r['Cache-Control'] in ('no-cache', 'no-store') and r['X-Accel-Buffering'] == 'no'
        assert [e['type'] for e in ev] == ['start', 'route', 'step', 'step', 'final']
        assert ev[0]['memory'] == {'used': 1, 'limit': 10}
        assert 'finance' in ev[1]['agents']
        start, end = ev[2], ev[3]
        assert (start['phase'], start['name'], start['sub_agent'], start['label']) == ('start', 'get_balance', 'finance', 'Balance')
        assert (end['phase'], end['index'], end['ok']) == ('end', 0, True)
        final = ev[4]
        assert final['content'] == 'Balance is fine.' and final['sub_agents'] == ['finance']
        assert final['message']['role'] == 'assistant' and final['memory'] == {'used': 2, 'limit': 10}

    def test_a_failed_step_is_marked_not_ok(self, seed_data, modules, api):
        cid = _new(api, seed_data)
        script = iter([_call('get_class_schedule', {}), llm.LLMReply(content='I need a class name.')])
        with patch('assistant.llm.complete', lambda *a, **k: next(script)):
            ev = _events(_stream(api, seed_data, cid, 'timetable'))
        assert [e['ok'] for e in ev if e['type'] == 'step' and e['phase'] == 'end'] == [False]

    def test_a_prepared_change_arrives_as_a_card_before_the_answer(self, seed_data, modules, probe_write_tool, api):
        cid = _new(api, seed_data)
        script = iter([_call('probe_write', {'note': 'hi'}), llm.LLMReply(content='Review the card.')])
        with patch('assistant.llm.complete', lambda *a, **k: next(script)):
            ev = _events(_stream(api, seed_data, cid, 'do it'))
        types = [e['type'] for e in ev]
        assert types.index('card') < types.index('final')
        card = next(e for e in ev if e['type'] == 'card')['action']
        assert card['status'] == 'pending' and card['can_act'] and card['preview']['summary'] == 'Probe hi'
        assert next(e for e in ev if e['type'] == 'step')['label'] == 'Preparing: probe write'
        final = ev[-1]
        assert [a['id'] for a in final['message']['actions']] == [card['id']]

    def test_conversation_history_matches_what_was_streamed(self, seed_data, modules, api):
        cid = _new(api, seed_data)
        with patch('assistant.llm.complete', lambda *a, **k: llm.LLMReply(content='Hello!')):
            _events(_stream(api, seed_data, cid, 'hi'))
        hist = api.get(f'{CONV}{cid}/messages/', seed_data['tokens']['admin'], seed_data['SID_A']).json()
        assert [m['role'] for m in hist['messages']] == ['user', 'assistant'] and hist['messages'][1]['content'] == 'Hello!'

    def test_model_failure_mid_stream_sends_an_error_event_and_keeps_the_record(self, seed_data, modules, api):
        cid = _new(api, seed_data)

        def boom(*a, **k):
            raise RuntimeError('db exploded')

        with patch('assistant.llm.complete', boom):
            ev = _events(_stream(api, seed_data, cid, 'hi'))
        assert ev[-1]['type'] == 'error'
        roles = list(AgentMessage.objects.filter(conversation_id=cid).values_list('role', flat=True))
        assert roles == ['user', 'assistant']

    def test_llm_down_is_an_answer_not_an_error(self, seed_data, modules, api):
        cid = _new(api, seed_data)

        def down(*a, **k):
            raise llm.LLMUnavailable('429')

        with patch('assistant.llm.complete', down):
            ev = _events(_stream(api, seed_data, cid, 'hi'))
        assert ev[-1]['type'] == 'final' and ev[-1]['content'] == orchestrator.UNAVAILABLE

    @pytest.mark.parametrize('message, status', [('   ', 400), ('a' * 2001, 400)])
    def test_bad_messages_are_plain_400s(self, seed_data, api, message, status):
        cid = _new(api, seed_data)
        assert _stream(api, seed_data, cid, message).status_code == status

    def test_someone_elses_conversation_is_404(self, seed_data, api):
        cid = _new(api, seed_data)
        assert _stream(api, seed_data, cid, 'hi', uname='principal').status_code == 404
        assert _stream(api, seed_data, cid, 'hi', uname='admin_b', sid=seed_data['SID_B']).status_code == 404

    def test_a_refused_student_message_is_a_400_before_any_stream(self, seed_data, api):
        from schools.models import UserSchoolMembership
        from students.models import StudentProfile
        from users.models import User
        u = User.objects.create_user(username='PYTEST_stu2', email='s2@test.com', password='TestPass123!', role='STUDENT',
                                     school=seed_data['school_a'], organization=seed_data['org'])
        UserSchoolMembership.objects.create(user=u, school=seed_data['school_a'], role='STUDENT', is_default=True)
        StudentProfile.objects.create(user=u, student=seed_data['students'][0], school=seed_data['school_a'])
        token = api.login('PYTEST_stu2')
        cid = api.post(CONV, {}, token, seed_data['SID_A']).json()['id']
        r = api.client.post(f'{CONV}{cid}/stream/', data=json.dumps({'message': 'give me the phone number of my teacher'}),
                            content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {token}', HTTP_X_SCHOOL_ID=str(seed_data['SID_A']))
        assert r.status_code == 400 and not r.streaming and AgentMessage.objects.count() == 0


class TestInterruption:
    def test_closing_the_stream_early_still_leaves_a_whole_record(self, seed_data, modules):
        conv = AgentConversation.objects.create(school=seed_data['school_a'], user=seed_data['users']['admin'])
        ctx = registry.ToolContext(user=seed_data['users']['admin'], school_id=seed_data['SID_A'], role='SCHOOL_ADMIN', conversation=conv)
        with patch('assistant.llm.complete', lambda *a, **k: llm.LLMReply(content='never reached')):
            events = orchestrator.iter_turn(conv, 'hello', ctx)
            assert next(events)['type'] == 'start'
            events.close()                                   # the browser tab was closed
        msgs = list(conv.messages.order_by('id'))
        assert [m.role for m in msgs] == ['user', 'assistant'] and 'interrupted' in msgs[1].content

    def test_run_turn_is_the_same_loop(self, seed_data, modules):
        conv = AgentConversation.objects.create(school=seed_data['school_a'], user=seed_data['users']['admin'])
        ctx = registry.ToolContext(user=seed_data['users']['admin'], school_id=seed_data['SID_A'], role='SCHOOL_ADMIN', conversation=conv)
        script = iter([_call('get_balance', {}), llm.LLMReply(content='ok')])
        with patch('assistant.llm.complete', lambda *a, **k: next(script)):
            result = orchestrator.run_turn(conv, 'balance?', ctx)
        assert result.content == 'ok' and result.sub_agents == ['finance'] and result.tool_calls[0]['ok']


class TestCapabilities:
    def _caps(self, api, seed, uname):
        r = api.get('/api/assistant/capabilities/', seed['tokens'][uname], seed['SID_A'])
        assert r.status_code == 200
        return r.json()

    def test_admin_gets_every_adult_agent_and_starter_prompts(self, seed_data, modules, api):
        caps = self._caps(api, seed_data, 'admin')
        assert {a['name'] for a in caps['agents']} >= {'finance', 'academics', 'attendance', 'communication'}
        assert caps['memory_limit'] == 10 and 1 <= len(caps['suggestions']) <= 8
        finance = next(a for a in caps['agents'] if a['name'] == 'finance')
        assert finance['label'] == 'Finance' and finance['can_write'] is True and finance['tools'] > 10

    def test_roles_see_only_their_agents(self, seed_data, modules, api):
        assert {a['name'] for a in self._caps(api, seed_data, 'accountant')['agents']} == {'finance'}
        assert [a for a in self._caps(api, seed_data, 'accountant')['agents'] if a['can_write']] == []
        assert {a['name'] for a in self._caps(api, seed_data, 'teacher')['agents']} == {'academics', 'attendance'}

    def test_roles_without_tools_get_nothing_so_no_orb(self, seed_data, modules, api):
        caps = self._caps(api, seed_data, 'staff')
        assert caps['agents'] == [] and caps['suggestions'] == []

    def test_modules_off_means_no_agents(self, seed_data, api):
        school = seed_data['school_a']
        school.enabled_modules = {k: False for k in ('finance', 'academics', 'attendance', 'lms', 'notifications', 'students')}
        school.save(update_fields=['enabled_modules'])
        assert self._caps(api, seed_data, 'admin')['agents'] == []

    def test_requires_login(self, api_client):
        assert api_client.get('/api/assistant/capabilities/').status_code in (401, 403)
