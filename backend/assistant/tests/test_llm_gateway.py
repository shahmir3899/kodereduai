"""The model gateway: Cerebras primary, Groq fallback, kill switch, limits. No network - the transport
(`providers.post_chat`) is replaced by a script, and the HTTP layer is tested with a fake httpx."""
import json
from unittest.mock import patch

import httpx
import pytest
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError

from assistant import llm, memory, providers, router
from assistant.providers import CEREBRAS, GROQ, ProviderError
from assistant.providers import post_chat as real_post_chat     # imported before the tripwire replaces it

MSGS = [{'role': 'user', 'content': 'hi'}]


@pytest.fixture(autouse=True)
def gateway(settings):
    settings.GROQ_API_KEY, settings.CEREBRAS_API_KEY = 'g-key', 'c-key'
    settings.LLM_CEREBRAS_ENABLED, settings.LLM_PRIMARY, settings.LLM_CEREBRAS_RPM = True, 'cerebras', 5
    settings.GROQ_MODEL, settings.CEREBRAS_MODEL = 'openai/gpt-oss-120b', 'gpt-oss-120b'
    settings.GROQ_FAST_MODEL = settings.CEREBRAS_FAST_MODEL = ''
    settings.GROQ_REASONING_EFFORT = settings.CEREBRAS_REASONING_EFFORT = 'low'
    settings.GROQ_MAX_TOKENS_PARAM = settings.CEREBRAS_MAX_TOKENS_PARAM = 'max_tokens'
    llm.reset_state()
    cache.clear()
    with patch('assistant.llm.time.sleep'):          # retry pauses are not worth waiting for
        yield
    llm.reset_state()


def ok(content='hello', tool_calls=None, total=100, headers=None):
    msg = {'role': 'assistant', 'content': content}
    if tool_calls is not None:
        msg['tool_calls'] = tool_calls
    return ({'choices': [{'message': msg}], 'usage': {'prompt_tokens': total - 10, 'completion_tokens': 10, 'total_tokens': total}}, headers or {})


def tool_call(name='get_balance', args='{}', call_id='c1'):
    return {'id': call_id, 'type': 'function', 'function': {'name': name, 'arguments': args}}


class Transport:
    """Scripted stand-in for providers.post_chat: one entry per provider, consumed in order."""

    def __init__(self, **script):
        self.script = {k: list(v) for k, v in script.items()}
        self.calls = []

    def __call__(self, provider, payload, timeout=None):
        self.calls.append((provider, payload))
        item = self.script[provider].pop(0) if len(self.script.get(provider, [])) > 1 else self.script[provider][0]
        if isinstance(item, Exception):
            raise item
        return item


def run(transport, **kw):
    with patch('assistant.providers.post_chat', transport):
        return llm.complete(MSGS, **kw)


def providers_called(transport):
    return [p for p, _ in transport.calls]


