"""Expenses and other income through the assistant: list, add (preview -> approve), edit, delete.
The finance API is real; only the model is mocked."""
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.utils import timezone

from assistant import engine, registry
from assistant.models import AgentAction, AgentConversation

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _all_agents_offered():
    with patch('assistant.router.pick_agents', lambda by_agent, message, recent=(): list(by_agent)):
        yield


@pytest.fixture
def books(seed_data):
    from finance.models import Account, ExpenseCategory, IncomeCategory

    school = seed_data['school_a']
    school.enabled_modules = {**(school.enabled_modules or {}), 'finance': True}
    school.save(update_fields=['enabled_modules'])
    org = school.organization
    org.allowed_modules = {**(org.allowed_modules or {}), 'finance': True}
    org.save(update_fields=['allowed_modules'])
    cash = Account.objects.create(school=school, organization=org, name='Cash Box', opening_balance=Decimal('10000'))
    cats = {n: ExpenseCategory.objects.create(school=school, name=n) for n in ('Utilities', 'Stationery', 'Salary')}
    sensitive = ExpenseCategory.objects.create(school=school, name='Legal', is_sensitive=True)
    inc = {n: IncomeCategory.objects.create(school=school, name=n) for n in ('Donation', 'Book Sale')}
    return {'cash': cash, 'cats': cats, 'sensitive': sensitive, 'inc': inc}


def _ctx(seed, uname='admin'):
    user = seed['users'][uname]
    return registry.ToolContext(user=user, school_id=seed['SID_A'], role=user.role)


def _run(seed, tool, uname='admin', **args):
    ctx = _ctx(seed, uname)
    ctx.conversation = AgentConversation.objects.create(school_id=ctx.school_id, user=ctx.user)
    return registry.execute(ctx, tool, args)


def _card(out):
    return AgentAction.objects.get(pk=out['proposal']['action_id'])


def _approve(seed, card, uname='admin'):
    return engine.approve(card.id, seed['users'][uname], seed['SID_A'])


def _balance(seed, books):
    from assistant.skills.finance_writes import _accounts
    return next(a for a in _accounts(_ctx(seed)) if a['id'] == books['cash'].id)['balance']


E = [{'amount': 5000, 'description': 'Electricity bill', 'category_name': 'Utilities'}]


