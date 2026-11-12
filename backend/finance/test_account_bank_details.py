"""Bank name, account number and IBAN on accounts: saved, validated, and shown only to the people who run the books."""
import pytest

from finance.models import Account

pytestmark = pytest.mark.django_db

URL = '/api/finance/accounts/'


def _token(api, seed_data, who):
    return api.login(f"{seed_data['prefix']}{who}")


@pytest.fixture
def bank(seed_data):
    return Account.objects.create(
        school=seed_data['school_a'], name='Kuickpay Settlement', account_type=Account.AccountType.BANK,
        bank_name='HBL', account_title='Focus Montessori Branch 2', account_number='0123-4567 8901', iban='PK36 HABB 0000 0123 4567 8901',
    )


def _row(api, seed_data, who, account):
    response = api.get(URL, _token(api, seed_data, who), seed_data['school_a'].id)
    assert response.status_code == 200
    body = response.json()
    rows = body['results'] if isinstance(body, dict) else body
    return next(r for r in rows if r['id'] == account.id)


@pytest.mark.parametrize('who', ['admin', 'principal', 'finance_manager'])
def test_the_people_who_run_the_books_see_the_full_details(api, seed_data, bank, who):
    row = _row(api, seed_data, who, bank)
    assert (row['bank_name'], row['account_title'], row['account_number'], row['iban']) == (
        'HBL', 'Focus Montessori Branch 2', '0123-4567 8901', 'PK36 HABB 0000 0123 4567 8901')


@pytest.mark.parametrize('who', ['teacher', 'staff', 'manager'])
def test_other_roles_see_the_bank_name_but_never_the_title_number_or_iban(api, seed_data, bank, who):
    response = api.safe_get(URL, _token(api, seed_data, who), seed_data['school_a'].id)
    if response.status_code != 200:
        pytest.skip(f'{who} cannot list accounts in this setup')
    body = response.json()
    rows = body['results'] if isinstance(body, dict) else body
    for row in rows:
        assert 'account_title' not in row and 'account_number' not in row and 'iban' not in row
        assert 'bank_name' in row


def test_an_account_created_without_bank_details_has_them_blank(api, seed_data):
    response = api.post(URL, {'name': 'Petty Cash', 'account_type': 'CASH', 'opening_balance': 0},
                        _token(api, seed_data, 'admin'), seed_data['school_a'].id)
    assert response.status_code == 201
    account = Account.objects.get(pk=response.json()['id']) if 'id' in response.json() else Account.objects.get(name='Petty Cash')
    assert (account.bank_name, account.account_number, account.iban) == ('', '', '')


def test_bank_details_can_be_created_and_then_edited(api, seed_data):
    token, school = _token(api, seed_data, 'admin'), seed_data['school_a'].id
    created = api.post(URL, {'name': 'Meezan', 'account_type': 'BANK', 'opening_balance': 0,
                             'bank_name': 'Meezan Bank', 'account_number': '99887766'}, token, school)
    assert created.status_code == 201
    account = Account.objects.get(name='Meezan', school=seed_data['school_a'])
    assert (account.bank_name, account.account_number) == ('Meezan Bank', '99887766')
    edited = api.patch(f'{URL}{account.id}/', {'iban': 'PK36 MEZN 0001 2345 6789'}, token, school)
    assert edited.status_code == 200
    account.refresh_from_db()
    assert account.iban == 'PK36 MEZN 0001 2345 6789' and account.account_number == '99887766'


@pytest.mark.parametrize('field', ['account_number', 'iban'])
def test_symbols_and_markup_are_refused(api, seed_data, field):
    response = api.post(URL, {'name': 'Bad', 'account_type': 'BANK', 'opening_balance': 0, field: '<script>1</script>'},
                        _token(api, seed_data, 'admin'), seed_data['school_a'].id)
    assert response.status_code == 400
    assert field in response.json()
    assert not Account.objects.filter(name='Bad').exists()


def test_a_number_longer_than_the_column_is_refused(api, seed_data):
    response = api.post(URL, {'name': 'Long', 'account_type': 'BANK', 'opening_balance': 0, 'account_number': '1' * 35},
                        _token(api, seed_data, 'admin'), seed_data['school_a'].id)
    assert response.status_code == 400


def test_the_account_title_is_saved_with_a_bank_account(api, seed_data):
    token, school = _token(api, seed_data, 'admin'), seed_data['school_a'].id
    created = api.post(URL, {'name': 'Titled', 'account_type': 'BANK', 'opening_balance': 0,
                             'bank_name': 'HBL', 'account_title': 'The Focus School', 'account_number': '1234'}, token, school)
    assert created.status_code == 201
    assert Account.objects.get(name='Titled', school=seed_data['school_a']).account_title == 'The Focus School'


@pytest.mark.parametrize('kind', ['CASH', 'PERSON'])
def test_a_cash_or_person_account_cannot_hold_bank_details(api, seed_data, kind):
    response = api.post(URL, {'name': f'Not a bank {kind}', 'account_type': kind, 'opening_balance': 0, 'bank_name': 'HBL',
                              'account_title': 'T', 'account_number': '1234', 'iban': 'PK36'},
                        _token(api, seed_data, 'admin'), seed_data['school_a'].id)
    assert response.status_code == 201
    account = Account.objects.get(name=f'Not a bank {kind}', school=seed_data['school_a'])
    assert (account.bank_name, account.account_title, account.account_number, account.iban) == ('', '', '', '')


def test_switching_an_account_away_from_bank_clears_its_bank_details(api, seed_data, bank):
    response = api.patch(f'{URL}{bank.id}/', {'account_type': 'CASH'}, _token(api, seed_data, 'admin'), seed_data['school_a'].id)
    assert response.status_code == 200
    bank.refresh_from_db()
    assert (bank.bank_name, bank.account_title, bank.account_number, bank.iban) == ('', '', '', '')


def test_clearing_also_holds_for_a_save_that_names_its_fields(seed_data):
    account = Account.objects.create(school=seed_data['school_a'], name='Switch', account_type='BANK',
                                     bank_name='HBL', account_title='T', account_number='9', iban='PK1')
    account.account_type = 'PERSON'
    account.save(update_fields=['account_type'])
    account.refresh_from_db()
    assert (account.bank_name, account.account_title, account.account_number, account.iban) == ('', '', '', '')
