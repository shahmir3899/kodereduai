"""Hardening: the per-school switch, usage rows, the per-user token cap and the counting of older Groq calls.
No model API is reached: `providers.post_chat` is replaced by a fake that answers with a usage block."""
import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.core.management import call_command

from assistant import guards, llm, orchestrator, registry, usage
from assistant.guards import GuardRefusal
from assistant.models import AgentConversation, AgentUsageDay
from assistant.providers import ProviderError

CAPS = '/api/assistant/capabilities/'
CONVS = '/api/assistant/conversations/'


@pytest.fixture(autouse=True)
def gateway(settings):
    settings.GROQ_API_KEY, settings.CEREBRAS_API_KEY = 'g', 'c'
    settings.LLM_PRIMARY, settings.LLM_CEREBRAS_ENABLED = 'cerebras', True
    settings.ASSISTANT_DEFAULT_ENABLED = True
    settings.USER_DAILY_TOKENS, settings.ADMIN_DAILY_TOKENS = 1000, 5000
    cache.clear()
    llm.reset_state()


@pytest.fixture
def modules(seed_data):
    school, org = seed_data['school_a'], seed_data['org']
    school.enabled_modules = {**(school.enabled_modules or {}), 'finance': True}
    school.save(update_fields=['enabled_modules'])
    org.allowed_modules = {**(org.allowed_modules or {}), 'finance': True}
    org.save(update_fields=['allowed_modules'])


def answer(total=120):
    return ({'choices': [{'message': {'content': 'hi'}}],
             'usage': {'total_tokens': total, 'prompt_tokens': 100, 'completion_tokens': 20}}, {})


@pytest.mark.django_db
class TestSwitch:
    def test_off_hides_capabilities_and_closes_every_endpoint(self, seed_data, modules, api):
        tok, sid = seed_data['tokens']['admin'], seed_data['SID_A']
        assert api.get(CAPS, tok, sid).json()['agents']
        usage.set_assistant_enabled(seed_data['school_a'], False)
        assert api.get(CAPS, tok, sid).json() == {'agents': [], 'suggestions': []}
        assert api.get(CONVS, tok, sid).status_code == 404
        spoken = api.client.post('/api/assistant/voice/spoken/', data=json.dumps({'text': 'x'}), content_type='application/json',
                                 HTTP_AUTHORIZATION=f'Bearer {tok}', HTTP_X_SCHOOL_ID=str(sid))
        assert spoken.status_code == 404

    def test_on_again_restores_it(self, seed_data, modules, api):
        usage.set_assistant_enabled(seed_data['school_a'], False)
        usage.set_assistant_enabled(seed_data['school_a'], True)
        assert api.get(CAPS, seed_data['tokens']['admin'], seed_data['SID_A']).json()['agents']

    def test_deployment_default_applies_only_without_an_explicit_setting(self, seed_data, settings):
        sid = seed_data['SID_A']
        settings.ASSISTANT_DEFAULT_ENABLED = False
        assert usage.assistant_enabled(sid) is False
        usage.set_assistant_enabled(seed_data['school_a'], True)
        assert usage.assistant_enabled(sid) is True

    def test_command_switches_a_school(self, seed_data):
        call_command('assistant_switch', 'off', school_id=seed_data['SID_A'])
        assert usage.assistant_enabled(seed_data['SID_A']) is False


