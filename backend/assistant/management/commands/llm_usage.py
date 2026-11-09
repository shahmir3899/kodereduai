"""Per-school and per-day assistant usage, plus the older Groq calls that bypass the gateway.

    python manage.py llm_usage [--days 7] [--school-id N] [--users]

Reads only; writes nothing.
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Sum

from assistant import usage
from assistant.models import AgentUsageDay

# Tag = the module that made the call (see usage.patch_groq_sdk); three OCR sites use requests and tag by hand.
EXTERNAL_TAGS = ['academics.ai_engine', 'finance.ai_agent', 'notifications.ai_agent', 'notifications.ai_service', 'notifications.digest',
                 'students.ai_service', 'students.study_helper_service', 'inventory.ai_service', 'lms.ai_generator', 'lms.tasks',
                 'lms.toc_ai_suggester', 'examinations.ai_comments_service', 'examinations.views',
                 'examinations.paper_ocr_processor.vision', 'examinations.paper_ocr_processor.structure',
                 'examinations.paper_ocr_processor.extract', 'academic_sessions.session_health_service', 'attendance.services',
                 'reports.views']


class Command(BaseCommand):
    help = 'Show assistant tokens, calls, fallbacks and voice seconds per school and day.'

    def add_arguments(self, parser):
        parser.add_argument('--days', type=int, default=7)
        parser.add_argument('--school-id', type=int)
        parser.add_argument('--users', action='store_true', help='also list the heaviest users per day')

    def handle(self, *args, **opts):
        since = usage.today() - timedelta(days=opts['days'] - 1)
        rows = AgentUsageDay.objects.filter(date__gte=since)
        if opts['school_id']:
            rows = rows.filter(school_id=opts['school_id'])
        per = rows.values('date', 'school__name').annotate(t=Sum('tokens'), c=Sum('calls'), f=Sum('fallbacks'), v=Sum('voice_seconds'))
        self.stdout.write(f'{"date":<11}{"school":<34}{"tokens":>10}{"calls":>7}{"fallback":>9}{"voice s":>8}')
        for r in per.order_by('-date', '-t'):
            self.stdout.write(f'{r["date"]!s:<11}{r["school__name"][:32]:<34}{r["t"]:>10,}{r["c"]:>7}{r["f"]:>9}{r["v"]:>8}')
        if opts['users']:
            self.stdout.write('\nHeaviest users today:')
            for r in rows.filter(date=usage.today()).order_by('-tokens')[:10]:
                self.stdout.write(f'  user {r.user_id} school {r.school_id}: {r.tokens:,} tokens, {r.calls} calls')
        self.stdout.write('\nOlder Groq calls outside the gateway (UTC today, from the shared counter):')
        shown = False
        for tag in EXTERNAL_TAGS:
            tokens, calls = usage.external_today(tag)
            if calls:
                shown = True
                self.stdout.write(f'  {tag:<22}{tokens:>9,} tokens {calls:>5} calls')
        if not shown:
            self.stdout.write('  none counted yet (counters start after this is deployed and a feature is used)')
