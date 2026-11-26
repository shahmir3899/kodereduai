"""Fee vouchers: totals agree with the student's pending balance, the PDF endpoint, settings.

Worked example (one Tuition category carrying balance forward, plus one annual fee):

    Jan   base 1000   carried    0   due 1000   paid   0
    Feb   base 1000   carried 1000   due 2000   paid 500
    Mar   base 1000   carried 1500   due 2500   paid   0
    Annual fee                       due  800   paid 300

March voucher: Tuition 1000 + Annual 500 current, previous unpaid 1500, total 3000,
the same 3000 student_pending_fees reports as owed today.
"""
from datetime import date
from decimal import Decimal

import pytest

from finance.models import (
    Account, FeePayment, KuickpayBill, KuickpayBiller, KuickpaySchoolMapping, MonthlyFeeCategory,
)
from finance.student_balance import student_pending_fees
from finance.vouchers import build_vouchers, compute_voucher, render_vouchers_pdf

URL = '/api/finance/fee-payments/vouchers/'
SETTINGS_URL = '/api/finance/voucher-settings/'


@pytest.fixture
def ctx(seed_data):
    school = seed_data['school_a']
    return {
        **seed_data,
        'school': school,
        'student': seed_data['students'][0],
        'tuition': MonthlyFeeCategory.objects.create(school=school, name='Tuition'),
        'transport': MonthlyFeeCategory.objects.create(school=school, name='Transport'),
        'cash': Account.objects.create(school=school, name='Cash', account_type='CASH'),
    }


def pay(ctx, fee_type, month, due, paid, *, prev='0', base=None, category='tuition', student=None, **kw):
    paid = Decimal(paid)
    extra = {'payment_date': date(2026, max(month, 1), 5), 'account': ctx['cash']} if paid else {}
    return FeePayment.objects.create(
        school=ctx['school'], academic_year=ctx['academic_year'], student=student or ctx['student'],
        fee_type=fee_type, month=month, year=2026,
        monthly_category=ctx[category] if fee_type == 'MONTHLY' else None,
        amount_due=Decimal(due), previous_balance=Decimal(prev),
        base_monthly_fee=Decimal(base) if base is not None else None,
        amount_paid=paid,
        status='PAID' if Decimal(due) == paid else ('PARTIAL' if paid else 'UNPAID'),
        **extra, **kw,
    )


def worked_example(ctx):
    pay(ctx, 'MONTHLY', 1, '1000', '0', base='1000')
    pay(ctx, 'MONTHLY', 2, '2000', '500', prev='1000', base='1000')
    pay(ctx, 'MONTHLY', 3, '2500', '0', prev='1500', base='1000')
    pay(ctx, 'ANNUAL', 0, '800', '300')


def rows(ctx):
    return list(FeePayment.objects.filter(student=ctx['student']).select_related('monthly_category', 'annual_category'))


