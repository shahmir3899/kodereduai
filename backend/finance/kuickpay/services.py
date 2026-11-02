"""Bill Inquiry and Bill Payment processing (Kuickpay BPS guide v3.2, assessment §8-§12).

Payment is two phases:

* Phase 1 stores the transaction durably (unique on consumer number + authorization id + date, as
  Kuickpay's duplicate rule defines it) before any ledger work, so a crash or retry can never lose or
  double-count money.
* Phase 2 (``post_transaction``) decides what the money may do and, where allowed, credits the fee
  ledger under row locks. It is idempotent and is retried by ``post_pending``.

The expired-payment rule (approval AD-10), with the reply codes approved as B-16:

* the transaction time is compared in UTC with the instant the bill was superseded, with no grace;
* time at or before it  -> in-flight: applied once to the successor bill's liability, reply ``00``;
* time after it, missing, unparseable or in the future -> kept as EXCEPTIONAL_EXPIRED, never credited,
  flagged urgent, reply ``02``. Kuickpay's own failed-payment / case process handles the refund.
"""
import logging
from datetime import timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from core.school_time import school_timezone
from finance import ledger
from finance.kuickpay import contract, payable
from finance.kuickpay.bills import OPEN, enabled_mapping
from finance.models import FeePayment, KuickpayBill, KuickpayPaymentAllocation, KuickpayTransaction
from students.models import Student

logger = logging.getLogger(__name__)

Status = KuickpayTransaction.Status
POSTABLE = (Status.RECEIVED, Status.PENDING_RETRY, Status.PENDING_PERIOD_LOCK)
ZERO = Decimal('0')


# ── Bill Inquiry ──────────────────────────────────────────────────────────────────────

def inquire(req):
    """(response body, bill or None). Strictly read-only: an inquiry never repairs a bill or the ledger."""
    bill = KuickpayBill.objects.select_related('school').filter(consumer_number=req.consumer_number).first()
    if bill is None:
        return contract.inquiry_not_found(), None
    mapping = enabled_mapping(bill.school_id)
    if mapping is None or bill.status != KuickpayBill.Status.ACTIVE:
        # Superseded, suspended, or school switched off: not payable. (Proposal K-26: code 02.)
        return contract.inquiry_blocked(), bill
    evaluation = payable.evaluate(bill)
    if evaluation.suspend_reason:
        return contract.inquiry_blocked(), bill

    school = bill.school
    student_name = Student.objects.filter(pk=bill.student_ref).values_list('name', flat=True).first() or ''
    common = dict(
        detail=contract.consumer_detail(student_name, school.name),
        due_date=contract.due_date_string(bill.year, bill.month, mapping.due_day),
        email=(school.contact_email or '').strip(),
        contact=contract.contact_number(school.contact_phone),
        billing_month=contract.billing_month_string(bill.year, bill.month),
    )
    if evaluation.payable > 0:
        return contract.inquiry_found(status=contract.UNPAID, amount=evaluation.payable, **common), bill

    last = (
        KuickpayTransaction.objects.filter(
            bill=bill, status__in=(Status.POSTED, *payable.UNPOSTED_STATUSES),
        ).order_by('-id').first()
    )
    billed = sum((max(ZERO, line.amount_due) for line in evaluation.rows), ZERO)
    paid = dict(
        date_paid=last.tran_date.strftime('%Y%m%d'), amount_paid=contract.amount_12(last.amount),
        tran_auth_id=last.tran_auth_id,
    ) if last else {}
    return contract.inquiry_found(status=contract.PAID, amount=billed, **common, **paid), bill


# ── Bill Payment ──────────────────────────────────────────────────────────────────────

def _store_transaction(bill, req):
    """Phase 1. Returns (transaction, created). Never touches the ledger."""
    received_at = timezone.now()
    try:
        with transaction.atomic():
            txn = KuickpayTransaction.objects.create(
                bill=bill, consumer_number=req.consumer_number, tran_auth_id=req.tran_auth_id,
                tran_date=req.tran_date, tran_time=req.tran_time, bank_mnemonic=req.bank_mnemonic,
                tran_at=req.tran_at,
                # A time in the future (or unparseable) cannot be trusted to decide in-flight vs late.
                timestamp_reliable=req.tran_at is not None and req.tran_at <= received_at,
                amount=req.amount, status=Status.RECEIVED, bill_status_at_receipt=bill.status,
                request_payload=req.raw, received_at=received_at,
            )
        return txn, True
    except IntegrityError:
        existing = KuickpayTransaction.objects.filter(
            consumer_number=req.consumer_number, tran_auth_id=req.tran_auth_id, tran_date=req.tran_date,
        ).first()
        if existing is None:
            raise            # a different constraint failed: not a duplicate
        return existing, False


