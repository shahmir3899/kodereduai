"""A student's current pending fee, computed without double counting.

Monthly rows are cumulative: FeePayment.amount_due = previous_balance + base fee
(see finance.views._get_previous_month_balance), so summing due - paid over every
month counts an unpaid January again in February, March and so on. The balance
a family owes today is therefore:

  * for each monthly fee category, the balance of its LATEST monthly row (it
    already contains everything carried forward), plus
  * for annual and the deprecated one-off fee types, each row's own balance.

Credits (ADVANCE rows, or paid above due) never offset another row's balance.

Rows handed over to another branch in a transfer (handed_over_to_exit) are no longer
owed here: the balance now lives on the destination branch's carried row. The latest
monthly row is still picked first, so an older row never takes its place.
"""
from decimal import Decimal

from django.db.models import Sum

from .models import FeePayment

ZERO = Decimal('0')


def _balance(payment):
    return (payment.amount_due or ZERO) - (payment.amount_paid or ZERO)


def student_pending_fees(student):
    """Return {'total': Decimal, 'items': [...]} for one student.

    Each item: {'fee_type', 'label', 'month', 'year', 'amount_due', 'amount_paid', 'balance'}
    and only rows that still owe money are listed.
    """
    payments = (
        FeePayment.objects
        .filter(student=student)
        .select_related('monthly_category', 'annual_category')
        .order_by('year', 'month', 'id')
    )

    latest_monthly = {}
    others = []
    for payment in payments:
        if payment.fee_type == 'MONTHLY':
            # Ordered by (year, month), so the last write per category is its latest row.
            latest_monthly[payment.monthly_category_id] = payment
        else:
            others.append(payment)

    items = []
    for payment in [*latest_monthly.values(), *others]:
        if payment.handed_over_to_exit_id:
            continue
        balance = _balance(payment)
        if balance <= ZERO:
            continue
        category = payment.monthly_category if payment.fee_type == 'MONTHLY' else payment.annual_category
        label = getattr(category, 'name', None) or payment.get_fee_type_display()
        items.append({
            'payment_id': payment.id,
            'category_id': payment.monthly_category_id if payment.fee_type == 'MONTHLY' else payment.annual_category_id,
            'fee_type': payment.fee_type,
            'label': label,
            'month': payment.month,
            'year': payment.year,
            'amount_due': payment.amount_due,
            'amount_paid': payment.amount_paid,
            'balance': balance,
        })

    return {'total': sum((i['balance'] for i in items), ZERO), 'items': items}


def student_fee_summary(student):
    """Headline fee figures for one student, consistent with each other.

    ``total_paid`` is money actually received (a plain sum of amount_paid: it never
    double counts). ``pending`` is what is still owed today (student_pending_fees).
    ``total_due`` is therefore what has been charged: paid plus still pending. Summing
    amount_due over every row instead would count a carried-forward monthly balance
    again in each later month.
    """
    pending = student_pending_fees(student)['total']
    paid = FeePayment.objects.filter(student=student).aggregate(total=Sum('amount_paid'))['total'] or ZERO
    return {'total_paid': paid, 'pending': pending, 'total_due': paid + pending}