class TestAddExpense:
    def test_proposing_saves_nothing_and_previews_the_balance(self, seed_data, books):
        from finance.models import Expense
        card = _card(_run(seed_data, 'record_expenses', entries=E, account_id=books['cash'].id))
        assert Expense.objects.count() == 0
        pv = card.preview
        assert pv['totals'] == {'count': 1, 'amount': 5000.0} and pv['rows'][0]['category'] == 'Utilities'
        assert pv['account']['balance_before'] == 10000.0 and pv['account']['balance_after'] == 5000.0

    def test_approve_records_it_and_the_balance_drops(self, seed_data, books):
        from finance.models import Expense
        card = _card(_run(seed_data, 'record_expenses', entries=E, account_id=books['cash'].id))
        done = _approve(seed_data, card)
        assert done.status == 'executed' and done.result['created'] == 1 and done.result['total'] == 5000.0
        e = Expense.objects.get()
        assert (e.amount, e.category.name, e.date, e.account_id) == (Decimal('5000.00'), 'Utilities', timezone.localdate(), books['cash'].id)
        assert e.recorded_by_id == seed_data['users']['admin'].id
        assert _balance(seed_data, books) == Decimal('5000')

    def test_several_entries_one_card(self, seed_data, books):
        entries = E + [{'amount': 1200, 'description': 'Markers', 'category_name': 'stationery', 'date': '2026-01-05'}]
        card = _card(_run(seed_data, 'record_expenses', entries=entries, account_id=books['cash'].id))
        assert card.preview['totals']['amount'] == 6200.0 and {r['category'] for r in card.preview['rows']} == {'Utilities', 'Stationery'}
        _approve(seed_data, card)
        from finance.models import Expense
        assert Expense.objects.count() == 2 and Expense.objects.filter(date=date(2026, 1, 5)).exists()

    def test_misspelled_category_still_matches(self, seed_data, books):
        card = _card(_run(seed_data, 'record_expenses', account_id=books['cash'].id,
                          entries=[{'amount': 10, 'description': 'x', 'category_name': 'Utilites'}]))
        assert card.preview['rows'][0]['category'] == 'Utilities'

    def test_unknown_category_lists_the_options(self, seed_data, books):
        out = _run(seed_data, 'record_expenses', account_id=books['cash'].id, entries=[{'amount': 10, 'description': 'x', 'category_name': 'Pizza'}])
        assert 'Utilities' in out['error'] and 'Stationery' in out['error']

    def test_missing_category_asks(self, seed_data, books):
        out = _run(seed_data, 'record_expenses', account_id=books['cash'].id, entries=[{'amount': 10, 'description': 'x'}])
        assert 'Which category' in out['error']

    def test_missing_account_with_several_asks(self, seed_data, books):
        from finance.models import Account
        Account.objects.create(school=seed_data['school_a'], organization=seed_data['org'], name='Bank', account_type='BANK')
        assert 'Which account' in _run(seed_data, 'record_expenses', entries=E)['error']

    def test_single_account_is_used_automatically(self, seed_data, books):
        assert _card(_run(seed_data, 'record_expenses', entries=E)).preview['account']['name'] == 'Cash Box'

    @pytest.mark.parametrize('amount', [0, -5, 'abc'])
    def test_bad_amounts_are_refused(self, seed_data, books, amount):
        out = _run(seed_data, 'record_expenses', account_id=books['cash'].id,
                   entries=[{'amount': amount, 'description': 'x', 'category_name': 'Utilities'}])
        assert 'error' in out

    def test_closed_month_is_refused_before_a_card_exists(self, seed_data, books):
        from finance.models import MonthlyClosing
        d = timezone.localdate()
        MonthlyClosing.objects.create(school=seed_data['school_a'], year=d.year, month=d.month, closed_by=seed_data['users']['admin'])
        out = _run(seed_data, 'record_expenses', entries=E, account_id=books['cash'].id)
        assert 'closed' in out['error'] and AgentAction.objects.count() == 0

    def test_future_date_warns(self, seed_data, books):
        card = _card(_run(seed_data, 'record_expenses', entries=E, account_id=books['cash'].id, date='2099-01-01'))
        assert any('future' in w for w in card.preview['warnings'])

    def test_no_entries_asks(self, seed_data, books):
        assert 'Ask the user' in _run(seed_data, 'record_expenses')['error']

    def test_edit_card_amount_category_account_and_remove(self, seed_data, books):
        from finance.models import Account, Expense
        bank = Account.objects.create(school=seed_data['school_a'], organization=seed_data['org'], name='Bank', account_type='BANK')
        card = _card(_run(seed_data, 'record_expenses', account_id=books['cash'].id,
                          entries=E + [{'amount': 100, 'description': 'Pens', 'category_name': 'Stationery'}]))
        edited = engine.edit(card.id, seed_data['users']['admin'], seed_data['SID_A'],
                             {'amounts': {'1': '4500'}, 'categories': {'1': 'Salary'}, 'account_id': bank.id, 'remove_keys': ['2']})
        assert edited.preview['totals'] == {'count': 1, 'amount': 4500.0} and edited.preview['rows'][0]['category'] == 'Salary'
        assert edited.preview['account']['name'] == 'Bank'
        _approve(seed_data, edited)
        e = Expense.objects.get()
        assert (e.amount, e.category.name, e.account_id) == (Decimal('4500.00'), 'Salary', bank.id)

    @pytest.mark.parametrize('edits', [{'amounts': {'9': '1'}}, {'amounts': {'1': '-3'}}, {'categories': {'1': 'Pizza'}},
                                       {'dates': {'1': 'soon'}}, {'account_id': 999999}])
    def test_bad_edits_keep_the_card(self, seed_data, books, edits):
        card = _card(_run(seed_data, 'record_expenses', entries=E, account_id=books['cash'].id))
        with pytest.raises(engine.ActionError):
            engine.edit(card.id, seed_data['users']['admin'], seed_data['SID_A'], edits)
        card.refresh_from_db()
        assert card.status == 'pending' and card.preview['totals']['amount'] == 5000.0

    def test_month_closed_while_the_card_is_open_blocks_the_write(self, seed_data, books):
        from finance.models import Expense, MonthlyClosing
        card = _card(_run(seed_data, 'record_expenses', entries=E, account_id=books['cash'].id))
        d = timezone.localdate()
        MonthlyClosing.objects.create(school=seed_data['school_a'], year=d.year, month=d.month, closed_by=seed_data['users']['admin'])
        with pytest.raises(engine.ActionError) as exc:
            _approve(seed_data, card)
        assert exc.value.status == 409 and Expense.objects.count() == 0

    def test_sensitive_flag_is_saved(self, seed_data, books):
        from finance.models import Expense
        card = _card(_run(seed_data, 'record_expenses', entries=E, account_id=books['cash'].id, is_sensitive=True))
        _approve(seed_data, card)
        assert Expense.objects.get().is_sensitive