def record_payment(req):
    """(response body, transaction or None) for an authenticated, well-formed payment."""
    bill = KuickpayBill.objects.filter(consumer_number=req.consumer_number).first()
    if bill is None:
        return contract.inquiry_not_found(), None
    txn, created = _store_transaction(bill, req)
    if not created:
        # Kuickpay's rule: same consumer, authorization id, amount and date -> duplicate (03);
        # anything else differing from the stored payment -> mismatch (04). Never a second credit.
        body = contract.payment_duplicate() if txn.amount == req.amount else contract.payment_mismatch()
        return body, txn
    try:
        txn = post_transaction(txn.pk)
    except Exception:
        # Phase 1 is committed, so the money is safe; the sweep finishes posting.
        logger.exception('Kuickpay posting failed for transaction %s; left for retry', txn.pk)
        KuickpayTransaction.objects.filter(pk=txn.pk, status=Status.RECEIVED).update(status=Status.PENDING_RETRY)
        txn.refresh_from_db()
    body = payment_response(txn)
    KuickpayTransaction.objects.filter(pk=txn.pk).update(response_snapshot=body)
    return body, txn


def payment_response(txn):
    """What Kuickpay is told about a stored transaction."""
    if txn.status == Status.EXCEPTIONAL_EXPIRED:
        return contract.payment_blocked()
    if txn.status == Status.HELD:
        if txn.reason == 'unexpected_amount':
            return contract.payment_mismatch()
        if txn.reason.startswith('inflight'):
            return contract.payment_ok(txn.pk)
        return contract.payment_blocked()
    # POSTED, or durably received and awaiting posting: the money is ours to credit.
    return contract.payment_ok(txn.pk)


def _park(txn, status, reason, *, urgent=True):
    """Keep the money, credit nothing, flag it for a person."""
    txn.status = status
    txn.reason = reason[:60]
    txn.urgent = urgent
    txn.allocated_amount = ZERO
    txn.held_amount = txn.amount
    txn.save(update_fields=['status', 'reason', 'urgent', 'allocated_amount', 'held_amount',
                            'superseded_at_snapshot', 'bill_status_at_receipt'])
    return txn


def _allocation_plan(rows, amount):
    """Oldest outstanding period first, then ascending category id; never more than each row owes."""
    remaining = amount
    plan = []
    for line in sorted((l for l in rows if l.balance > 0), key=lambda l: (l.year, l.month, l.category_id or 0)):
        if remaining <= 0:
            break
        part = min(remaining, line.balance)
        plan.append((line, part))
        remaining -= part
    return plan


def post_transaction(txn_id):
    """Phase 2: decide and, where allowed, credit the ledger. Idempotent; safe to call repeatedly."""
    with transaction.atomic():
        txn = KuickpayTransaction.objects.select_for_update().get(pk=txn_id)
        if txn.status not in POSTABLE:
            return txn
        return _decide_and_post(txn)


