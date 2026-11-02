from django.core.management.base import BaseCommand

from finance.kuickpay.services import post_pending


class Command(BaseCommand):
    help = (
        "Finish crediting Kuickpay payments that were stored but not yet posted to the fee ledger "
        "(crash, transient error, or closed accounting period). Idempotent; never bypasses a period lock."
    )

    def add_arguments(self, parser):
        parser.add_argument('--older-than-seconds', type=int, default=0)

    def handle(self, *args, **opts):
        counts = post_pending(older_than_seconds=opts['older_than_seconds'])
        self.stdout.write(' '.join(f'{k}={v}' for k, v in sorted(counts.items())) or 'nothing pending')
