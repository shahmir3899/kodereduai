"""Run the weekly gap grouping once by hand.

    python manage.py group_gaps_now --dry-run     # calls the model, prints the plan, writes nothing
    python manage.py group_gaps_now               # groups for real (writes AgentGap.group / AgentGapGroup)
"""
from django.core.management.base import BaseCommand

from assistant import grouping


class Command(BaseCommand):
    help = 'Group new Aura gap summaries now instead of waiting for the weekly job.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Show what would be grouped; change nothing.')

    def handle(self, *args, **opts):
        result = grouping.run(dry_run=opts['dry_run'])
        for item in result.pop('plan', []):
            self.stdout.write(f"  {item['label']}  <-  {item['summary']}")
        self.stdout.write(str(result))
