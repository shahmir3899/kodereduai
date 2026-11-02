"""The one place that answers "what does this student owe" for monthly fees.

Monthly FeePayment rows are cumulative: ``amount_due = previous_balance + base_monthly_fee``, and
``previous_balance`` is the unpaid (or overpaid, negative) balance of the same category's
latest earlier row. Fee generation, the single-row generator, the integrity report and the
Kuickpay bill all read it through this module so there is never a second liability calculation.

Everything here is read-only except ``refresh_chain``, an explicit administrator action.

A row handed over to another branch in a transfer (``handed_over_to_exit``) carries nothing
forward: its balance now lives on the destination branch's row. It is still the *latest* row
of its chain, so an older row never takes its place (same rule as ``student_balance``).
"""
from decimal import Decimal

from django.db import connection, transaction
from django.core.exceptions import ValidationError
from django.db.models import F, Max

from .models import FeePayment

ZERO = Decimal('0')


def period_of(year, month):
    """Calendar month as one comparable integer."""
    return year * 12 + month


def lock_generation(school_id, year, month):
    """Serialize fee generation for one school and month (PostgreSQL advisory lock, released at the
    end of the surrounding transaction). A no-op elsewhere: SQLite has one writer at a time."""
    if connection.vendor != 'postgresql':
        return
    with connection.cursor() as cursor:
        cursor.execute('SELECT pg_advisory_xact_lock(%s, %s)', [school_id, period_of(year, month)])


def row_balance(row):
    """``due - paid``, unclamped: an overpaid row carries a negative balance, as generation always did."""
    return (row.amount_due or ZERO) - (row.amount_paid or ZERO)


def _carry_value(row):
    """Balance a row hands to the next month: nothing when its balance moved to another branch."""
    if row.handed_over_to_exit_id:
        return ZERO
    return row_balance(row)


def _monthly_rows(school_id, student_ids, category_id=None):
    qs = FeePayment.objects.filter(
        school_id=school_id, fee_type='MONTHLY', student_id__in=list(student_ids),
    )
    if category_id is not None:
        qs = qs.filter(monthly_category_id=category_id)
    return qs.annotate(period=F('year') * 12 + F('month'))


def latest_prior_rows(school_id, student_ids, category_id, year, month, *, lock=False):
    """{student_id: row} - each student's latest same-category MONTHLY row earlier than (year, month).

    Not just month M-1: a category with no row in M-1 (vacation month, gap, newly active category)
    must not lose the balance of the row before it.

    ``lock=True`` row-locks the rows read, in id order, so a concurrent payment cannot slip in
    between this read and the new row being written. Only meaningful inside ``transaction.atomic()``.
    """
    student_ids = list(student_ids)
    if not student_ids:
        return {}
    target = period_of(year, month)
    prior = _monthly_rows(school_id, student_ids, category_id).filter(period__lt=target)
    # order_by() clears the model's default ordering, which would otherwise leak into GROUP BY.
    latest = dict(
        prior.order_by().values('student_id').annotate(p=Max('period')).values_list('student_id', 'p')
    )
    if not latest:
        return {}
    rows = prior.filter(period__in=set(latest.values())).order_by('id')
    if lock:
        rows = rows.select_for_update()
    return {r.student_id: r for r in rows if r.period == latest[r.student_id]}


def carry_in_balances(school_id, student_ids, category_id, year, month, *, lock=False):
    """{student_id: balance carried into (year, month)}; students with no earlier row are absent."""
    rows = latest_prior_rows(school_id, student_ids, category_id, year, month, lock=lock)
    return {sid: _carry_value(row) for sid, row in rows.items()}


def carry_in_balance(school_id, student_id, category_id, year, month, *, lock=False):
    """Single-student form of ``carry_in_balances``; zero when nothing is carried."""
    return carry_in_balances(school_id, [student_id], category_id, year, month, lock=lock).get(student_id, ZERO)


def monthly_member_rows(school_id, student_id):
    """The student's latest MONTHLY row per category, excluding rows handed over to another branch.

    These rows already contain every earlier unpaid month, so they - and only they - make up what
    is owed in monthly fees today.
    """
    latest = {}
    for row in _monthly_rows(school_id, [student_id]).order_by('period', 'id'):
        latest[row.monthly_category_id] = row
    return [r for _, r in sorted(latest.items(), key=lambda kv: (kv[1].period, kv[0] or 0))
            if not r.handed_over_to_exit_id]


