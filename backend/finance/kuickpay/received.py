"""The small "received via Kuickpay" label shown on a fee record to every role that can see it.

Built from the confirmed allocations on the fee row, so it appears only for money that has really
been credited to that row (never for payments that are held or not yet posted), and it names the
Kuickpay reference the parent can quote. One place builds the text so the web and mobile apps agree.
"""
from decimal import Decimal

from finance.kuickpay import contract

GATEWAY = 'Kuickpay'
FULL = 'FULL'
PARTIAL = 'PARTIAL'


def money(amount):
    """PKR 6,500 / PKR 6,500.50, matching how the apps print amounts."""
    amount = Decimal(amount)
    return f'PKR {amount:,.0f}' if amount == amount.to_integral_value() else f'PKR {amount:,.2f}'


def received_summary(fee_payment):
    """None when nothing was received through Kuickpay, else the label data for this fee row.

    Uses ``fee_payment.kuickpay_allocations.all()``; list views prefetch it (with the transaction)
    so a page of rows costs one extra query, not one per row.
    """
    allocations = list(fee_payment.kuickpay_allocations.all())
    if not allocations:
        return None
    allocations.sort(key=lambda a: (a.transaction.tran_date, a.transaction.tran_time, a.id))
    received = sum((a.amount for a in allocations), Decimal('0'))
    due = fee_payment.amount_due or Decimal('0')
    coverage = FULL if due > 0 and received >= due else PARTIAL
    references = []
    for a in allocations:
        if a.transaction.tran_auth_id not in references:
            references.append(a.transaction.tran_auth_id)
    return {
        'gateway': GATEWAY,
        'received': f'{received:.2f}',
        'coverage': coverage,
        'label': f"{money(received)} received via {GATEWAY} ({'paid in full' if coverage == FULL else 'partial payment'})",
        'reference_text': ('Ref ' if len(references) == 1 else 'Refs ') + ', '.join(references),
        'payments': [
            {
                'reference': a.transaction.tran_auth_id,
                'receipt': contract.receipt_id(a.transaction_id),
                'date': a.transaction.tran_date.isoformat(),
                'amount': f'{a.amount:.2f}',
            }
            for a in allocations
        ],
    }
