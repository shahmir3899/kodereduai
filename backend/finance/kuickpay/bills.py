"""Bill lifecycle: one open bill per student, the latest monthly cycle only.

Activating a student's bill for a new cycle supersedes the previous open bill in the same database
transaction, under a row lock. The liability itself is never touched: it stays on the fee rows and is
already carried forward in the new cycle's rows. A DB partial unique constraint
(``uniq_kuickpay_one_open_bill_per_student``) makes a second payable bill impossible.

Lock order, everywhere: this student's bill rows first (by id), then fee rows.
"""
import logging
from collections import namedtuple
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import F, Max
from django.utils import timezone

from finance import ledger
from finance.kuickpay import consumer_numbers, payable
from finance.models import FeePayment, KuickpayBill, KuickpaySchoolMapping
from students.models import Student

logger = logging.getLogger(__name__)

ActivationResult = namedtuple('ActivationResult', 'action bill')

CREATED = 'created'
UNCHANGED = 'unchanged'
SKIPPED_NOT_ENABLED = 'skipped_not_enabled'
SKIPPED_NO_STUDENT = 'skipped_no_student'
SKIPPED_NO_ROWS = 'skipped_no_rows'
SKIPPED_NEWER_EXISTS = 'skipped_newer_exists'

OPEN = (KuickpayBill.Status.ACTIVE, KuickpayBill.Status.SUSPENDED)
_NUMBER_ATTEMPTS = 5


def enabled_mapping(school_id):
    """The school's Kuickpay mapping when both the school and its biller are switched on."""
    return (
        KuickpaySchoolMapping.objects.select_related('biller')
        .filter(school_id=school_id, is_enabled=True, biller__is_enabled=True).first()
    )


def _snapshot(school_id, student_id):
    return {'rows': [
        {
            'fee_payment_id': r.id, 'category_id': r.monthly_category_id, 'year': r.year, 'month': r.month,
            'amount_due': str(r.amount_due), 'amount_paid': str(r.amount_paid),
        }
        for r in ledger.monthly_member_rows(school_id, student_id)
    ]}


def _create_with_unique_number(**fields):
    """Create the bill, retrying only if a random consumer number collided (practically never)."""
    biller = fields['biller']
    for _ in range(_NUMBER_ATTEMPTS):
        number = consumer_numbers.allocate(biller, 1)[0]
        try:
            with transaction.atomic():
                return KuickpayBill.objects.create(consumer_number=number, **fields)
        except IntegrityError:
            if not KuickpayBill.objects.filter(consumer_number=number).exists():
                raise          # a different constraint failed: not ours to retry
    raise consumer_numbers.ConsumerNumberExhausted('Repeated consumer number collisions.')


def activate_bill_for_cycle(school_id, student_id, year, month, *, now=None):
    """Make (year, month) the student's open bill. Idempotent; never expires a newer bill.

    A student with no bill yet has no row to lock, so two simultaneous first activations can both
    try to insert. The database constraints let exactly one win; the loser retries once and then
    finds the winner's bill (UNCHANGED).
    """
    for attempt in range(2):
        try:
            return _activate(school_id, student_id, year, month, now=now)
        except IntegrityError:
            if attempt:
                raise