def _decide_and_post(txn):
    received_bill = KuickpayBill.objects.get(pk=txn.bill_id)
    # Lock order everywhere: the student's bills first (by id), then fee rows (by id).
    student_bills = list(
        KuickpayBill.objects.select_for_update()
        .filter(school_id=received_bill.school_id, student_ref=received_bill.student_ref).order_by('id')
    )
    current = next(b for b in student_bills if b.id == received_bill.id)

    in_flight = False
    if current.status == KuickpayBill.Status.SUPERSEDED:
        txn.superseded_at_snapshot = current.superseded_at
        in_time = (
            txn.timestamp_reliable and txn.tran_at is not None and txn.tran_at <= current.superseded_at
        )
        if not in_time:
            reason = 'after_expiry' if txn.timestamp_reliable else 'unreliable_timestamp'
            return _park(txn, Status.EXCEPTIONAL_EXPIRED, reason)
        target = next((b for b in student_bills if b.status in OPEN), None)
        if target is None:
            return _park(txn, Status.HELD, 'inflight_no_open_bill')
        in_flight = True
    else:
        target = current

    mapping = enabled_mapping(target.school_id)
    if mapping is None:
        return _park(txn, Status.HELD, 'school_not_enabled')

    members = ledger.monthly_member_rows(target.school_id, target.student_ref)
    locked = {
        r.id: r for r in FeePayment.objects.select_for_update()
        .filter(pk__in=[m.id for m in members]).order_by('id')
    }
    evaluation = payable.evaluate(target, exclude_txn_id=txn.pk)
    prefix = 'inflight_' if in_flight else ''
    if target.status == KuickpayBill.Status.SUSPENDED or evaluation.suspend_reason:
        return _park(txn, Status.HELD, f'{prefix}bill_suspended')
    if not in_flight:
        # Release 1 accepts the exact payable only (no partial or over-payments expected).
        if evaluation.payable <= 0:
            return _park(txn, Status.HELD, 'already_paid')
        if txn.amount != evaluation.payable:
            return _park(txn, Status.HELD, 'unexpected_amount')
    to_credit = min(txn.amount, evaluation.payable)
    if to_credit <= 0:
        return _park(txn, Status.HELD, 'inflight_nothing_payable')

    plan = _allocation_plan(evaluation.rows, to_credit)
    try:
        with transaction.atomic():
            _credit_ledger(txn, target, mapping, locked, plan, in_flight)
    except ValidationError as exc:
        # Typically a closed accounting period: never bypassed. The money stays durable and counts
        # against the payable; it is posted when the period is reopened or the next cycle exists.
        txn.status = Status.PENDING_PERIOD_LOCK
        txn.ledger_error = '; '.join(exc.messages)[:2000]
        txn.save(update_fields=['status', 'ledger_error', 'superseded_at_snapshot'])
    except Exception as exc:
        logger.exception('Kuickpay ledger posting failed for transaction %s', txn.pk)
        txn.status = Status.PENDING_RETRY
        txn.ledger_error = str(exc)[:2000]
        txn.save(update_fields=['status', 'ledger_error', 'superseded_at_snapshot'])
    return txn


def _credit_ledger(txn, target, mapping, locked, plan, in_flight):
    with school_timezone(target.school_id):
        posting_date = timezone.localdate()
    receipt = contract.receipt_id(txn.pk)
    now = timezone.now()
    allocated = ZERO
    for line, part in plan:
        row = locked[line.fee_payment_id]
        before = ledger.row_balance(row)
        row.amount_paid = (row.amount_paid or ZERO) + part
        row.payment_date = posting_date          # Education AI posting date; Kuickpay's own date is kept on the transaction
        row.account_id = mapping.settlement_account_id
        row.payment_method = FeePayment.PaymentMethod.ONLINE
        row.receipt_number = receipt
        row.collected_by = None
        row.save()                               # save(), never update(): period locks and status logic must run
        KuickpayPaymentAllocation.objects.create(
            transaction=txn, fee_payment=row, fee_payment_ref=row.id, amount=part,
            period_year=row.year, period_month=row.month, category_id=row.monthly_category_id,
            row_balance_before=before, row_balance_after=ledger.row_balance(row),
            posting_date=posting_date, posted_at=now,
        )
        allocated += part
    txn.allocated_amount = allocated
    txn.held_amount = txn.amount - allocated
    txn.posted_at, txn.posting_date = now, posting_date
    txn.ledger_error = ''
    if txn.held_amount > 0:
        txn.status, txn.reason, txn.urgent = Status.HELD, 'inflight_excess', True
    else:
        txn.status, txn.reason = Status.POSTED, 'inflight' if in_flight else ''
    txn.save(update_fields=[
        'allocated_amount', 'held_amount', 'posted_at', 'posting_date', 'ledger_error', 'status', 'reason',
        'urgent', 'superseded_at_snapshot',
    ])
    payable.sync_bill_state(target, now=now)


def post_pending(*, older_than_seconds=0, limit=500):
    """Retry transactions that were stored but not yet credited. Returns {resulting status: count}."""
    cutoff = timezone.now() - timedelta(seconds=older_than_seconds)
    ids = list(
        KuickpayTransaction.objects.filter(status__in=POSTABLE, received_at__lte=cutoff)
        .order_by('id').values_list('id', flat=True)[:limit]
    )
    counts = {}
    for txn_id in ids:
        try:
            status = post_transaction(txn_id).status
        except Exception:
            logger.exception('Kuickpay retry failed for transaction %s', txn_id)
            status = 'error'
        counts[status] = counts.get(status, 0) + 1
    return counts