class TestChoice:
    def test_main_calls_go_to_cerebras_first_with_its_model(self):
        t = Transport(cerebras=[ok('from cerebras')], groq=[ok('from groq')])
        reply = run(t)
        assert providers_called(t) == [CEREBRAS] and reply.content == 'from cerebras'
        assert (reply.provider, reply.model) == (CEREBRAS, 'gpt-oss-120b')

    def test_fast_calls_go_to_groq_first_to_spare_cerebras_requests(self):
        t = Transport(cerebras=[ok()], groq=[ok('quick')])
        assert run(t, tier='fast').provider == GROQ and providers_called(t) == [GROQ]

    def test_with_groq_as_primary_both_tiers_start_on_groq(self, settings):
        settings.LLM_PRIMARY = 'groq'
        for tier in ('main', 'fast'):
            t = Transport(cerebras=[ok()], groq=[ok()])
            run(t, tier=tier)
            assert providers_called(t) == [GROQ]

    def test_fast_tier_can_use_a_smaller_model(self, settings):
        settings.GROQ_FAST_MODEL = 'llama-3.1-8b-instant'
        t = Transport(groq=[ok()], cerebras=[ok()])
        run(t, tier='fast')
        assert t.calls[0][1]['model'] == 'llama-3.1-8b-instant'
        t = Transport(groq=[ok()], cerebras=[ok()])
        run(t, tier='main')
        assert t.calls[0][1]['model'] == 'gpt-oss-120b'

    def test_payload_shape(self):
        t = Transport(cerebras=[ok()])
        run(t, tools=[{'type': 'function', 'function': {'name': 'x'}}], max_tokens=77, temperature=0.1)
        payload = t.calls[0][1]
        assert payload['max_tokens'] == 77 and payload['temperature'] == 0.1 and payload['reasoning_effort'] == 'low'
        assert payload['tool_choice'] == 'auto' and payload['tools'][0]['function']['name'] == 'x'

    def test_no_tools_means_no_tool_fields(self):
        t = Transport(cerebras=[ok()])
        run(t)
        assert 'tools' not in t.calls[0][1] and 'tool_choice' not in t.calls[0][1]

    def test_reasoning_effort_can_be_omitted_and_the_token_field_renamed(self, settings):
        settings.CEREBRAS_REASONING_EFFORT, settings.CEREBRAS_MAX_TOKENS_PARAM = '', 'max_completion_tokens'
        t = Transport(cerebras=[ok()])
        run(t, max_tokens=50)
        payload = t.calls[0][1]
        assert 'reasoning_effort' not in payload and payload['max_completion_tokens'] == 50 and 'max_tokens' not in payload


class TestParsing:
    def test_tool_calls_keep_the_raw_arguments_and_parse_the_good_ones(self):
        t = Transport(cerebras=[ok(None, [tool_call('get_pending_fees', '{"class_name": "Class 5"}'), tool_call('bad', '{oops', 'c2')])])
        reply = run(t)
        assert reply.content == ''                       # a null content is an empty string, not a crash
        assert reply.tool_calls[0] == {'id': 'c1', 'name': 'get_pending_fees', 'arguments': {'class_name': 'Class 5'},
                                       'raw_arguments': '{"class_name": "Class 5"}'}
        assert reply.tool_calls[1]['arguments'] is None and reply.tool_calls[1]['raw_arguments'] == '{oops'

    def test_a_tool_call_with_no_arguments_is_an_empty_object(self):
        reply = run(Transport(cerebras=[ok('', [tool_call('get_balance', '')])]))
        assert reply.tool_calls[0]['arguments'] == {}

    def test_usage_is_returned(self):
        assert run(Transport(cerebras=[ok(total=321)])).usage['total_tokens'] == 321


