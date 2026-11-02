"""Bill Inquiry and Bill Payment endpoints against Kuickpay BPS guide v3.2 (Track B)."""
from datetime import timedelta
from decimal import Decimal
from unittest import mock
from zoneinfo import ZoneInfo

import pytest
from django.core.cache import cache
from django.db import OperationalError
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from core.school_time import school_timezone
from finance.kuickpay import contract, services
from finance.models import (
    FeePayment, KuickpayBill, KuickpayBiller, KuickpayCallbackLog, KuickpayPaymentAllocation,
    KuickpaySchoolMapping, KuickpayTransaction, MonthlyClosing,
)
from finance.test_fee_generation_regression import _gen, _row
from finance.test_kuickpay_bills import KuickpayBase
from schools.models import School

pytestmark = pytest.mark.kuickpay

USER, PASSWORD = 'kp_user', 'kp_pass_123'
PKT = ZoneInfo('Asia/Karachi')


def moment(dt):
    """(YYYYMMDD, HHMMSS) of an instant, in Kuickpay's configured zone."""
    local = dt.astimezone(PKT)
    return local.strftime('%Y%m%d'), local.strftime('%H%M%S')


@override_settings(
    KUICKPAY_ENABLED=True, KUICKPAY_USERNAME=USER, KUICKPAY_PASSWORD=PASSWORD,
    KUICKPAY_AMOUNT_UNIT='RUPEES', KUICKPAY_REQUIRE_HTTPS=False, KUICKPAY_TIMEZONE='Asia/Karachi',
)
class ApiBase(KuickpayBase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        School.objects.filter(pk=cls.school.pk).update(contact_email='office@school.pk', contact_phone='0300-1234567')
        cls.school.refresh_from_db()

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.auth = {'HTTP_USERNAME': USER, 'HTTP_PASSWORD': PASSWORD}
        self._counter = 0

    # helpers -----------------------------------------------------------------------------------
    def gen(self, *months, categories=None):
        for m in months:
            _gen(self.school, m, 2026, categories or [self.tuition])

    def bill(self, month, student=None):
        return KuickpayBill.objects.get(student_ref=(student or self.student).id, month=month, year=2026)

    def call(self, path, body, headers=None, **extra):
        return self.client.post(path, body, format='json', **(self.auth if headers is None else headers), **extra)

    def inquire(self, number, **extra):
        return self.call('/api/v1/BillInquiry', {'consumer_number': number, 'bank_mnemonic': 'KPY', 'reserved': ''}, **extra)

    def pay(self, number, amount='1000', *, when=None, auth=None, **raw):
        when = when or (timezone.now() - timedelta(minutes=1))
        day, clock = moment(when)
        if auth is None:
            self._counter += 1
            auth = f'{self._counter:06d}'
        body = {'consumer_number': number, 'tran_auth_id': auth, 'transaction_amount': amount,
                'tran_date': day, 'tran_time': clock, 'bank_mnemonic': 'KPY', 'reserved': ''}
        body.update(raw)
        return self.call('/api/v1/BillPayment', body)

    def txn(self, pk=None):
        return KuickpayTransaction.objects.get(pk=pk) if pk else KuickpayTransaction.objects.latest('id')

    def today(self):
        with school_timezone(self.school.id):
            return timezone.localdate()


class TestAuthentication(ApiBase):
    def setUp(self):
        super().setUp()
        self.gen(1)
        self.number = self.bill(1).consumer_number

    def assertAuthFailure(self, response):
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'response_Code': '04', 'message': 'Invalid username or password.'})

    def test_missing_headers(self):
        self.assertAuthFailure(self.call('/api/v1/BillInquiry', {'consumer_number': self.number}, headers={}))

    def test_wrong_username_or_password(self):
        for headers in ({'HTTP_USERNAME': 'nope', 'HTTP_PASSWORD': PASSWORD},
                        {'HTTP_USERNAME': USER, 'HTTP_PASSWORD': 'nope'}):
            self.assertAuthFailure(self.call('/api/v1/BillInquiry', {'consumer_number': self.number}, headers=headers))

    def test_credentials_in_the_body_are_not_accepted(self):
        self.assertAuthFailure(self.call(
            '/api/v1/BillInquiry', {'consumer_number': self.number, 'username': USER, 'password': PASSWORD}, headers={}))

    def test_an_unconfigured_or_disabled_integration_rejects_everything_alike(self):
        with override_settings(KUICKPAY_ENABLED=False):
            self.assertAuthFailure(self.inquire(self.number))
        with override_settings(KUICKPAY_USERNAME='', KUICKPAY_PASSWORD=''):
            self.assertAuthFailure(self.call(
                '/api/v1/BillInquiry', {'consumer_number': self.number}, headers={'HTTP_USERNAME': '', 'HTTP_PASSWORD': ''}))

    def test_a_failed_authentication_reaches_no_data(self):
        response = self.call('/api/v1/BillPayment', {'consumer_number': self.number}, headers={})
        self.assertEqual(response.json()['response_Code'], '04')
        self.assertFalse(KuickpayTransaction.objects.exists())

    def test_https_is_required_when_configured(self):
        with override_settings(KUICKPAY_REQUIRE_HTTPS=True):
            self.assertEqual(self.inquire(self.number).status_code, 403)
            self.assertEqual(self.inquire(self.number, secure=True).json()['response_Code'], '00')

    def test_only_post_is_allowed(self):
        self.assertEqual(self.client.get('/api/v1/BillInquiry', **self.auth).status_code, 405)

    def test_constant_time_comparison_is_used(self):
        with mock.patch('finance.kuickpay.auth.hmac.compare_digest', wraps=__import__('hmac').compare_digest) as cmp:
            self.inquire(self.number)
        self.assertEqual(cmp.call_count, 2)           # both fields always compared

    def test_paths_and_the_alternate_payment_name(self):
        for path in ('/api/v1/BillInquiry', '/api/v1/BillInquiry/'):
            self.assertEqual(self.call(path, {'consumer_number': self.number}).json()['response_Code'], '00')
        for path in ('/api/v1/BillPayment', '/api/v1/payment'):
            self.assertEqual(self.call(path, {'consumer_number': '1'}).status_code, 200)


