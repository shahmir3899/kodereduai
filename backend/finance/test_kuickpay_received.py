"""The "received via Kuickpay" label on fee records, for every role that can see them."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from finance.kuickpay.received import money, received_summary
from finance.models import KuickpayBill, KuickpayTransaction
from finance.test_kuickpay_api import PKT, ApiBase
from finance.test_kuickpay_parent_reconcile import ParentBase
from students import history

pytestmark = pytest.mark.kuickpay


class LabelBase(ParentBase, ApiBase):
    def staff_rows(self, **params):
        user = get_user_model().objects.create_superuser('lbl_admin', 'lbl@test.com', 'pw12345678')
        client = APIClient()
        client.force_authenticate(user)
        response = client.get('/api/finance/fee-payments/', params, HTTP_X_SCHOOL_ID=str(self.school.id))
        self.assertEqual(response.status_code, 200)
        body = response.json()
        return body['results'] if isinstance(body, dict) else body

    def row_for(self, rows, student, month):
        return next(r for r in rows if r['student'] == student.id and r['month'] == month)


class TestLabelContent(LabelBase):
    def test_a_record_with_no_kuickpay_money_has_no_label(self):
        self.gen(1)
        self.assertIsNone(self.row_for(self.staff_rows(), self.student, 1)['kuickpay'])

    def test_a_full_payment_names_the_amount_gateway_and_reference(self):
        self.gen(1)
        self.pay(self.bill(1).consumer_number, auth='550727')
        label = self.row_for(self.staff_rows(), self.student, 1)['kuickpay']
        self.assertEqual(label['label'], 'PKR 1,000 received via Kuickpay (paid in full)')
        self.assertEqual((label['gateway'], label['coverage'], label['received']), ('Kuickpay', 'FULL', '1000.00'))
        self.assertEqual(label['reference_text'], 'Ref 550727')
        self.assertEqual(len(label['payments'][0]['receipt']), 20)
        paid_on = (timezone.now() - timedelta(minutes=1)).astimezone(PKT).date().isoformat()
        self.assertEqual(label['payments'][0]['date'], paid_on)                  # Kuickpay's own payment date
        self.assertEqual(label['payments'][0]['amount'], '1000.00')

    def test_a_partial_payment_says_partial(self):
        # In-flight money credited to a larger cumulative row covers only part of it.
        self.gen(1)
        jan = self.bill(1)
        self.gen(2)
        cut = (timezone.now() - timedelta(hours=1)).replace(microsecond=0)
        KuickpayBill.objects.filter(pk=jan.pk).update(superseded_at=cut)
        self.pay(jan.consumer_number, when=cut - timedelta(minutes=5), auth='600001')
        label = self.row_for(self.staff_rows(), self.student, 2)['kuickpay']
        self.assertEqual((label['coverage'], label['label']),
                         ('PARTIAL', 'PKR 1,000 received via Kuickpay (partial payment)'))

    def test_two_payments_list_every_reference(self):
        self.gen(1)
        jan = self.bill(1)
        self.gen(2)
        cut = (timezone.now() - timedelta(hours=1)).replace(microsecond=0)
        KuickpayBill.objects.filter(pk=jan.pk).update(superseded_at=cut)
        self.pay(jan.consumer_number, '600', when=cut - timedelta(minutes=5), auth='600001')
        self.pay(jan.consumer_number, '400', when=cut - timedelta(minutes=4), auth='600002')
        label = self.row_for(self.staff_rows(), self.student, 2)['kuickpay']
        self.assertEqual(label['reference_text'], 'Refs 600001, 600002')
        self.assertEqual(label['received'], '1000.00')
        self.assertEqual([p['amount'] for p in label['payments']], ['600.00', '400.00'])

    def test_a_cash_top_up_never_counts_as_kuickpay_money(self):
        self.gen(1)
        self.pay(self.bill(1).consumer_number)
        row = self.row_for(self.staff_rows(), self.student, 1)
        self.assertEqual(row['kuickpay']['received'], '1000.00')
        self.assertEqual(row['payment_method'], 'ONLINE')

    def test_money_that_was_held_or_refused_is_never_shown_as_received(self):
        self.gen(1)
        self.pay(self.bill(1).consumer_number, '500')                       # wrong amount: held, not credited
        self.assertEqual(KuickpayTransaction.objects.get().status, 'HELD')
        self.assertIsNone(self.row_for(self.staff_rows(), self.student, 1)['kuickpay'])

    def test_amounts_print_like_the_app_does(self):
        self.assertEqual(money(Decimal('6500')), 'PKR 6,500')
        self.assertEqual(money(Decimal('6500.5')), 'PKR 6,500.50')
        self.assertEqual(money(Decimal('1234567')), 'PKR 1,234,567')


class TestConsumerNumberColumn(LabelBase):
    def test_the_open_bills_month_shows_its_consumer_number(self):
        self.gen(1)
        row = self.row_for(self.staff_rows(), self.student, 1)
        self.assertEqual(row['kuickpay_consumer_number'], self.bill(1).consumer_number)

    def test_an_older_month_the_bill_no_longer_covers_shows_none(self):
        self.gen(1)
        self.gen(2)
        rows = self.staff_rows()
        self.assertIsNone(self.row_for(rows, self.student, 1)['kuickpay_consumer_number'])
        self.assertEqual(self.row_for(rows, self.student, 2)['kuickpay_consumer_number'], self.bill(2).consumer_number)

    def test_a_suspended_bill_shows_no_number(self):
        self.gen(1)
        KuickpayBill.objects.filter(pk=self.bill(1).pk).update(status=KuickpayBill.Status.SUSPENDED)
        self.assertIsNone(self.row_for(self.staff_rows(), self.student, 1)['kuickpay_consumer_number'])

    def test_the_number_costs_one_query_for_a_whole_page_of_rows(self):
        self.gen(1)
        with CaptureQueriesContext(connection) as page:
            self.staff_rows()
        numbered = [q for q in page.captured_queries if 'finance_kuickpaybill' in q['sql']]
        self.assertEqual(len(numbered), 1)


class TestEveryRoleSeesIt(LabelBase):
    def setUp(self):
        super().setUp()
        self.parent = self.make_parent('parent0000009', self.student)
        self.gen(1)
        self.pay(self.bill(1).consumer_number, auth='550727')

    def test_staff_fee_list(self):
        self.assertEqual(self.row_for(self.staff_rows(), self.student, 1)['kuickpay']['reference_text'], 'Ref 550727')

    def test_parent_fee_screen(self):
        client = APIClient()
        client.force_authenticate(self.parent)
        response = client.get(f'/api/parents/children/{self.student.id}/fees/', HTTP_X_SCHOOL_ID=str(self.school.id))
        self.assertEqual(response.status_code, 200)
        row = next(r for r in response.json() if r['month'] == 1)
        self.assertEqual(row['kuickpay']['label'], 'PKR 1,000 received via Kuickpay (paid in full)')

    def test_student_fee_feed_and_profile_history(self):
        # The student portal and the staff student profile both read this function.
        row = history.fee_rows(self.student)[0]
        self.assertEqual(row['kuickpay']['reference_text'], 'Ref 550727')

    def test_a_parent_does_not_see_another_childs_payment(self):
        stranger = self.make_parent('parent0000010', self.student2)
        client = APIClient()
        client.force_authenticate(stranger)
        response = client.get(f'/api/parents/children/{self.student.id}/fees/', HTTP_X_SCHOOL_ID=str(self.school.id))
        self.assertEqual(response.status_code, 403)

    def test_the_label_costs_one_query_for_a_whole_page_of_rows(self):
        self.gen(2)
        self.pay(self.bill(2).consumer_number, '2000', auth='550728')
        for student in (self.student2,):
            self.pay(self.bill(2, student=student).consumer_number, '2000', auth='550729')
        with CaptureQueriesContext(connection) as few:
            list(history.fee_rows(self.student2))
        with CaptureQueriesContext(connection) as more:
            list(history.fee_rows(self.student))
        self.assertLessEqual(len(more), len(few) + 1)          # does not grow with the number of rows

    def test_summary_is_none_without_allocations(self):
        from finance.models import FeePayment
        self.assertIsNone(received_summary(FeePayment.objects.filter(student=self.student2).first()))
