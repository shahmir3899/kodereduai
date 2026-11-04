"""Kuickpay BPS Integration Guide v3.2: field formats, parsing and response bodies.

Everything here comes from the guide (docs/KUICKPAY_TECHNICAL_ASSESSMENT.md §0A). Where the guide is
silent or contradicts itself, the choice is isolated here and marked with its question id so it is a
one-line change once Kuickpay answers:

* K-24  request field names appear in camelCase in the tables and snake_case in the examples, so both
        are accepted;
* K-25  the unit of ``transaction_amount`` is not stated, so it comes from configuration and payments
        are refused until it is set;
* K-9   the time zone of ``tran_date``/``tran_time`` is not stated; it is configurable.
"""
import re
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

# Response codes (guide, "Response Codes Summary").
OK = '00'
NOT_FOUND = '01'
BLOCKED = '02'
DUPLICATE = '03'
INVALID = '04'
SERVER_ERROR = '05'

# bill_status values.
UNPAID = 'U'
PAID = 'P'

CONSUMER_DETAIL_MAX = 30
EMAIL_MAX = 30


class ContractError(ValueError):
    """The request is not valid under the guide; the caller answers code 04."""


@dataclass(frozen=True)
class InquiryRequest:
    consumer_number: str
    bank_mnemonic: str


@dataclass(frozen=True)
class PaymentRequest:
    consumer_number: str
    tran_auth_id: str
    amount: Decimal
    tran_date: date
    tran_time: time
    tran_at: object            # aware datetime (UTC) or None
    bank_mnemonic: str
    raw: dict


_ALIASES = {
    'consumer_number': ('consumer_number', 'consumerNumber', 'consumer_Number'),
    'bank_mnemonic': ('bank_mnemonic', 'bankMnemonic', 'bank_Mnemonic'),
    'tran_auth_id': ('tran_auth_id', 'tranAuthId', 'tran_auth_Id'),
    'transaction_amount': ('transaction_amount', 'transactionAmount'),
    'tran_date': ('tran_date', 'tranDate'),
    'tran_time': ('tran_time', 'tranTime'),
}


def _field(data, name, *, required=True, max_len=None):
    for key in _ALIASES[name]:
        if key in data:
            value = data[key]
            break
    else:
        if required:
            raise ContractError(f'{name} is required')
        return ''
    if value is None or value == '':
        if required:
            raise ContractError(f'{name} is required')
        return ''
    if not isinstance(value, str):
        # JSON numbers would silently drop leading zeros of identifiers, so they are refused.
        raise ContractError(f'{name} must be a string')
    value = value.strip()
    if max_len is not None and len(value) > max_len:
        raise ContractError(f'{name} is too long')
    return value


def _consumer_number(data):
    value = _field(data, 'consumer_number', max_len=18)
    if not (value.isascii() and value.isdigit()):
        raise ContractError('consumer_number must be numeric')
    return value


def parse_inquiry(data):
    if not isinstance(data, dict):
        raise ContractError('body must be a JSON object')
    return InquiryRequest(
        consumer_number=_consumer_number(data),
        bank_mnemonic=_field(data, 'bank_mnemonic', required=False, max_len=8),
    )


def parse_amount(raw, unit):
    """``transaction_amount`` to a rupee Decimal. ``unit`` is 'RUPEES' or 'MINOR' (K-25); anything
    else means the unit is unconfirmed and the caller must not credit money."""
    if unit not in ('RUPEES', 'MINOR'):
        raise ContractError('amount unit is not configured')
    pattern = r'^\d+(\.\d{1,2})?$' if unit == 'RUPEES' else r'^\d+$'
    if not re.match(pattern, raw):
        raise ContractError('transaction_amount is not a valid number')
    try:
        value = Decimal(raw)
    except InvalidOperation:
        raise ContractError('transaction_amount is not a valid number')
    amount = value / Decimal(100) if unit == 'MINOR' else value
    if amount <= 0:
        raise ContractError('transaction_amount must be positive')
    return amount.quantize(Decimal('0.01'))


def parse_transaction_moment(date_s, time_s, tzname):
    """(date, time, aware UTC datetime) from ``YYYYMMDD`` and ``HHMMSS`` read in ``tzname``."""
    if not (re.match(r'^\d{8}$', date_s) and re.match(r'^\d{6}$', time_s)):
        raise ContractError('tran_date/tran_time format')
    try:
        day = datetime.strptime(date_s, '%Y%m%d').date()
        clock = datetime.strptime(time_s, '%H%M%S').time()
    except ValueError:
        raise ContractError('tran_date/tran_time value')
    local = datetime.combine(day, clock).replace(tzinfo=ZoneInfo(tzname))
    return day, clock, local.astimezone(ZoneInfo('UTC'))


