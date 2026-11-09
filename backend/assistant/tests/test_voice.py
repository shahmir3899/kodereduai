"""Voice: speech to text, the spoken version of a reply, limits and privacy. No audio leaves the machine -
`providers.post_transcription` is replaced, and the HTTP layer is checked with a fake httpx."""
import logging
from unittest.mock import patch

import httpx
import pytest
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.core.management.base import CommandError

from assistant import llm, providers, voice
from assistant.providers import ProviderError
from assistant.providers import post_transcription as real_post_transcription

T = '/api/assistant/voice/transcribe/'
S = '/api/assistant/voice/spoken/'
WHISPER = {'text': ' class 5A ki hazri lagao ', 'language': 'urdu', 'duration': 3.2,
           'segments': [{'no_speech_prob': 0.01}, {'no_speech_prob': 0.05}]}


@pytest.fixture(autouse=True)
def voice_on(settings):
    settings.GROQ_API_KEY, settings.VOICE_ENABLED = 'g-key', True
    settings.STT_MODEL, settings.STT_LANGUAGE, settings.STT_PROMPT = 'whisper-large-v3-turbo', '', 'School words.'
    settings.STT_MAX_BYTES, settings.VOICE_DAILY_PER_USER = 4 * 1024 * 1024, 150
    cache.clear()


@pytest.fixture
def modules(seed_data):
    school, org = seed_data['school_a'], seed_data['org']
    school.enabled_modules = {**(school.enabled_modules or {}), 'finance': True}
    school.save(update_fields=['enabled_modules'])
    org.allowed_modules = {**(org.allowed_modules or {}), 'finance': True}
    org.save(update_fields=['allowed_modules'])


def clip(content_type='audio/webm;codecs=opus', data=b'\x1aE\xdf\xa3fake-audio', name='speech.webm'):
    return SimpleUploadedFile(name, data, content_type=content_type)


def upload(api, seed, url=T, uname='admin', **fields):
    return api.client.post(url, data=fields, HTTP_AUTHORIZATION=f'Bearer {seed["tokens"][uname]}', HTTP_X_SCHOOL_ID=str(seed['SID_A']))


def post_json(api, seed, url, payload, uname='admin'):
    import json
    return api.client.post(url, data=json.dumps(payload), content_type='application/json',
                           HTTP_AUTHORIZATION=f'Bearer {seed["tokens"][uname]}', HTTP_X_SCHOOL_ID=str(seed['SID_A']))


class TestTranscribeFunction:
    def run(self, data=None, **kw):
        with patch('assistant.providers.post_transcription', return_value=data or WHISPER) as mocked:
            return voice.transcribe(b'audio', kw.pop('content_type', 'audio/webm;codecs=opus'), **kw), mocked

    def test_returns_clean_text_language_and_length(self):
        result, _ = self.run()
        assert result == {'text': 'class 5A ki hazri lagao', 'language': 'urdu', 'duration': 3.2}

    def test_sends_the_configured_model_prompt_and_a_matching_file_name(self):
        _, mocked = self.run(content_type='audio/mp4')
        args, kwargs = mocked.call_args
        assert args[0] == b'audio' and args[1] == 'speech.m4a' and args[2] == 'audio/mp4' and args[3] == 'whisper-large-v3-turbo'
        assert kwargs['prompt'] == 'School words.' and kwargs['language'] == ''

    def test_language_hint_beats_the_default_and_auto_means_detect(self, settings):
        settings.STT_LANGUAGE = 'ur'
        assert self.run(language='')[1].call_args.kwargs['language'] == 'ur'          # falls back to the setting
        assert self.run(language='en')[1].call_args.kwargs['language'] == 'en'
        assert self.run(language='auto')[1].call_args.kwargs['language'] == 'ur'

    def test_silence_is_not_a_command(self):
        silent = {'text': 'Thank you.', 'language': 'english', 'duration': 4.0, 'segments': [{'no_speech_prob': 0.9}, {'no_speech_prob': 0.8}]}
        assert self.run(silent)[0]['text'] == ''

    def test_one_real_segment_keeps_the_text(self):
        mixed = {**WHISPER, 'segments': [{'no_speech_prob': 0.9}, {'no_speech_prob': 0.1}]}
        assert self.run(mixed)[0]['text'] == 'class 5A ki hazri lagao'

    def test_a_mis_tap_is_dropped(self):
        assert self.run({**WHISPER, 'duration': 0.2})[0]['text'] == ''

    @pytest.mark.parametrize('kind, expect', [('rate_limit', 'busy'), ('bad_request', 'could not be read'), ('server', 'not available'), ('auth', 'not enabled')])
    def test_provider_failures_become_safe_messages(self, kind, expect):
        with patch('assistant.providers.post_transcription', side_effect=ProviderError('groq', kind, 'secret internals', 429)):
            with pytest.raises(voice.VoiceUnavailable, match=expect) as exc:
                voice.transcribe(b'a', 'audio/webm')
        assert 'secret internals' not in str(exc.value)


