"""Parent-facing bill endpoint and reconciliation report/alerts (Kuickpay plan Phase A5, F-7)."""
from datetime import date, time, timedelta
from decimal import Decimal
from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from finance.kuickpay import parent_summary, reconciliation
from finance.models import (
    FeePayment, KuickpayBill, KuickpayPaymentAllocation, KuickpayReconciliationEvent, KuickpayTransaction,
)
from finance.test_fee_generation_regression import _gen, _row
from finance.test_kuickpay_bills import KuickpayBase
from notifications.models import NotificationLog
from parents.models import ParentChild, ParentProfile
from schools.models import UserSchoolMembership

pytestmark = pytest.mark.kuickpay


class ParentBase(KuickpayBase):
    def make_parent(self, username, child):
        User = get_user_model()
        user = User.objects.create_user(
            username=username, email=f'{username}@test.com', password='pw12345678', role='PARENT', school=self.school,
        )
        UserSchoolMembership.objects.create(user=user, school=self.school, role='PARENT', is_default=True)
        profile = ParentProfile.objects.create(user=user, phone='0300' + username[-7:].zfill(7))
        if child is not None:
            ParentChild.objects.create(parent=profile, student=child, school=self.school)
        return user

    def get(self, user, student):
        client = APIClient()
        client.force_authenticate(user)
        return client.get(
            f'/api/parents/children/{student.id}/kuickpay-bill/', HTTP_X_SCHOOL_ID=str(self.school.id),
        )


class TestParentEndpoint(ParentBase):
    def setUp(self):
        self.parent = self.make_parent('parent0000001', self.student)

    def test_a_parent_sees_only_the_latest_bill_as_active_with_a_breakdown(self):
        _gen(self.school, 1, 2026, [self.tuition, self.transport])
        _gen(self.school, 2, 2026, [self.tuition, self.transport])
        body = self.get(self.parent, self.student).json()
        active = body['active_bill']
        self.assertTrue(body['enabled'])
        self.assertEqual(active['cycle'], {'year': 2026, 'month': 2})
        self.assertEqual(active['consumer_number'], KuickpayBill.objects.get(
            student_ref=self.student.id, month=2).consumer_number)
        self.assertEqual(active['payable_amount'], '2600.00')
        self.assertTrue(active['payable'])
        self.assertEqual({(l['category_name'], l['amount']) for l in active['breakdown']},
                         {('Tuition', '2000.00'), ('Transport', '600.00')})
        self.assertEqual(sum(Decimal(l['amount']) for l in active['breakdown']), Decimal(active['payable_amount']))
        self.assertIn('monthly fees only', active['scope_note'])

    def test_expired_bills_appear_only_in_history_and_are_never_payable(self):
        _gen(self.school, 1, 2026, [self.tuition])
        jan = KuickpayBill.objects.get(student_ref=self.student.id, month=1)
        _gen(self.school, 2, 2026, [self.tuition])
        body = self.get(self.parent, self.student).json()
        self.assertEqual(len(body['history']), 1)
        old = body['history'][0]
        self.assertEqual((old['consumer_number'], old['status'], old['payable']), (jan.consumer_number, 'EXPIRED', False))
        self.assertNotEqual(body['active_bill']['consumer_number'], jan.consumer_number)

    def test_a_suspended_bill_is_shown_unpayable_with_a_neutral_message(self):
        _gen(self.school, 1, 2026, [self.tuition])
        self.pay(_row(self.student, self.tuition, 1, 2026), '400')          # manual part payment
        active = self.get(self.parent, self.student).json()['active_bill']
        self.assertEqual((active['status'], active['payable']), ('SUSPENDED', False))
        self.assertEqual(active['message'], parent_summary.SUSPENDED_MESSAGE)
        self.assertNotIn('manual', str(active).lower())

    def test_a_fully_paid_bill_is_not_payable(self):
        _gen(self.school, 1, 2026, [self.tuition])
        self.pay(_row(self.student, self.tuition, 1, 2026), '1000')
        active = self.get(self.parent, self.student).json()['active_bill']
        self.assertEqual((active['payable'], active['payable_amount']), (False, '0.00'))

    def test_transactions_are_shown_with_parent_safe_labels(self):
        _gen(self.school, 1, 2026, [self.tuition])
        bill = KuickpayBill.objects.get(student_ref=self.student.id)
        self.receive(bill, '300', auth='000001', status='POSTED', allocated_amount=Decimal('300'))
        self.receive(bill, '100', auth='000002', status='EXCEPTIONAL_EXPIRED', held_amount=Decimal('100'))
        self.receive(bill, '50', auth='000003', status='REJECTED')
        labels = sorted(t['status'] for t in self.get(self.parent, self.student).json()['active_bill']['transactions'])
        self.assertEqual(labels, ['PAID', 'UNDER_REVIEW'])

    def test_a_school_without_kuickpay_shows_nothing(self):
        from finance.models import KuickpaySchoolMapping
        KuickpaySchoolMapping.objects.filter(pk=self.mapping.pk).update(is_enabled=False)
        self.assertEqual(self.get(self.parent, self.student).json(),
                         {'enabled': False, 'active_bill': None, 'history': []})

    def test_a_child_without_a_bill_has_no_active_bill(self):
        body = self.get(self.parent, self.student).json()
        self.assertEqual((body['enabled'], body['active_bill'], body['history']), (True, None, []))

    def test_another_parent_cannot_see_the_child(self):
        _gen(self.school, 1, 2026, [self.tuition])
        stranger = self.make_parent('parent0000002', self.student2)
        self.assertEqual(self.get(stranger, self.student).status_code, 403)

    def test_a_parent_sees_only_their_own_child_consumer_number(self):
        _gen(self.school, 1, 2026, [self.tuition])
        other = KuickpayBill.objects.get(student_ref=self.student2.id).consumer_number
        self.assertNotIn(other, str(self.get(self.parent, self.student).json()))

    def test_anonymous_requests_are_rejected(self):
        response = APIClient().get(f'/api/parents/children/{self.student.id}/kuickpay-bill/')
        self.assertIn(response.status_code, (401, 403))