class TestAddIncome:
    def test_donation_raises_the_balance(self, seed_data, books):
        from finance.models import OtherIncome
        card = _card(_run(seed_data, 'record_other_income', account_id=books['cash'].id,
                          entries=[{'amount': 2500, 'description': 'Annual day donation', 'category_name': 'donation'}]))
        assert card.preview['account']['balance_after'] == 12500.0
        _approve(seed_data, card)
        assert OtherIncome.objects.get().amount == Decimal('2500.00') and _balance(seed_data, books) == Decimal('12500')

    def test_income_categories_are_separate_from_expense_categories(self, seed_data, books):
        out = _run(seed_data, 'record_other_income', account_id=books['cash'].id,
                   entries=[{'amount': 1, 'description': 'x', 'category_name': 'Utilities'}])
        assert 'No income category' in out['error'] and 'Donation' in out['error']


class TestRoles:
    def test_only_admins_and_principals_get_the_write_tools(self, seed_data, books):
        writes = {'record_expenses', 'record_other_income', 'edit_finance_entry', 'delete_finance_entries'}
        for uname, expected in [('admin', True), ('principal', True), ('accountant', False), ('teacher', False), ('staff', False)]:
            names = {t.name for t in registry.tools_for(_ctx(seed_data, uname))}
            assert (writes <= names) is expected, uname

    def test_accountant_can_read_but_not_propose(self, seed_data, books):
        assert 'data' in _run(seed_data, 'list_expenses', 'accountant')
        assert _run(seed_data, 'record_expenses', 'accountant', entries=E)['error'].startswith('You do not have permission')

    def test_principal_never_sees_sensitive_categories_or_entries(self, seed_data, books):
        from finance.models import Expense
        Expense.objects.create(school=seed_data['school_a'], category=books['sensitive'], amount=900, date=timezone.localdate(),
                               description='lawyer', recorded_by=seed_data['users']['admin'], account=books['cash'], is_sensitive=True)
        admin_list = _run(seed_data, 'list_expenses')['data']
        principal_list = _run(seed_data, 'list_expenses', 'principal')['data']
        assert admin_list['count'] == 1 and principal_list['count'] == 0
        out = _run(seed_data, 'record_expenses', 'principal', account_id=books['cash'].id,
                   entries=[{'amount': 1, 'description': 'x', 'category_name': 'Legal'}])
        assert 'No expense category' in out['error']