class TestFallback:
    def test_a_rate_limit_moves_the_call_to_groq_and_rests_cerebras(self):
        t = Transport(cerebras=[ProviderError(CEREBRAS, 'rate_limit', 'too many', 429, retry_after=45)], groq=[ok('groq answered')])
        reply = run(t)
        assert reply.content == 'groq answered' and providers_called(t) == [CEREBRAS, GROQ]
        assert 40 <= llm.rest_remaining(CEREBRAS) <= 45

    def test_a_resting_provider_is_skipped_by_the_next_call(self):
        llm.rest(CEREBRAS, 30)
        t = Transport(cerebras=[ok()], groq=[ok('g')])
        assert run(t).provider == GROQ and providers_called(t) == [GROQ]

    def test_without_a_stated_wait_it_rests_for_a_minute(self):
        t = Transport(cerebras=[ProviderError(CEREBRAS, 'rate_limit', 'x', 429)], groq=[ok()])
        run(t)
        assert 55 <= llm.rest_remaining(CEREBRAS) <= llm.DEFAULT_REST_SECONDS

    def test_both_rate_limited_is_unavailable_and_the_next_call_does_not_even_try(self):
        t = Transport(cerebras=[ProviderError(CEREBRAS, 'rate_limit', 'x', 429, retry_after=30)],
                      groq=[ProviderError(GROQ, 'rate_limit', 'x', 429, retry_after=300)])
        with pytest.raises(llm.LLMUnavailable):
            run(t)
        t2 = Transport(cerebras=[ok()], groq=[ok()])
        with pytest.raises(llm.LLMUnavailable, match='rate-limited'):
            run(t2)
        assert t2.calls == []

    def test_a_server_error_gets_one_retry_on_the_same_provider(self):
        t = Transport(cerebras=[ProviderError(CEREBRAS, 'server', 'boom', 503), ok('recovered')], groq=[ok('groq')])
        reply = run(t)
        assert reply.content == 'recovered' and providers_called(t) == [CEREBRAS, CEREBRAS]
        assert llm.rest_remaining(CEREBRAS) == 0

    def test_a_server_error_that_repeats_moves_on_and_rests_briefly(self):
        t = Transport(cerebras=[ProviderError(CEREBRAS, 'server', 'boom', 503)], groq=[ok('groq')])
        reply = run(t)
        assert reply.provider == GROQ and providers_called(t) == [CEREBRAS, CEREBRAS, GROQ]
        assert 0 < llm.rest_remaining(CEREBRAS) <= llm.SERVER_REST_SECONDS

    def test_a_refused_request_is_retried_once_then_the_other_provider_tries(self):
        t = Transport(cerebras=[ProviderError(CEREBRAS, 'bad_request', 'tool_use_failed', 400)], groq=[ok('groq')])
        reply = run(t)
        assert providers_called(t) == [CEREBRAS, CEREBRAS, GROQ] and reply.provider == GROQ
        assert llm.rest_remaining(CEREBRAS) == 0           # a bad request is not the provider's fault

    def test_retries_off_means_one_attempt_per_provider(self):
        t = Transport(cerebras=[ProviderError(CEREBRAS, 'server', 'boom', 503)], groq=[ok('groq')])
        run(t, retries=0)
        assert providers_called(t) == [CEREBRAS, GROQ]

    def test_a_refused_key_rests_the_provider_for_an_hour(self):
        t = Transport(cerebras=[ProviderError(CEREBRAS, 'auth', 'the API key was refused', 401)], groq=[ok('groq')])
        run(t)
        assert llm.rest_remaining(CEREBRAS) > 3000 and providers_called(t) == [CEREBRAS, GROQ]

    def test_an_unexpected_response_shape_falls_back(self):
        t = Transport(cerebras=[({'oops': True}, {})], groq=[ok('groq')])
        assert run(t).provider == GROQ

    def test_every_provider_failing_raises_unavailable_with_the_last_reason(self):
        t = Transport(cerebras=[ProviderError(CEREBRAS, 'server', 'down', 500)], groq=[ProviderError(GROQ, 'server', 'also down', 500)])
        with pytest.raises(llm.LLMUnavailable, match='also down'):
            run(t)


class TestKillSwitchAndConfig:
    def test_switching_cerebras_off_makes_it_groq_only(self, settings):
        settings.LLM_CEREBRAS_ENABLED = False
        t = Transport(cerebras=[ok('never')], groq=[ok('groq only')])
        assert run(t).provider == GROQ and providers_called(t) == [GROQ]
        assert llm.order_for('main') == [GROQ] and llm.order_for('fast') == [GROQ]

    def test_a_missing_cerebras_key_is_the_same_as_off(self, settings):
        settings.CEREBRAS_API_KEY = ''
        assert llm.order_for('main') == [GROQ]

    def test_a_missing_groq_key_runs_on_cerebras_alone(self, settings):
        settings.GROQ_API_KEY = ''
        t = Transport(cerebras=[ok('alone')])
        assert run(t, tier='fast').provider == CEREBRAS

    def test_no_keys_at_all(self, settings):
        settings.GROQ_API_KEY = settings.CEREBRAS_API_KEY = ''
        with pytest.raises(llm.LLMUnavailable, match='no model provider'):
            run(Transport())

    def test_an_unknown_primary_falls_back_to_cerebras_first(self, settings):
        settings.LLM_PRIMARY = 'banana'
        assert llm.order_for('main') == [CEREBRAS, GROQ]


