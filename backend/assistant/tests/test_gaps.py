"""Learning loop, step 1: redaction, gap signals, role scoping, retention field and the feedback endpoint.
The model is always mocked; the shared seed_data school is reused."""
import json
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from assistant import engine, gaps, llm, orchestrator, redact, registry
from assistant.models import AgentAction, AgentConversation, AgentGap, AgentMessage

pytestmark = pytest.mark.django_db

FEEDBACK = '/api/assistant/feedback/'


@pytest.fixture(autouse=True)
def _all_agents_offered():
    with patch('assistant.router.pick_agents', lambda by_agent, message, recent=(): list(by_agent)):
        yield


def _ctx(seed, uname='admin', conv=None, role=None):
    user = seed['users'][uname]
    return registry.ToolContext(user=user, school_id=seed['SID_A'], role=role or user.role, conversation=conv)


def _conv(seed, uname='admin'):
    return AgentConversation.objects.create(school=seed['school_a'], user=seed['users'][uname])


def _call(name, args, call_id='c1'):
    return llm.LLMReply(tool_calls=[{'id': call_id, 'name': name, 'arguments': args, 'raw_arguments': json.dumps(args)}])


def _turn(seed, replies, text='fee wale bachon ke parents', uname='admin', ctx=None):
    conv = _conv(seed, uname)
    ctx = ctx or _ctx(seed, uname, conv)
    ctx.conversation = conv
    script = iter(replies)
    with patch('assistant.llm.complete', lambda *a, **k: next(script)):
        events = list(orchestrator.iter_turn(conv, text, ctx))
    return conv, events[-1]


class TestRedaction:
    def test_student_names_phones_emails_and_ids_are_replaced(self, seed_data):
        out = redact.redact('Ali Hassan ka number 0300-1234567 ya +92 300 1234567, mail ali@x.com, CNIC 35202-1234567-1',
                            seed_data['SID_A'])
        assert '<student>' in out
        for raw in ('Ali', 'Hassan', '1234567', 'ali@x.com'):
            assert raw not in out
        assert '<phone>' in out and '<email>' in out and '<id>' in out

    def test_staff_names_are_replaced_and_marked_staff(self, seed_data):
        staff = seed_data['staff'][0]
        staff.last_name = 'Zubairi'      # the seed staff share names with students; this one is staff-only
        staff.save(update_fields=['last_name'])
        out = redact.redact(f'{staff.last_name} ki leave kitni hai', seed_data['SID_A'])
        assert staff.last_name not in out and '<staff>' in out

    def test_other_schools_names_are_not_touched_and_text_is_capped(self, seed_data):
        assert redact.redact('Ali Hassan', seed_data['SID_B']) == 'Ali Hassan'
        assert len(redact.redact('word ' * 200, seed_data['SID_A'])) == 300

    def test_lookup_failure_stores_nothing_rather_than_raw_text(self, seed_data):
        with patch('assistant.redact._names', side_effect=RuntimeError('db')):
            assert redact.redact('Ali Hassan 03001234567', seed_data['SID_A']) == ''

    def test_language_guess(self):
        assert redact.detect_language('fee kitni baki hai mera') == 'ur_roman'
        assert redact.detect_language('show pending fees') == 'en'
        assert redact.detect_language('فیس کتنی ہے') == 'ur'


class TestRecordGap:
    def test_staff_text_is_redacted_and_gets_a_90_day_expiry(self, seed_data):
        row = gaps.record_gap(_ctx(seed_data), 'missing_tool', 'Ali Hassan ke parents ka number 03001234567')
        assert 'Ali' not in row.summary and 'Hassan' not in row.summary and '0300' not in row.summary
        assert row.role == 'SCHOOL_ADMIN' and row.language == 'ur_roman'
        assert timedelta(days=89) < row.delete_after - timezone.now() <= timedelta(days=90)

    @pytest.mark.parametrize('role', ['STUDENT', 'PARENT'])
    def test_students_and_parents_never_have_text_stored(self, seed_data, role):
        row = gaps.record_gap(_ctx(seed_data, role=role), 'missing_tool', 'my secret question', reason='because', agent='finance')
        assert row.summary == '' and row.reason == '' and row.language == ''
        assert row.agent == 'finance'

    def test_exact_duplicates_are_ignored(self, seed_data):
        ctx = _ctx(seed_data, conv=_conv(seed_data))
        assert gaps.record_gap(ctx, 'missing_tool', 'list scholarship holders')
        assert gaps.record_gap(ctx, 'missing_tool', 'list scholarship holders') is None
        assert AgentGap.objects.count() == 1

    def test_a_failing_write_never_raises(self, seed_data):
        with patch('assistant.gaps.AgentGap.objects') as objects:
            objects.filter.side_effect = RuntimeError('db down')
            assert gaps.record_gap(_ctx(seed_data), 'denied') is None


