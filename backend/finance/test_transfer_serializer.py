from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from finance.models import Account, Transfer
from finance.serializers import TransferCreateSerializer
from schools.models import Organization, School


User = get_user_model()


class TransferCreateSerializerTests(TestCase):
    def setUp(self):
        self.organization = Organization.objects.create(name='Serializer Org', slug='serializer-org')
        self.school = School.objects.create(
            organization=self.organization,
            name='Serializer School',
            subdomain='serializer-school',
        )
        self.user = User.objects.create_user(
            username='serializer-user',
            email='serializer-user@example.com',
            password='pass123',
        )
        self.account_one = Account.objects.create(
            school=self.school,
            name='Cash Box',
            account_type='CASH',
        )
        self.account_two = Account.objects.create(
            school=self.school,
            name='Main Bank',
            account_type='BANK',
        )
        self.transfer = Transfer.objects.create(
            school=self.school,
            from_account=self.account_one,
            to_account=self.account_two,
            amount=Decimal('1500.00'),
            date=date(2026, 4, 15),
            recorded_by=self.user,
            description='Initial transfer',
        )

    def test_partial_update_uses_existing_accounts_for_same_account_validation(self):
        serializer = TransferCreateSerializer(
            instance=self.transfer,
            data={'to_account': self.account_one.id},
            partial=True,
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn('Cannot transfer to the same account.', serializer.errors['non_field_errors'])

    def test_partial_update_rejects_non_positive_amount(self):
        serializer = TransferCreateSerializer(
            instance=self.transfer,
            data={'amount': '0'},
            partial=True,
        )

        self.assertFalse(serializer.is_valid())
        self.assertEqual(serializer.errors['amount'][0], 'Amount must be positive.')