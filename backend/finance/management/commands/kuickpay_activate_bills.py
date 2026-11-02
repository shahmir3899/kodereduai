from django.core.management.base import BaseCommand, CommandError

from finance.kuickpay.bills import enabled_mapping, sweep_school
from schools.models import School


class Command(BaseCommand):
    help = (
        "Backfill / repair Kuickpay bills for a pilot school: every active student gets a bill for "
        "their latest generated monthly cycle (older bills are superseded) and every open bill's "
        "state is re-synced with the fee ledger. Use --dry-run to only count."
    )

    def add_arguments(self, parser):
        parser.add_argument('--school-id', type=int, required=True)
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **opts):
        school_id = opts['school_id']
        if not School.objects.filter(pk=school_id).exists():
            raise CommandError(f'School {school_id} does not exist.')
        if enabled_mapping(school_id) is None:
            raise CommandError(
                f'School {school_id} has no enabled Kuickpay mapping (school and biller must both be enabled).'
            )
        counts = sweep_school(school_id, dry_run=opts['dry_run'])
        self.stdout.write(('DRY RUN ' if opts['dry_run'] else '') + ' '.join(f'{k}={v}' for k, v in counts.items()))