class TestComputeVoucher:
    def test_march_matches_pending_balance(self, ctx):
        worked_example(ctx)
        v = compute_voucher(rows(ctx), 2026, 3)
        assert [(l['label'], l['amount']) for l in v['lines']] == [
            ('Tuition', Decimal('1000')), ('Annual (Annual 2026)', Decimal('500')),
        ]
        assert (v['current_total'], v['previous_unpaid'], v['paid']) == (Decimal('1500'), Decimal('1500'), Decimal('0'))
        assert v['total_payable'] == Decimal('3000') == student_pending_fees(ctx['student'])['total']

    def test_earlier_month_ignores_later_rows_and_subtracts_paid(self, ctx):
        worked_example(ctx)
        v = compute_voucher(rows(ctx), 2026, 2)
        assert (v['previous_unpaid'], v['paid']) == (Decimal('1000'), Decimal('500'))
        # Feb row balance 1500 + annual 500; March is never counted in a February voucher.
        assert v['total_payable'] == Decimal('2000')

    def test_category_without_a_row_this_month_counts_as_previous_unpaid(self, ctx):
        worked_example(ctx)
        pay(ctx, 'MONTHLY', 1, '700', '0', base='700', category='transport')
        v = compute_voucher(rows(ctx), 2026, 3)
        assert v['previous_unpaid'] == Decimal('2200')
        assert v['total_payable'] == Decimal('3700') == student_pending_fees(ctx['student'])['total']

    def test_overpaid_row_does_not_reduce_other_fees(self, ctx):
        pay(ctx, 'MONTHLY', 3, '1000', '1200', base='1000')
        pay(ctx, 'MONTHLY', 3, '500', '0', base='500', category='transport')
        v = compute_voucher(rows(ctx), 2026, 3)
        assert v['paid'] == Decimal('1000')
        assert v['total_payable'] == Decimal('500')

    def test_many_fees_fold_into_other_charges(self, ctx):
        for i in range(8):
            cat = MonthlyFeeCategory.objects.create(school=ctx['school'], name=f'Fee {i}')
            FeePayment.objects.create(
                school=ctx['school'], academic_year=ctx['academic_year'], student=ctx['student'],
                fee_type='MONTHLY', month=3, year=2026, monthly_category=cat,
                amount_due=Decimal('100'), base_monthly_fee=Decimal('100'), amount_paid=0,
            )
        v = compute_voucher(rows(ctx), 2026, 3)
        assert len(v['lines']) == 6
        assert v['lines'][-1] == {'label': 'Other charges', 'amount': Decimal('300')}
        assert v['total_payable'] == Decimal('800')


class TestBuildAndRender:
    def test_only_unpaid_skips_settled_students(self, ctx):
        other = ctx['students'][1]
        pay(ctx, 'MONTHLY', 3, '1000', '0', base='1000')
        pay(ctx, 'MONTHLY', 3, '1000', '1000', base='1000', student=other)
        ids = [ctx['student'].id, other.id]
        assert [v['student_id'] for v in build_vouchers(ctx['school'], ids, 2026, 3)] == [ctx['student'].id]
        assert len(build_vouchers(ctx['school'], ids, 2026, 3, only_unpaid=False)) == 2

    def test_due_date_and_kuickpay_number(self, ctx):
        school = ctx['school']
        bank = Account.objects.create(
            school=school, name='HBL', account_type='BANK', bank_name='HBL', account_number='12345678',
        )
        biller = KuickpayBiller.objects.create(name='K', prefix='12345', mode='UAT', is_enabled=True)
        KuickpaySchoolMapping.objects.create(school=school, biller=biller, settlement_account=bank, is_enabled=True)
        KuickpayBill.objects.create(
            school=school, biller=biller, student=ctx['student'], student_ref=ctx['student'].id,
            year=2026, month=3, consumer_number='1234500000017',
        )
        school.finance_config = {'due_day': 15, 'voucher_bank_account_id': bank.id}
        school.save()
        pay(ctx, 'MONTHLY', 3, '1000', '0', base='1000')

        [v] = build_vouchers(school, [ctx['student'].id], 2026, 3)
        assert v['due_date'] == date(2026, 3, 15)
        assert v['kuickpay_number'] == '1234500000017'
        pdf = render_vouchers_pdf(school, [v])
        assert pdf.startswith(b'%PDF')

    def test_empty_pdf_still_renders(self, ctx):
        assert render_vouchers_pdf(ctx['school'], []).startswith(b'%PDF')


