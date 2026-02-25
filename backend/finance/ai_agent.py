"""
Finance AI Chat Agent.

Uses Groq LLM to interpret natural language financial queries and
translate them into database queries scoped to the user's school.
"""

import json
import logging
from datetime import date
from decimal import Decimal

from django.conf import settings
from django.db.models import Sum, Count, Q

logger = logging.getLogger(__name__)


class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super().default(obj)


SYSTEM_PROMPT = """You are a helpful financial assistant for a school management platform.
You answer questions about school fees, expenses, and financial data.

You have access to these tools. When you need data, respond with a JSON tool call.
You may call multiple tools across turns to gather all the information needed.
When you have enough information, respond directly with a clear, concise answer.

Tools:

1. get_pending_fees - Get pending/unpaid fee amounts
   Parameters: class_name (optional), month (optional, 1-12), year (optional)

2. get_total_expenses - Get total expenses
   Parameters: category (optional: SALARY/RENT/UTILITIES/SUPPLIES/MAINTENANCE/MISC), date_from (optional, YYYY-MM-DD), date_to (optional, YYYY-MM-DD)

3. get_unpaid_students - List students who haven't paid
   Parameters: class_name (optional), month (optional, 1-12), year (optional)

4. get_income_summary - Get fee collection summary
   Parameters: month (optional), year (optional)

5. get_balance - Get income minus expenses
   Parameters: date_from (optional, YYYY-MM-DD), date_to (optional, YYYY-MM-DD)

6. get_expense_breakdown - Get expenses grouped by category
   Parameters: date_from (optional, YYYY-MM-DD), date_to (optional, YYYY-MM-DD)

7. get_other_income - Get non-fee income (book sales, donations, events, etc.)
   Parameters: category (optional: SALE/DONATION/EVENT/MISC), date_from (optional, YYYY-MM-DD), date_to (optional, YYYY-MM-DD)

8. get_account_balances - Get balance summary for all accounts (BBF + receipts - payments + transfers in - transfers out)
   Parameters: date_from (optional, YYYY-MM-DD), date_to (optional, YYYY-MM-DD)

9. get_fee_structure - Get configured fee amounts per class and type
   Parameters: class_name (optional), fee_type (optional: MONTHLY/ANNUAL/ADMISSION/BOOKS/FINE)

10. get_payment_method_analysis - Fee collection breakdown by payment method
    Parameters: month (optional, 1-12), year (optional)

11. get_scholarships_summary - Active scholarships with recipient counts and waived amounts
    Parameters: none

12. get_discounts_impact - Total discounts applied, grouped by type
    Parameters: none

13. get_online_payment_status - Online payment success/failure rates
    Parameters: date_from (optional, YYYY-MM-DD), date_to (optional, YYYY-MM-DD)

14. get_monthly_closing_status - Which months are closed/open
    Parameters: none

15. get_fee_defaulters - Students with consecutive unpaid months (chronic defaulters)
    Parameters: min_months (optional, default 2)

16. get_collection_trend - Month-over-month fee collection rate comparison
    Parameters: months (optional, default 6)

17. get_transfer_history - Inter-account transfers
    Parameters: date_from (optional, YYYY-MM-DD), date_to (optional, YYYY-MM-DD)

18. get_top_expenses - Largest expenses by amount
    Parameters: limit (optional, default 10), date_from (optional, YYYY-MM-DD), date_to (optional, YYYY-MM-DD)

Current date: {current_date}
School: {school_name}

To call a tool, respond with ONLY a JSON object like:
{{"tool": "get_pending_fees", "params": {{"month": 2, "year": 2026}}}}

If the question is not about finances, respond with a helpful answer directly (no JSON)."""