@pytest.mark.django_db
class TestTranscribeEndpoint:
    def test_a_recording_becomes_text(self, seed_data, modules, api):
        with patch('assistant.providers.post_transcription', return_value=WHISPER) as mocked:
            r = upload(api, seed_data, audio=clip(), language='ur')
        assert r.status_code == 200 and r.json() == {'text': 'class 5A ki hazri lagao', 'language': 'urdu', 'duration': 3.2}
        assert mocked.call_args.args[0] == b'\x1aE\xdf\xa3fake-audio' and mocked.call_args.kwargs['language'] == 'ur'

    @pytest.mark.parametrize('field, status', [({}, 400), ({'audio': SimpleUploadedFile('a.webm', b'', content_type='audio/webm')}, 400)])
    def test_missing_or_empty_audio(self, seed_data, modules, api, field, status):
        assert upload(api, seed_data, **field).status_code == status

    def test_too_large(self, seed_data, modules, api, settings):
        settings.STT_MAX_BYTES = 10
        assert upload(api, seed_data, audio=clip(data=b'x' * 11)).status_code == 413

    def test_unsupported_format(self, seed_data, modules, api):
        assert upload(api, seed_data, audio=clip('text/plain', name='a.txt')).status_code == 415

    def test_unknown_language_value(self, seed_data, modules, api):
        assert upload(api, seed_data, audio=clip(), language='klingon').status_code == 400

    def test_a_role_with_no_assistant_tools_cannot_use_voice(self, seed_data, modules, api):
        # Every seeded role has at least one tool now (STAFF got its own leave and payslip), so the
        # empty list is simulated: the gate must refuse whoever has nothing to ask Aura.
        with patch('assistant.providers.post_transcription') as mocked, patch('assistant.registry.tools_for', return_value=[]):
            r = upload(api, seed_data, uname='staff', audio=clip())
        assert r.status_code == 403 and not mocked.called              # nothing was sent to Groq

    def test_login_is_required(self, api_client):
        assert api_client.post(T, data={'audio': clip()}).status_code in (401, 403)

    def test_kill_switch_and_missing_key(self, seed_data, modules, api, settings):
        settings.VOICE_ENABLED = False
        assert upload(api, seed_data, audio=clip()).status_code == 503
        settings.VOICE_ENABLED, settings.GROQ_API_KEY = True, ''
        assert upload(api, seed_data, audio=clip()).status_code == 503

    def test_daily_allowance(self, seed_data, modules, api, settings):
        settings.VOICE_DAILY_PER_USER = 2
        with patch('assistant.providers.post_transcription', return_value=WHISPER):
            codes = [upload(api, seed_data, audio=clip()).status_code for _ in range(3)]
        assert codes == [200, 200, 429]

    def test_rejected_uploads_do_not_use_up_the_allowance(self, seed_data, modules, api, settings):
        settings.VOICE_DAILY_PER_USER = 1
        upload(api, seed_data, audio=clip('text/plain', name='a.txt'))
        upload(api, seed_data)
        with patch('assistant.providers.post_transcription', return_value=WHISPER):
            assert upload(api, seed_data, audio=clip()).status_code == 200

    def test_each_user_has_their_own_allowance(self, seed_data, modules, api, settings):
        settings.VOICE_DAILY_PER_USER = 1
        with patch('assistant.providers.post_transcription', return_value=WHISPER):
            assert upload(api, seed_data, audio=clip()).status_code == 200
            assert upload(api, seed_data, audio=clip()).status_code == 429
            assert upload(api, seed_data, uname='accountant', audio=clip()).status_code == 200

    def test_groq_rate_limit_is_a_friendly_503(self, seed_data, modules, api):
        with patch('assistant.providers.post_transcription', side_effect=ProviderError('groq', 'rate_limit', 'x', 429)):
            r = upload(api, seed_data, audio=clip())
        assert r.status_code == 503 and 'busy' in r.json()['error']

    def test_a_refused_upload_says_why_in_the_server_log(self, seed_data, modules, api, caplog):
        with caplog.at_level(logging.WARNING):
            upload(api, seed_data, audio=clip('text/plain', name='a.txt'))
        text = ' '.join(r.getMessage() for r in caplog.records)
        assert 'voice request refused (415)' in text and 'content_type=text/plain' in text

    def test_the_browsers_default_accept_header_is_fine_for_audio_upload(self, seed_data, modules, api):
        with patch('assistant.providers.post_transcription', return_value=WHISPER):
            r = api.client.post(T, data={'audio': clip(), 'language': 'auto'}, HTTP_ACCEPT='application/json, text/plain, */*',
                                HTTP_AUTHORIZATION=f'Bearer {seed_data["tokens"]["admin"]}', HTTP_X_SCHOOL_ID=str(seed_data['SID_A']))
        assert r.status_code == 200 and r.json()['text'] == 'class 5A ki hazri lagao'

    def test_the_words_and_audio_are_never_logged(self, seed_data, modules, api, caplog):
        with caplog.at_level(logging.DEBUG), patch('assistant.providers.post_transcription', return_value=WHISPER):
            upload(api, seed_data, audio=clip(data=b'PRIVATE-AUDIO-BYTES'))
        text = ' '.join(r.getMessage() for r in caplog.records)
        assert 'hazri' not in text and 'PRIVATE-AUDIO' not in text and 'g-key' not in text
        assert 'stt model=' in text                                    # only size, length and timing are kept