class TestVoucherEndpoint:
    def test_admin_downloads_pdf_for_the_month(self, ctx, api):
        pay(ctx, 'MONTHLY', 3, '1000', '0', base='1000')
        resp = api.get(f'{URL}?month=3&year=2026', ctx['tokens']['admin'], ctx['school'].id)
        assert resp.status_code == 200
        assert resp['Content-Type'] == 'application/pdf'
        assert resp['X-Voucher-Count'] == '1'

    def test_month_is_required(self, ctx, api):
        resp = api.get(URL, ctx['tokens']['admin'], ctx['school'].id)
        assert resp.status_code == 400

    def test_student_ids_narrow_the_list(self, ctx, api):
        other = ctx['students'][1]
        pay(ctx, 'MONTHLY', 3, '1000', '0', base='1000')
        pay(ctx, 'MONTHLY', 3, '1000', '0', base='1000', student=other)
        resp = api.get(f'{URL}?month=3&year=2026&student_ids={other.id}', ctx['tokens']['admin'], ctx['school'].id)
        assert resp['X-Voucher-Count'] == '1'

    def test_staff_cannot_print(self, ctx, api):
        resp = api.get(f'{URL}?month=3&year=2026', ctx['tokens']['staff'], ctx['school'].id)
        assert resp.status_code == 403


class TestVoucherSettings:
    def test_defaults(self, ctx, api):
        resp = api.get(SETTINGS_URL, ctx['tokens']['admin'], ctx['school'].id)
        assert resp.status_code == 200
        body = resp.json()
        assert body['due_day'] == 10 and body['voucher_bank_account_id'] is None
        assert body['kuickpay_enabled'] is False

    def put(self, ctx, api, data, user='admin'):
        return api.client.put(
            SETTINGS_URL, data, content_type='application/json',
            HTTP_AUTHORIZATION=f"Bearer {ctx['tokens'][user]}", HTTP_X_SCHOOL_ID=str(ctx['school'].id),
        )

    def test_admin_sets_due_day_and_kuickpay_follows(self, ctx, api):
        bank = Account.objects.create(school=ctx['school'], name='HBL', account_type='BANK')
        biller = KuickpayBiller.objects.create(name='K', prefix='12345', mode='UAT', is_enabled=True)
        mapping = KuickpaySchoolMapping.objects.create(school=ctx['school'], biller=biller, settlement_account=bank)
        resp = self.put(ctx, api, {'due_day': 20, 'voucher_bank_account_id': bank.id, 'voucher_note': 'Late fee Rs 200'})
        assert resp.status_code == 200, resp.content
        assert resp.json()['due_day'] == 20
        mapping.refresh_from_db()
        assert mapping.due_day == 20
        ctx['school'].refresh_from_db()
        assert ctx['school'].finance_config['voucher_bank_account_id'] == bank.id

    def test_rejects_bad_values(self, ctx, api):
        assert self.put(ctx, api, {'due_day': 31}).status_code == 400
        cash = ctx['cash']
        assert self.put(ctx, api, {'voucher_bank_account_id': cash.id}).status_code == 400
        other_bank = Account.objects.create(school=ctx['school_b'], name='B', account_type='BANK')
        assert self.put(ctx, api, {'voucher_bank_account_id': other_bank.id}).status_code == 400

    def test_finance_manager_reads_but_cannot_change(self, ctx, api):
        assert api.get(SETTINGS_URL, ctx['tokens']['finance_manager'], ctx['school'].id).status_code == 200
        assert self.put(ctx, api, {'due_day': 5}, user='finance_manager').status_code == 403


class TestVoucherPreviewAndDueDate:
    def test_json_preview_and_due_date_override(self, ctx, api):
        pay(ctx, 'MONTHLY', 3, '1000', '0', base='1000')
        resp = api.get(f'{URL}?month=3&year=2026&format=json&due_date=2026-03-20', ctx['tokens']['admin'], ctx['school'].id)
        assert resp.status_code == 200, resp.content
        body = resp.json()
        assert body['count'] == 1 and body['vouchers'][0]['due_date'] == '2026-03-20'
        assert Decimal(body['vouchers'][0]['total_payable']) == Decimal('1000')
        assert api.get(f'{URL}?month=3&year=2026&due_date=bad', ctx['tokens']['admin'], ctx['school'].id).status_code == 400