class TestBillInquiry(ApiBase):
    def test_unpaid_bill_matches_the_guides_response_format(self):
        self.gen(1)
        bill = self.bill(1)
        body = self.inquire(bill.consumer_number).json()
        self.assertEqual(set(body), {
            'response_Code', 'consumer_Detail', 'bill_status', 'due_date', 'amount_within_dueDate',
            'amount_after_dueDate', 'email_address', 'contact_number', 'billing_month', 'date_paid',
            'amount_paid', 'tran_auth_Id', 'reserved'})
        self.assertEqual(body['response_Code'], '00')
        self.assertEqual(body['bill_status'], 'U')
        self.assertEqual(body['due_date'], '20260110')                      # per-school due day, default 10
        self.assertEqual(body['amount_within_dueDate'], '+0000000100000')   # Rs 1,000.00
        self.assertEqual(body['amount_after_dueDate'], '+0000000100000')
        self.assertEqual(body['billing_month'], '2601')
        self.assertEqual((body['date_paid'], body['amount_paid'], body['tran_auth_Id']), ('', '', ''))

    def test_only_minimal_data_leaves_the_system(self):
        self.gen(1)
        body = self.inquire(self.bill(1).consumer_number).json()
        self.assertEqual(body['consumer_Detail'], 'S****** O** | Regression Schoo')
        self.assertLessEqual(len(body['consumer_Detail']), 30)
        self.assertNotIn('Student', str(body))
        self.assertEqual(body['email_address'], 'office@school.pk')           # the school's, not a parent's
        self.assertEqual(body['contact_number'], '03001234567')

    def test_the_per_school_due_day_is_used(self):
        self.gen(1)
        KuickpaySchoolMapping.objects.filter(pk=self.mapping.pk).update(due_day=25)
        self.assertEqual(self.inquire(self.bill(1).consumer_number).json()['due_date'], '20260125')

    def test_unknown_consumer_number(self):
        self.assertEqual(self.inquire('999999999999').json(), {'response_Code': '01', 'reserved': 'Voucher not Found.'})

    def test_superseded_suspended_and_inactive_bills_are_blocked(self):
        self.gen(1)
        jan = self.bill(1).consumer_number
        self.gen(2)
        self.assertEqual(self.inquire(jan).json()['response_Code'], '02')                    # expired number
        self.assertEqual(self.inquire(self.bill(2).consumer_number).json()['response_Code'], '00')
        self.pay_manual_part()
        self.assertEqual(self.inquire(self.bill(2).consumer_number).json()['response_Code'], '02')   # manual part-payment

    def pay_manual_part(self):
        self._pay_row(_row(self.student, self.tuition, 2, 2026), '400')

    def _pay_row(self, row, amount):
        row.amount_paid, row.payment_date, row.account = Decimal(amount), self.today(), self.account
        row.save()

    def test_a_school_that_is_switched_off_is_blocked(self):
        self.gen(1)
        number = self.bill(1).consumer_number
        KuickpaySchoolMapping.objects.filter(pk=self.mapping.pk).update(is_enabled=False)
        self.assertEqual(self.inquire(number).json()['response_Code'], '02')

    def test_a_fully_paid_bill_is_reported_paid_with_the_payment_details(self):
        self.gen(1)
        number = self.bill(1).consumer_number
        self.assertEqual(self.pay(number, auth='698242').json()['response_Code'], '00')
        body = self.inquire(number).json()
        self.assertEqual((body['response_Code'], body['bill_status']), ('00', 'P'))
        self.assertEqual(body['amount_paid'], '000000100000')
        self.assertEqual(body['tran_auth_Id'], '698242')
        self.assertEqual(body['date_paid'], moment(timezone.now() - timedelta(minutes=1))[0])

    def test_a_manually_paid_bill_is_reported_paid_without_payment_details(self):
        self.gen(1)
        self._pay_row(_row(self.student, self.tuition, 1, 2026), '1000')
        body = self.inquire(self.bill(1).consumer_number).json()
        self.assertEqual((body['response_Code'], body['bill_status'], body['tran_auth_Id']), ('00', 'P', ''))

    def test_inquiry_never_writes_or_repairs_anything(self):
        self.gen(1, 2)
        row = _row(self.student, self.tuition, 1, 2026)
        row.amount_paid, row.payment_date, row.account = Decimal('1000'), self.today(), self.account
        row.save()                                                 # earlier month paid after Feb was generated: stale
        number = self.bill(2).consumer_number
        before = (KuickpayBill.objects.get(consumer_number=number).status, FeePayment.objects.count())
        self.assertEqual(self.inquire(number).json()['response_Code'], '02')
        bill = KuickpayBill.objects.get(consumer_number=number)
        self.assertEqual((bill.status, FeePayment.objects.count()), before)       # reported, not changed

    def test_request_field_names_in_either_style_are_accepted(self):
        self.gen(1)
        number = self.bill(1).consumer_number
        for body in ({'consumer_number': number}, {'consumerNumber': number, 'bankMnemonic': 'KPY'}):
            self.assertEqual(self.call('/api/v1/BillInquiry', body).json()['response_Code'], '00')

    def test_invalid_requests_get_code_04(self):
        for body in ({}, {'consumer_number': ''}, {'consumer_number': 'abc123'}, {'consumer_number': '1' * 19},
                     {'consumer_number': 123456789012}, ['x']):
            response = self.call('/api/v1/BillInquiry', body)
            self.assertEqual(response.json()['response_Code'], '04', body)
        malformed = self.client.post('/api/v1/BillInquiry', 'not json', content_type='application/json', **self.auth)
        self.assertEqual(malformed.json()['response_Code'], '04')

    def test_a_consumer_number_with_a_leading_zero_round_trips(self):
        biller = KuickpayBiller.objects.create(name='Z', prefix='01520', mode='PROD', consumer_number_length=12, is_enabled=True)
        KuickpaySchoolMapping.objects.filter(pk=self.mapping.pk).update(biller=biller)
        self.gen(1)
        number = self.bill(1).consumer_number
        self.assertTrue(number.startswith('01520'))
        self.assertEqual(self.inquire(number).json()['response_Code'], '00')

    def test_every_call_is_logged_without_credentials(self):
        self.gen(1)
        self.inquire(self.bill(1).consumer_number)
        log = KuickpayCallbackLog.objects.latest('id')
        self.assertEqual((log.endpoint, log.auth_ok, log.result_code, log.http_status), ('BillInquiry', True, '00', 200))
        self.assertNotIn(PASSWORD, str(log.redacted_request) + str(log.redacted_response))
        self.call('/api/v1/BillInquiry', {'consumer_number': '1'}, headers={})
        self.assertFalse(KuickpayCallbackLog.objects.latest('id').auth_ok)