class TestSignals:
    def test_report_missing_capability_records_once_per_turn(self, seed_data):
        conv, final = _turn(seed_data, [
            _call('report_missing_capability', {'summary': 'parents of fee pending children', 'category': 'lists'}, 'a'),
            _call('report_missing_capability', {'summary': 'parents of fee pending children again', 'category': 'lists'}, 'b'),
            llm.LLMReply(content="I can't do that yet. Use the Fees screen."),
        ])
        rows = AgentGap.objects.filter(kind='missing_tool')
        assert rows.count() == 1 and rows[0].agent == 'lists'
        assert final['ask_feedback'] is True

    def test_plain_decline_text_is_captured_without_the_tool(self, seed_data):
        conv, final = _turn(seed_data, [llm.LLMReply(content="Sorry, I can't do that from chat.")], text='scholarship wale list do')
        row = AgentGap.objects.get(kind='missing_tool')
        assert row.summary == 'scholarship wale list do' and row.message_id
        assert final['ask_feedback'] is True

    def test_normal_answer_records_nothing_and_asks_for_no_thumb(self, seed_data):
        _, final = _turn(seed_data, [llm.LLMReply(content='All good.')])
        assert AgentGap.objects.count() == 0 and final['ask_feedback'] is False

    def test_tool_error_and_denied_are_recorded_without_user_text(self, seed_data):
        def boom(ctx, **kw):
            raise RuntimeError('boom')

        registry.register(registry.Tool(name='probe_boom', description='x', parameters={'type': 'object', 'properties': {}},
                                        handler=boom, sub_agent='finance', module=None, roles=registry.ADMINS))
        registry.register(registry.Tool(name='probe_nope', description='x', parameters={'type': 'object', 'properties': {}},
                                        handler=lambda ctx: 1, sub_agent='finance', module=None, roles=('TEACHER',)))
        try:
            ctx = _ctx(seed_data, conv=_conv(seed_data))
            assert 'error' in registry.execute(ctx, 'probe_boom', {})
            assert 'error' in registry.execute(ctx, 'probe_nope', {})
        finally:
            registry._TOOLS.pop('probe_boom', None)
            registry._TOOLS.pop('probe_nope', None)
        by_kind = {g.kind: g for g in AgentGap.objects.all()}
        assert by_kind['tool_error'].tool_hint == 'probe_boom' and by_kind['denied'].tool_hint == 'probe_nope'
        assert by_kind['tool_error'].summary == ''

    def test_proposal_error_is_a_normal_question_not_a_gap(self, seed_data):
        def ask(ctx, **kw):
            raise registry.ProposalError('which class?')

        registry.register(registry.Tool(name='probe_ask', description='x', parameters={'type': 'object', 'properties': {}},
                                        handler=ask, sub_agent='finance', module=None, roles=registry.ADMINS))
        try:
            registry.execute(_ctx(seed_data), 'probe_ask', {})
        finally:
            registry._TOOLS.pop('probe_ask', None)
        assert AgentGap.objects.count() == 0

    def test_rejecting_and_editing_a_card_are_recorded(self, seed_data):
        def propose(ctx, note='x'):
            return {'payload': {'note': note}, 'preview': {'kind': 'probe', 'summary': 'secret card text', 'rows': []}}

        registry.register(registry.Tool(name='probe_w', description='x', parameters={'type': 'object', 'properties': {}},
                                        handler=propose, sub_agent='finance', module=None, roles=registry.ADMINS, kind='write',
                                        revise=lambda ctx, payload, edits: propose(ctx), apply=lambda ctx, payload: {'ok': True}))
        try:
            user, sid = seed_data['users']['admin'], seed_data['SID_A']
            ctx = _ctx(seed_data, conv=_conv(seed_data))
            a = engine.create_proposal(ctx, registry.get_tool('probe_w'), {})
            engine.edit(a.pk, user, sid, {})
            engine.reject(a.pk, user, sid)
        finally:
            registry._TOOLS.pop('probe_w', None)
        rows = {g.kind: g for g in AgentGap.objects.all()}
        assert set(rows) == {'card_edited', 'card_rejected'}
        assert rows['card_rejected'].tool_hint == 'probe_w' and 'secret' not in rows['card_rejected'].summary

    def test_three_questions_in_a_row_is_a_clarify_loop(self, seed_data):
        conv = _conv(seed_data)
        ctx = _ctx(seed_data, conv=conv)
        script = iter([llm.LLMReply(content='Which class?'), llm.LLMReply(content='Which month?'), llm.LLMReply(content='Which account?')])
        with patch('assistant.llm.complete', lambda *a, **k: next(script)):
            for text in ('fees', 'this month', 'all'):
                list(orchestrator.iter_turn(conv, text, ctx))
        assert AgentGap.objects.filter(kind='clarify_loop').count() == 1

    def test_the_tool_is_offered_to_every_role(self, seed_data):
        for uname in ('admin', 'teacher', 'finance_manager'):
            assert 'report_missing_capability' in {t.name for t in registry.tools_for(_ctx(seed_data, uname))}
        for role in ('STUDENT', 'PARENT'):
            assert 'report_missing_capability' in {t.name for t in registry.tools_for(_ctx(seed_data, role=role))}