def _activate(school_id, student_id, year, month, *, now=None):
    mapping = enabled_mapping(school_id)
    if mapping is None:
        return ActivationResult(SKIPPED_NOT_ENABLED, None)
    student = Student.objects.filter(pk=student_id, school_id=school_id).first()
    if student is None:
        return ActivationResult(SKIPPED_NO_STUDENT, None)

    with transaction.atomic():
        existing = list(
            KuickpayBill.objects.select_for_update()
            .filter(school_id=school_id, student_ref=student_id).order_by('id')
        )
        cycle = (year, month)
        same = [b for b in existing if (b.year, b.month) == cycle]
        if same:
            bill = same[0]
            if bill.status in OPEN:
                payable.sync_bill_state(bill, now=now)
                return ActivationResult(UNCHANGED, bill)
            return ActivationResult(SKIPPED_NEWER_EXISTS, bill)
        if any((b.year, b.month) > cycle for b in existing):
            return ActivationResult(SKIPPED_NEWER_EXISTS, None)
        if not FeePayment.objects.filter(
            school_id=school_id, student_id=student_id, fee_type='MONTHLY', year=year, month=month,
        ).exists():
            return ActivationResult(SKIPPED_NO_ROWS, None)

        now = now or timezone.now()
        # Supersede first: the partial unique constraint is checked per statement, so the old open
        # bill must stop being open before the new one is inserted. One timestamp serves both, and
        # it is what the late-payment policy later compares transaction times against.
        previous = [b for b in existing if b.status in OPEN]
        for old in previous:
            old.status = KuickpayBill.Status.SUPERSEDED
            old.superseded_at = now
            old.save(update_fields=['status', 'superseded_at'])
        bill = _create_with_unique_number(
            school_id=school_id, biller=mapping.biller, student=student, student_ref=student_id,
            year=year, month=month, activated_at=now, activation_snapshot=_snapshot(school_id, student_id),
        )
        for old in previous:
            old.superseded_by = bill
            old.save(update_fields=['superseded_by'])
        payable.sync_bill_state(bill, now=now)
        return ActivationResult(CREATED, bill)


def activate_bills_for_scope(school_id, year, month, student_ids=None):
    """Activate the (year, month) bill for every student who has monthly rows that month.

    One student's failure never stops the others: fee generation has already committed, and the
    periodic sweep repairs whatever this misses. Returns {action: count}.
    """
    if enabled_mapping(school_id) is None:
        return {SKIPPED_NOT_ENABLED: 1}
    rows = FeePayment.objects.filter(
        school_id=school_id, fee_type='MONTHLY', year=year, month=month, student_id__isnull=False,
    )
    if student_ids is not None:
        rows = rows.filter(student_id__in=list(student_ids))
    counts = {}
    for sid in rows.order_by().values_list('student_id', flat=True).distinct():
        try:
            action = activate_bill_for_cycle(school_id, sid, year, month).action
        except Exception:
            logger.exception('Kuickpay bill activation failed (school=%s student=%s %s/%s)', school_id, sid, month, year)
            action = 'error'
        counts[action] = counts.get(action, 0) + 1
    return counts


def sweep_school(school_id, *, dry_run=False):
    """Repair pass: every active student gets a bill for their latest generated cycle, and every
    open bill's ACTIVE/SUSPENDED state is re-synced with the ledger. Returns {name: count}.

    This is the guarantee behind "no manual monthly work": the post-generation hook is the fast
    path, this catches anything that hook missed or that changed later (e.g. an administrator
    refreshed a stale chain).
    """
    counts = {'to_activate': 0, 'activated': 0, 'resynced': 0, 'errors': 0}
    if enabled_mapping(school_id) is None:
        return counts
    latest = dict(
        FeePayment.objects.filter(
            school_id=school_id, fee_type='MONTHLY', student_id__isnull=False, student__is_active=True,
        ).annotate(period=F('year') * 12 + F('month'))
        .order_by().values('student_id').annotate(p=Max('period')).values_list('student_id', 'p')
    )
    open_bills = {
        b.student_ref: b for b in KuickpayBill.objects.filter(school_id=school_id, status__in=OPEN)
    }
    for student_id, period in latest.items():
        year, month = divmod(period - 1, 12)
        year, month = year, month + 1
        current = open_bills.get(student_id)
        if current is not None and (current.year, current.month) >= (year, month):
            continue
        counts['to_activate'] += 1
        if dry_run:
            continue
        try:
            if activate_bill_for_cycle(school_id, student_id, year, month).action == CREATED:
                counts['activated'] += 1
        except Exception:
            logger.exception('Kuickpay sweep failed (school=%s student=%s)', school_id, student_id)
            counts['errors'] += 1
    if not dry_run:
        for bill in KuickpayBill.objects.filter(school_id=school_id, status__in=OPEN):
            try:
                with transaction.atomic():
                    locked = KuickpayBill.objects.select_for_update().get(pk=bill.pk)
                    if payable.sync_bill_state(locked):
                        counts['resynced'] += 1
            except Exception:
                logger.exception('Kuickpay bill re-sync failed (bill=%s)', bill.pk)
                counts['errors'] += 1
    return counts