class TestBillPayment(ApiBase):
    def setUp(self):
        super().setUp()
        self.gen(1)
        self.bill1 = self.bill(1)
        self.number = self.bill1.consumer_number

    def test_exact_payment_credits_the_ledger_and_returns_a_receipt(self):
        response = self.pay(self.number)
        txn = self.txn()
        self.assertEqual(response.json(), {'response_Code': '00', 'Identification_parameter': str(txn.pk).zfill(20), 'reserved': ''})
        self.assertEqual(len(response.json()['Identification_parameter']), 20)
        row = _row(self.student, self.tuition, 1, 2026)
        self.assertEqual((row.amount_paid, row.status), (Decimal('1000'), 'PAID'))
        self.assertEqual((row.payment_method, row.account_id, row.payment_date), ('ONLINE', self.bank.id, self.today()))
        self.assertEqual(row.receipt_number, str(txn.pk).zfill(20))
        self.assertEqual((txn.status, txn.allocated_amount, txn.held_amount), ('POSTED', Decimal('1000'), Decimal('0')))
        alloc = KuickpayPaymentAllocation.objects.get(transaction=txn)
        self.assertEqual((alloc.fee_payment_id, alloc.amount, alloc.row_balance_before, alloc.row_balance_after),
                         (row.id, Decimal('1000'), Decimal('1000'), Decimal('0')))

    def test_the_original_kuickpay_date_and_time_are_kept_separately(self):
        when = timezone.now() - timedelta(hours=3)
        self.pay(self.number, when=when)
        txn = self.txn()
        day, clock = moment(when)
        self.assertEqual((txn.tran_date.strftime('%Y%m%d'), txn.tran_time.strftime('%H%M%S')), (day, clock))
        self.assertEqual(txn.posting_date, self.today())

    def test_two_categories_are_paid_in_full_by_one_bill_payment(self):
        self.gen(2, categories=[self.tuition, self.transport])
        number = self.bill(2).consumer_number
        self.assertEqual(self.pay(number, '2300').json()['response_Code'], '00')   # tuition 1000+1000 carried, transport 300
        self.assertEqual({a.category_id: a.amount for a in KuickpayPaymentAllocation.objects.all()},
                         {self.tuition.id: Decimal('2000'), self.transport.id: Decimal('300')})
        self.assertEqual(sum(a.amount for a in KuickpayPaymentAllocation.objects.all()), Decimal('2300'))

    def test_identical_retry_is_a_duplicate_and_credits_nothing_more(self):
        self.assertEqual(self.pay(self.number, auth='550727').json()['response_Code'], '00')
        again = self.pay(self.number, auth='550727')
        self.assertEqual(again.json(), {'response_Code': '03', 'reserved': 'Duplicate Transaction.'})
        self.assertEqual(KuickpayTransaction.objects.count(), 1)
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_paid, Decimal('1000'))

    def test_same_identity_with_a_different_amount_is_a_mismatch(self):
        self.pay(self.number, auth='550727')
        response = self.pay(self.number, '700', auth='550727')
        self.assertEqual(response.json(), {'response_Code': '04', 'reserved': 'Mismatched Transaction Data.'})
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_paid, Decimal('1000'))

    def test_transaction_time_is_ignored_by_the_duplicate_rule(self):
        when = timezone.now() - timedelta(minutes=5)
        self.pay(self.number, auth='550727', when=when)
        later = self.pay(self.number, auth='550727', when=when + timedelta(seconds=30))
        self.assertEqual(later.json()['response_Code'], '03')
        self.assertEqual(KuickpayTransaction.objects.count(), 1)

    def test_the_same_authorization_id_for_another_consumer_is_independent(self):
        other = self.bill(1, student=self.student2).consumer_number
        self.assertEqual(self.pay(self.number, auth='111111').json()['response_Code'], '00')
        self.assertEqual(self.pay(other, auth='111111').json()['response_Code'], '00')
        self.assertEqual(KuickpayTransaction.objects.count(), 2)
        self.assertEqual(_row(self.student2, self.tuition, 1, 2026).amount_paid, Decimal('1000'))

    def test_the_same_authorization_id_on_another_date_is_independent(self):
        self.assertEqual(self.pay(self.number, '400', auth='111111').json()['response_Code'], '04')   # wrong amount, held
        self.assertEqual(self.pay(self.number, auth='111111', when=timezone.now() - timedelta(days=1)).json()['response_Code'], '00')

    def test_unknown_consumer_number(self):
        self.assertEqual(self.pay('999999999999').json()['response_Code'], '01')
        self.assertFalse(KuickpayTransaction.objects.exists())

    def test_invalid_data_gets_code_04_and_creates_no_transaction(self):
        good = dict(consumer_number=self.number, tran_auth_id='123456', transaction_amount='1000',
                    tran_date='20260110', tran_time='093000', bank_mnemonic='KPY')
        for change in ({'tran_auth_id': '12345'}, {'tran_auth_id': 'abcdef'}, {'tran_date': '2026-01-10'},
                       {'tran_date': '20261340'}, {'tran_time': '256100'}, {'transaction_amount': '10x0'},
                       {'transaction_amount': '0'}, {'transaction_amount': 1000}, {'bank_mnemonic': ''},
                       {'consumer_number': 'abc'}):
            response = self.call('/api/v1/BillPayment', {**good, **change})
            self.assertEqual(response.json()['response_Code'], '04', change)
        self.assertFalse(KuickpayTransaction.objects.exists())

    def test_amount_unit_must_be_configured_before_any_money_is_credited(self):
        with override_settings(KUICKPAY_AMOUNT_UNIT=''):
            response = self.pay(self.number)
        self.assertEqual(response.json()['response_Code'], '05')
        self.assertFalse(KuickpayTransaction.objects.exists())
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_paid, 0)

    def test_minor_unit_amounts_are_converted(self):
        with override_settings(KUICKPAY_AMOUNT_UNIT='MINOR'):
            self.assertEqual(self.pay(self.number, '100000').json()['response_Code'], '00')
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_paid, Decimal('1000'))

    def test_a_wrong_amount_is_kept_not_credited_and_flagged(self):
        for amount in ('500', '1500'):
            response = self.pay(self.number, amount)
            self.assertEqual(response.json()['response_Code'], '04')
        for txn in KuickpayTransaction.objects.all():
            self.assertEqual((txn.status, txn.reason, txn.urgent, txn.allocated_amount, txn.held_amount),
                             ('HELD', 'unexpected_amount', True, Decimal('0'), txn.amount))
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_paid, 0)
        self.assertFalse(KuickpayPaymentAllocation.objects.exists())

    def test_a_suspended_bill_or_an_already_paid_bill_keeps_the_money_and_answers_blocked(self):
        row = _row(self.student, self.tuition, 1, 2026)
        row.amount_paid, row.payment_date, row.account = Decimal('400'), self.today(), self.account
        row.save()                                                       # manual part-payment
        response = self.pay(self.number, '600')
        self.assertEqual(response.json()['response_Code'], '02')
        self.assertEqual((self.txn().status, self.txn().reason, self.txn().urgent), ('HELD', 'bill_suspended', True))
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_paid, Decimal('400'))

    def test_paying_an_already_paid_bill_is_held_not_credited_twice(self):
        self.pay(self.number)
        response = self.pay(self.number)
        self.assertEqual(response.json()['response_Code'], '02')
        self.assertEqual(self.txn().reason, 'already_paid')
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_paid, Decimal('1000'))

    def test_a_manual_edit_cannot_erase_a_credited_kuickpay_payment(self):
        self.pay(self.number)
        row = _row(self.student, self.tuition, 1, 2026)
        row.amount_paid = Decimal('100')
        from django.core.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            row.save()

    def test_a_school_is_never_touched_by_another_schools_payment(self):
        self.pay(self.number)
        self.assertEqual(_row(self.student2, self.tuition, 1, 2026).amount_paid, 0)

    def test_the_payment_is_logged(self):
        self.pay(self.number)
        log = KuickpayCallbackLog.objects.latest('id')
        self.assertEqual((log.endpoint, log.result_code, log.transaction_id, log.bill_id),
                         ('BillPayment', '00', self.txn().pk, self.bill1.pk))


