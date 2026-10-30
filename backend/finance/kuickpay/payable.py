"""What a Kuickpay bill may collect right now, computed live from the fee ledger.

``evaluate`` is strictly read-only. Inquiry and payment requests call it and never repair anything:
a bill whose ledger is stale is reported as not payable until an administrator refreshes the fee
records (approval AD-14). ``sync_bill_state`` is the only writer, and only the activation hook, the
sweep and the commands use it.

There is no second liability calculation here: member rows and balances come from finance.ledger.
"""
from dataclasses import dataclass, field
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone

from finance import ledger
from finance.models import (
    KuickpayBill, KuickpayPaymentAllocation, KuickpayTransaction, MonthlyFeeCategory,
)
from students.models import Student

ZERO = Decimal('0')

# Suspension reasons (KuickpayBill.suspend_reason).
STUDENT_NOT_ACTIVE = 'student_not_active'
NO_MEMBER_ROWS = 'no_member_rows'
STALE_LEDGER = 'stale_ledger'
MANUAL_PARTIAL_PAYMENT = 'manual_partial_payment'
ALLOCATION_INVARIANT = 'allocation_invariant_violation'

# Receipts we hold durably but have not yet posted to the ledger. They reduce what can still be
# collected, so the same amount cannot be paid twice while posting is delayed.
UNPOSTED_STATUSES = (
    KuickpayTransaction.Status.RECEIVED,
    KuickpayTransaction.Status.PENDING_PERIOD_LOCK,
    KuickpayTransaction.Status.PENDING_RETRY,
)


@dataclass
class RowLine:
    fee_payment_id: int
    category_id: int
    category_name: str
    year: int
    month: int
    amount_due: Decimal
    amount_paid: Decimal
    balance: Decimal            # max(0, due - paid)
    kuickpay_allocated: Decimal


@dataclass
class BillEvaluation:
    rows: list = field(default_factory=list)
    ledger_payable: Decimal = ZERO       # sum of the rows' balances
    processing: Decimal = ZERO           # received by Kuickpay, not yet posted
    payable: Decimal = ZERO              # what may still be collected
    suspend_reason: str = ''


def _allocated_by_row(row_ids):
    totals = (
        KuickpayPaymentAllocation.objects.filter(fee_payment_ref__in=list(row_ids))
        .values('fee_payment_ref').annotate(t=Sum('amount')).values_list('fee_payment_ref', 't')
    )
    return {ref: total for ref, total in totals}


def unposted_receipts(school_id, student_ref):
    """Amount received through Kuickpay for this student that is not yet allocated or held."""
    total = ZERO
    for amount, allocated, held in KuickpayTransaction.objects.filter(
        bill__school_id=school_id, bill__student_ref=student_ref, status__in=UNPOSTED_STATUSES,
    ).values_list('amount', 'allocated_amount', 'held_amount'):
        total += amount - allocated - held
    return total


def evaluate(bill):
    """Read-only evaluation of a bill against the ledger."""
    result = BillEvaluation()
    student = Student.objects.filter(pk=bill.student_ref, school_id=bill.school_id).first()
    members = ledger.monthly_member_rows(bill.school_id, bill.student_ref)
    allocated = _allocated_by_row(r.id for r in members)
    names = dict(
        MonthlyFeeCategory.objects.filter(
            pk__in={r.monthly_category_id for r in members}
        ).values_list('pk', 'name')
    )
    for row in members:
        balance = max(ZERO, ledger.row_balance(row))
        result.rows.append(RowLine(
            fee_payment_id=row.id, category_id=row.monthly_category_id,
            category_name=names.get(row.monthly_category_id, ''), year=row.year, month=row.month,
            amount_due=row.amount_due, amount_paid=row.amount_paid, balance=balance,
            kuickpay_allocated=allocated.get(row.id, ZERO),
        ))
    result.ledger_payable = sum((line.balance for line in result.rows), ZERO)
    result.processing = unposted_receipts(bill.school_id, bill.student_ref)
    result.payable = max(ZERO, result.ledger_payable - result.processing)

    # Order matters only for the reported reason; any one of them makes the bill non-payable.
    if student is None or not student.is_active or student.status != Student.Status.ACTIVE:
        result.suspend_reason = STUDENT_NOT_ACTIVE
    elif not result.rows:
        result.suspend_reason = NO_MEMBER_ROWS
    elif any(line.amount_paid < line.kuickpay_allocated for line in result.rows):
        result.suspend_reason = ALLOCATION_INVARIANT
    elif _has_stale_member_row(bill, result.rows):
        result.suspend_reason = STALE_LEDGER
    elif any(
        line.balance > 0 and line.amount_paid - line.kuickpay_allocated > 0 for line in result.rows
    ):
        # Part of this row was paid by cash/bank and part could be Kuickpay: the row has only one
        # payment date and account, so adding online money would misattribute it.
        result.suspend_reason = MANUAL_PARTIAL_PAYMENT
    return result


def _has_stale_member_row(bill, rows):
    member_ids = {line.fee_payment_id for line in rows}
    return any(
        f['kind'] == 'stale' and f['row_id'] in member_ids
        for f in ledger.chain_integrity(bill.school_id, [bill.student_ref])
    )


def is_payable(bill, evaluation):
    return (
        bill.status == KuickpayBill.Status.ACTIVE
        and not evaluation.suspend_reason
        and evaluation.payable > 0
    )


def sync_bill_state(bill, *, now=None):
    """Bring an open bill's ACTIVE/SUSPENDED state in line with the ledger. Returns True if changed.

    Never called from inquiry or payment handling: those only read. Superseded bills never change.
    """
    if bill.status == KuickpayBill.Status.SUPERSEDED:
        return False
    now = now or timezone.now()
    reason = evaluate(bill).suspend_reason
    if reason and bill.status == KuickpayBill.Status.ACTIVE:
        bill.status = KuickpayBill.Status.SUSPENDED
        bill.suspend_reason, bill.suspended_at = reason, now
    elif reason and bill.suspend_reason != reason:
        bill.suspend_reason = reason
    elif not reason and bill.status == KuickpayBill.Status.SUSPENDED:
        bill.status = KuickpayBill.Status.ACTIVE
        bill.suspend_reason, bill.suspended_at = '', None
    else:
        return False
    bill.save(update_fields=['status', 'suspend_reason', 'suspended_at'])
    return True
