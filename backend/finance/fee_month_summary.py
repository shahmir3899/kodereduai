"""Single source for the fee-collection numbers shown on the dashboards.

The admin dashboard, finance dashboard, accountant dashboard and the dashboard
bootstrap each used to re-implement this aggregation with slightly different
filters (one of them MONTHLY-only), so the same month showed different rates on
different screens. Everything now goes through ``month_payments`` +
``summarize`` so they cannot drift apart again.
"""
from decimal import Decimal

from django.db.models import Count, Q, Sum

from .models import FeePayment, FeeType

ZERO = Decimal('0')

# Non-monthly types are stored with month=0 (see FeePayment.month), so "this
# month" has to pull MONTHLY rows for the calendar month and the month=0 rows
# separately; a plain month filter silently drops every annual fee.
_TYPE_ORDER = {code: i for i, (code, _) in enumerate(FeeType.choices)}


def month_payments(school_ids, month, year, academic_year_id=None, fee_type=None):
    """FeePayment rows that count towards the dashboard fee numbers.

    ``fee_type`` given: that type only, for exactly ``month`` (callers asking for
    ANNUAL pass month=0 themselves). Not given: every type — MONTHLY rows for
    ``month`` plus the month=0 rows of the other types for ``year``.
    """
    month, year = int(month), int(year)
    payments = FeePayment.objects.filter(school_id__in=school_ids, year=year)
    if academic_year_id:
        payments = payments.filter(academic_year_id=academic_year_id)
    if fee_type:
        return payments.filter(fee_type=fee_type.upper(), month=month)
    return payments.filter(
        Q(fee_type=FeeType.MONTHLY, month=month)
        | (~Q(fee_type=FeeType.MONTHLY) & Q(month=0))
    )


def _pending(due, collected):
    return max(ZERO, due - collected)


def summarize(payments):
    """Totals, status counts and per-type / per-category breakdowns for ``payments``."""
    totals = payments.aggregate(total_due=Sum('amount_due'), total_collected=Sum('amount_paid'))
    total_due = totals['total_due'] or ZERO
    total_collected = totals['total_collected'] or ZERO

    counts = {
        row['status']: row['count']
        for row in payments.order_by().values('status').annotate(count=Count('id'))
    }

    type_labels = dict(FeeType.choices)
    by_type = sorted(
        (
            {
                'fee_type': row['fee_type'],
                'fee_type_label': type_labels.get(row['fee_type'], row['fee_type']),
                'total_due': row['total_due'] or ZERO,
                'total_collected': row['total_collected'] or ZERO,
                'total_pending': _pending(row['total_due'] or ZERO, row['total_collected'] or ZERO),
                'count': row['count'],
            }
            for row in payments.order_by().values('fee_type').annotate(
                total_due=Sum('amount_due'), total_collected=Sum('amount_paid'), count=Count('id'),
            )
        ),
        key=lambda r: _TYPE_ORDER.get(r['fee_type'], 99),
    )

    # A payment carries a monthly OR an annual category, never both; the
    # fee_type on each row lets the UI nest categories under their type row.
    by_category = [
        {
            'category_id': row['monthly_category__id'] or row['annual_category__id'],
            'category_name': (
                row['monthly_category__name'] or row['annual_category__name'] or 'Uncategorized'
            ),
            'fee_type': row['fee_type'],
            'total_due': row['total_due'] or ZERO,
            'total_collected': row['total_collected'] or ZERO,
            'count': row['count'],
        }
        for row in payments.exclude(
            monthly_category__isnull=True, annual_category__isnull=True,
        ).order_by().values(
            'fee_type', 'monthly_category__id', 'monthly_category__name',
            'annual_category__id', 'annual_category__name',
        ).annotate(
            total_due=Sum('amount_due'), total_collected=Sum('amount_paid'), count=Count('id'),
        )
    ]
    by_category.sort(key=lambda c: (_TYPE_ORDER.get(c['fee_type'], 99), c['category_name']))

    return {
        'total_due': total_due,
        'total_collected': total_collected,
        'total_pending': _pending(total_due, total_collected),
        'paid_count': counts.get('PAID', 0),
        'partial_count': counts.get('PARTIAL', 0),
        'unpaid_count': counts.get('UNPAID', 0),
        'advance_count': counts.get('ADVANCE', 0),
        'by_type': by_type,
        'by_category': by_category,
    }


def summarize_schools(schools, month, year, fee_type=None):
    """Per-school summaries plus a combined ``grand`` summary, for multi-school admins.

    Academic-year ids belong to a single school, so the caller's active-year id
    cannot filter the others; each school is scoped to its own current year
    (falling back to unfiltered when it has none).
    """
    from academic_sessions.models import AcademicYear

    current_years = dict(
        AcademicYear.objects.filter(school__in=schools, is_current=True)
        .values_list('school_id', 'id')
    )
    per_school = []
    for school in schools:
        summary = summarize(month_payments(
            [school.id], month, year,
            academic_year_id=current_years.get(school.id), fee_type=fee_type,
        ))
        per_school.append({'school_id': school.id, 'school_name': school.name, **summary})

    grand_due = sum((s['total_due'] for s in per_school), ZERO)
    grand_collected = sum((s['total_collected'] for s in per_school), ZERO)
    by_type = {}
    for s in per_school:
        for row in s['by_type']:
            agg = by_type.setdefault(row['fee_type'], {
                'fee_type': row['fee_type'], 'fee_type_label': row['fee_type_label'],
                'total_due': ZERO, 'total_collected': ZERO, 'count': 0,
            })
            agg['total_due'] += row['total_due']
            agg['total_collected'] += row['total_collected']
            agg['count'] += row['count']
    for agg in by_type.values():
        agg['total_pending'] = _pending(agg['total_due'], agg['total_collected'])

    grand = {
        'total_due': grand_due,
        'total_collected': grand_collected,
        'total_pending': _pending(grand_due, grand_collected),
        'paid_count': sum(s['paid_count'] for s in per_school),
        'partial_count': sum(s['partial_count'] for s in per_school),
        'unpaid_count': sum(s['unpaid_count'] for s in per_school),
        'advance_count': sum(s['advance_count'] for s in per_school),
        'by_type': sorted(by_type.values(), key=lambda r: _TYPE_ORDER.get(r['fee_type'], 99)),
        'by_category': [],
    }
    return per_school, grand