class TestExpiredPaymentPolicy(ApiBase):
    """AD-10: no grace; transaction time <= supersession is in-flight, later is never credited."""

    def setUp(self):
        super().setUp()
        self.gen(1)
        self.jan = self.bill(1)
        self.gen(2)                                   # Jan superseded, Feb ACTIVE (payable 2000)
        self.feb = self.bill(2)
        self.cut = (timezone.now() - timedelta(hours=1)).replace(microsecond=0)
        KuickpayBill.objects.filter(pk=self.jan.pk).update(superseded_at=self.cut)

    def pay_jan(self, when, amount='1000', **kw):
        return self.pay(self.jan.consumer_number, amount, when=when, **kw)

    def test_a_payment_before_supersession_is_applied_once_to_the_successor(self):
        response = self.pay_jan(self.cut - timedelta(minutes=5), auth='111111')
        self.assertEqual(response.json()['response_Code'], '00')
        txn = self.txn()
        self.assertEqual((txn.status, txn.reason, txn.allocated_amount, txn.held_amount), ('POSTED', 'inflight', Decimal('1000'), 0))
        feb_row = _row(self.student, self.tuition, 2, 2026)
        self.assertEqual((feb_row.amount_due, feb_row.amount_paid), (Decimal('2000'), Decimal('1000')))
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_paid, 0)       # old row untouched: liability credited once
        self.assertEqual(KuickpayPaymentAllocation.objects.get().fee_payment_id, feb_row.id)
        # An identical retry is a duplicate and never credits again.
        self.assertEqual(self.pay_jan(self.cut - timedelta(minutes=5), auth='111111').json()['response_Code'], '03')
        self.assertEqual(_row(self.student, self.tuition, 2, 2026).amount_paid, Decimal('1000'))

    def test_the_boundary_is_inclusive_and_one_second_later_is_not(self):
        self.assertEqual(self.pay_jan(self.cut, auth='111111').json()['response_Code'], '00')
        self.assertEqual(self.txn().status, 'POSTED')
        late = self.pay_jan(self.cut + timedelta(seconds=1), auth='222222')
        self.assertEqual(late.json()['response_Code'], '02')
        self.assertEqual(self.txn().status, 'EXCEPTIONAL_EXPIRED')

    def test_a_payment_after_supersession_is_kept_urgent_and_never_credited(self):
        response = self.pay_jan(self.cut + timedelta(minutes=10))
        self.assertEqual(response.json(), {'response_Code': '02', 'reserved': 'Voucher is blocked. Payment not allowed.'})
        txn = self.txn()
        self.assertEqual((txn.status, txn.reason, txn.urgent, txn.allocated_amount, txn.held_amount),
                         ('EXCEPTIONAL_EXPIRED', 'after_expiry', True, Decimal('0'), Decimal('1000')))
        self.assertEqual(txn.superseded_at_snapshot, self.cut)
        self.assertEqual(_row(self.student, self.tuition, 2, 2026).amount_paid, 0)
        self.assertFalse(KuickpayPaymentAllocation.objects.exists())

    def test_a_timestamp_in_the_future_cannot_be_trusted(self):
        self.pay_jan(timezone.now() + timedelta(hours=2))
        txn = self.txn()
        self.assertEqual((txn.status, txn.reason, txn.timestamp_reliable), ('EXCEPTIONAL_EXPIRED', 'unreliable_timestamp', False))

    def test_in_flight_money_above_the_successors_liability_is_held_not_added_to_a_row(self):
        response = self.pay_jan(self.cut - timedelta(minutes=1), '5000')
        self.assertEqual(response.json()['response_Code'], '00')
        txn = self.txn()
        self.assertEqual((txn.status, txn.reason, txn.allocated_amount, txn.held_amount),
                         ('HELD', 'inflight_excess', Decimal('2000'), Decimal('3000')))
        feb_row = _row(self.student, self.tuition, 2, 2026)
        self.assertEqual(feb_row.amount_paid, Decimal('2000'))                # never more than owed

    def test_in_flight_with_a_suspended_successor_is_held_for_reconciliation(self):
        row = _row(self.student, self.tuition, 2, 2026)
        row.amount_paid, row.payment_date, row.account = Decimal('300'), self.today(), self.account
        row.save()                                                            # manual part-payment suspends Feb
        response = self.pay_jan(self.cut - timedelta(minutes=1))
        self.assertEqual(response.json()['response_Code'], '00')              # genuinely in-flight money
        self.assertEqual((self.txn().status, self.txn().reason), ('HELD', 'inflight_bill_suspended'))
        self.assertEqual(_row(self.student, self.tuition, 2, 2026).amount_paid, Decimal('300'))

    def test_the_expired_number_is_blocked_at_inquiry(self):
        self.assertEqual(self.inquire(self.jan.consumer_number).json()['response_Code'], '02')

    def test_exceptional_payments_appear_in_the_reconciliation_report(self):
        from finance.kuickpay import reconciliation
        self.pay_jan(self.cut + timedelta(minutes=10))
        report = reconciliation.build_report(self.school.id)
        self.assertEqual(len(report['urgent']), 1)