def _reply(seed, uname='admin'):
    conv = _conv(seed, uname)
    AgentMessage.objects.create(conversation=conv, role='user', content='scholarship list for Ali Hassan')
    return AgentMessage.objects.create(conversation=conv, role='assistant', content='no', sub_agent='finance')


def _post(api, seed, body, uname='admin', sid=None):
    return api.client.post(FEEDBACK, data=json.dumps(body), content_type='application/json',
                           HTTP_AUTHORIZATION=f'Bearer {seed["tokens"][uname]}', HTTP_X_SCHOOL_ID=str(sid or seed['SID_A']))


class TestFeedbackEndpoint:
    def test_thumbs_down_is_saved_redacted_and_a_changed_mind_replaces_it(self, seed_data, api):
        msg = _reply(seed_data)
        assert _post(api, seed_data, {'message_id': msg.pk, 'rating': -1, 'reason': 'Ali Hassan missing'}).status_code == 200
        row = AgentGap.objects.get()
        assert row.kind == 'thumbs_down' and row.rating == -1 and row.agent == 'finance'
        assert 'Ali' not in row.summary and 'Ali' not in row.reason
        assert _post(api, seed_data, {'message_id': msg.pk, 'rating': 1}).status_code == 200
        assert [(g.kind, g.rating) for g in AgentGap.objects.all()] == [('thumbs_up', 1)]

    def test_validation(self, seed_data, api):
        msg = _reply(seed_data)
        assert _post(api, seed_data, {'message_id': msg.pk, 'rating': 5}).status_code == 400
        assert _post(api, seed_data, {'rating': 1}).status_code == 400

    def test_requires_login(self, seed_data, api):
        msg = _reply(seed_data)
        r = api.client.post(FEEDBACK, data=json.dumps({'message_id': msg.pk, 'rating': 1}), content_type='application/json',
                            HTTP_X_SCHOOL_ID=str(seed_data['SID_A']))
        assert r.status_code in (401, 403)

    def test_another_users_message_is_not_found(self, seed_data, api):
        msg = _reply(seed_data, 'admin')
        assert _post(api, seed_data, {'message_id': msg.pk, 'rating': 1}, uname='principal').status_code == 404
        assert AgentGap.objects.count() == 0

    def test_a_parent_can_rate_but_no_text_is_kept(self, seed_data, api):
        from schools.models import UserSchoolMembership
        from users.models import User

        parent = User.objects.create_user(username='PYTEST_par', email='par@test.com', password='TestPass123!',
                                          role='PARENT', school=seed_data['school_a'], organization=seed_data['org'])
        UserSchoolMembership.objects.create(user=parent, school=seed_data['school_a'], role='PARENT', is_default=True)
        conv = AgentConversation.objects.create(school=seed_data['school_a'], user=parent)
        AgentMessage.objects.create(conversation=conv, role='user', content='private question')
        msg = AgentMessage.objects.create(conversation=conv, role='assistant', content='no')
        token = api.login('PYTEST_par')
        r = api.client.post(FEEDBACK, data=json.dumps({'message_id': msg.pk, 'rating': -1, 'reason': 'private'}),
                            content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {token}',
                            HTTP_X_SCHOOL_ID=str(seed_data['SID_A']))
        assert r.status_code == 200
        row = AgentGap.objects.get()
        assert row.role == 'PARENT' and row.summary == '' and row.reason == ''
