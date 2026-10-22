"""A monthly row's amount_due carries the earlier months' balance, so totals that span
months must not add it up again. Builds on the shared seed_data fixture."""
from datetime import date
from decimal import Decimal

import pytest

from finance.ai_agent import FinanceAIAgent
from finance.models import FeePayment, MonthlyFeeCategory


pytestmark = pytest.mark.django_db


def _unpaid_chain(seed_data, student):
    cat = MonthlyFeeCategory.objects.create(school=seed_data['school_a'], name='Chain Tuition', is_active=True)
    # 1000 a month, never paid: each row's amount_due holds all the earlier months.
    for month, due in ((4, '1000'), (5, '2000'), (6, '3000')):
        FeePayment.objects.create(
            school=seed_data['school_a'], student=student, academic_year=seed_data['academic_year'],
            fee_type='MONTHLY', monthly_category=cat, month=month, year=2025,
            amount_due=Decimal(due), amount_paid=Decimal('0'), previous_balance=Decimal(due) - 1000,
            base_monthly_fee=Decimal('1000'),
        )


def test_defaulter_owes_the_latest_balance_not_the_sum_of_carried_rows(seed_data):
    student = seed_data['students'][0]
    _unpaid_chain(seed_data, student)

    result = FinanceAIAgent(seed_data['SID_A'])._get_fee_defaulters(min_months=2)

    row = next(d for d in result['defaulters'] if d['student'] == student.name)
    assert row['unpaid_months'] == 3
    assert row['total_due'] == 3000.0  # not 1000 + 2000 + 3000


def test_fee_summary_requires_a_month(seed_data, api):
    response = api.get(
        '/api/finance/fee-payments/fee_summary/?fee_type=MONTHLY',
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )

    assert response.status_code == 400


def test_fee_summary_accepts_month_zero_for_annual(seed_data, api):
    response = api.get(
        '/api/finance/fee-payments/fee_summary/?fee_type=ANNUAL&month=0&year=2025',
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )

    assert response.status_code == 200, response.content[:300]
