"""What the parent app may show about a child's Kuickpay bills (approval AD-8, AD-16).

Only the single open bill is ever "active", and only an ACTIVE bill with something to pay is
payable. Superseded bills appear in history, always non-payable. Nothing internal leaks: a
suspended bill gets a neutral message, never the reason, and no other consumer's data appears.
"""
from finance.kuickpay import payable
from finance.kuickpay.bills import OPEN, enabled_mapping
from finance.models import KuickpayBill, KuickpayTransaction

SUSPENDED_MESSAGE = (
    'Online payment is temporarily unavailable for this child. Please contact the school office.'
)
SCOPE_NOTE = 'This bill covers monthly fees only.'

_TXN_LABELS = {
    KuickpayTransaction.Status.POSTED: 'PAID',
    KuickpayTransaction.Status.RECEIVED: 'PROCESSING',
    KuickpayTransaction.Status.PENDING_PERIOD_LOCK: 'PROCESSING',
    KuickpayTransaction.Status.PENDING_RETRY: 'PROCESSING',
    KuickpayTransaction.Status.HELD: 'UNDER_REVIEW',
    KuickpayTransaction.Status.EXCEPTIONAL_EXPIRED: 'UNDER_REVIEW',
}


def _money(value):
    return f'{value:.2f}'


def _transactions(bill):
    return [
        {'amount': _money(t.amount), 'date': t.tran_date.isoformat(), 'status': _TXN_LABELS[t.status]}
        for t in bill.transactions.order_by('-received_at') if t.status in _TXN_LABELS
    ]


def _active_bill(bill):
    evaluation = payable.evaluate(bill)
    suspended = bill.status == KuickpayBill.Status.SUSPENDED or bool(evaluation.suspend_reason)
    return {
        'consumer_number': bill.consumer_number,
        'biller_name': bill.biller.name,
        'cycle': {'year': bill.year, 'month': bill.month},
        'status': 'SUSPENDED' if suspended else 'ACTIVE',
        'payable': payable.is_payable(bill, evaluation),
        'payable_amount': _money(evaluation.payable),
        # Lines add up to payable_amount + processing_amount.
        'breakdown': [
            {
                'category_id': line.category_id, 'category_name': line.category_name,
                'period': {'year': line.year, 'month': line.month}, 'amount': _money(line.balance),
            }
            for line in evaluation.rows if line.balance > 0
        ],
        'processing_amount': _money(evaluation.processing),
        'scope_note': SCOPE_NOTE,
        'message': SUSPENDED_MESSAGE if suspended else '',
        'transactions': _transactions(bill),
    }


def build_parent_summary(student):
    """{'enabled', 'active_bill', 'history'} for one child. Read-only."""
    if enabled_mapping(student.school_id) is None:
        return {'enabled': False, 'active_bill': None, 'history': []}
    bills = list(
        KuickpayBill.objects.select_related('biller')
        .filter(school_id=student.school_id, student_ref=student.id)
        .order_by('-year', '-month', '-id')
    )
    open_bill = next((b for b in bills if b.status in OPEN), None)
    history = [
        {
            'consumer_number': b.consumer_number,
            'cycle': {'year': b.year, 'month': b.month},
            'status': 'EXPIRED',
            'payable': False,
            'superseded_at': b.superseded_at.isoformat() if b.superseded_at else None,
            'transactions': _transactions(b),
        }
        for b in bills if b is not open_bill
    ]
    return {
        'enabled': True,
        'active_bill': _active_bill(open_bill) if open_bill else None,
        'history': history,
    }
