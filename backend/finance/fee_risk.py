"""Fee risk from what a family owes today, shared by every risk surface.

The level is arrears measured in months of fees: how many monthly fees the student's
pending monthly balance amounts to. It reuses the cumulative-row rule of
finance.student_balance (a monthly row already includes everything carried forward,
so only the latest row per fee category counts; months are never summed):

    months_owed = pending monthly balance / current monthly fee
    HIGH   at 3 or more months owed
    MEDIUM at 1 or more months owed
    None   (not flagged) otherwise, including annual fees owed on their own

"Current monthly fee" is the sum of the base fees of the categories billed in the
student's most recent billing month, so a category that was dropped long ago does not
shrink the figure. months_overdue is a separate display figure: the longest run, over
the monthly categories, of the most recent months in which nothing at all was paid.
"""
from collections import defaultdict
from decimal import Decimal

from .models import FeePayment

ZERO = Decimal('0')
HIGH_MONTHS_OWED = Decimal('3')
MEDIUM_MONTHS_OWED = Decimal('1')


def _base_fee(row):
    """The month's own charge, without the carried-forward balance."""
    if row['base_monthly_fee'] is not None:
        return row['base_monthly_fee']
    return (row['amount_due'] or ZERO) - (row['previous_balance'] or ZERO)


def _level(months_owed):
    if months_owed >= HIGH_MONTHS_OWED:
        return 'HIGH'
    if months_owed >= MEDIUM_MONTHS_OWED:
        return 'MEDIUM'
    return None


def fee_risk_for_students(student_ids, timelines=None):
    """{student_id: info} for every id given (students with no fee rows get zeros).

    info: pending (all fee types), monthly_pending, monthly_fee, months_owed,
    months_overdue, level ('HIGH' | 'MEDIUM' | None).
    One query however many students.

    timelines ({student_id: segments} from students.timeline): for a student transferred
    in from another branch, what is OWED is still only this branch's rows (the balance
    was carried here), but two figures use what really happened:
      * months_overdue runs across the earlier branch's months too (the carried row is
        the same debt as the earlier branch's last row, so it is not counted twice);
      * when the carried row has no monthly fee of its own, the monthly fee is the one
        the earlier branch last billed, so "months owed" means what it should.
    """
    ids = list(student_ids)
    earlier_of = {}   # earlier record id -> the current record it belongs to
    for primary_id, segments in (timelines or {}).items():
        if primary_id not in ids:
            continue
        for seg in segments:
            if not seg.is_current:
                earlier_of[seg.student_id] = primary_id

    rows_by_student = defaultdict(list)
    for row in FeePayment.objects.filter(student_id__in=ids + list(earlier_of)).order_by(
        'student_id', 'monthly_category_id', 'year', 'month', 'id',
    ).values(
        'id', 'student_id', 'fee_type', 'monthly_category_id', 'monthly_category__name', 'year', 'month',
        'amount_due', 'amount_paid', 'previous_balance', 'base_monthly_fee', 'handed_over_to_exit_id',
        'carried_from_exit_id',
    ):
        row['earlier'] = row['student_id'] in earlier_of
        rows_by_student[earlier_of.get(row['student_id'], row['student_id'])].append(row)

    result = {}
    for sid in ids:
        rows = rows_by_student.get(sid, [])
        has_history = any(r['earlier'] for r in rows)
        if has_history:
            # Categories have different ids at each branch: line them up by name, and walk
            # the months in order across both branches.
            rows = sorted(rows, key=lambda r: (r['year'], r['month'], r['id']))

        latest_monthly = {}   # category -> latest row (rows are ordered, so the last write wins)
        unpaid_run = {}       # category -> trailing months with nothing paid
        earlier_fee = {}      # category name -> the earlier branch's last monthly base fee
        other_pending = ZERO
        for row in rows:
            if row['fee_type'] == 'MONTHLY':
                name = (row['monthly_category__name'] or '').lower()
                key = name if has_history else row['monthly_category_id']
                if row['earlier']:
                    earlier_fee[name] = max(_base_fee(row), ZERO)
                else:
                    latest_monthly[key] = row
                if row['carried_from_exit_id']:
                    continue          # the same debt as the earlier branch's last row
                nothing_paid = (row['amount_paid'] or ZERO) == 0 and (row['amount_due'] or ZERO) > 0
                unpaid_run[key] = unpaid_run.get(key, 0) + 1 if nothing_paid else 0
            elif not row['handed_over_to_exit_id'] and not row['earlier']:
                balance = (row['amount_due'] or ZERO) - (row['amount_paid'] or ZERO)
                if balance > ZERO:
                    other_pending += balance

        # A category handed over to another branch is no longer owed here (its latest
        # row is flagged; older rows must not stand in for it).
        latest_monthly = {k: r for k, r in latest_monthly.items() if not r['handed_over_to_exit_id']}

        monthly_pending = ZERO
        for row in latest_monthly.values():
            balance = (row['amount_due'] or ZERO) - (row['amount_paid'] or ZERO)
            if balance > ZERO:
                monthly_pending += balance

        monthly_fee = ZERO
        if latest_monthly:
            newest = max((r['year'], r['month']) for r in latest_monthly.values())
            monthly_fee = sum(
                (max(_base_fee(r), ZERO) for r in latest_monthly.values() if (r['year'], r['month']) == newest),
                ZERO,
            )
        if monthly_fee <= ZERO and earlier_fee:
            # A carried balance has no monthly fee of its own yet: use what the earlier
            # branch last billed for the same charges.
            monthly_fee = sum(
                (earlier_fee.get((r['monthly_category__name'] or '').lower(), ZERO) for r in latest_monthly.values()),
                ZERO,
            )

        months_owed = (monthly_pending / monthly_fee) if monthly_fee > ZERO else ZERO
        pending = monthly_pending + other_pending
        result[sid] = {
            'pending': pending,
            'monthly_pending': monthly_pending,
            'monthly_fee': monthly_fee,
            'months_owed': months_owed,
            'months_overdue': max(unpaid_run.values(), default=0) if pending > ZERO else 0,
            'level': _level(months_owed),
        }
    return result


def student_fee_risk(student_id, segments=None):
    timelines = {student_id: segments} if segments else None
    return fee_risk_for_students([student_id], timelines)[student_id]