@pytest.mark.django_db
class TestUsageRows:
    def test_a_call_inside_a_scope_is_recorded_and_accumulates(self, seed_data):
        user = seed_data['users']['admin']
        with patch('assistant.providers.post_chat', return_value=answer(120)):
            with usage.scope(seed_data['SID_A'], user.pk):
                llm.complete([{'role': 'user', 'content': 'x'}])
                llm.complete([{'role': 'user', 'content': 'x'}])
        row = AgentUsageDay.objects.get(school_id=seed_data['SID_A'], user=user)
        assert (row.tokens, row.calls, row.fallbacks) == (240, 2, 0)

    def test_no_scope_records_nothing(self, seed_data):
        with patch('assistant.providers.post_chat', return_value=answer()):
            llm.complete([{'role': 'user', 'content': 'x'}])
        assert not AgentUsageDay.objects.exists()

    def test_a_fallback_is_counted(self, seed_data):
        user = seed_data['users']['admin']
        replies = iter([ProviderError('cerebras', 'rate_limit', 'slow'), answer(50)])

        def fake(provider, payload):
            r = next(replies)
            if isinstance(r, Exception):
                raise r
            return r
        with patch('assistant.providers.post_chat', fake), usage.scope(seed_data['SID_A'], user.pk):
            reply = llm.complete([{'role': 'user', 'content': 'x'}])
        assert reply.provider == 'groq'
        assert AgentUsageDay.objects.get(user=user).fallbacks == 1

    def test_a_failing_write_never_breaks_the_answer(self, seed_data):
        with patch('assistant.providers.post_chat', return_value=answer()), \
                patch('assistant.usage._bump', side_effect=RuntimeError('db gone')), \
                usage.scope(seed_data['SID_A'], seed_data['users']['admin'].pk):
            assert llm.complete([{'role': 'user', 'content': 'x'}]).content == 'hi'

    def test_voice_seconds(self, seed_data):
        usage.record_voice(seed_data['SID_A'], seed_data['users']['admin'].pk, 3.6)
        assert AgentUsageDay.objects.get().voice_seconds == 4

    def test_report_command_prints_the_school(self, seed_data, capsys):
        usage.record_voice(seed_data['SID_A'], seed_data['users']['admin'].pk, 2)
        call_command('llm_usage', days=1)
        assert seed_data['school_a'].name[:20] in capsys.readouterr().out


@pytest.mark.django_db
class TestTokenCap:
    def _ctx(self, seed, uname, role):
        return registry.ToolContext(user=seed['users'][uname], school_id=seed['SID_A'], role=role)

    def _spend(self, seed, uname, tokens):
        usage._bump(seed['SID_A'], seed['users'][uname].pk, tokens=tokens)

    def test_under_the_cap_the_turn_runs(self, seed_data):
        self._spend(seed_data, 'teacher', 999)
        guards.check_input(self._ctx(seed_data, 'teacher', 'TEACHER'), 'hello')

    def test_over_the_cap_is_refused_with_a_clear_message_and_nothing_is_saved(self, seed_data):
        self._spend(seed_data, 'teacher', 1000)
        conv = AgentConversation.objects.create(school=seed_data['school_a'], user=seed_data['users']['teacher'])
        with pytest.raises(GuardRefusal) as exc:
            list(orchestrator.iter_turn(conv, 'hello', self._ctx(seed_data, 'teacher', 'TEACHER')))
        assert 'daily AI limit' in str(exc.value) and 'dobara' in str(exc.value)
        assert conv.messages.count() == 0

    def test_leaders_get_the_larger_allowance(self, seed_data):
        self._spend(seed_data, 'admin', 4000)
        guards.check_input(self._ctx(seed_data, 'admin', 'SCHOOL_ADMIN'), 'hello')

    def test_zero_means_no_cap(self, seed_data, settings):
        settings.USER_DAILY_TOKENS = 0
        self._spend(seed_data, 'teacher', 10 ** 7)
        guards.check_input(self._ctx(seed_data, 'teacher', 'TEACHER'), 'hello')

    def test_other_days_do_not_count(self, seed_data):
        AgentUsageDay.objects.create(school_id=seed_data['SID_A'], user=seed_data['users']['teacher'],
                                     date=usage.today().replace(year=usage.today().year - 1), tokens=10 ** 6)
        assert usage.user_tokens_today(seed_data['users']['teacher'].pk) == 0


class TestOlderGroqCalls:
    def test_the_sdk_is_wrapped_once(self):
        from groq.resources.chat.completions import Completions
        assert getattr(Completions.create, '_edu_counted', False)
        first = Completions.create
        usage.patch_groq_sdk()      # idempotent: a second call must not wrap again
        assert Completions.create is first

    def test_counts_sdk_objects_and_json_dicts(self):
        cache.clear()
        usage.record_external('finance.ai_agent', SimpleNamespace(usage=SimpleNamespace(total_tokens=77)))
        usage.record_external('finance.ai_agent', {'usage': {'total_tokens': 3}})
        assert usage.external_today('finance.ai_agent') == (80, 2)

    def test_counting_never_raises(self):
        usage.record_external('x', None)
        usage.record_external('x', object())
