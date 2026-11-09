"""Draft baseline questions from one gap group. Never edits questions.json.

    python manage.py export_gap_questions --group 12
    python manage.py export_gap_questions --group 12 --out draft.json

The examples are redacted: <student> / <staff> must be replaced with real names from the seeded
school, and `expect` must be filled in, before a draft is pasted into questions.json.
"""
import json
from collections import Counter

from django.core.management.base import BaseCommand, CommandError

from assistant.models import AgentGap, AgentGapGroup

MAX_EXAMPLES = 5


class Command(BaseCommand):
    help = 'Write draft baseline questions for a gap group (never edits questions.json).'

    def add_arguments(self, parser):
        parser.add_argument('--group', type=int, required=True)
        parser.add_argument('--out', help='Write the drafts to this file instead of the screen.')

    def handle(self, *args, **opts):
        try:
            group = AgentGapGroup.objects.get(pk=opts['group'])
        except AgentGapGroup.DoesNotExist:
            raise CommandError(f'No group with id {opts["group"]}.')

        rows = list(AgentGap.objects.filter(group=group).exclude(summary='').order_by('-created_at')
                    .values('summary', 'agent', 'role', 'language'))
        seen, examples = set(), []
        for r in rows:
            if r['summary'] not in seen:
                seen.add(r['summary'])
                examples.append(r)
            if len(examples) >= MAX_EXAMPLES:
                break
        if not examples:
            self.stdout.write('This group has no text examples (students and parents are never stored). Nothing to export.')
            return

        agent = Counter(r['agent'] for r in rows if r['agent']).most_common(1)
        role = Counter(r['role'] for r in rows).most_common(1)
        drafts = [{
            'id': f'G{group.pk}-{i}',
            'agent': agent[0][0] if agent else '',
            'role': role[0][0] if role else 'SCHOOL_ADMIN',
            'lang': ex['language'] or 'en',
            'q': ex['summary'],
            'expect': {'tool': 'TODO'},
        } for i, ex in enumerate(examples, 1)]
        text = json.dumps(drafts, indent=1, ensure_ascii=False)
        if opts['out']:
            with open(opts['out'], 'w', encoding='utf-8') as fh:
                fh.write(text + '\n')
            self.stdout.write(f'Wrote {len(drafts)} draft(s) to {opts["out"]}. Replace <student>/<staff> and fill in expect.')
        else:
            self.stdout.write(text)
