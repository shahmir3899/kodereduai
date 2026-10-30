"""Reconciliation report and admin alerts for Kuickpay money and bills.

Read-only. It lists what a person has to look at: payments we could not safely credit, receipts
stuck before the ledger, ledger rows that disagree with their Kuickpay allocations, and bills that
are suspended or missing. Alerts carry counts only.
"""
from datetime import timedelta
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone

from finance.kuickpay import bills as bill_service, payable
from finance.models import (
    FeePayment, KuickpayBill, KuickpayPaymentAllocation, KuickpayTransaction,
)

ZERO = Decimal('0')
DEFAULT_STALE_MINUTES = 30


def build_report(school_id, *, stale_minutes=DEFAULT_STALE_MINUTES, now=None):
    now = now or timezone.now()
    txns = KuickpayTransaction.objects.filter(bill__school_id=school_id)
    Status = KuickpayTransaction.Status

    urgent = list(
        txns.filter(status=Status.EXCEPTIONAL_EXPIRED).order_by('received_at')
        .values('id', 'consumer_number', 'amount', 'received_at', 'reason')
    )
    held = list(
        txns.filter(status=Status.HELD).order_by('received_at')
        .values('id', 'consumer_number', 'held_amount', 'received_at', 'reason')
    )
    cutoff = now - timedelta(minutes=stale_minutes)
    unposted = list(
        txns.filter(status__in=payable.UNPOSTED_STATUSES, received_at__lt=cutoff).order_by('received_at')
        .values('id', 'consumer_number', 'amount', 'status', 'received_at', 'ledger_error')
    )

    # A POSTED transaction must equal the sum of its allocations.
    sums = dict(
        KuickpayPaymentAllocation.objects.filter(transaction__bill__school_id=school_id)
        .values('transaction_id').annotate(t=Sum('amount')).values_list('transaction_id', 't')
    )
    allocation_mismatches = [
        {'id': t['id'], 'consumer_number': t['consumer_number'], 'allocated_amount': t['allocated_amount'],
         'allocations_total': sums.get(t['id'], ZERO)}
        for t in txns.filter(status=Status.POSTED).values('id', 'consumer_number', 'allocated_amount')
        if sums.get(t['id'], ZERO) != t['allocated_amount']
    ]

    # A fee row can never hold less than Kuickpay credited to it.
    per_row = dict(
        KuickpayPaymentAllocation.objects.filter(transaction__bill__school_id=school_id)
        .values('fee_payment_ref').annotate(t=Sum('amount')).values_list('fee_payment_ref', 't')
    )
    row_invariants = [
        {'fee_payment_id': row_id, 'amount_paid': paid, 'kuickpay_allocated': per_row[row_id]}
        for row_id, paid in FeePayment.objects.filter(pk__in=list(per_row)).values_list('id', 'amount_paid')
        if paid < per_row[row_id]
    ]

    suspended = {}
    for reason in KuickpayBill.objects.filter(
        school_id=school_id, status=KuickpayBill.Status.SUSPENDED,
    ).values_list('suspend_reason', flat=True):
        suspended[reason] = suspended.get(reason, 0) + 1

    return {
        'school_id': school_id,
        'urgent': urgent,
        'held': held,
        'unposted': unposted,
        'allocation_mismatches': allocation_mismatches,
        'row_invariants': row_invariants,
        'suspended_bills': suspended,
        'students_missing_bill': bill_service.sweep_school(school_id, dry_run=True)['to_activate'],
    }


def alert_lines(report):
    """One short, count-only line per kind of problem that needs a person."""
    lines = []
    if report['urgent']:
        lines.append(
            f"{len(report['urgent'])} payment(s) arrived after their bill expired and were not credited "
            f"(URGENT: refund or reconcile)"
        )
    if report['held']:
        lines.append(f"{len(report['held'])} payment(s) are held for reconciliation")
    if report['unposted']:
        lines.append(f"{len(report['unposted'])} confirmed payment(s) are not yet posted to the fee ledger")
    if report['allocation_mismatches'] or report['row_invariants']:
        lines.append(
            f"{len(report['allocation_mismatches']) + len(report['row_invariants'])} ledger record(s) "
            f"disagree with their Kuickpay payments"
        )
    if report['suspended_bills']:
        lines.append(f"{sum(report['suspended_bills'].values())} bill(s) are suspended")
    if report['students_missing_bill']:
        lines.append(f"{report['students_missing_bill']} student(s) have no current bill")
    return lines


def send_alerts(school, **kwargs):
    """Alert the school's admins in-app when there is anything to reconcile. Returns notifications sent."""
    from notifications.triggers import trigger_kuickpay_reconciliation_alert

    return trigger_kuickpay_reconciliation_alert(school, alert_lines(build_report(school.id, **kwargs)))