class TestRequestGuard:
    def test_cerebras_requests_per_minute_are_spaced_out_by_sending_the_overflow_to_groq(self, settings):
        settings.LLM_CEREBRAS_RPM = 2
        t = Transport(cerebras=[ok('c')], groq=[ok('g')])
        got = [run(t).provider for _ in range(4)]
        assert got == [CEREBRAS, CEREBRAS, GROQ, GROQ]

    def test_the_guard_is_a_preference_not_a_wall(self, settings):
        settings.LLM_CEREBRAS_RPM = 1
        run(Transport(cerebras=[ok()], groq=[ok()]))          # uses the one allowed request
        llm.rest(GROQ, 60)                                    # and Groq is unavailable
        t = Transport(cerebras=[ok('still tried')], groq=[ok()])
        assert run(t).content == 'still tried'

    def test_the_guard_can_be_turned_off(self, settings):
        settings.LLM_CEREBRAS_RPM = 0
        t = Transport(cerebras=[ok()], groq=[ok()])
        assert [run(t).provider for _ in range(8)] == [CEREBRAS] * 8


class TestHeaders:
    def test_cerebras_reporting_no_requests_left_this_minute_rests_it(self):
        run(Transport(cerebras=[ok(headers={'x-ratelimit-remaining-requests-minute': '0', 'x-ratelimit-remaining-tokens-day': '900000'})], groq=[ok()]))
        assert 25 <= llm.rest_remaining(CEREBRAS) <= 30

    def test_cerebras_day_budget_spent_rests_it_for_the_maximum(self):
        run(Transport(cerebras=[ok(headers={'x-ratelimit-remaining-tokens-day': '900'})], groq=[ok()]))
        assert llm.rest_remaining(CEREBRAS) > 3000

    def test_cerebras_minute_tokens_nearly_gone_gives_a_short_rest(self):
        run(Transport(cerebras=[ok(headers={'x-ratelimit-remaining-tokens-minute': '800', 'x-ratelimit-remaining-requests-minute': '3'})], groq=[ok()]))
        assert 0 < llm.rest_remaining(CEREBRAS) <= 20

    def test_healthy_headers_change_nothing_but_are_kept_for_the_status_page(self):
        run(Transport(cerebras=[ok(headers={'X-RateLimit-Remaining-Tokens-Day': '990000', 'x-ratelimit-remaining-requests-minute': '4'})]))
        assert llm.rest_remaining(CEREBRAS) == 0
        assert llm.snapshot()['providers']['cerebras']['server_says']['x-ratelimit-remaining-tokens-day'] == '990000'

    def test_groq_out_of_requests_rests_until_its_stated_reset(self, settings):
        settings.LLM_PRIMARY = 'groq'
        run(Transport(groq=[ok(headers={'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '12s'})], cerebras=[ok()]))
        assert 10 <= llm.rest_remaining(GROQ) <= 12

    def test_groq_nearly_out_of_tokens_rests_until_the_minute_resets(self, settings):
        settings.LLM_PRIMARY = 'groq'
        run(Transport(groq=[ok(headers={'x-ratelimit-remaining-tokens': '200', 'x-ratelimit-reset-tokens': '6.5s',
                                        'x-ratelimit-remaining-requests': '900'})], cerebras=[ok()]))
        assert 5 <= llm.rest_remaining(GROQ) <= 6.5

    def test_missing_or_odd_headers_are_ignored(self):
        run(Transport(cerebras=[ok(headers={'x-ratelimit-remaining-requests-minute': 'soon'})]))
        assert llm.rest_remaining(CEREBRAS) == 0


class TestUsageCounter:
    def test_tokens_are_counted_per_provider_per_day(self):
        run(Transport(cerebras=[ok(total=120)]))
        run(Transport(cerebras=[ok(total=80)]))
        run(Transport(groq=[ok(total=30)]), tier='fast')
        assert llm.tokens_today(CEREBRAS) == 200 and llm.tokens_today(GROQ) == 30

    def test_a_broken_cache_never_breaks_an_answer(self):
        with patch('assistant.llm.cache.incr', side_effect=RuntimeError('redis down')), \
                patch('assistant.llm.cache.get', side_effect=RuntimeError('redis down')):
            assert run(Transport(cerebras=[ok('fine')])).content == 'fine'
            assert llm.tokens_today(CEREBRAS) == 0

    def test_snapshot_reports_percent_of_the_daily_budget(self, settings):
        settings.LLM_DAILY_BUDGETS = {'groq': 200000, 'cerebras': 1000000}
        run(Transport(cerebras=[ok(total=250000)]))
        info = llm.snapshot()
        assert info['providers']['cerebras']['percent'] == 25.0 and info['providers']['groq']['tokens_today'] == 0
        assert info['order']['main'] == [CEREBRAS, GROQ] and info['order']['fast'] == [GROQ, CEREBRAS]

    def test_llm_status_command_prints_the_picture(self, capsys):
        run(Transport(cerebras=[ok(total=1500)]))
        call_command('llm_status')
        out = capsys.readouterr().out
        assert 'main calls: cerebras -> groq' in out and 'tokens today: 1,500' in out and 'c-key' not in out


class TestCallers:
    def test_the_router_and_the_summary_use_the_fast_tier(self):
        seen = []

        def spy(messages, **kw):
            seen.append(kw.get('tier'))
            return llm.LLMReply(content='finance')

        with patch('assistant.llm.complete', spy):
            router.pick_agents({'finance': [1], 'academics': [1]}, 'fee?')
        assert seen == ['fast']


def fake_response(status=200, body=None, headers=None, text=None):
    return httpx.Response(status, json=body if text is None else None, text=text, headers=headers or {},
                          request=httpx.Request('POST', 'https://x'))


class TestHttpLayer:
    def post(self, provider=CEREBRAS, **resp):
        with patch('assistant.providers.httpx.post', return_value=fake_response(**resp)) as mocked:
            result = real_post_chat(provider, {'model': 'm'})
        return result, mocked

    def test_success_returns_json_and_headers_and_sends_the_key_as_a_bearer_token(self):
        (data, headers), mocked = self.post(body={'choices': []}, headers={'x-ratelimit-remaining-tokens-day': '5'})
        assert data == {'choices': []} and headers['x-ratelimit-remaining-tokens-day'] == '5'
        assert mocked.call_args.args[0] == 'https://api.cerebras.ai/v1/chat/completions'
        assert mocked.call_args.kwargs['headers']['Authorization'] == 'Bearer c-key'

    def test_groq_uses_its_own_url_and_key(self):
        _, mocked = self.post(GROQ, body={})
        assert mocked.call_args.args[0] == 'https://api.groq.com/openai/v1/chat/completions'
        assert mocked.call_args.kwargs['headers']['Authorization'] == 'Bearer g-key'

    @pytest.mark.parametrize('status, kind', [(429, 'rate_limit'), (401, 'auth'), (403, 'auth'), (500, 'server'), (503, 'server'), (400, 'bad_request'), (422, 'bad_request')])
    def test_errors_are_classified(self, status, kind):
        with pytest.raises(ProviderError) as exc:
            self.post(status=status, body={'error': {'message': 'nope'}})
        assert exc.value.kind == kind and exc.value.status == status

    def test_a_429_reads_the_wait_from_the_header_or_from_the_message(self):
        with pytest.raises(ProviderError) as exc:
            self.post(status=429, body={'error': {'message': 'x'}}, headers={'retry-after': '17'})
        assert exc.value.retry_after == 17
        with pytest.raises(ProviderError) as exc:
            self.post(status=429, body={'error': {'message': 'Rate limit reached. Please try again in 5m41.28s.'}})
        assert round(exc.value.retry_after) == 341

    def test_an_error_message_never_contains_the_key(self):
        with pytest.raises(ProviderError) as exc:
            self.post(status=400, body={'error': {'message': 'bad'}})
        assert 'c-key' not in str(exc.value)

    def test_timeouts_and_network_errors_are_server_errors(self):
        for failure in (httpx.ReadTimeout('slow'), httpx.ConnectError('down')):
            with patch('assistant.providers.httpx.post', side_effect=failure):
                with pytest.raises(ProviderError) as exc:
                    real_post_chat(CEREBRAS, {})
            assert exc.value.kind == 'server'

    def test_a_non_json_success_is_a_server_error(self):
        with pytest.raises(ProviderError) as exc:
            self.post(status=200, text='<html>gateway</html>')
        assert exc.value.kind == 'server'

    def test_non_json_error_bodies_are_still_classified(self):
        with pytest.raises(ProviderError) as exc:
            self.post(status=502, text='Bad gateway')
        assert exc.value.kind == 'server'

    def test_parse_helpers(self):
        assert providers.parse_duration('6s') == 6 and providers.parse_duration('1m30.5s') == 90.5
        assert providers.parse_duration('250ms') == 0.25 and providers.parse_duration('2h') == 7200
        assert providers.parse_duration(None) is None and providers.parse_duration('soon') is None
        assert providers.parse_retry_after({}, 'nothing here') is None
        assert providers.parse_retry_after({'retry-after': '0'}, '') == 1.0


class TestProbeCommand:
    def probe_transport(self):
        def post(provider, payload, timeout=None):
            if payload.get('tools'):
                if any(m.get('role') == 'tool' for m in payload['messages']):
                    return ok('Class 5 mein 48,000 pending hai.')[0], {}
                return ok(None, [tool_call('get_pending_fees', '{"class_name": "Class 5"}')])[0], {}
            return ok('ok')[0], {'x-ratelimit-remaining-tokens-day': '999000', 'x-ratelimit-limit-tokens-day': '1000000'}
        return post

    def test_a_healthy_provider_passes_without_printing_the_key(self, capsys):
        with patch('assistant.providers.post_chat', self.probe_transport()), \
                patch('assistant.providers.list_models', return_value=['gpt-oss-120b', 'qwen-3.8-27b']):
            call_command('llm_probe', provider='cerebras')
        out = capsys.readouterr().out
        assert 'tool call: get_pending_fees' in out and 'x-ratelimit-remaining-tokens-day = 999000' in out
        assert 'c-key' not in out and 'FAIL' not in out

    def test_an_unlisted_model_fails_the_probe(self):
        with patch('assistant.providers.post_chat', self.probe_transport()), \
                patch('assistant.providers.list_models', return_value=['something-else']):
            with pytest.raises(CommandError):
                call_command('llm_probe', provider='cerebras')

    def test_it_finds_the_parameter_variant_a_model_accepts(self, capsys):
        base = self.probe_transport()

        def picky(provider, payload, timeout=None):
            if 'reasoning_effort' in payload:
                raise ProviderError(provider, 'bad_request', 'unsupported parameter reasoning_effort', 400)
            return base(provider, payload, timeout)

        with patch('assistant.providers.post_chat', picky), patch('assistant.providers.list_models', return_value=['gpt-oss-120b']):
            with pytest.raises(CommandError):
                call_command('llm_probe', provider='cerebras')
        out = capsys.readouterr().out
        assert 'without reasoning_effort' in out and 'EDU_CEREBRAS_REASONING_EFFORT=' in out

    def test_a_missing_key_is_reported(self, settings):
        settings.CEREBRAS_API_KEY = ''
        with pytest.raises(CommandError):
            call_command('llm_probe', provider='cerebras')

    def test_urdu_in_a_reply_cannot_crash_the_printout(self, capsys):
        base = self.probe_transport()

        def urdu(provider, payload, timeout=None):
            if payload.get('tools') and any(m.get('role') == 'tool' for m in payload['messages']):
                return ok('کلاس 5 کی فیس 48,000 باقی ہے')[0], {}
            return base(provider, payload, timeout)

        with patch('assistant.providers.post_chat', urdu), patch('assistant.providers.list_models', return_value=['gpt-oss-120b']):
            call_command('llm_probe', provider='cerebras')
        assert 'answer after the tool result' in capsys.readouterr().out
