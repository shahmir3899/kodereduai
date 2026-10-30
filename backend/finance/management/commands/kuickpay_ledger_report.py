from django.core.management.base import BaseCommand, CommandError

from finance import ledger
from finance.models import FeePayment
from schools.models import School


class Command(BaseCommand):
    help = (
        "Report monthly fee chains whose carried-forward balances are stale or have gaps. "
        "Read-only by default. With --refresh it shows what an administrator refresh would change "
        "(dry run); add --apply to write it. Closed accounting periods are never bypassed."
    )

    def add_arguments(self, parser):
        parser.add_argument('--school-id', type=int, required=True)
        parser.add_argument('--refresh', action='store_true', help='Plan a refresh of stale chains (dry run).')
        parser.add_argument('--apply', action='store_true', help='With --refresh: actually write the changes.')

    def handle(self, *args, **opts):
        school_id = opts['school_id']
        if not School.objects.filter(pk=school_id).exists():
            raise CommandError(f'School {school_id} does not exist.')
        if opts['apply'] and not opts['refresh']:
            raise CommandError('--apply only makes sense together with --refresh.')

        student_ids = list(
            FeePayment.objects.filter(school_id=school_id, fee_type='MONTHLY', student_id__isnull=False)
            .order_by().values_list('student_id', flat=True).distinct()
        )
        findings = ledger.chain_integrity(school_id, student_ids)
        stale = [f for f in findings if f['kind'] == 'stale']
        gaps = [f for f in findings if f['kind'] == 'gap']
        self.stdout.write(f'students with monthly rows: {len(student_ids)}')
        self.stdout.write(f'stale rows: {len(stale)}   gaps (informational): {len(gaps)}')
        for f in stale:
            self.stdout.write(
                f"  STALE student={f['student_id']} category={f['category_id']} row={f['row_id']} "
                f"{f['period'][0]}/{f['period'][1]:02d}: stored {f['stored_previous_balance']} "
                f"expected {f['expected_previous_balance']}"
            )
        if not opts['refresh']:
            return

        dry_run = not opts['apply']
        chains = sorted({(f['student_id'], f['category_id']) for f in stale})
        counts = {}
        for student_id, category_id in chains:
            for r in ledger.refresh_chain(school_id, student_id, category_id, dry_run=dry_run):
                counts[r['action']] = counts.get(r['action'], 0) + 1
                self.stdout.write(
                    f"  {r['action'].upper()} student={student_id} category={category_id} row={r['row_id']} "
                    f"{r['period'][0]}/{r['period'][1]:02d}: due {r['old_amount_due']} -> {r['new_amount_due']}"
                    + (f" ({r['detail']})" if r.get('detail') else '')
                )
        mode = 'DRY RUN' if dry_run else 'APPLIED'
        self.stdout.write(f'{mode}: {counts or "nothing to change"}')
