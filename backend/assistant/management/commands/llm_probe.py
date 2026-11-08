"""Find out what a provider's API really accepts, with a few cheap calls (about 3,000 tokens).

    python manage.py llm_probe                 # Cerebras (default)
    python manage.py llm_probe --provider all  # both

Checks: the models this key can use, a plain answer, native tool calling (in Roman Urdu), whether
`reasoning_effort` and `max_tokens` are accepted, and which rate-limit headers come back. It
prints what to set in the environment if the defaults need changing. Keys are never printed.
"""
import json
import sys
import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from assistant import providers
from assistant.providers import ProviderError

TOOL = {'type': 'function', 'function': {
    'name': 'get_pending_fees', 'description': 'Total pending fee amount for a class.',
    'parameters': {'type': 'object', 'properties': {'class_name': {'type': 'string', 'description': 'Class name, e.g. "Class 5"'}},
                   'required': [], 'additionalProperties': False}}}


class Command(BaseCommand):
    help = 'Probe a model provider: models, tool calling, reasoning_effort, max_tokens, rate-limit headers.'

    def add_arguments(self, parser):
        parser.add_argument('--provider', choices=['cerebras', 'groq', 'all'], default='cerebras')

    def handle(self, *args, **opts):
        chosen = [providers.CEREBRAS, providers.GROQ] if opts['provider'] == 'all' else [opts['provider']]
        failed = False
        for provider in chosen:
            self.stdout.write(self.style.MIGRATE_HEADING(f'\n== {provider} =='))
            if not providers.api_key(provider):
                self.stdout.write(self.style.ERROR('no API key in the environment (EDU_CEREBRAS_API_KEY / EDU_GROQ_API_KEY)'))
                failed = True
                continue
            failed |= not self._probe(provider)
        if failed:
            raise CommandError('at least one check failed')

    # ── helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _safe(text):
        """Model replies can hold Urdu; a Windows console cannot always print it."""
        enc = getattr(sys.stdout, 'encoding', None) or 'utf-8'
        return str(text).encode(enc, 'replace').decode(enc, 'replace')

    def _ok(self, text):
        self.stdout.write(self.style.SUCCESS('  ok    ') + self._safe(text))

    def _bad(self, text):
        self.stdout.write(self.style.ERROR('  FAIL  ') + self._safe(text))

    def _info(self, text):
        self.stdout.write('        ' + self._safe(text))

    def _call(self, provider, payload):
        started = time.monotonic()
        data, headers = providers.post_chat(provider, payload)
        return data, headers, int((time.monotonic() - started) * 1000)

    def _payload(self, provider, messages, max_tokens=60, effort=True, max_param=None, tools=None):
        payload = {'model': providers.model_for(provider), 'messages': messages, 'temperature': 0.2,
                   (max_param or providers.max_tokens_param(provider)): max_tokens}
        if effort and providers.reasoning_effort_for(provider):
            payload['reasoning_effort'] = providers.reasoning_effort_for(provider)
        if tools:
            payload['tools'], payload['tool_choice'] = tools, 'auto'
        return payload

    # ── the probe ────────────────────────────────────────────────────────────

    def _probe(self, provider):
        good = True
        used = 0
        model = providers.model_for(provider)
        self._info(f'configured model: {model}   reasoning_effort: {providers.reasoning_effort_for(provider) or "(omitted)"}   '
                   f'max-tokens field: {providers.max_tokens_param(provider)}')

        # 1. models this key can use
        try:
            models = providers.list_models(provider)
            self._ok(f'models available: {len(models)}  ->  {", ".join(models[:12])}{" ..." if len(models) > 12 else ""}')
            if model not in models:
                self._bad(f'the configured model "{model}" is NOT in that list. Set EDU_{provider.upper()}_MODEL to one of them.')
                good = False
        except ProviderError as exc:
            self._bad(f'listing models: {exc}')
            good = False

        # 2. a plain answer, trying the parameter variants until one works
        messages = [{'role': 'user', 'content': 'Reply with the single word: ok'}]
        variants = [
            ('as configured', dict()),
            ('without reasoning_effort', dict(effort=False)),
            ('max_completion_tokens instead of max_tokens', dict(max_param='max_completion_tokens')),
            ('max_completion_tokens, no reasoning_effort', dict(effort=False, max_param='max_completion_tokens')),
        ]
        headers = {}
        working = None
        for label, kw in variants:
            try:
                data, headers, ms = self._call(provider, self._payload(provider, messages, **kw))
                usage = data.get('usage') or {}
                used += usage.get('total_tokens') or 0
                text = (data['choices'][0]['message'].get('content') or '').strip()
                self._ok(f'plain answer ({label}): "{text[:40]}"  {ms} ms  tokens={usage.get("total_tokens")}')
                working = (label, kw)
                break
            except ProviderError as exc:
                self._info(f'plain answer ({label}) refused: {str(exc)[:160]}')
        if working is None:
            self._bad('no parameter variant was accepted - cannot continue')
            return False
        if working[0] != 'as configured':
            good = False
            self._bad(f'the defaults do not work; it accepted: {working[0]}')
            kw = working[1]
            if kw.get('effort') is False:
                self._info(f'-> set EDU_{provider.upper()}_REASONING_EFFORT= (blank) in the environment')
            if kw.get('max_param'):
                self._info(f'-> set EDU_{provider.upper()}_MAX_TOKENS_PARAM={kw["max_param"]}')

        # 3. native tool calling, in Roman Urdu
        kw = working[1]
        convo = [{'role': 'system', 'content': 'You are a school assistant. Use the tools to get data; never guess.'},
                 {'role': 'user', 'content': 'class 5 ki fee ka kia status hai?'}]
        try:
            data, _h, ms = self._call(provider, self._payload(provider, convo, max_tokens=300, tools=[TOOL], **kw))
            used += (data.get('usage') or {}).get('total_tokens') or 0
            message = data['choices'][0]['message']
            calls = message.get('tool_calls') or []
            if not calls:
                self._bad(f'tool calling: the model answered in text and called no tool ({ms} ms): "{(message.get("content") or "")[:80]}"')
                good = False
            else:
                call = calls[0]
                args = json.loads(call['function']['arguments'] or '{}')
                ok = call['function']['name'] == 'get_pending_fees' and '5' in str(args.get('class_name', ''))
                (self._ok if ok else self._bad)(f'tool call: {call["function"]["name"]}({json.dumps(args, ensure_ascii=False)})  {ms} ms')
                good &= ok
                convo += [message, {'role': 'tool', 'tool_call_id': call['id'], 'content': json.dumps({'data': {'total_pending': 48000, 'count': 12}})}]
                data, _h, ms = self._call(provider, self._payload(provider, convo, max_tokens=300, tools=[TOOL], **kw))
                used += (data.get('usage') or {}).get('total_tokens') or 0
                final = (data['choices'][0]['message'].get('content') or '').strip()
                (self._ok if final else self._bad)(f'answer after the tool result ({ms} ms): "{final[:100]}"')
                good &= bool(final)
        except ProviderError as exc:
            self._bad(f'tool calling: {exc}')
            good = False
        except (KeyError, ValueError, TypeError) as exc:
            self._bad(f'tool calling: unexpected response shape ({type(exc).__name__})')
            good = False

        # 4. rate-limit headers
        names = sorted(k for k in headers if k.lower().startswith(('x-ratelimit', 'retry-after', 'x-rate')))
        self._ok('rate-limit headers: ' + (', '.join(names) if names else 'none returned'))
        lowered = {k.lower(): v for k, v in headers.items()}
        for key in ('x-ratelimit-remaining-tokens-day', 'x-ratelimit-remaining-requests-minute', 'x-ratelimit-remaining-tokens',
                    'x-ratelimit-remaining-requests', 'x-ratelimit-limit-tokens-day', 'x-ratelimit-limit-requests-minute'):
            if key in lowered:
                self._info(f'{key} = {lowered[key]}')
        self._info(f'probe used about {used} tokens')
        return good
