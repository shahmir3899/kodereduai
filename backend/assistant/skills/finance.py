"""Finance tools.

Phase 0 wraps the existing FinanceAIAgent query methods instead of copying them, so the
numbers stay identical to what the old chat produced. Their only change is the way they
are called: native tool calling through the shared orchestrator, with role checks.
"""
from ..registry import FINANCE_ROLES, Tool, register

_DATE = {'type': 'string', 'description': 'YYYY-MM-DD'}
_MONTH = {'type': 'integer', 'minimum': 1, 'maximum': 12}
_YEAR = {'type': 'integer'}
_CLASS = {'type': 'string', 'description': 'Class name, e.g. "Class 5" or "8B"'}
_RANGE = {'date_from': _DATE, 'date_to': _DATE}

# name -> (description, properties)
_SPECS = {
    'get_pending_fees': ('Total pending/unpaid fee amount, optionally for a class and month.',
                         {'class_name': _CLASS, 'month': _MONTH, 'year': _YEAR}),
    'get_total_expenses': ('ONE total of expenses, optionally for one category and a date range. Not for a split by category: use get_expense_breakdown for that. '
                           'The SALARY category is only salary expenses booked in the ledger; the staff salary bill for a month is get_payroll_summary (hr).',
                           {'category': {'type': 'string', 'enum': ['SALARY', 'RENT', 'UTILITIES', 'SUPPLIES', 'MAINTENANCE', 'MISC']}, **_RANGE}),
    'get_income_summary': ('Fee collection summary for a month.', {'month': _MONTH, 'year': _YEAR}),
    'get_balance': ('Net position to date: ALL income (fees + other) minus ALL expenses. Call it with NO dates for "total collection minus expenses so far"; add dates only for a specific period. For one month of fee collection use get_income_summary.', _RANGE),
    'get_expense_breakdown': ('Expenses split by category (break down, split up, category wise, what did we spend on). Returns every category with its amount.', _RANGE),
    'get_other_income': ('Non-fee income (sales, donations, events).',
                         {'category': {'type': 'string', 'enum': ['SALE', 'DONATION', 'EVENT', 'MISC']}, **_RANGE}),
    'get_account_balances': ('Balance of every account (opening + receipts - payments +/- transfers).', _RANGE),
    'get_fee_structure': ('Configured fee amounts per class and fee type.',
                          {'class_name': _CLASS, 'fee_type': {'type': 'string', 'enum': ['MONTHLY', 'ANNUAL', 'ADMISSION', 'BOOKS', 'FINE']}}),
    'get_payment_method_analysis': ('Fee collection by payment method.', {'month': _MONTH, 'year': _YEAR}),
    'get_scholarships_summary': ('Active scholarships with recipient counts and waived amounts.', {}),
    'get_discounts_impact': ('Total discounts applied, grouped by type.', {}),
    'get_online_payment_status': ('Online payment success/failure rates.', _RANGE),
    'get_monthly_closing_status': ('Which months are closed or open.', {}),
    'get_fee_defaulters': ('Students with consecutive unpaid months.',
                           {'min_months': {'type': 'integer', 'minimum': 1}}),
    'get_collection_trend': ('Month-over-month fee collection rate.',
                             {'months': {'type': 'integer', 'minimum': 1, 'maximum': 24}}),
    'get_transfer_history': ('Transfers between accounts.', _RANGE),
    'get_top_expenses': ('Largest individual expenses.',
                         {'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50}, **_RANGE}),
}


def _make_handler(tool_name):
    def handler(ctx, **params):
        from finance.ai_agent import FinanceAIAgent
        return FinanceAIAgent(ctx.school_id, role=ctx.role)._execute_tool(tool_name, params)
    return handler


for _name, (_desc, _props) in _SPECS.items():
    register(Tool(
        name=_name,
        description=_desc,
        parameters={'type': 'object', 'properties': _props, 'additionalProperties': False},
        handler=_make_handler(_name),
        sub_agent='finance',
        module='finance',
        roles=FINANCE_ROLES,
    ))


def list_scholarship_recipients(ctx, scholarship_name=None, limit=50):
    """Names of students who hold a scholarship (get_scholarships_summary only has counts)."""
    from finance.models import StudentDiscount

    qs = StudentDiscount.objects.filter(school_id=ctx.school_id, is_active=True, scholarship__isnull=False,
                                        student__isnull=False).select_related('student__class_obj', 'scholarship')
    if scholarship_name:
        qs = qs.filter(scholarship__name__icontains=scholarship_name)
    rows = [{'student_id': d.student_id, 'student': d.student.name,
             'class': d.student.class_obj.name if d.student.class_obj_id else '',
             'scholarship': d.scholarship.name, 'type': d.scholarship.scholarship_type}
            for d in qs.order_by('scholarship__name', 'student__name')[:min(int(limit), 100)]]
    return {'count': qs.count(), 'shown': len(rows), 'recipients': rows}


register(Tool(
    name='list_scholarship_recipients',
    description='Who has a scholarship: student names, class and scholarship, optionally for one scholarship name. '
                'Use for "which students have a scholarship"; get_scholarships_summary only gives counts.',
    parameters={'type': 'object', 'properties': {
        'scholarship_name': {'type': 'string'},
        'limit': {'type': 'integer', 'minimum': 1, 'maximum': 100},
    }, 'additionalProperties': False},
    handler=list_scholarship_recipients, sub_agent='finance', module='finance', roles=FINANCE_ROLES,
))
