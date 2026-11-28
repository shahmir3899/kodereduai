"""Aura and the fee system of 2026-11-26: per-fee discounts, optional (enrolled-only) fees, fee generation,
the per-fee breakdown and vouchers. No model is reached; tools are called directly."""
from datetime import date
from decimal import Decimal

import pytest
from django.utils import timezone

from assistant import engine, registry
from assistant.models import AgentAction, AgentConversation
from assistant.skills import load_all

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _tools():
    load_all()


@pytest.fixture
def fees(seed_data):
    from finance.models import Account, FeeStructure, MonthlyFeeCategory

    school, org = seed_data['school_a'], seed_data['org']
    school.enabled_modules = {**(school.enabled_modules or {}), 'finance': True}
    school.save(update_fields=['enabled_modules'])
    org.allowed_modules = {**(org.allowed_modules or {}), 'finance': True}
    org.save(update_fields=['allowed_modules'])
    tuition = MonthlyFeeCategory.objects.create(school=school, name='Tuition Fee')
    koder = MonthlyFeeCategory.objects.create(school=school, name='Koder Kids', billing_mode='ENROLLED', default_amount=Decimal('1500'))
    students = [s for s in seed_data['students'] if s.school_id == school.id][:3]
    for st in students:
        FeeStructure.objects.create(school=school, student=st, fee_type='MONTHLY', monthly_category=tuition,
                                    monthly_amount=Decimal('3000'), effective_from=date(2024, 1, 1))
    bank = Account.objects.create(school=school, name='HBL Main', account_type='BANK', bank_name='HBL')
    return {'school': school, 'tuition': tuition, 'koder': koder, 'students': students, 'bank': bank}


def _run(seed_data, tool, role='admin', **args):
    user = seed_data['users'][role]
    ctx = registry.ToolContext(user=user, school_id=user.school_id, role=user.role)
    ctx.conversation = AgentConversation.objects.create(school_id=ctx.school_id, user=user)
    return registry.execute(ctx, tool, args)


def _approve(seed_data, out):
    user = seed_data['users']['admin']
    return engine.approve(out['proposal']['action_id'], user, user.school_id)


def _card(out):
    return AgentAction.objects.get(pk=out['proposal']['action_id']).preview


class TestDiscountFeeTypes:
    def test_new_discount_must_name_its_fees(self, seed_data, fees):
        out = _run(seed_data, 'create_discount', name='Sibling 10%', discount_type='PERCENTAGE', value=10, applies_to='SIBLING')
        assert 'Which fees' in out['error']

    def test_discount_saves_the_fees_it_cuts(self, seed_data, fees):
        from finance.models import Discount
        out = _run(seed_data, 'create_discount', name='Sibling 10%', discount_type='PERCENTAGE', value=10, applies_to='SIBLING',
                   fee_names='tuition fee, koder kids')
        assert {'field': 'Applies to fees', 'from': '', 'to': 'Tuition Fee, Koder Kids'} in _card(out)['rows']
        assert _approve(seed_data, out).status == 'executed'
        d = Discount.objects.get()
        assert set(d.monthly_categories.values_list('name', flat=True)) == {'Tuition Fee', 'Koder Kids'}

    def test_unknown_fee_lists_the_real_ones(self, seed_data, fees):
        out = _run(seed_data, 'create_discount', name='x', discount_type='FIXED', value=5, fee_names='Robotics')
        assert 'No fee called "Robotics"' in out['error'] and 'Tuition Fee' in out['error']

    def test_editing_an_old_discount_warns_it_cuts_nothing(self, seed_data, fees):
        from finance.models import Discount
        Discount.objects.create(school=fees['school'], academic_year=seed_data['academic_year'], name='Old', discount_type='FIXED', value=Decimal('100'))
        out = _run(seed_data, 'edit_discount', discount_name='Old', value=200)
        assert any('reduces no bill' in w for w in _card(out)['warnings'])

    def test_list_discounts_shows_what_each_reduces(self, seed_data, fees):
        from finance.models import Discount
        d = Discount.objects.create(school=fees['school'], academic_year=seed_data['academic_year'], name='Merit', discount_type='FIXED', value=Decimal('100'))
        d.monthly_categories.add(fees['tuition'])
        data = _run(seed_data, 'list_discounts')['data']
        assert data['discounts'][0]['reduces'] == ['Tuition Fee']


class TestFeeStructureAnswer:
    def test_no_longer_crashes_and_names_fees_and_optional_ones(self, seed_data, fees):
        from finance.models import FeeStructure
        FeeStructure.objects.create(school=fees['school'], class_obj=fees['students'][0].class_obj, fee_type='MONTHLY',
                                    monthly_category=fees['tuition'], monthly_amount=Decimal('3000'), effective_from=date(2024, 1, 1))
        data = _run(seed_data, 'get_fee_structure')['data']
        assert data['structures'][0]['fee'] == 'Tuition Fee' and data['structures'][0]['amount'] == 3000.0
        assert data['optional_fees'][0]['fee'] == 'Koder Kids' and data['optional_fees'][0]['default_price'] == 1500.0


