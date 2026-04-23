from datetime import date
from decimal import Decimal

from django.test import TestCase

from finance.models import Account, AccountSnapshot, FeePayment, MonthlyClosing
from finance.views import AccountViewSet
from schools.models import Organization, School
from students.models import Class, Student


class TestAccountSnapshotBoundary(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="Ledger Org", slug="ledger-org")
        cls.school = School.objects.create(
            organization=cls.org,
            name="Ledger School",
            subdomain="ledger-school",
        )
        cls.class_obj = Class.objects.create(
            school=cls.school,
            name="Class 1",
            grade_level=1,
        )
        cls.student = Student.objects.create(
            school=cls.school,
            class_obj=cls.class_obj,
            name="Snapshot Student",
            roll_number="1",
        )

        cls.account = Account.objects.create(
            school=cls.school,
            name="Main Cash",
            account_type=Account.AccountType.CASH,
            opening_balance=Decimal("100.00"),
        )

        jan_closing = MonthlyClosing.objects.create(
            school=cls.school,
            year=2025,
            month=1,
        )
        dec_closing = MonthlyClosing.objects.create(
            school=cls.school,
            year=2025,
            month=12,
        )

        AccountSnapshot.objects.create(
            closing=jan_closing,
            account=cls.account,
            closing_balance=Decimal("500.00"),
            opening_balance_used=Decimal("100.00"),
            receipts=Decimal("400.00"),
            payments=Decimal("0.00"),
            transfers_in=Decimal("0.00"),
            transfers_out=Decimal("0.00"),
        )
        AccountSnapshot.objects.create(
            closing=dec_closing,
            account=cls.account,
            closing_balance=Decimal("900.00"),
            opening_balance_used=Decimal("500.00"),
            receipts=Decimal("400.00"),
            payments=Decimal("0.00"),
            transfers_in=Decimal("0.00"),
            transfers_out=Decimal("0.00"),
        )

        FeePayment.objects.create(
            school=cls.school,
            student=cls.student,
            fee_type='MONTHLY',
            month=2,
            year=2025,
            amount_due=Decimal("100.00"),
            amount_paid=Decimal("50.00"),
            payment_date=date(2025, 2, 10),
            account=cls.account,
        )
        FeePayment.objects.create(
            school=cls.school,
            student=cls.student,
            fee_type='MONTHLY',
            month=3,
            year=2025,
            amount_due=Decimal("100.00"),
            amount_paid=Decimal("25.00"),
            payment_date=date(2025, 3, 5),
            account=cls.account,
        )

    def test_date_to_only_uses_snapshot_before_as_of_month(self):
        result = AccountViewSet._compute_account_balance(
            account=self.account,
            scope_ids=[self.school.id],
            date_from=None,
            date_to=date(2025, 3, 31),
            is_staff=False,
            snapshot_school_id=self.school.id,
        )

        # Must use Jan-2025 snapshot (500.00) and include Feb+Mar receipts (75.00).
        self.assertEqual(result['opening_balance'], Decimal('500.00'))
        self.assertEqual(result['receipts'], Decimal('75.00'))
        self.assertEqual(result['net_balance'], Decimal('575.00'))