class TestDurabilityAndPeriods(ApiBase):
    def setUp(self):
        super().setUp()
        self.gen(1)
        self.number = self.bill(1).consumer_number

    def test_a_crash_after_the_transaction_is_stored_loses_nothing_and_credits_exactly_once(self):
        with mock.patch.object(services, 'post_transaction', side_effect=RuntimeError('crash')):
            response = self.pay(self.number)
        self.assertEqual(response.json()['response_Code'], '00')               # money is durable
        txn = self.txn()
        self.assertEqual(txn.status, 'PENDING_RETRY')
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_paid, 0)
        self.assertEqual(services.post_pending(), {'POSTED': 1})
        self.assertEqual(services.post_pending(), {})                          # idempotent
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_paid, Decimal('1000'))
        self.assertEqual(KuickpayPaymentAllocation.objects.count(), 1)

    def test_a_database_error_while_crediting_rolls_back_and_retries_cleanly(self):
        real = FeePayment.save
        calls = {'n': 0}

        def flaky(self, *a, **kw):
            calls['n'] += 1
            if calls['n'] == 1:
                raise OperationalError('connection lost')
            return real(self, *a, **kw)

        with mock.patch.object(FeePayment, 'save', flaky):
            self.assertEqual(self.pay(self.number).json()['response_Code'], '00')
            self.assertEqual(self.txn().status, 'PENDING_RETRY')
            self.assertFalse(KuickpayPaymentAllocation.objects.exists())
            self.assertEqual(services.post_pending(), {'POSTED': 1})
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_paid, Decimal('1000'))

    def test_unposted_money_reduces_the_payable_so_it_cannot_be_paid_twice(self):
        with mock.patch.object(services, 'post_transaction', side_effect=RuntimeError('crash')):
            self.pay(self.number)
        body = self.inquire(self.number).json()
        self.assertEqual((body['bill_status'], body['amount_paid']), ('P', '000000100000'))
        self.assertEqual(self.pay(self.number, auth='999999').json()['response_Code'], '02')     # nothing left to pay

    def test_a_closed_period_never_loses_the_payment_and_is_never_bypassed(self):
        closing = MonthlyClosing.objects.create(school=self.school, year=2026, month=1)
        response = self.pay(self.number)
        self.assertEqual(response.json()['response_Code'], '00')
        txn = self.txn()
        self.assertEqual(txn.status, 'PENDING_PERIOD_LOCK')
        self.assertIn('closed', txn.ledger_error)
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_paid, 0)       # lock respected
        self.assertEqual(services.post_pending(), {'PENDING_PERIOD_LOCK': 1})           # still locked
        closing.delete()                                                                   # administrator reopens the month
        self.assertEqual(services.post_pending(), {'POSTED': 1})
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_paid, Decimal('1000'))

    def test_a_payment_waiting_on_a_closed_month_lands_on_the_next_cycle_when_it_exists(self):
        MonthlyClosing.objects.create(school=self.school, year=2026, month=1)
        self.pay(self.number)
        self.gen(2)                                                                       # next cycle supersedes January
        self.assertEqual(services.post_pending(), {'POSTED': 1})
        feb = _row(self.student, self.tuition, 2, 2026)
        self.assertEqual((feb.amount_due, feb.amount_paid), (Decimal('2000'), Decimal('1000')))
        self.assertEqual(self.txn().reason, 'inflight')

    def test_the_command_and_beat_task_run_the_same_retry(self):
        from io import StringIO
        from django.core.management import call_command
        from finance.tasks import kuickpay_post_pending_task
        with mock.patch.object(services, 'post_transaction', side_effect=RuntimeError('crash')):
            self.pay(self.number)
        KuickpayTransaction.objects.update(received_at=timezone.now() - timedelta(minutes=5))
        self.assertEqual(kuickpay_post_pending_task.apply().get(), {'POSTED': 1})
        out = StringIO()
        call_command('kuickpay_post_pending', stdout=out)
        self.assertIn('nothing pending', out.getvalue())


