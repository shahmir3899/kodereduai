"""
Dashboard fee numbers come from one helper: every fee type counts (one row per
type), and the multi-school endpoint reports the same fields as the
single-school one. Builds on the shared seed_data fixture.
"""
from datetime import date
from decimal import Decimal

import pytest

from finance.models import Account, AnnualFeeCategory, FeePayment, MonthlyFeeCategory


pytestmark = pytest.mark.django_db

MONTH, YEAR = 3, 2026


@pytest.fixture
def fees(seed_data):
    school, year = seed_data['school_a'], seed_data['academic_year']
    s1, s2 = seed_data['students'][0], seed_data['students'][1]
    account = Account.objects.create(school=school, name='Summary Cash', account_type=Account.AccountType.CASH)
    monthly_cat = MonthlyFeeCategory.objects.create(school=school, name='Summary Tuition', is_active=True)
    annual_cat = AnnualFeeCategory.objects.create(school=school, name='Summary Annual', is_active=True)

    def make(student, fee_type, month, due, paid, **extra):
        # A paid amount must carry payment_date + account (FeePayment.save).
        return FeePayment.objects.create(
            school=school, student=student, academic_year=year, fee_type=fee_type,
            month=month, year=YEAR, amount_due=Decimal(due), amount_paid=Decimal(paid),
            payment_date=date(YEAR, 3, 10) if Decimal(paid) > 0 else None,
            account=account if Decimal(paid) > 0 else None, **extra,
        )

    make(s1, 'MONTHLY', MONTH, '1000', '1000', monthly_category=monthly_cat)
    make(s2, 'MONTHLY', MONTH, '1000', '0', monthly_category=monthly_cat)
    make(s1, 'ANNUAL', 0, '5000', '2000', annual_category=annual_cat)
    # Another month's monthly fee must stay out of March's numbers.
    make(s1, 'MONTHLY', 4, '1000', '1000', monthly_category=monthly_cat)
    return seed_data


def _get(api, seed_data, path):
    response = api.get(path, seed_data['tokens']['admin'], seed_data['SID_A'])
    assert response.status_code == 200, response.content[:300]
    return response.json()


def test_all_types_counted_one_row_per_type(fees, api):
    data = _get(api, fees, f'/api/finance/fee-payments/monthly_summary/?month={MONTH}&year={YEAR}')

    assert Decimal(data['total_due']) == Decimal('7000')
    assert Decimal(data['total_collected']) == Decimal('3000')
    assert Decimal(data['total_pending']) == Decimal('4000')
    assert (data['paid_count'], data['partial_count'], data['unpaid_count']) == (1, 1, 1)

    by_type = {row['fee_type']: row for row in data['by_type']}
    assert [row['fee_type'] for row in data['by_type']] == ['MONTHLY', 'ANNUAL']
    assert Decimal(by_type['MONTHLY']['total_due']) == Decimal('2000')
    assert Decimal(by_type['ANNUAL']['total_pending']) == Decimal('3000')
    assert {c['fee_type'] for c in data['by_category']} == {'MONTHLY', 'ANNUAL'}


def test_explicit_fee_type_still_narrows(fees, api):
    data = _get(api, fees, f'/api/finance/fee-payments/monthly_summary/?month={MONTH}&year={YEAR}&fee_type=MONTHLY')

    assert Decimal(data['total_due']) == Decimal('2000')
    assert [row['fee_type'] for row in data['by_type']] == ['MONTHLY']


def test_all_schools_matches_single_school_fields(fees, api):
    single = _get(api, fees, (
        f"/api/finance/fee-payments/monthly_summary/?month={MONTH}&year={YEAR}"
        f"&academic_year={fees['academic_year'].id}"
    ))
    everything = _get(api, fees, f'/api/finance/fee-payments/monthly_summary_all/?month={MONTH}&year={YEAR}')

    mine = next(s for s in everything['schools'] if s['school_id'] == fees['SID_A'])
    for field in ('total_due', 'total_collected', 'total_pending',
                  'paid_count', 'partial_count', 'unpaid_count', 'advance_count'):
        assert mine[field] == single[field], field
    assert mine['by_type'] == single['by_type']
    assert Decimal(everything['grand']['total_due']) >= Decimal(single['total_due'])


def test_bootstrap_finance_section_is_monthly_only(fees):
    from core.bootstrap_views import _get_finance_section

    section = _get_finance_section(fees['SID_A'], MONTH, YEAR, fees['academic_year'].id)

    assert Decimal(section['total_due']) == Decimal('2000')
    assert [row['fee_type'] for row in section['by_type']] == ['MONTHLY']
