"""balances_all computed every account with ~7 queries each (51 for 7 accounts). The
batched version must give exactly the same money figures, in a flat number of queries."""
from datetime import date
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from finance.models import (
    Account, AccountSnapshot, Expense, FeePayment, MonthlyClosing, OtherIncome, Transfer,
)
from finance.views import AccountViewSet

pytestmark = pytest.mark.django_db

D = Decimal


@pytest.fixture
def ledger(seed_data):
    """Six accounts with fees, income, expenses and transfers; two have a monthly snapshot."""
    school, student = seed_data['school_a'], seed_data['students'][0]
    by = seed_data['users']['admin']
    accounts = [
        Account.objects.create(school=school, name=f'ZZ_acct_{i}', account_type=Account.AccountType.CASH,
                               opening_balance=D('100.00') * i)
        for i in range(6)
    ]
    for i, account in enumerate(accounts):
        FeePayment.objects.create(
            school=school, student=student, fee_type='MONTHLY', month=i + 1, year=2025,
            amount_due=D('100'), amount_paid=D('40') + i, payment_date=date(2025, 2 + i, 10), account=account,
        )
        OtherIncome.objects.create(school=school, recorded_by=by, account=account, amount=D('10') * (i + 1), date=date(2025, 3, 1))
        Expense.objects.create(school=school, recorded_by=by, account=account, amount=D('5') * (i + 1), date=date(2025, 3, 15))
    # An undated payment (counts before a snapshot, not after) and transfers both ways.
    undated = FeePayment.objects.create(
        school=school, student=student, fee_type='MONTHLY', month=12, year=2025,
        amount_due=D('100'), amount_paid=D('7'), payment_date=date(2025, 12, 1), account=accounts[0],
    )
    FeePayment.objects.filter(pk=undated.pk).update(payment_date=None)  # old data the model would now refuse
    Transfer.objects.create(school=school, recorded_by=by, from_account=accounts[0], to_account=accounts[1], amount=D('30'), date=date(2025, 3, 20))
    Transfer.objects.create(school=school, recorded_by=by, from_account=accounts[1], to_account=accounts[2], amount=D('12'), date=date(2025, 5, 2))
    closing = MonthlyClosing.objects.create(school=school, year=2025, month=2)
    for account in accounts[:2]:
        AccountSnapshot.objects.create(
            closing=closing, account=account, closing_balance=D('777.00'), opening_balance_used=D('0'),
            receipts=D('0'), payments=D('0'), transfers_in=D('0'), transfers_out=D('0'),
        )
    return {**seed_data, 'accounts': accounts}


@pytest.mark.parametrize('date_from, date_to', [
    (None, None),
    (None, date(2025, 3, 31)),
    (date(2025, 3, 1), None),
    (date(2025, 1, 1), date(2025, 6, 30)),
    (date(2025, 4, 1), date(2025, 12, 31)),  # snapshot (Feb) sits before date_from: gap path
])
def test_batch_matches_the_per_account_figures(ledger, date_from, date_to):
    school_id = ledger['school_a'].id
    accounts = list(Account.objects.filter(id__in=[a.id for a in ledger['accounts']]).order_by('id'))

    expected = [
        AccountViewSet._compute_account_balance(a, [school_id], date_from, date_to, snapshot_school_id=school_id)
        for a in accounts
    ]
    got = AccountViewSet._compute_balances_batch(accounts, [school_id], date_from, date_to, snapshot_school_id=school_id)

    assert got == expected


def test_batch_without_snapshots_matches_too(ledger):
    school_id = ledger['school_a'].id
    accounts = list(Account.objects.filter(id__in=[a.id for a in ledger['accounts']]).order_by('id'))

    expected = [AccountViewSet._compute_account_balance(a, [school_id], None, date(2025, 4, 30)) for a in accounts]
    got = AccountViewSet._compute_balances_batch(accounts, [school_id], None, date(2025, 4, 30))

    assert got == expected


def test_no_accounts_is_an_empty_list():
    assert AccountViewSet._compute_balances_batch([], [1]) == []


def test_the_endpoint_cost_does_not_grow_with_the_number_of_accounts(api, ledger):
    def call():
        with CaptureQueriesContext(connection) as q:
            resp = api.get('/api/finance/accounts/balances_all/', ledger['tokens']['admin'], ledger['SID_A'])
        assert resp.status_code == 200, resp.content
        return len(q), resp.json()

    call()  # warm
    six, body = call()
    for i in range(10):
        Account.objects.create(school=ledger['school_a'], name=f'ZZ_more_{i}', opening_balance=D('1'))
    sixteen, _ = call()

    assert sixteen - six <= 1, f'{six} queries for 6 accounts, {sixteen} for 16'
    names = {a['name'] for g in body['groups'] for a in g['accounts']}
    assert {f'ZZ_acct_{i}' for i in range(6)} <= names
