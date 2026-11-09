"""Finance gaps (backlog item G): student ledger, receipts, account ledger, discount / scholarship definitions. No model is reached."""
from datetime import date
from decimal import Decimal

import pytest

from assistant import engine, registry
from assistant.models import AgentAction, AgentConversation
from assistant.skills import load_all

pytestmark = pytest.mark.django_db
NO_PERMISSION = {'error': 'You do not have permission to use this tool.'}


@pytest.fixture(autouse=True)
def _tools():
    load_all()


@pytest.fixture
def fin(seed_data):
    from finance.models import Account, FeePayment

    school, org = seed_data['school_a'], seed_data['org']
    school.enabled_modules = {**(school.enabled_modules or {}), 'finance': True}
    school.save(update_fields=['enabled_modules'])
    org.allowed_modules = {**(org.allowed_modules or {}), 'finance': True}
    org.save(update_fields=['allowed_modules'])
    cash = Account.objects.create(school=school, name='Cash', account_type='CASH', opening_balance=Decimal('1000'))
    ali, sara = seed_data['students'][0], seed_data['students'][1]
    ay = seed_data['academic_year']

    def fee(student, month, due, paid, method='CASH', on=None, receipt=''):
        return FeePayment.objects.create(
            school=school, student=student, academic_year=ay, fee_type='MONTHLY', month=month, year=2025, amount_due=Decimal(due), amount_paid=Decimal(paid),
            status='PAID' if Decimal(paid) >= Decimal(due) else ('PARTIAL' if Decimal(paid) > 0 else 'UNPAID'),
            payment_date=on, payment_method=method, receipt_number=receipt, account=cash if Decimal(paid) > 0 else None)

    fee(ali, 4, '2000', '2000', on=date(2025, 4, 10), receipt='R-1')
    fee(ali, 5, '2000', '500', 'BANK_TRANSFER', on=date(2025, 5, 12), receipt='R-2')
    fee(ali, 6, '2000', '0')
    fee(sara, 4, '1500', '1500', on=date(2025, 4, 20), receipt='R-3')
    return {'cash': cash, 'ali': ali, 'sara': sara}


def _run(seed_data, tool, role='admin', **args):
    user = seed_data['users'][role]
    ctx = registry.ToolContext(user=user, school_id=user.school_id, role=user.role)
    ctx.conversation = AgentConversation.objects.create(school_id=ctx.school_id, user=user)
    return registry.execute(ctx, tool, args)


def _approve(seed_data, out):
    user = seed_data['users']['admin']
    return engine.approve(out['proposal']['action_id'], user, user.school_id)


class TestReads:
    def test_student_ledger_adds_up_and_runs(self, seed_data, fin):
        out = _run(seed_data, 'get_student_ledger', student_id=fin['ali'].id)['data']
        assert out['totals'] == {'billed': 6000.0, 'received': 2500.0, 'pending': 3500.0}
        assert [r['balance_after'] for r in out['records']] == [0.0, 1500.0, 3500.0]
        assert out['records'][0]['receipt'] == 'R-1' and out['records'][2]['paid_on'] is None
        assert out['totals']['billed'] == out['totals']['received'] + out['totals']['pending']

    def test_ledger_of_a_student_with_no_records_is_empty_not_an_error(self, seed_data, fin):
        out = _run(seed_data, 'get_student_ledger', student_id=seed_data['students'][5].id)['data']
        assert out['records'] == [] and out['totals']['billed'] == 0.0

    def test_another_schools_student_is_not_found(self, seed_data, fin):
        from students.models import Class, Student
        b = seed_data['school_b']
        klass = Class.objects.create(school=b, name='B1', section='A', grade_level=1)
        other = Student.objects.create(school=b, class_obj=klass, roll_number='1', name='Foreign Kid', is_active=True, status='ACTIVE')
        assert 'No student with id' in _run(seed_data, 'get_student_ledger', student_id=other.id)['error']

    def test_receipts_in_a_range_with_totals_and_method_split(self, seed_data, fin):
        out = _run(seed_data, 'get_receipts', date_from='2025-04-01', date_to='2025-05-31')['data']
        assert out['count'] == 3 and out['total_received'] == 4000.0
        assert out['by_method'] == {'CASH': 3500.0, 'BANK_TRANSFER': 500.0}
        assert out['receipts'][0]['receipt'] == 'R-2'                       # newest first
        only_april = _run(seed_data, 'get_receipts', date_from='2025-04-01', date_to='2025-04-30')['data']
        assert only_april['count'] == 2
        bank = _run(seed_data, 'get_receipts', date_from='2025-04-01', date_to='2025-05-31', method='bank_transfer')['data']
        assert bank['count'] == 1 and bank['receipts'][0]['student'].endswith('Ali Hassan')

    def test_receipts_for_one_student_and_a_bad_range(self, seed_data, fin):
        out = _run(seed_data, 'get_receipts', date_from='2025-04-01', date_to='2025-12-31', student_id=fin['sara'].id)['data']
        assert out['count'] == 1 and out['total_received'] == 1500.0
        assert 'before the start' in _run(seed_data, 'get_receipts', date_from='2025-05-01', date_to='2025-04-01')['error']

    def test_account_ledger_balances(self, seed_data, fin):
        out = _run(seed_data, 'get_account_ledger', account_name='Cash', date_from='2025-04-01', date_to='2025-12-31')['data']
        assert out['opening_balance'] == 1000.0 and out['total_in'] == 4000.0
        assert out['closing_balance'] == out['opening_balance'] + out['total_in'] - out['total_out'] == 5000.0
        assert {e['reference'] for e in out['entries']} == {'R-1', 'R-2', 'R-3'}

    def test_roles(self, seed_data, fin):
        assert 'data' in _run(seed_data, 'get_receipts', 'accountant', date_from='2025-04-01', date_to='2025-04-30')
        for role in ('teacher', 'staff'):
            assert _run(seed_data, 'get_student_ledger', role, student_id=fin['ali'].id) == NO_PERMISSION