@pytest.mark.django_db
class TestSpokenVersion:
    def test_returns_a_short_spoken_text_made_by_the_small_model(self, seed_data, modules, api):
        seen = {}

        def fake(messages, **kw):
            seen.update(kw, system=messages[0]['content'], user=messages[1]['content'])
            return llm.LLMReply(content=' کلاس 5 کی 12 بچوں کی فیس باقی ہے ')

        with patch('assistant.llm.complete', fake):
            r = post_json(api, seed_data, S, {'text': 'Class 5 mein 12 bachon ki fee pending hai. Names: ...'})
        assert r.status_code == 200 and r.json()['spoken'] == 'کلاس 5 کی 12 بچوں کی فیس باقی ہے'
        assert seen['tier'] == 'fast' and 'Urdu script' in seen['system'] and 'Class 5 mein 12' in seen['user']

    def test_empty_and_oversized_text(self, seed_data, modules, api):
        assert post_json(api, seed_data, S, {'text': '  '}).status_code == 400
        assert post_json(api, seed_data, S, {'text': 'x' * 4000}).status_code == 400

    def test_model_failure_is_a_503(self, seed_data, modules, api):
        with patch('assistant.llm.complete', side_effect=llm.LLMUnavailable('down')):
            assert post_json(api, seed_data, S, {'text': 'hello'}).status_code == 503

    def test_same_gates_as_transcription(self, seed_data, modules, api, settings):
        with patch('assistant.llm.complete') as mocked:
            with patch('assistant.registry.tools_for', return_value=[]):      # STAFF has tools now; simulate a role with none
                assert post_json(api, seed_data, S, {'text': 'hello'}, uname='staff').status_code == 403
            settings.VOICE_ENABLED = False
            assert post_json(api, seed_data, S, {'text': 'hello'}).status_code == 503
        assert not mocked.called

    def test_counts_toward_the_daily_allowance(self, seed_data, modules, api, settings):
        settings.VOICE_DAILY_PER_USER = 1
        with patch('assistant.llm.complete', return_value=llm.LLMReply(content='ok')):
            assert post_json(api, seed_data, S, {'text': 'one'}).status_code == 200
            assert post_json(api, seed_data, S, {'text': 'two'}).status_code == 429


@pytest.mark.django_db
class TestCapabilities:
    def test_voice_block(self, seed_data, modules, api, settings):
        caps = api.get('/api/assistant/capabilities/', seed_data['tokens']['admin'], seed_data['SID_A']).json()
        assert caps['voice'] == {'enabled': True, 'max_seconds': 60}
        settings.VOICE_ENABLED = False
        caps = api.get('/api/assistant/capabilities/', seed_data['tokens']['admin'], seed_data['SID_A']).json()
        assert caps['voice']['enabled'] is False