def outstanding(school_id, student_id):
    """Monthly fees still owed: sum of ``max(0, due - paid)`` over the member rows.

    A credit on one category never offsets another category's balance.
    """
    return sum((max(ZERO, row_balance(r)) for r in monthly_member_rows(school_id, student_id)), ZERO)


def _is_pinned(row):
    """Rows regeneration must never rewrite: balances taken over from another branch, and legacy
    rows with no recorded base fee (their override cannot be separated from the carried part)."""
    return bool(row.carried_from_exit_id) or row.base_monthly_fee is None


def _chains(school_id, student_ids):
    chains = {}
    for row in _monthly_rows(school_id, student_ids).order_by('student_id', 'monthly_category_id', 'period', 'id'):
        chains.setdefault((row.student_id, row.monthly_category_id), []).append(row)
    return chains


def chain_integrity(school_id, student_ids):
    """Read-only audit of every (student, category) chain. Returns a list of findings:

    * ``stale`` - a row's ``previous_balance`` no longer equals the balance of the row before it
      (a payment was recorded on the earlier row after this one was generated).
    * ``gap``   - months with no row between two consecutive rows (informational: the balance
      does carry across it).

    Pinned rows are skipped for ``stale`` because regeneration never rewrites them.
    """
    findings = []
    for (student_id, category_id), rows in _chains(school_id, student_ids).items():
        for prev, cur in zip(rows, rows[1:]):
            if period_of(cur.year, cur.month) - period_of(prev.year, prev.month) > 1:
                findings.append({
                    'kind': 'gap', 'student_id': student_id, 'category_id': category_id,
                    'after': (prev.year, prev.month), 'before': (cur.year, cur.month),
                })
            if _is_pinned(cur):
                continue
            expected = _carry_value(prev)
            if (cur.previous_balance or ZERO) != expected:
                findings.append({
                    'kind': 'stale', 'student_id': student_id, 'category_id': category_id,
                    'row_id': cur.id, 'period': (cur.year, cur.month),
                    'stored_previous_balance': cur.previous_balance, 'expected_previous_balance': expected,
                })
    return findings


def refresh_chain(school_id, student_id, category_id, *, dry_run=True):
    """Bring a chain's later rows back in line with the rows before them. Administrator action only.

    For each row after the first: ``previous_balance`` becomes the earlier row's balance and
    ``amount_due`` is recomputed, keeping any manual override (``amount_due`` minus
    ``previous_balance + base_monthly_fee``) exactly as it was. Pinned rows are left alone, and a row
    whose recorded payment would exceed its new amount due is left alone too (the same protection
    the ``update`` generation mode applies). Writes go through ``save()`` so a closed accounting
    period refuses the change; the chain then stops there and the reason is reported.

    Returns ``[{'row_id', 'period', 'action', ...}]`` where action is one of
    ``updated`` / ``would_update`` / ``protected`` / ``period_closed``.
    """
    results = []
    with transaction.atomic():
        rows = list(
            _monthly_rows(school_id, [student_id], category_id)
            .order_by('period', 'id').select_for_update()
        )
        for prev, cur in zip(rows, rows[1:]):
            if _is_pinned(cur):
                continue
            new_prev = _carry_value(prev)
            override = (cur.amount_due or ZERO) - ((cur.previous_balance or ZERO) + (cur.base_monthly_fee or ZERO))
            new_due = new_prev + (cur.base_monthly_fee or ZERO) + override
            if new_prev == (cur.previous_balance or ZERO) and new_due == (cur.amount_due or ZERO):
                continue
            entry = {
                'row_id': cur.id, 'period': (cur.year, cur.month),
                'old_previous_balance': cur.previous_balance, 'new_previous_balance': new_prev,
                'old_amount_due': cur.amount_due, 'new_amount_due': new_due,
            }
            if (cur.amount_paid or ZERO) > new_due:
                results.append({**entry, 'action': 'protected'})
                continue
            # Applied in memory even for a dry run so the next row in the chain is computed from
            # this row's would-be values, not its stale ones.
            cur.previous_balance = new_prev
            cur.amount_due = new_due
            if dry_run:
                results.append({**entry, 'action': 'would_update'})
                continue
            try:
                with transaction.atomic():
                    cur.save()
            except ValidationError as exc:
                results.append({**entry, 'action': 'period_closed', 'detail': '; '.join(exc.messages)})
                break
            results.append({**entry, 'action': 'updated'})
    return results