class TestDefinitions:
    def test_create_discount_card_then_save_on_approval(self, seed_data, fin):
        from finance.models import Discount
        out = _run(seed_data, 'create_discount', name='Sibling 10%', discount_type='PERCENTAGE', value=10, applies_to='SIBLING')
        assert out['status'] == 'awaiting_user_approval' and not Discount.objects.exists()
        card = AgentAction.objects.get(pk=out['proposal']['action_id'])
        assert {r['field'] for r in card.preview['rows']} >= {'Name', 'Type', 'Value'}
        assert _approve(seed_data, out).status == 'executed'
        d = Discount.objects.get()
        assert (d.name, d.discount_type, d.value, d.applies_to, d.school_id) == ('Sibling 10%', 'PERCENTAGE', Decimal('10.00'), 'SIBLING', seed_data['school_a'].id)
        assert d.academic_year_id == seed_data['academic_year'].id

    def test_bad_values_are_refused_before_a_card(self, seed_data, fin):
        assert 'between 0 and 100' in _run(seed_data, 'create_discount', name='x', discount_type='PERCENTAGE', value=150)['error']
        assert 'Which class' in _run(seed_data, 'create_discount', name='x', discount_type='FIXED', value=500, applies_to='CLASS')['error']
        assert 'required' in _run(seed_data, 'create_discount', value=5)['error']
        assert 'No class matching' in _run(seed_data, 'create_discount', name='x', discount_type='FIXED', value=5, applies_to='CLASS', class_name='99Z')['error']

    def test_class_discount_uses_the_master_class(self, seed_data, fin):
        from finance.models import Discount
        master = seed_data['classes'][0]
        out = _run(seed_data, 'create_discount', name='Class 1A 500', discount_type='FIXED', value=500, applies_to='CLASS', class_name=master.name)
        _approve(seed_data, out)
        assert Discount.objects.get().target_class_id == master.id

    def test_edit_discount_warns_how_many_students_hold_it(self, seed_data, fin):
        from finance.models import Discount, StudentDiscount
        d = Discount.objects.create(school=seed_data['school_a'], academic_year=seed_data['academic_year'], name='Merit', discount_type='PERCENTAGE', value=Decimal('5'))
        StudentDiscount.objects.create(school=seed_data['school_a'], student=fin['ali'], discount=d, academic_year=seed_data['academic_year'])
        out = _run(seed_data, 'edit_discount', discount_name='Merit', value=8)
        card = AgentAction.objects.get(pk=out['proposal']['action_id'])
        assert card.preview['rows'] == [{'field': 'Value', 'from': '5.00', 'to': '8'}]
        assert '1 student already have' in card.preview['warnings'][0]
        _approve(seed_data, out)
        d.refresh_from_db()
        assert d.value == Decimal('8.00')

    def test_edit_with_no_real_change_or_unknown_name_is_refused(self, seed_data, fin):
        from finance.models import Discount
        Discount.objects.create(school=seed_data['school_a'], academic_year=seed_data['academic_year'], name='Merit', discount_type='PERCENTAGE', value=Decimal('5'))
        assert 'No discount named' in _run(seed_data, 'edit_discount', discount_name='Ghost', value=1)['error']
        assert 'Nothing to change' in _run(seed_data, 'edit_discount', discount_name='Merit')['error']

    def test_scholarship_create_and_deactivate(self, seed_data, fin):
        from finance.models import Scholarship
        out = _run(seed_data, 'create_scholarship', name='Top Scorer', scholarship_type='MERIT', coverage='PERCENTAGE', value=50, max_recipients=3)
        _approve(seed_data, out)
        s = Scholarship.objects.get()
        assert (s.coverage, s.value, s.max_recipients, s.is_active) == ('PERCENTAGE', Decimal('50.00'), 3, True)
        off = _run(seed_data, 'edit_scholarship', scholarship_name='Top Scorer', is_active=False)
        _approve(seed_data, off)
        s.refresh_from_db()
        assert s.is_active is False
        assert 'needs a value' in _run(seed_data, 'create_scholarship', name='y', scholarship_type='NEED', coverage='FIXED')['error']

    def test_only_admins_may_prepare_definitions(self, seed_data, fin):
        for role in ('accountant', 'teacher', 'manager'):
            assert _run(seed_data, 'create_discount', role, name='x', discount_type='FIXED', value=1) == NO_PERMISSION, role