class TestWhisperHttp:
    def test_request_shape_and_error_handling(self):
        resp = httpx.Response(200, json={'text': 'ok'}, request=httpx.Request('POST', 'https://x'))
        with patch('assistant.providers.httpx.post', return_value=resp) as mocked:
            out = real_post_transcription(b'bytes', 'speech.webm', 'audio/webm', 'whisper-large-v3-turbo', language='ur', prompt='words')
        assert out == {'text': 'ok'}
        assert mocked.call_args.args[0] == 'https://api.groq.com/openai/v1/audio/transcriptions'
        assert mocked.call_args.kwargs['headers'] == {'Authorization': 'Bearer g-key'}
        assert mocked.call_args.kwargs['data'] == {'model': 'whisper-large-v3-turbo', 'response_format': 'verbose_json',
                                                   'temperature': '0', 'language': 'ur', 'prompt': 'words'}
        assert mocked.call_args.kwargs['files'] == {'file': ('speech.webm', b'bytes', 'audio/webm')}

    def test_language_and_prompt_are_optional(self):
        resp = httpx.Response(200, json={}, request=httpx.Request('POST', 'https://x'))
        with patch('assistant.providers.httpx.post', return_value=resp) as mocked:
            real_post_transcription(b'a', 'a.webm', 'audio/webm', 'm')
        assert 'language' not in mocked.call_args.kwargs['data'] and 'prompt' not in mocked.call_args.kwargs['data']

    @pytest.mark.parametrize('status, kind', [(429, 'rate_limit'), (401, 'auth'), (500, 'server'), (400, 'bad_request')])
    def test_errors_are_classified(self, status, kind):
        resp = httpx.Response(status, json={'error': {'message': 'nope'}}, request=httpx.Request('POST', 'https://x'))
        with patch('assistant.providers.httpx.post', return_value=resp):
            with pytest.raises(ProviderError) as exc:
                real_post_transcription(b'a', 'a.webm', 'audio/webm', 'm')
        assert exc.value.kind == kind and 'g-key' not in str(exc.value)

    def test_a_blocked_model_reports_the_providers_reason_without_the_key(self):
        body = {'error': {'message': 'The model `whisper-large-v3` is blocked at the project level. key g-key', 'code': 'model_permission_blocked_project'}}
        resp = httpx.Response(403, json=body, request=httpx.Request('POST', 'https://x'))
        with patch('assistant.providers.httpx.post', return_value=resp):
            with pytest.raises(ProviderError) as exc:
                real_post_transcription(b'a', 'a.webm', 'audio/webm', 'whisper-large-v3')
        assert exc.value.kind == 'auth' and 'blocked at the project level' in str(exc.value) and 'g-key' not in str(exc.value)

    def test_timeout_is_a_server_error(self):
        with patch('assistant.providers.httpx.post', side_effect=httpx.ReadTimeout('slow')):
            with pytest.raises(ProviderError) as exc:
                real_post_transcription(b'a', 'a.webm', 'audio/webm', 'm')
        assert exc.value.kind == 'server'


class TestSttProbe:
    def test_compares_both_models_and_prints_urdu_safely(self, tmp_path, capsys):
        f = tmp_path / 'clip.webm'
        f.write_bytes(b'audio')
        replies = {'whisper-large-v3-turbo': {'text': 'کلاس پانچ', 'language': 'urdu', 'duration': 2.0},
                   'whisper-large-v3': {'text': 'class 5', 'language': 'urdu', 'duration': 2.0}}
        with patch('assistant.providers.post_transcription', side_effect=lambda a, n, c, model, **kw: replies[model]):
            call_command('stt_probe', file=[str(f)], models='both', language='ur')
        out = capsys.readouterr().out
        assert 'whisper-large-v3-turbo' in out and 'whisper-large-v3:' in out and 'class 5' in out and 'g-key' not in out

    def test_a_failed_call_or_a_bad_file_fails_the_command(self, tmp_path):
        f = tmp_path / 'clip.wav'
        f.write_bytes(b'audio')
        with patch('assistant.providers.post_transcription', side_effect=ProviderError('groq', 'rate_limit', 'busy', 429)):
            with pytest.raises(CommandError):
                call_command('stt_probe', file=[str(f)])
        with pytest.raises(CommandError):
            call_command('stt_probe', file=[str(tmp_path / 'notes.txt')])

    def test_needs_a_key(self, tmp_path, settings):
        settings.GROQ_API_KEY = ''
        with pytest.raises(CommandError):
            call_command('stt_probe', file=[str(tmp_path / 'x.wav')])