class TestOptionalFees:
    def test_create_optional_fee(self, seed_data, fees):
        from finance.models import MonthlyFeeCategory
        out = _run(seed_data, 'create_optional_fee', name='Karate', charged='monthly', price=1000)
        assert _approve(seed_data, out).status == 'executed'
        k = MonthlyFeeCategory.objects.get(name='Karate')
        assert (k.billing_mode, k.default_amount) == ('ENROLLED', Decimal('1000.00'))

    def test_enroll_list_and_end(self, seed_data, fees):
        from finance.models import StudentFeeEnrollment
        s0, s1 = fees['students'][0], fees['students'][1]
        out = _run(seed_data, 'enroll_in_optional_fee', fee_name='koder kids', student_names=f'{s0.name}, {s1.name}', own_price=1200)
        assert len(_card(out)['rows']) == 2
        assert _approve(seed_data, out).status == 'executed'
        assert StudentFeeEnrollment.objects.filter(monthly_category=fees['koder']).count() == 2
        listed = _run(seed_data, 'list_optional_fees')['data']['optional_fees'][0]
        assert listed['enrolled_count'] == 2 and listed['students'][0]['own_price'] == 1200.0
        out = _run(seed_data, 'end_optional_fee', fee_name='Koder Kids', student_names=s0.name)
        assert _approve(seed_data, out).status == 'executed'
        assert StudentFeeEnrollment.objects.get(student=s0).end_date == timezone.localdate()

    def test_cannot_enroll_in_a_fee_everyone_pays(self, seed_data, fees):
        out = _run(seed_data, 'enroll_in_optional_fee', fee_name='Tuition Fee', student_names=fees['students'][0].name)
        assert 'paid by every student' in out['error']

    def test_only_admins_write(self, seed_data, fees):
        out = _run(seed_data, 'create_optional_fee', role='teacher', name='Chess', price=500)
        assert 'permission' in out['error']


class TestGenerateFees:
    def test_card_shows_each_fee_then_creates_records(self, seed_data, fees):
        from finance.models import FeePayment, StudentFeeEnrollment
        s0 = fees['students'][0]
        StudentFeeEnrollment.objects.create(school=fees['school'], student=s0, monthly_category=fees['koder'], start_date=date(2025, 1, 1))
        out = _run(seed_data, 'generate_fees', fee_names='Tuition Fee, Koder Kids', month=3, year=2026)
        rows = {r['field']: r for r in _card(out)['rows']}
        assert rows['Koder Kids']['from'].startswith('1 of ') and rows['Koder Kids']['to'].startswith('1 new, Rs 1,500')
        assert rows['Tuition Fee']['to'].startswith('3 new')
        assert not FeePayment.objects.filter(month=3, year=2026).exists()
        assert _approve(seed_data, out).status == 'executed'
        assert FeePayment.objects.filter(month=3, year=2026, monthly_category=fees['koder']).count() == 1
        assert FeePayment.objects.filter(month=3, year=2026, monthly_category=fees['tuition']).count() == 3

    def test_monthly_and_annual_are_not_mixed(self, seed_data, fees):
        from finance.models import AnnualFeeCategory
        AnnualFeeCategory.objects.create(school=fees['school'], name='Admission')
        out = _run(seed_data, 'generate_fees', fee_names='Tuition Fee, Admission', month=3, year=2026)
        assert 'generated separately' in out['error']


class TestBreakdownAndVouchers:
    def test_breakdown_lists_paid_fees_with_discount(self, seed_data, fees):
        from finance.models import Discount, StudentDiscount
        s0 = fees['students'][0]
        d = Discount.objects.create(school=fees['school'], academic_year=seed_data['academic_year'], name='Sib', discount_type='PERCENTAGE', value=Decimal('10'))
        d.monthly_categories.add(fees['tuition'])
        StudentDiscount.objects.create(school=fees['school'], student=s0, discount=d, academic_year=seed_data['academic_year'])
        data = _run(seed_data, 'get_fee_breakdown', student_id=s0.id, month=3, year=2026)['data']
        tuition = next(f for f in data['fees'] if f['fee'] == 'Tuition Fee')
        assert (tuition['full_fee'], tuition['discount'], tuition['charged']) == (3000.0, 300.0, 2700.0)
        assert not any(f['fee'] == 'Koder Kids' for f in data['fees'])

    def test_vouchers_summary(self, seed_data, fees):
        from finance.models import FeePayment
        s0 = fees['students'][0]
        FeePayment.objects.create(school=fees['school'], student=s0, academic_year=seed_data['academic_year'], fee_type='MONTHLY',
                                  monthly_category=fees['tuition'], month=3, year=2026, amount_due=Decimal('3000'),
                                  base_monthly_fee=Decimal('3000'), amount_paid=0)
        data = _run(seed_data, 'get_fee_vouchers', month=3, year=2026, due_date='2026-03-20')['data']
        assert data['vouchers'] == 1 and data['first'][0]['due_date'] == '2026-03-20'
        assert 'Print Vouchers' in data['how_to_print']

    def test_voucher_settings_card(self, seed_data, fees):
        out = _run(seed_data, 'set_voucher_settings', due_day=15, bank_account_name='hbl')
        assert _approve(seed_data, out).status == 'executed'
        fees['school'].refresh_from_db()
        assert fees['school'].finance_config['due_day'] == 15
        assert fees['school'].finance_config['voucher_bank_account_id'] == fees['bank'].id