class FinanceAIAgent:
    """AI agent that answers natural language questions about school finances."""

    def __init__(self, school_id):
        self.school_id = school_id
        self._school = None

    @property
    def school(self):
        if self._school is None:
            from schools.models import School
            self._school = School.objects.get(id=self.school_id)
        return self._school

    def process_query(self, user_message, user=None):
        """Process a user's natural language query and return a response.

        Args:
            user_message: The user's question.
            user: Optional Django User instance for loading conversation history.
        """
        if not settings.GROQ_API_KEY:
            return self._fallback_response(user_message)

        try:
            from groq import Groq
            client = Groq(api_key=settings.GROQ_API_KEY)

            system = SYSTEM_PROMPT.format(
                current_date=date.today().isoformat(),
                school_name=self.school.name,
            )

            messages = [{"role": "system", "content": system}]

            # Load last 10 messages from DB for context continuity
            if user:
                from .models import FinanceAIChatMessage
                history = FinanceAIChatMessage.objects.filter(
                    school_id=self.school_id, user=user
                ).order_by('-created_at')[:10]
                for msg in reversed(list(history)):
                    messages.append({"role": msg.role, "content": msg.content})

            messages.append({"role": "user", "content": user_message})

            # Multi-round tool-calling loop (up to 3 rounds)
            response = client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=messages,
                temperature=0.3,
                max_tokens=1000,
            )
            content = response.choices[0].message.content.strip()

            max_tool_rounds = 3
            for _ in range(max_tool_rounds):
                try:
                    # Try to parse as JSON tool call
                    if '```json' in content:
                        json_str = content.split('```json')[1].split('```')[0]
                    elif '```' in content:
                        json_str = content.split('```')[1].split('```')[0]
                    elif content.strip().startswith('{'):
                        json_str = content.strip()
                    else:
                        break  # Not a tool call — final answer

                    tool_call = json.loads(json_str)
                    if 'tool' not in tool_call:
                        break

                    if tool_call.get('tool') == 'none':
                        return tool_call.get('answer', "I can help with questions about fees, expenses, and school finances.")

                    # Execute tool
                    tool_name = tool_call.get('tool', '')
                    params = tool_call.get('params', {})
                    data = self._execute_tool(tool_name, params)

                    # Append tool result and call LLM again
                    messages.append({"role": "assistant", "content": content})
                    messages.append({"role": "user", "content": f"Tool result: {json.dumps(data, cls=DecimalEncoder)}"})

                    response = client.chat.completions.create(
                        model=settings.GROQ_MODEL,
                        messages=messages,
                        temperature=0.3,
                        max_tokens=1000,
                    )
                    content = response.choices[0].message.content.strip()

                except (json.JSONDecodeError, IndexError, KeyError):
                    break

            return content

        except Exception as e:
            logger.error(f"Finance AI agent error: {e}")
            return self._fallback_response(user_message)

    def _execute_tool(self, tool_name, params):
        """Execute a tool call and return the data."""
        tools = {
            'get_pending_fees': self._get_pending_fees,
            'get_total_expenses': self._get_total_expenses,
            'get_unpaid_students': self._get_unpaid_students,
            'get_income_summary': self._get_income_summary,
            'get_balance': self._get_balance,
            'get_expense_breakdown': self._get_expense_breakdown,
            'get_other_income': self._get_other_income,
            'get_account_balances': self._get_account_balances,
            'get_fee_structure': self._get_fee_structure,
            'get_payment_method_analysis': self._get_payment_method_analysis,
            'get_scholarships_summary': self._get_scholarships_summary,
            'get_discounts_impact': self._get_discounts_impact,
            'get_online_payment_status': self._get_online_payment_status,
            'get_monthly_closing_status': self._get_monthly_closing_status,
            'get_fee_defaulters': self._get_fee_defaulters,
            'get_collection_trend': self._get_collection_trend,
            'get_transfer_history': self._get_transfer_history,
            'get_top_expenses': self._get_top_expenses,
        }

        handler = tools.get(tool_name)
        if not handler:
            available = ', '.join(tools.keys())
            return {"error": f"Unknown tool: {tool_name}. Available tools: {available}"}

        return handler(**params)

    def _get_pending_fees(self, class_name=None, month=None, year=None):
        from .models import FeePayment
        from students.models import Class

        today = date.today()
        month = month or today.month
        year = year or today.year

        qs = FeePayment.objects.filter(
            school_id=self.school_id,
            status__in=['UNPAID', 'PARTIAL'],
            month=month,
            year=year,
        )

        if class_name:
            qs = qs.filter(student__class_obj__name__icontains=class_name)

        totals = qs.aggregate(
            total_due=Sum('amount_due'),
            total_paid=Sum('amount_paid'),
        )
        total_due = totals['total_due'] or 0
        total_paid = totals['total_paid'] or 0

        return {
            "month": month,
            "year": year,
            "class_filter": class_name,
            "total_pending": float(total_due) - float(total_paid),
            "total_due": float(total_due),
            "total_paid": float(total_paid),
            "unpaid_count": qs.count(),
        }

    def _get_total_expenses(self, category=None, date_from=None, date_to=None):
        from .models import Expense

        qs = Expense.objects.filter(school_id=self.school_id)
        if category:
            qs = qs.filter(category__name__iexact=category)
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)

        total = qs.aggregate(total=Sum('amount'))['total'] or 0
        return {
            "total_expenses": float(total),
            "count": qs.count(),
            "category_filter": category,
            "date_from": date_from,
            "date_to": date_to,
        }

    def _get_unpaid_students(self, class_name=None, month=None, year=None):
        from .models import FeePayment

        today = date.today()
        month = month or today.month
        year = year or today.year

        qs = FeePayment.objects.filter(
            school_id=self.school_id,
            status='UNPAID',
            month=month,
            year=year,
        ).select_related('student', 'student__class_obj')

        if class_name:
            qs = qs.filter(student__class_obj__name__icontains=class_name)

        students = [
            {
                "name": p.student.name,
                "roll_number": p.student.roll_number,
                "class": p.student.class_obj.name,
                "amount_due": float(p.amount_due),
            }
            for p in qs[:50]  # Limit to 50 for LLM context
        ]

        return {
            "month": month,
            "year": year,
            "class_filter": class_name,
            "total_unpaid": len(students),
            "students": students,
        }

    def _get_income_summary(self, month=None, year=None):
        from .models import FeePayment, OtherIncome

        today = date.today()
        month = month or today.month
        year = year or today.year

        qs = FeePayment.objects.filter(
            school_id=self.school_id,
            month=month,
            year=year,
        )

        totals = qs.aggregate(
            total_due=Sum('amount_due'),
            total_collected=Sum('amount_paid'),
        )

        status_counts = qs.values('status').annotate(count=Count('id'))
        counts = {item['status']: item['count'] for item in status_counts}

        other_income = float(OtherIncome.objects.filter(
            school_id=self.school_id,
            date__year=year,
            date__month=month,
        ).aggregate(total=Sum('amount'))['total'] or 0)

        fee_collected = float(totals['total_collected'] or 0)

        return {
            "month": month,
            "year": year,
            "total_due": float(totals['total_due'] or 0),
            "fee_collected": fee_collected,
            "other_income": other_income,
            "total_income": fee_collected + other_income,
            "collection_rate": round(
                fee_collected / float(totals['total_due'] or 1) * 100, 1
            ),
            "paid_count": counts.get('PAID', 0),
            "partial_count": counts.get('PARTIAL', 0),
            "unpaid_count": counts.get('UNPAID', 0),
        }

    def _get_balance(self, date_from=None, date_to=None):
        from .models import FeePayment, Expense, OtherIncome

        fee_qs = FeePayment.objects.filter(school_id=self.school_id)
        exp_qs = Expense.objects.filter(school_id=self.school_id)
        other_qs = OtherIncome.objects.filter(school_id=self.school_id)

        if date_from:
            fee_qs = fee_qs.filter(Q(payment_date__gte=date_from) | Q(payment_date__isnull=True))
            exp_qs = exp_qs.filter(date__gte=date_from)
            other_qs = other_qs.filter(date__gte=date_from)
        if date_to:
            fee_qs = fee_qs.filter(Q(payment_date__lte=date_to) | Q(payment_date__isnull=True))
            exp_qs = exp_qs.filter(date__lte=date_to)
            other_qs = other_qs.filter(date__lte=date_to)

        fee_income = float(fee_qs.aggregate(total=Sum('amount_paid'))['total'] or 0)
        other_income = float(other_qs.aggregate(total=Sum('amount'))['total'] or 0)
        income = fee_income + other_income
        expenses = float(exp_qs.aggregate(total=Sum('amount'))['total'] or 0)

        return {
            "fee_income": fee_income,
            "other_income": other_income,
            "total_income": income,
            "expenses": expenses,
            "balance": income - expenses,
            "date_from": date_from,
            "date_to": date_to,
        }

    def _get_expense_breakdown(self, date_from=None, date_to=None):
        from .models import Expense

        qs = Expense.objects.filter(school_id=self.school_id)
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)

        breakdown = qs.values('category', 'category__name').annotate(
            total=Sum('amount'),
            count=Count('id'),
        ).order_by('-total')

        return {
            "categories": [
                {
                    "category": item['category'],
                    "name": item['category__name'] or 'Uncategorized',
                    "total": float(item['total']),
                    "count": item['count'],
                }
                for item in breakdown
            ],
            "grand_total": float(qs.aggregate(total=Sum('amount'))['total'] or 0),
            "date_from": date_from,
            "date_to": date_to,
        }

    def _get_other_income(self, category=None, date_from=None, date_to=None):
        from .models import OtherIncome

        qs = OtherIncome.objects.filter(school_id=self.school_id)
        if category:
            qs = qs.filter(category__name__iexact=category)
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)

        total = qs.aggregate(total=Sum('amount'))['total'] or 0

        breakdown = qs.values('category', 'category__name').annotate(
            total=Sum('amount'), count=Count('id'),
        ).order_by('-total')

        return {
            "total_other_income": float(total),
            "count": qs.count(),
            "category_filter": category,
            "categories": [
                {
                    "category": item['category'],
                    "name": item['category__name'] or 'Uncategorized',
                    "total": float(item['total']),
                    "count": item['count'],
                }
                for item in breakdown
            ],
            "date_from": date_from,
            "date_to": date_to,
        }

    def _get_account_balances(self, date_from=None, date_to=None):
        from .models import Account, FeePayment, Expense, OtherIncome, Transfer
        from schools.models import School
        from django.db.models import Q

        # Include school-specific + org-level shared accounts
        try:
            school_obj = School.objects.select_related('organization').get(id=self.school_id)
            org_id = school_obj.organization_id
        except School.DoesNotExist:
            org_id = None

        q = Q(school_id=self.school_id, is_active=True)
        if org_id:
            q |= Q(school__isnull=True, organization_id=org_id, is_active=True)
            org_school_ids = list(School.objects.filter(organization_id=org_id).values_list('id', flat=True))
        else:
            org_school_ids = [self.school_id]

        accounts = Account.objects.filter(q)
        result = []

        for account in accounts:
            # Shared accounts sum across all org schools
            scope_ids = org_school_ids if account.school_id is None else [account.school_id]

            fee_qs = FeePayment.objects.filter(school_id__in=scope_ids, account=account)
            other_qs = OtherIncome.objects.filter(school_id__in=scope_ids, account=account)
            exp_qs = Expense.objects.filter(school_id__in=scope_ids, account=account)
            tfr_in_qs = Transfer.objects.filter(school_id__in=scope_ids, to_account=account)
            tfr_out_qs = Transfer.objects.filter(school_id__in=scope_ids, from_account=account)

            if date_from:
                fee_qs = fee_qs.filter(Q(payment_date__gte=date_from) | Q(payment_date__isnull=True))
                other_qs = other_qs.filter(date__gte=date_from)
                exp_qs = exp_qs.filter(date__gte=date_from)
                tfr_in_qs = tfr_in_qs.filter(date__gte=date_from)
                tfr_out_qs = tfr_out_qs.filter(date__gte=date_from)
            if date_to:
                fee_qs = fee_qs.filter(Q(payment_date__lte=date_to) | Q(payment_date__isnull=True))
                other_qs = other_qs.filter(date__lte=date_to)
                exp_qs = exp_qs.filter(date__lte=date_to)
                tfr_in_qs = tfr_in_qs.filter(date__lte=date_to)
                tfr_out_qs = tfr_out_qs.filter(date__lte=date_to)

            bbf = float(account.opening_balance)
            receipts = float(fee_qs.aggregate(t=Sum('amount_paid'))['t'] or 0) + \
                       float(other_qs.aggregate(t=Sum('amount'))['t'] or 0)
            payments = float(exp_qs.aggregate(t=Sum('amount'))['t'] or 0)
            tfr_in = float(tfr_in_qs.aggregate(t=Sum('amount'))['t'] or 0)
            tfr_out = float(tfr_out_qs.aggregate(t=Sum('amount'))['t'] or 0)

            result.append({
                "account": account.name,
                "type": account.get_account_type_display(),
                "bbf": bbf,
                "receipts": receipts,
                "payments": payments,
                "transfers_in": tfr_in,
                "transfers_out": tfr_out,
                "net_balance": bbf + receipts - payments + tfr_in - tfr_out,
            })

        grand_total = sum(a['net_balance'] for a in result)
        return {
            "accounts": result,
            "grand_total": grand_total,
            "date_from": date_from,
            "date_to": date_to,
        }

    # ── New Tools (9-18) ────────────────────────────────────────────────

    def _get_fee_structure(self, class_name=None, fee_type=None):
        from .models import FeeStructure

        qs = FeeStructure.objects.filter(school_id=self.school_id, is_active=True)
        if class_name:
            qs = qs.filter(class_obj__name__icontains=class_name)
        if fee_type:
            qs = qs.filter(fee_type=fee_type.upper())

        qs = qs.select_related('class_obj')
        structures = [
            {
                "class": fs.class_obj.name if fs.class_obj else "All Classes",
                "fee_type": fs.fee_type,
                "amount": float(fs.amount),
                "effective_from": str(fs.effective_from) if fs.effective_from else None,
                "effective_to": str(fs.effective_to) if fs.effective_to else None,
            }
            for fs in qs[:30]
        ]
        return {"structures": structures, "total": len(structures)}

    def _get_payment_method_analysis(self, month=None, year=None):
        from .models import FeePayment

        today = date.today()
        month = month or today.month
        year = year or today.year

        qs = FeePayment.objects.filter(
            school_id=self.school_id, status='PAID', month=month, year=year,
        )

        breakdown = qs.values('payment_method').annotate(
            total=Sum('amount_paid'), count=Count('id'),
        ).order_by('-total')

        return {
            "month": month,
            "year": year,
            "methods": [
                {
                    "method": item['payment_method'] or 'UNKNOWN',
                    "total_collected": float(item['total'] or 0),
                    "count": item['count'],
                }
                for item in breakdown
            ],
            "grand_total": float(qs.aggregate(total=Sum('amount_paid'))['total'] or 0),
        }

    def _get_scholarships_summary(self):
        from .models import Scholarship, StudentDiscount

        scholarships = Scholarship.objects.filter(
            school_id=self.school_id, is_active=True,
        )

        result = []
        for s in scholarships:
            recipients = StudentDiscount.objects.filter(
                scholarship=s, is_active=True,
            ).count()
            result.append({
                "name": s.name,
                "type": s.scholarship_type,
                "coverage": s.coverage,
                "max_recipients": s.max_recipients,
                "current_recipients": recipients,
            })

        return {"scholarships": result, "total_active": len(result)}

    def _get_discounts_impact(self):
        from .models import Discount, StudentDiscount

        discounts = Discount.objects.filter(
            school_id=self.school_id, is_active=True,
        )

        result = []
        for d in discounts:
            applied_count = StudentDiscount.objects.filter(
                discount=d, is_active=True,
            ).count()
            result.append({
                "name": d.name,
                "discount_type": d.discount_type,
                "value": float(d.value),
                "applies_to": d.applies_to,
                "recipients": applied_count,
                "stackable": d.stackable,
            })

        return {"discounts": result, "total_active": len(result)}

    def _get_online_payment_status(self, date_from=None, date_to=None):
        from .models import OnlinePayment

        qs = OnlinePayment.objects.filter(school_id=self.school_id)
        if date_from:
            qs = qs.filter(initiated_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(initiated_at__date__lte=date_to)

        breakdown = qs.values('status').annotate(
            count=Count('id'), total=Sum('amount'),
        )

        status_map = {item['status']: item for item in breakdown}
        total = sum(item['count'] for item in breakdown)
        success_count = status_map.get('SUCCESS', {}).get('count', 0)

        return {
            "statuses": [
                {
                    "status": item['status'],
                    "count": item['count'],
                    "total": float(item['total'] or 0),
                }
                for item in breakdown
            ],
            "total_transactions": total,
            "success_rate": f"{round(success_count / total * 100, 1)}%" if total else "N/A",
            "date_from": date_from,
            "date_to": date_to,
        }

    def _get_monthly_closing_status(self):
        from .models import MonthlyClosing

        closings = MonthlyClosing.objects.filter(
            school_id=self.school_id,
        ).order_by('-year', '-month')[:12]

        today = date.today()
        closed_periods = [(c.year, c.month) for c in closings]

        # Check last 6 months
        open_months = []
        for i in range(6):
            m = today.month - i
            y = today.year
            if m <= 0:
                m += 12
                y -= 1
            if (y, m) not in closed_periods:
                open_months.append({"year": y, "month": m})

        return {
            "closed_months": [
                {"year": c.year, "month": c.month, "closed_at": str(c.closed_at)}
                for c in closings
            ],
            "open_months": open_months,
        }

    def _get_fee_defaulters(self, min_months=2):
        from .models import FeePayment

        qs = FeePayment.objects.filter(
            school_id=self.school_id, status='UNPAID',
        ).values(
            'student_id', 'student__name', 'student__class_obj__name',
        ).annotate(
            unpaid_months=Count('id'),
            total_due=Sum('amount_due'),
        ).filter(
            unpaid_months__gte=int(min_months),
        ).order_by('-unpaid_months')[:30]

        return {
            "defaulters": [
                {
                    "student": item['student__name'],
                    "class": item['student__class_obj__name'],
                    "unpaid_months": item['unpaid_months'],
                    "total_due": float(item['total_due'] or 0),
                }
                for item in qs
            ],
            "min_months_filter": min_months,
        }

    def _get_collection_trend(self, months=6):
        from .models import FeePayment

        today = date.today()
        trend = []
        for i in range(int(months)):
            m = today.month - i
            y = today.year
            if m <= 0:
                m += 12
                y -= 1

            qs = FeePayment.objects.filter(
                school_id=self.school_id, month=m, year=y,
            )
            totals = qs.aggregate(
                total_due=Sum('amount_due'),
                total_paid=Sum('amount_paid'),
            )
            total_due = float(totals['total_due'] or 0)
            total_paid = float(totals['total_paid'] or 0)

            trend.append({
                "month": m,
                "year": y,
                "total_due": total_due,
                "total_collected": total_paid,
                "collection_rate": round(total_paid / total_due * 100, 1) if total_due else 0,
            })

        return {"trend": list(reversed(trend))}

    def _get_transfer_history(self, date_from=None, date_to=None):
        from .models import Transfer

        qs = Transfer.objects.filter(
            school_id=self.school_id,
        ).select_related('from_account', 'to_account').order_by('-date')

        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)

        transfers = [
            {
                "date": str(t.date),
                "from_account": t.from_account.name,
                "to_account": t.to_account.name,
                "amount": float(t.amount),
                "description": t.description or '',
            }
            for t in qs[:20]
        ]

        return {"transfers": transfers, "total": len(transfers)}

    def _get_top_expenses(self, limit=10, date_from=None, date_to=None):
        from .models import Expense

        qs = Expense.objects.filter(
            school_id=self.school_id,
        ).select_related('category').order_by('-amount')

        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)

        expenses = [
            {
                "date": str(e.date),
                "category": e.category.name if e.category else 'Uncategorized',
                "amount": float(e.amount),
                "description": e.description or '',
            }
            for e in qs[:int(limit)]
        ]

        return {"expenses": expenses, "total_shown": len(expenses)}

    def _fallback_response(self, user_message):
        """Simple keyword-based fallback when LLM is not available."""
        msg = user_message.lower()
        today = date.today()

        if any(w in msg for w in ['pending', 'unpaid', 'due']):
            data = self._get_pending_fees(month=today.month, year=today.year)
            return (
                f"For {today.strftime('%B %Y')}, there is a total pending amount of "
                f"{data['total_pending']:,.0f} across {data['unpaid_count']} records."
            )
        elif any(w in msg for w in ['expense', 'spent', 'cost']):
            data = self._get_total_expenses()
            return f"Total recorded expenses: {data['total_expenses']:,.0f} across {data['count']} entries."
        elif any(w in msg for w in ['account', 'wallet', 'cash']):
            data = self._get_account_balances()
            lines = [f"{a['account']}: {a['net_balance']:,.0f}" for a in data['accounts']]
            return f"Account balances:\n" + "\n".join(lines) + f"\nGrand Total: {data['grand_total']:,.0f}"
        elif any(w in msg for w in ['balance', 'profit', 'net']):
            data = self._get_balance()
            return (
                f"Income: {data['total_income']:,.0f}, Expenses: {data['expenses']:,.0f}, "
                f"Balance: {data['balance']:,.0f}"
            )
        elif any(w in msg for w in ['collect', 'income', 'revenue']):
            data = self._get_income_summary(month=today.month, year=today.year)
            return (
                f"For {today.strftime('%B %Y')}: collected {data['total_collected']:,.0f} "
                f"out of {data['total_due']:,.0f} due ({data['collection_rate']}% collection rate)."
            )
        else:
            return (
                "I can help with questions about:\n"
                "- Pending fees (e.g., 'How much fee is pending?')\n"
                "- Expenses (e.g., 'What were total expenses last month?')\n"
                "- Unpaid students (e.g., 'Which students haven't paid?')\n"
                "- Financial balance (e.g., 'What is the current balance?')\n"
                "Please try asking about one of these topics."
            )
