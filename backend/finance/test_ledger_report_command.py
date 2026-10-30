from datetime import date
from decimal import Decimal
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from finance.models import FeePayment
from finance.test_ledger import LedgerBase

pytestmark = pytest.mark.kuickpay


class TestLedgerReportCommand(LedgerBase):
    def run_cmd(self, *args):
        out = StringIO()
        call_command('kuickpay_ledger_report', '--school-id', str(self.school.id), *args, stdout=out)
        return out.getvalue()

    def make_stale(self):
        jan = self.row(1)
        feb = self.row(2, prev='1000')
        jan.amount_paid, jan.payment_date, jan.account = Decimal('1000'), date(2026, 2, 5), self.account
        jan.save()
        return feb

    def test_report_is_read_only(self):
        feb = self.make_stale()
        out = self.run_cmd()
        self.assertIn('stale rows: 1', out)
        feb.refresh_from_db()
        self.assertEqual(feb.amount_due, Decimal('2000'))

    def test_refresh_defaults_to_a_dry_run(self):
        feb = self.make_stale()
        out = self.run_cmd('--refresh')
        self.assertIn('DRY RUN', out)
        feb.refresh_from_db()
        self.assertEqual(feb.amount_due, Decimal('2000'))

    def test_apply_writes_the_refresh(self):
        feb = self.make_stale()
        out = self.run_cmd('--refresh', '--apply')
        self.assertIn('APPLIED', out)
        feb.refresh_from_db()
        self.assertEqual(feb.amount_due, Decimal('1000'))
        self.assertIn('stale rows: 0', self.run_cmd())

    def test_apply_without_refresh_is_rejected(self):
        with self.assertRaises(CommandError):
            self.run_cmd('--apply')

    def test_unknown_school_is_rejected(self):
        with self.assertRaises(CommandError):
            call_command('kuickpay_ledger_report', '--school-id', '999999')