class TestListEditDelete:
    def _expense(self, seed, books, amount=700, description='Chalk', cat='Stationery', d=None):
        from finance.models import Expense
        return Expense.objects.create(school=seed['school_a'], category=books['cats'][cat], amount=amount, date=d or timezone.localdate(),
                                      description=description, recorded_by=seed['users']['admin'], account=books['cash'])

    def test_list_filters_by_category_and_amount(self, seed_data, books):
        self._expense(seed_data, books)
        self._expense(seed_data, books, 5000, 'Bill', 'Utilities')
        out = _run(seed_data, 'list_expenses', category_name='Utilities')['data']
        assert out['count'] == 1 and out['entries'][0]['description'] == 'Bill'
        assert len(_run(seed_data, 'list_expenses', min_amount=1000)['data']['entries']) == 1

    def test_list_income(self, seed_data, books):
        from finance.models import OtherIncome
        OtherIncome.objects.create(school=seed_data['school_a'], category=books['inc']['Donation'], amount=300, date=timezone.localdate(),
                                   description='gift', recorded_by=seed_data['users']['admin'], account=books['cash'])
        assert _run(seed_data, 'list_other_income')['data']['entries'][0]['description'] == 'gift'

    def test_edit_shows_before_and_after_then_changes_only_that_entry(self, seed_data, books):
        from finance.models import Expense
        e = self._expense(seed_data, books)
        other = self._expense(seed_data, books, 50, 'Tape')
        card = _card(_run(seed_data, 'edit_finance_entry', entry_kind='expense', entry_id=e.id, amount=650, description='Chalk (box)'))
        fields = {r['field']: (r['from'], r['to']) for r in card.preview['rows']}
        assert fields['amount'] == (700.0, 650.0) and fields['description'] == ('Chalk', 'Chalk (box)')
        assert card.preview['effect_on_balance'] == 50.0                      # an expense going down gives money back
        assert Expense.objects.get(pk=e.pk).amount == 700
        done = _approve(seed_data, card)
        assert done.status == 'executed'
        e.refresh_from_db()
        other.refresh_from_db()
        assert (e.amount, e.description, other.amount) == (Decimal('650.00'), 'Chalk (box)', Decimal('50.00'))

    def test_edit_in_the_card_changes_the_value(self, seed_data, books):
        e = self._expense(seed_data, books)
        card = _card(_run(seed_data, 'edit_finance_entry', entry_kind='expense', entry_id=e.id, amount=650))
        edited = engine.edit(card.id, seed_data['users']['admin'], seed_data['SID_A'], {'amount': '640'})
        _approve(seed_data, edited)
        e.refresh_from_db()
        assert e.amount == Decimal('640.00')

    def test_edit_with_nothing_to_change_asks(self, seed_data, books):
        e = self._expense(seed_data, books)
        assert 'Nothing to change' in _run(seed_data, 'edit_finance_entry', entry_kind='expense', entry_id=e.id)['error']

    def test_edit_in_a_closed_month_is_refused(self, seed_data, books):
        from finance.models import MonthlyClosing
        e = self._expense(seed_data, books)
        MonthlyClosing.objects.create(school=seed_data['school_a'], year=e.date.year, month=e.date.month, closed_by=seed_data['users']['admin'])
        assert 'closed' in _run(seed_data, 'edit_finance_entry', entry_kind='expense', entry_id=e.id, amount=1)['error']

    def test_delete_lists_then_removes_after_approval(self, seed_data, books):
        from finance.models import Expense
        a, b = self._expense(seed_data, books), self._expense(seed_data, books, 40, 'Tape')
        card = _card(_run(seed_data, 'delete_finance_entries', entry_kind='expense', ids=[a.id, b.id]))
        assert card.preview['totals'] == {'count': 2, 'amount': 740.0} and Expense.objects.count() == 2
        edited = engine.edit(card.id, seed_data['users']['admin'], seed_data['SID_A'], {'remove_ids': [b.id]})
        done = _approve(seed_data, edited)
        assert done.status == 'executed' and done.result['deleted'] == 1
        assert list(Expense.objects.values_list('id', flat=True)) == [b.id]

    def test_delete_unknown_ids_is_nothing_to_delete(self, seed_data, books):
        assert 'Nothing to delete' in _run(seed_data, 'delete_finance_entries', entry_kind='expense', ids=[99999])['error']

    def test_delete_needs_kind_and_ids(self, seed_data, books):
        assert 'Which entries' in _run(seed_data, 'delete_finance_entries')['error']

    def test_delete_in_a_closed_month_fails_and_keeps_the_row(self, seed_data, books):
        from finance.models import Expense, MonthlyClosing
        e = self._expense(seed_data, books)
        card = _card(_run(seed_data, 'delete_finance_entries', entry_kind='expense', ids=[e.id]))
        MonthlyClosing.objects.create(school=seed_data['school_a'], year=e.date.year, month=e.date.month, closed_by=seed_data['users']['admin'])
        done = _approve(seed_data, card)
        assert done.status == 'failed' and Expense.objects.count() == 1

    def test_delete_income(self, seed_data, books):
        from finance.models import OtherIncome
        i = OtherIncome.objects.create(school=seed_data['school_a'], category=books['inc']['Donation'], amount=300, date=timezone.localdate(),
                                       description='gift', recorded_by=seed_data['users']['admin'], account=books['cash'])
        card = _card(_run(seed_data, 'delete_finance_entries', entry_kind='income', ids=[i.id]))
        _approve(seed_data, card)
        assert OtherIncome.objects.count() == 0

    def test_other_school_entries_are_invisible(self, seed_data, books):
        from finance.models import Account, Expense, ExpenseCategory
        beta = seed_data['school_b']
        cat = ExpenseCategory.objects.create(school=beta, name='Utilities')
        acc = Account.objects.create(school=beta, organization=seed_data['org'], name='Beta cash')
        foreign = Expense.objects.create(school=beta, category=cat, amount=5, date=timezone.localdate(), description='x',
                                         recorded_by=seed_data['users']['admin_b'], account=acc)
        assert 'Nothing to delete' in _run(seed_data, 'delete_finance_entries', entry_kind='expense', ids=[foreign.id])['error']
