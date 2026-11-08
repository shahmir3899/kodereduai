"""Measure how well the assistant (or the old per-app agents) answers the baseline questions.

    python manage.py assistant_baseline --school-id 37 --mode legacy
    python manage.py assistant_baseline --school-id 37 --mode unified

It calls the real model (Groq), so it costs tokens, and the free tier allows only a
daily token budget. The run is therefore RESUMABLE: results are kept in a state file
(docs/ai_baseline_<mode>_state.json) and each run continues with the questions not yet
answered. The moment Groq answers 429 the run stops without recording that question, so a
rate limit is never scored as a wrong answer. Run it again after the quota resets.

Everything it writes to the database (conversations, audit rows) is rolled back.
"""
import json
import logging
import time
from pathlib import Path
from unittest.mock import patch

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from assistant import orchestrator, registry
from assistant.baseline.scoring import score, summarize
from assistant.models import AgentConversation

QUESTIONS = Path(__file__).resolve().parents[2] / 'baseline' / 'questions.json'
DOCS = Path(__file__).resolve().parents[3].parent / 'docs'   # <repo>/docs
ADMIN_ROLES = ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL')
# Who could reach each old agent through its view's permission classes.
LEGACY_ACCESS = {
    'finance': ADMIN_ROLES,
    'academics': ADMIN_ROLES + ('MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF'),
    'communication': ADMIN_ROLES,
}


class RateLimited(Exception):
    pass


class _RateLimitWatcher(logging.Handler):
    """The old agents swallow Groq errors and fall back to canned text, which would look
    like 'chose no tool'. Watching the log is the only place the 429 is visible."""

    def __init__(self):
        super().__init__(level=logging.INFO)
        self.hit = False

    def emit(self, record):
        try:
            msg = record.getMessage()
        except Exception:
            return
        if '429' in msg or 'rate_limit' in msg or 'Rate limit' in msg:
            self.hit = True


class Command(BaseCommand):
    help = 'Run the assistant baseline question set (resumable) and report pass rates.'

    def add_arguments(self, parser):
        parser.add_argument('--school-id', type=int, required=True)
        parser.add_argument('--mode', choices=['legacy', 'unified'], default='unified')
        parser.add_argument('--agent', help='Only questions for this agent')
        parser.add_argument('--max-questions', type=int, help='Stop after this many NEW questions this run')
        parser.add_argument('--delay', type=float, default=2, help='Seconds to wait between questions')
        parser.add_argument('--restart', action='store_true', help='Discard saved progress for this mode')

    def handle(self, *args, **opts):
        from schools.models import School, UserSchoolMembership

        try:
            school = School.objects.get(pk=opts['school_id'])
        except School.DoesNotExist:
            raise CommandError('school not found')
        questions = json.loads(QUESTIONS.read_text(encoding='utf-8'))
        if opts['agent']:
            questions = [q for q in questions if q['agent'] == opts['agent']]

        state_path = DOCS / f'ai_baseline_{opts["mode"]}_state.json'
        state = {}
        if state_path.exists() and not opts['restart']:
            state = json.loads(state_path.read_text(encoding='utf-8'))
        done = state.setdefault('results', {})
        state['school_id'] = school.id

        users = {}
        for m in UserSchoolMembership.objects.filter(school=school).select_related('user'):
            users.setdefault(m.role, m.user)

        todo = [q for q in questions if q['id'] not in done]
        if opts['max_questions']:
            todo = todo[:opts['max_questions']]

        watcher = _RateLimitWatcher()
        logging.getLogger().addHandler(watcher)
        stopped_by_limit = False
        ran = 0
        try:
            with transaction.atomic():
                for q in todo:
                    user = users.get(q['role'])
                    if user is None:
                        done[q['id']] = {'question': q, 'pass': False, 'skipped': True,
                                         'reason': f'no {q["role"]} user in school', 'ms': 0}
                        continue
                    watcher.hit = False
                    started = time.monotonic()
                    try:
                        calls = (self._legacy if opts['mode'] == 'legacy' else self._unified)(q, user, school)
                        if watcher.hit and opts['mode'] == 'legacy':
                            raise RateLimited()
                        verdict = score(q, calls)
                    except RateLimited:
                        stopped_by_limit = True
                        break
                    except Exception as exc:   # one bad question must not stop the run
                        if watcher.hit and opts['mode'] == 'legacy':
                            stopped_by_limit = True
                            break
                        verdict = {'pass': False, 'reason': f'error: {exc}'}
                    done[q['id']] = {'question': q, 'ms': int((time.monotonic() - started) * 1000), **verdict}
                    ran += 1
                    state_path.write_text(json.dumps(state, indent=1, ensure_ascii=False), encoding='utf-8')
                    if opts['delay']:
                        time.sleep(opts['delay'])
                transaction.set_rollback(True)
        finally:
            logging.getLogger().removeHandler(watcher)
            state_path.write_text(json.dumps(state, indent=1, ensure_ascii=False), encoding='utf-8')

        scored = [r for r in done.values() if not r.get('skipped')]
        remaining = len([q for q in questions if q['id'] not in done])
        self.stdout.write(f'ran {ran} new questions; {remaining} of {len(questions)} still to do')
        if stopped_by_limit:
            self.stdout.write('STOPPED: Groq rate limit hit. Progress is saved; rerun after the quota resets.')
        if scored:
            self.stdout.write(json.dumps(summarize(scored), indent=1))

    # -- runners ---------------------------------------------------------------

    def _unified(self, q, user, school):
        conv = AgentConversation.objects.create(school=school, user=user)
        ctx = registry.ToolContext(user=user, school_id=school.id, role=q['role'], conversation=conv)
        result = orchestrator.run_turn(conv, q['q'], ctx)
        if result.content == orchestrator.UNAVAILABLE:      # both providers refused: not a wrong answer
            raise RateLimited()
        return result.tool_calls

    def _legacy(self, q, user, school):
        """Run the old agent and record which tool it picked. Roles the old view would
        have rejected, and agents that do not exist yet, make no calls."""
        agent = q['agent']
        if agent not in LEGACY_ACCESS or q['role'] not in LEGACY_ACCESS[agent]:
            return []
        calls = []
        if agent == 'finance':
            from finance.ai_agent import FinanceAIAgent as cls
        elif agent == 'academics':
            from academics.ai_engine import AcademicsAIAgent as cls
        else:
            from notifications.ai_agent import ParentCommunicationAgent as cls
        real = cls._execute_tool

        def spy(self_, name, params):
            out = real(self_, name, params)
            calls.append({'name': name, 'args': dict(params or {}), 'ok': 'error' not in (out or {})})
            return out

        with patch.object(cls, '_execute_tool', spy):
            inst = cls(school.id)
            if agent == 'communication':
                inst.chat(q['q'])
            else:
                inst.process_query(q['q'], user=None)
        return calls