class TestContractHelpers(ApiBase):
    def test_amount_formats(self):
        self.assertEqual(contract.amount_an14(Decimal('120')), '+0000000012000')
        self.assertEqual(contract.amount_an14(Decimal('1869')), '+0000000186900')
        self.assertEqual(contract.amount_an14(Decimal('-120')), '-0000000012000')
        self.assertEqual(contract.amount_12(Decimal('2025')), '000000202500')
        self.assertEqual(contract.amount_12(Decimal('120')), '000000012000')

    def test_receipt_id_is_20_digits(self):
        self.assertEqual(contract.receipt_id(226), '00000000000000000226')

    def test_names_are_masked(self):
        self.assertEqual(contract.mask_name('Muhammad Affan'), 'M******* A****')
        self.assertEqual(contract.consumer_detail('Muhammad Affan', 'Early Bird Coder Kids'), 'M******* A**** | Early Bird Co')
        self.assertLessEqual(len(contract.consumer_detail('A' * 40, 'School')), 30)

    def test_contact_number_must_start_92_or_03(self):
        self.assertEqual(contract.contact_number('0300-1234567'), '03001234567')
        self.assertEqual(contract.contact_number('+92 300 1234567'), '923001234567')
        self.assertEqual(contract.contact_number('0092 300 1234567'), '923001234567')
        self.assertEqual(contract.contact_number('021-1234567'), '')

    def test_transaction_moment_uses_the_configured_zone(self):
        day, clock, at = contract.parse_transaction_moment('20260110', '093000', 'Asia/Karachi')
        self.assertEqual(at.isoformat(), '2026-01-10T04:30:00+00:00')

    def test_enabling_a_mapping_requires_valid_school_contact_details(self):
        from django.core.exceptions import ValidationError
        School.objects.filter(pk=self.school.pk).update(contact_email='', contact_phone='021-111')
        self.mapping.refresh_from_db()
        self.mapping.school.refresh_from_db()
        with self.assertRaises(ValidationError):
            self.mapping.clean()
        School.objects.filter(pk=self.school.pk).update(contact_email='a' * 31 + '@x.pk', contact_phone='03001234567')
        self.mapping.school.refresh_from_db()
        with self.assertRaises(ValidationError):
            self.mapping.clean()