def parse_payment(data, *, amount_unit, tzname):
    if not isinstance(data, dict):
        raise ContractError('body must be a JSON object')
    consumer_number = _consumer_number(data)
    tran_auth_id = _field(data, 'tran_auth_id', max_len=6)
    if not re.match(r'^\d{6}$', tran_auth_id):
        raise ContractError('tran_auth_id must be 6 digits')
    day, clock, tran_at = parse_transaction_moment(
        _field(data, 'tran_date'), _field(data, 'tran_time'), tzname,
    )
    bank = _field(data, 'bank_mnemonic', max_len=8)
    amount = parse_amount(_field(data, 'transaction_amount'), amount_unit)
    safe_raw = {k: v for k, v in data.items() if isinstance(k, str) and k.lower() not in ('username', 'password')}
    return PaymentRequest(consumer_number, tran_auth_id, amount, day, clock, tran_at, bank, safe_raw)


# ── Formatting ──────────────────────────────────────────────────────────────────────

def amount_an14(amount):
    """Sign + 13 digits, last two minor units: Rs 120.00 -> ``+0000000012000``."""
    minor = int((Decimal(amount) * 100).quantize(Decimal('1')))
    return ('-' if minor < 0 else '+') + str(abs(minor)).zfill(13)


def amount_12(amount):
    """12 digits, no sign, last two minor units: Rs 120.00 -> ``000000012000``."""
    return str(int((Decimal(amount) * 100).quantize(Decimal('1')))).zfill(12)


def receipt_id(transaction_pk):
    """``Identification_parameter``: numeric, 20 digits, left padded with zeros."""
    return str(transaction_pk).zfill(20)


def _alphanumeric_words(text):
    """Words made of ASCII letters and digits only: Kuickpay's consumer_Detail takes no symbols."""
    cleaned = ''.join(ch if ch.isascii() and ch.isalnum() else ' ' for ch in (text or ''))
    return cleaned.split()


def mask_name(name):
    """'Muhammad Affan' -> 'M A' (initials only: no symbols, and the child's name is not printed)."""
    return ' '.join(w[0].upper() for w in _alphanumeric_words(name))


def consumer_detail(student_name, school_name):
    """Student initials plus the school name: letters, digits and single spaces, within 30 characters.

    Kuickpay's own testing flagged special characters here (the old asterisk mask and ' | '
    separator, and symbols inside school names such as 'School - Branch 2').
    """
    initials = mask_name(student_name)
    school = ' '.join(_alphanumeric_words(school_name))
    text = f'{initials} {school}' if initials and school else initials or school
    cut = text[:CONSUMER_DETAIL_MAX]
    # Drop a word the limit would cut in half ("Montessori and S") rather than print a fragment.
    if len(text) > CONSUMER_DETAIL_MAX and text[CONSUMER_DETAIL_MAX] != ' ' and ' ' in cut:
        cut = cut.rsplit(' ', 1)[0]
    return cut.rstrip()


def contact_number(raw_phone):
    """Digits only, normalised to start with 92 or 03; '' when the phone cannot satisfy the guide."""
    digits = ''.join(ch for ch in (raw_phone or '') if ch.isdigit())
    if digits.startswith('0092'):
        digits = digits[2:]
    return digits if digits.startswith(('92', '03')) else ''


def due_date_string(year, month, due_day):
    return f'{year:04d}{month:02d}{min(due_day, 28):02d}'


def billing_month_string(year, month):
    return f'{year % 100:02d}{month:02d}'


# ── Response bodies (keys and casing exactly as in the guide's examples) ───────────────────────

AUTH_FAILURE = {'response_Code': INVALID, 'message': 'Invalid username or password.'}


def inquiry_not_found():
    return {'response_Code': NOT_FOUND, 'reserved': 'Voucher not Found.'}


def inquiry_blocked():
    return {'response_Code': BLOCKED, 'message': 'Voucher is blocked or dormant. Transactions not allowed.'}


def invalid_data(message='Invalid data.'):
    return {'response_Code': INVALID, 'reserved': message}


def server_error():
    return {'response_Code': SERVER_ERROR, 'reserved': 'Server error.'}


def inquiry_found(*, detail, status, due_date, amount, email, contact, billing_month,
                  date_paid='', amount_paid='', tran_auth_id=''):
    return {
        'response_Code': OK,
        'consumer_Detail': detail,
        'bill_status': status,
        'due_date': due_date,
        'amount_within_dueDate': amount_an14(amount),
        'amount_after_dueDate': amount_an14(amount),
        'email_address': email,
        'contact_number': contact,
        'billing_month': billing_month,
        'date_paid': date_paid,
        'amount_paid': amount_paid,
        'tran_auth_Id': tran_auth_id,
        'reserved': '',
    }


def payment_ok(transaction_pk):
    return {'response_Code': OK, 'Identification_parameter': receipt_id(transaction_pk), 'reserved': ''}


def payment_duplicate():
    return {'response_Code': DUPLICATE, 'reserved': 'Duplicate Transaction.'}


def payment_mismatch():
    return {'response_Code': INVALID, 'reserved': 'Mismatched Transaction Data.'}


def payment_blocked():
    return {'response_Code': BLOCKED, 'reserved': 'Voucher is blocked. Payment not allowed.'}
