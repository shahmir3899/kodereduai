from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIRequestFactory

from finance.models import Account, AccountSnapshot, FeePayment, MonthlyClosing, AnnualFeeCategory
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

    def _build_ledger_response(self):
        factory = APIRequestFactory()
        request = factory.get('/api/finance/accounts/ledger/', {
            'account_id': self.account.id,
            'ordering': 'asc',
        })

        # Bypass auth/tenant for focused unit test; ledger data logic is the target.
        request.user = type('User', (), {
            'is_authenticated': True,
            'is_super_admin': True,
            'school_id': self.school.id,
            'organization_id': self.org.id,
        })()
        request.META['HTTP_X_SCHOOL_ID'] = str(self.school.id)

        view = AccountViewSet()
        view.request = request
        view.kwargs = {}
        response = view.ledger(request)
        self.assertEqual(response.status_code, 200)
        return response.data

    def test_monthly_fee_description_uses_month_and_year(self):
        data = self._build_ledger_response()
        monthly_entries = [
            e for e in data['entries']
            if e['type'] == 'fee_payment' and e['date'] == date(2025, 2, 10)
        ]
        self.assertTrue(monthly_entries)
        self.assertIn('(Monthly - February 2025)', monthly_entries[0]['description'])

    def test_annual_fee_description_uses_category_name(self):
        books = AnnualFeeCategory.objects.create(
            school=self.school,
            name='Books',
        )
        FeePayment.objects.create(
            school=self.school,
            student=self.student,
            fee_type='ANNUAL',
            month=0,
            year=2025,
            annual_category=books,
            amount_due=Decimal('100.00'),
            amount_paid=Decimal('100.00'),
            payment_date=date(2025, 4, 20),
            account=self.account,
        )

        data = self._build_ledger_response()
        annual_entries = [
            e for e in data['entries']
            if e['type'] == 'fee_payment' and e['date'] == date(2025, 4, 20)
        ]
        self.assertTrue(annual_entries)
        self.assertIn('(Annual - Books)', annual_entries[0]['description'])

    def test_annual_fee_description_falls_back_to_uncategorized(self):
        FeePayment.objects.create(
            school=self.school,
            student=self.student,
            fee_type='ANNUAL',
            month=0,
            year=2025,
            annual_category=None,
            amount_due=Decimal('100.00'),
            amount_paid=Decimal('100.00'),
            payment_date=date(2025, 4, 21),
            account=self.account,
        )

        data = self._build_ledger_response()
        annual_entries = [
            e for e in data['entries']
            if e['type'] == 'fee_payment' and e['date'] == date(2025, 4, 21)
        ]
        self.assertTrue(annual_entries)
        self.assertIn('(Annual - Uncategorized)', annual_entries[0]['description'])
