"""
Regression tests for PRINCIPAL branch isolation on Account endpoints.

AccountViewSet.balances() has always excluded org-level shared accounts
(Account.school_id is NULL) for PRINCIPAL users. get_queryset() — which backs
list/CRUD, the ledger lookup, and the exports — didn't have the same
exclusion, so a Principal could see and pull the ledger for every shared
account in the organization, not just their own branch. See
backend/finance/views.py AccountViewSet.get_queryset()/balances_all().
"""
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from finance.models import Account
from schools.models import Organization, School, UserSchoolMembership


class TestAccountPrincipalScoping(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="Scoping Org", slug="scoping-org")
        cls.school_a = School.objects.create(
            organization=cls.org, name="Branch A", subdomain="scoping-branch-a",
        )
        cls.school_b = School.objects.create(
            organization=cls.org, name="Branch B", subdomain="scoping-branch-b",
        )

        cls.shared_account = Account.objects.create(
            school=None,
            organization=cls.org,
            name="Org Shared Fund",
            account_type=Account.AccountType.BANK,
            opening_balance=Decimal("0.00"),
        )
        cls.branch_a_account = Account.objects.create(
            school=cls.school_a,
            name="Branch A Cash",
            account_type=Account.AccountType.CASH,
            opening_balance=Decimal("0.00"),
        )

        cls.principal = get_user_model().objects.create_user(
            username='scoping_principal',
            email='scoping_principal@test.com',
            password='test12345',
        )
        UserSchoolMembership.objects.create(
            user=cls.principal, school=cls.school_a,
            role=UserSchoolMembership.Role.PRINCIPAL, is_default=True, is_active=True,
        )

        cls.school_admin = get_user_model().objects.create_user(
            username='scoping_school_admin',
            email='scoping_school_admin@test.com',
            password='test12345',
        )
        UserSchoolMembership.objects.create(
            user=cls.school_admin, school=cls.school_a,
            role=UserSchoolMembership.Role.SCHOOL_ADMIN, is_default=True, is_active=True,
        )

    def _client_for(self, user, school):
        client = APIClient()
        client.force_authenticate(user)
        return client, {'HTTP_X_SCHOOL_ID': str(school.id)}

    def test_principal_account_list_excludes_shared_account(self):
        client, header = self._client_for(self.principal, self.school_a)
        response = client.get('/api/finance/accounts/', {'page_size': 9999}, **header)

        self.assertEqual(response.status_code, 200)
        account_ids = {a['id'] for a in response.json()['results']}
        self.assertIn(self.branch_a_account.id, account_ids)
        self.assertNotIn(self.shared_account.id, account_ids)

    def test_principal_ledger_404s_for_shared_account(self):
        client, header = self._client_for(self.principal, self.school_a)
        response = client.get(
            '/api/finance/accounts/ledger/', {'account_id': self.shared_account.id}, **header,
        )
        self.assertEqual(response.status_code, 404)

    def test_principal_balances_all_hides_shared_section(self):
        # Give the Principal a second membership so balances_all's
        # multi-school path is exercised.
        UserSchoolMembership.objects.create(
            user=self.principal, school=self.school_b,
            role=UserSchoolMembership.Role.PRINCIPAL, is_active=True,
        )
        client, header = self._client_for(self.principal, self.school_a)
        response = client.get('/api/finance/accounts/balances_all/', **header)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['shared']['accounts'], [])

    def test_school_admin_still_sees_shared_account(self):
        """Regression guard: the fix must not also hide shared accounts from
        roles that are supposed to see them."""
        client, header = self._client_for(self.school_admin, self.school_a)

        list_response = client.get('/api/finance/accounts/', {'page_size': 9999}, **header)
        account_ids = {a['id'] for a in list_response.json()['results']}
        self.assertIn(self.shared_account.id, account_ids)

        ledger_response = client.get(
            '/api/finance/accounts/ledger/', {'account_id': self.shared_account.id}, **header,
        )
        self.assertEqual(ledger_response.status_code, 200)