class TestReconciliation(ParentBase):
    def setUp(self):
        _gen(self.school, 1, 2026, [self.tuition])
        self.bill = KuickpayBill.objects.get(student_ref=self.student.id)
        self.admin = get_user_model().objects.create_user(
            username='kp_admin', email='kp_admin@test.com', password='pw12345678', role='SCHOOL_ADMIN', school=self.school,
        )
        UserSchoolMembership.objects.create(user=self.admin, school=self.school, role='SCHOOL_ADMIN', is_default=True)

    def report(self, **kw):
        return reconciliation.build_report(self.school.id, **kw)

    def test_a_clean_school_has_nothing_to_report(self):
        report = self.report()
        self.assertEqual(reconciliation.alert_lines(report), [])

    def test_late_payments_are_listed_as_urgent(self):
        self.receive(self.bill, '700', status='EXCEPTIONAL_EXPIRED', held_amount=Decimal('700'), urgent=True)
        report = self.report()
        self.assertEqual(len(report['urgent']), 1)
        self.assertIn('URGENT', reconciliation.alert_lines(report)[0])

    def test_held_and_stale_unposted_payments_are_listed(self):
        self.receive(self.bill, '100', auth='000001', status='HELD', held_amount=Decimal('100'))
        old = self.receive(self.bill, '200', auth='000002', status='PENDING_PERIOD_LOCK')
        fresh = self.receive(self.bill, '300', auth='000003', status='RECEIVED')
        KuickpayTransaction.objects.filter(pk=old.pk).update(received_at=timezone.now() - timedelta(hours=2))
        report = self.report(stale_minutes=30)
        self.assertEqual(len(report['held']), 1)
        self.assertEqual([t['id'] for t in report['unposted']], [old.id])       # the fresh one is not stale yet

    def test_a_posted_payment_must_match_its_allocations(self):
        row = _row(self.student, self.tuition, 1, 2026)
        txn = self.receive(self.bill, '400', status='POSTED', allocated_amount=Decimal('400'))
        self.assertEqual(len(self.report()['allocation_mismatches']), 1)           # no allocation rows yet
        KuickpayPaymentAllocation.objects.create(
            transaction=txn, fee_payment=row, fee_payment_ref=row.id, amount=Decimal('400'),
            period_year=2026, period_month=1, row_balance_before=Decimal('1000'),
            row_balance_after=Decimal('600'), posting_date=date(2026, 1, 12),
        )
        self.assertEqual(self.report()['allocation_mismatches'], [])

    def test_a_fee_row_below_its_allocations_is_reported(self):
        row = _row(self.student, self.tuition, 1, 2026)
        txn = self.receive(self.bill, '400', status='POSTED', allocated_amount=Decimal('400'))
        KuickpayPaymentAllocation.objects.create(
            transaction=txn, fee_payment=row, fee_payment_ref=row.id, amount=Decimal('400'),
            period_year=2026, period_month=1, row_balance_before=Decimal('1000'),
            row_balance_after=Decimal('600'), posting_date=date(2026, 1, 12),
        )
        FeePayment.objects.filter(pk=row.pk).update(amount_paid=Decimal('100'))     # bypasses the guard
        self.assertEqual(len(self.report()['row_invariants']), 1)

    def test_suspended_bills_and_missing_bills_are_counted(self):
        self.pay(_row(self.student, self.tuition, 1, 2026), '400')
        from finance.kuickpay import payable
        payable.sync_bill_state(self.bill)
        KuickpayBill.objects.filter(student_ref=self.student2.id).delete()
        report = self.report()
        self.assertEqual(report['suspended_bills'], {'manual_partial_payment': 1})
        self.assertEqual(report['students_missing_bill'], 1)

    def test_alert_lines_carry_counts_only(self):
        self.receive(self.bill, '700', status='EXCEPTIONAL_EXPIRED', held_amount=Decimal('700'), urgent=True)
        text = ' '.join(reconciliation.alert_lines(self.report()))
        self.assertNotIn(self.bill.consumer_number, text)
        self.assertNotIn(self.student.name, text)

    def test_school_admins_get_one_in_app_alert_per_day(self):
        self.receive(self.bill, '700', status='EXCEPTIONAL_EXPIRED', held_amount=Decimal('700'), urgent=True)
        self.assertEqual(reconciliation.send_alerts(self.school), 1)
        self.assertEqual(reconciliation.send_alerts(self.school), 0)                 # deduplicated
        log = NotificationLog.objects.get(recipient_user=self.admin)
        self.assertEqual((log.channel, log.event_type), ('IN_APP', 'GENERAL'))
        self.assertIn('Kuickpay', log.title)
        self.assertNotIn(self.bill.consumer_number, log.body)

    def test_no_alert_when_there_is_nothing_to_reconcile(self):
        self.assertEqual(reconciliation.send_alerts(self.school), 0)
        self.assertFalse(NotificationLog.objects.filter(recipient_user=self.admin).exists())

    def test_command_prints_the_report_and_can_alert(self):
        self.receive(self.bill, '700', status='EXCEPTIONAL_EXPIRED', held_amount=Decimal('700'), urgent=True)
        out = StringIO()
        call_command('kuickpay_reconcile', '--school-id', str(self.school.id), '--alert', stdout=out)
        text = out.getvalue()
        self.assertIn('URGENT  payments after expiry, not credited: 1', text)
        self.assertIn('alerts sent: 1', text)

    def test_beat_task_alerts_only_enabled_schools(self):
        from finance.tasks import kuickpay_reconciliation_task
        self.receive(self.bill, '700', status='EXCEPTIONAL_EXPIRED', held_amount=Decimal('700'), urgent=True)
        self.assertEqual(kuickpay_reconciliation_task.apply().get(), {self.school.id: 1})

    def test_reconciliation_events_are_append_only_records(self):
        txn = self.receive(self.bill, '700', status='HELD', held_amount=Decimal('700'))
        KuickpayReconciliationEvent.objects.create(transaction=txn, action='NOTE', details={'note': 'checked'})
        self.assertEqual(txn.reconciliation_events.count(), 1)
