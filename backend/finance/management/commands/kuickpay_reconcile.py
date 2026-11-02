from django.core.management.base import BaseCommand, CommandError

from finance.kuickpay import reconciliation
from schools.models import School


class Command(BaseCommand):
    help = (
        "Kuickpay reconciliation report for one school: payments not credited, held or unposted, "
        "ledger/allocation disagreements, suspended bills. Read-only; --alert also sends the in-app "
        "alert to school admins (at most one per admin per day)."
    )

    def add_arguments(self, parser):
        parser.add_argument('--school-id', type=int, required=True)
        parser.add_argument('--stale-minutes', type=int, default=reconciliation.DEFAULT_STALE_MINUTES)
        parser.add_argument('--alert', action='store_true')

    def handle(self, *args, **opts):
        school = School.objects.filter(pk=opts['school_id']).first()
        if school is None:
            raise CommandError(f"School {opts['school_id']} does not exist.")
        report = reconciliation.build_report(school.id, stale_minutes=opts['stale_minutes'])
        w = self.stdout.write
        w(f'URGENT  payments after expiry, not credited: {len(report["urgent"])}')
        for t in report['urgent']:
            w(f'  txn={t["id"]} consumer={t["consumer_number"]} amount={t["amount"]} received={t["received_at"]:%Y-%m-%d %H:%M}')
        w(f'HELD    payments held for reconciliation: {len(report["held"])}')
        for t in report['held']:
            w(f'  txn={t["id"]} consumer={t["consumer_number"]} held={t["held_amount"]} reason={t["reason"]}')
        w(f'UNPOSTED confirmed payments not in the ledger: {len(report["unposted"])}')
        for t in report['unposted']:
            w(f'  txn={t["id"]} consumer={t["consumer_number"]} amount={t["amount"]} status={t["status"]}')
        w(f'allocation mismatches: {len(report["allocation_mismatches"])}   fee rows below allocations: {len(report["row_invariants"])}')
        w(f'suspended bills: {report["suspended_bills"] or 0}   students without a current bill: {report["students_missing_bill"]}')
        if opts['alert']:
            w(f'alerts sent: {reconciliation.send_alerts(school, stale_minutes=opts["stale_minutes"])}')
