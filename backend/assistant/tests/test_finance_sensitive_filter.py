"""The Finance chat tools must hide what the Finance screens hide.

Principals and staff-level roles (finance managers included) never see sensitive entries or accounts
hidden from staff - not on the Expenses screen, and not by asking the assistant either. Before
this fix the aggregate tools (totals, balance, breakdown, top expenses...) ignored the flag.
"""
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.utils import timezone

from assistant import registry

pytestmark = pytest.mark.django_db
TODAY = None


@pytest.fixture(autouse=True)
def _all_agents_offered():
    with patch('assistant.router.pick_agents', lambda by_agent, message, recent=(): list(by_agent)):
        yield


@pytest.fixture
def ledger(seed_data):
    from finance.models import Account, Expense, ExpenseCategory, IncomeCategory, OtherIncome, Transfer

    school, org, admin = seed_data['school_a'], seed_data['org'], seed_data['users']['admin']
    school.enabled_modules = {**(school.enabled_modules or {}), 'finance': True}
    school.save(update_fields=['enabled_modules'])
    org.allowed_modules = {**(org.allowed_modules or {}), 'finance': True}
    org.save(update_fields=['allowed_modules'])
    today = timezone.localdate()

    cash = Account.objects.create(school=school, organization=org, name='Cash', opening_balance=Decimal('10000'))
    private = Account.objects.create(school=school, organization=org, name='Private', opening_balance=Decimal('500'), staff_visible=False)
    shared = Account.objects.create(school=None, organization=org, name='Org shared', opening_balance=Decimal('7'))
    util, legal = ExpenseCategory.objects.create(school=school, name='Utilities'), ExpenseCategory.objects.create(school=school, name='Legal', is_sensitive=True)
    gift = IncomeCategory.objects.create(school=school, name='Donation')

    def exp(amount, cat, account, sensitive=False):
        return Expense.objects.create(school=school, category=cat, amount=amount, date=today, description='x', recorded_by=admin,
                                      account=account, is_sensitive=sensitive)

    exp(1000, util, cash)                      # visible to everyone
    exp(900, legal, cash, sensitive=True)      # sensitive
    exp(500, util, private)                    # on an account hidden from staff
    OtherIncome.objects.create(school=school, category=gift, amount=300, date=today, description='a', recorded_by=admin, account=cash)
    OtherIncome.objects.create(school=school, category=gift, amount=200, date=today, description='b', recorded_by=admin, account=cash, is_sensitive=True)
    Transfer.objects.create(school=school, from_account=cash, to_account=private, amount=40, date=today, description='open', recorded_by=admin)
    Transfer.objects.create(school=school, from_account=cash, to_account=private, amount=60, date=today, description='secret', recorded_by=admin, is_sensitive=True)
    return {'cash': cash, 'private': private, 'shared': shared, 'month': today.month, 'year': today.year}


def _tool(seed, role, name, **args):
    user = seed['users']['principal' if role == 'PRINCIPAL' else 'finance_manager' if role == 'FINANCE_MANAGER' else 'admin']
    # 'FINANCE_MANAGER' is the finance-enabled MANAGER now.
    out = registry.execute(registry.ToolContext(user=user, school_id=seed['SID_A'], role='MANAGER' if role == 'FINANCE_MANAGER' else role), name, args)
    assert 'data' in out, out
    return out['data']


class TestExpenseSideTools:
    def test_total_expenses(self, seed_data, ledger):
        assert _tool(seed_data, 'SCHOOL_ADMIN', 'get_total_expenses')['total_expenses'] == 2400.0
        assert _tool(seed_data, 'PRINCIPAL', 'get_total_expenses')['total_expenses'] == 1000.0
        assert _tool(seed_data, 'FINANCE_MANAGER', 'get_total_expenses')['total_expenses'] == 1000.0

    def test_breakdown_and_top_expenses_hide_sensitive_rows(self, seed_data, ledger):
        admin = _tool(seed_data, 'SCHOOL_ADMIN', 'get_expense_breakdown')
        principal = _tool(seed_data, 'PRINCIPAL', 'get_expense_breakdown')
        assert admin['grand_total'] == 2400.0 and principal['grand_total'] == 1000.0
        assert 'Legal' in {c['name'] for c in admin['categories']} and 'Legal' not in {c['name'] for c in principal['categories']}
        top = _tool(seed_data, 'PRINCIPAL', 'get_top_expenses')['expenses']
        assert [e['amount'] for e in top] == [1000.0]

    def test_balance_uses_only_visible_expenses_and_income(self, seed_data, ledger):
        admin = _tool(seed_data, 'SCHOOL_ADMIN', 'get_balance')
        principal = _tool(seed_data, 'PRINCIPAL', 'get_balance')
        assert (admin['expenses'], admin['other_income']) == (2400.0, 500.0)
        assert (principal['expenses'], principal['other_income']) == (1000.0, 300.0)

    def test_income_tools(self, seed_data, ledger):
        assert _tool(seed_data, 'SCHOOL_ADMIN', 'get_other_income')['total_other_income'] == 500.0
        assert _tool(seed_data, 'PRINCIPAL', 'get_other_income')['total_other_income'] == 300.0
        assert _tool(seed_data, 'PRINCIPAL', 'get_income_summary')['other_income'] == 300.0

    def test_transfer_history(self, seed_data, ledger):
        assert _tool(seed_data, 'SCHOOL_ADMIN', 'get_transfer_history')['total'] == 2
        assert [t['amount'] for t in _tool(seed_data, 'PRINCIPAL', 'get_transfer_history')['transfers']] == [40.0]


class TestAccountBalances:
    def _names(self, seed, role):
        return {a['account']: a for a in _tool(seed, role, 'get_account_balances')['accounts']}

    def test_admin_sees_everything_including_shared(self, seed_data, ledger):
        assert set(self._names(seed_data, 'SCHOOL_ADMIN')) == {'Cash', 'Private', 'Org shared'}

    def test_principal_sees_no_shared_org_accounts(self, seed_data, ledger):
        assert set(self._names(seed_data, 'PRINCIPAL')) == {'Cash', 'Private'}

    def test_staff_level_roles_see_only_staff_visible_accounts_without_sensitive_rows(self, seed_data, ledger):
        acct = self._names(seed_data, 'FINANCE_MANAGER')
        assert set(acct) == {'Cash', 'Org shared'}
        assert acct['Cash']['payments'] == 1000.0 and acct['Cash']['receipts'] == 300.0      # no 900 sensitive expense, no 200 income
        assert acct['Cash']['transfers_out'] == 40.0
        admin_cash = self._names(seed_data, 'SCHOOL_ADMIN')['Cash']
        assert admin_cash['payments'] == 1900.0 and admin_cash['receipts'] == 500.0


class TestUnchangedPaths:
    def test_agent_without_a_role_is_unrestricted_for_internal_callers(self, seed_data, ledger):
        from finance.ai_agent import FinanceAIAgent
        assert FinanceAIAgent(seed_data['SID_A'])._get_total_expenses()['total_expenses'] == 2400.0

    def test_old_chat_endpoint_now_passes_the_askers_role(self, seed_data, ledger, api):
        from finance.ai_agent import FinanceAIAgent
        seen = {}

        def spy(self, message, user=None):
            seen['role'] = self.role
            return 'ok'

        with patch.object(FinanceAIAgent, 'process_query', spy):
            r = api.post('/api/finance/ai-chat/', {'message': 'expenses?'}, seed_data['tokens']['principal'], seed_data['SID_A'])
        assert r.status_code == 200 and seen['role'] == 'PRINCIPAL'
