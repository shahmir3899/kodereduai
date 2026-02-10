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
from django.db.models import Sum, Count

logger = logging.getLogger(__name__)


class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super().default(obj)


SYSTEM_PROMPT = """You are a helpful financial assistant for a school management platform.
You answer questions about school fees, expenses, and financial data.

You have access to these tools. Call exactly ONE tool per question by responding with JSON:

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

Current date: {current_date}
School: {school_name}

Respond with ONLY a JSON object like:
{{"tool": "get_pending_fees", "params": {{"month": 2, "year": 2026}}}}

If the question is not about finances, respond with:
{{"tool": "none", "answer": "Your friendly response here"}}"""

FORMAT_PROMPT = """Given this financial data from a school, provide a clear, concise answer to the user's question.

User question: {question}
Data: {data}

Respond in a helpful, conversational tone. Format numbers clearly. Keep it brief (2-4 sentences max)."""


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

    def process_query(self, user_message):
        """Process a user's natural language query and return a response."""
        if not settings.GROQ_API_KEY:
            return self._fallback_response(user_message)

        try:
            from groq import Groq
            client = Groq(api_key=settings.GROQ_API_KEY)

            # Step 1: Get tool call from LLM
            system = SYSTEM_PROMPT.format(
                current_date=date.today().isoformat(),
                school_name=self.school.name,
            )

            response = client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_message},
                ],
                temperature=0.1,
                max_tokens=500,
            )

            result_text = response.choices[0].message.content.strip()

            # Parse the tool call
            if "```json" in result_text:
                result_text = result_text.split("```json")[1].split("```")[0]
            elif "```" in result_text:
                result_text = result_text.split("```")[1].split("```")[0]

            tool_call = json.loads(result_text.strip())

            if tool_call.get('tool') == 'none':
                return tool_call.get('answer', "I can help with questions about fees, expenses, and school finances.")

            # Step 2: Execute the tool
            tool_name = tool_call.get('tool', '')
            params = tool_call.get('params', {})
            data = self._execute_tool(tool_name, params)

            # Step 3: Format the response using LLM
            format_response = client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=[
                    {"role": "user", "content": FORMAT_PROMPT.format(
                        question=user_message,
                        data=json.dumps(data, cls=DecimalEncoder),
                    )},
                ],
                temperature=0.3,
                max_tokens=500,
            )

            return format_response.choices[0].message.content.strip()

        except json.JSONDecodeError:
            logger.warning(f"Failed to parse LLM tool call for query: {user_message}")
            return self._fallback_response(user_message)
        except Exception as e:
            logger.error(f"Finance AI agent error: {e}")
            return "I'm sorry, I couldn't process that question right now. Please try rephrasing or try again later."

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
        }

        handler = tools.get(tool_name)
        if not handler:
            return {"error": f"Unknown tool: {tool_name}"}

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
            qs = qs.filter(category=category.upper())
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
            fee_qs = fee_qs.filter(payment_date__gte=date_from)
            exp_qs = exp_qs.filter(date__gte=date_from)
            other_qs = other_qs.filter(date__gte=date_from)
        if date_to:
            fee_qs = fee_qs.filter(payment_date__lte=date_to)
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

        breakdown = qs.values('category').annotate(
            total=Sum('amount'),
            count=Count('id'),
        ).order_by('-total')

        category_map = dict(Expense.Category.choices)
        return {
            "categories": [
                {
                    "category": item['category'],
                    "name": category_map.get(item['category'], item['category']),
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
            qs = qs.filter(category=category.upper())
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)

        total = qs.aggregate(total=Sum('amount'))['total'] or 0
        category_map = dict(OtherIncome.Category.choices)

        breakdown = qs.values('category').annotate(
            total=Sum('amount'), count=Count('id'),
        ).order_by('-total')

        return {
            "total_other_income": float(total),
            "count": qs.count(),
            "category_filter": category,
            "categories": [
                {
                    "category": item['category'],
                    "name": category_map.get(item['category'], item['category']),
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

        accounts = Account.objects.filter(school_id=self.school_id, is_active=True)
        result = []

        for account in accounts:
            fee_qs = FeePayment.objects.filter(school_id=self.school_id, account=account)
            other_qs = OtherIncome.objects.filter(school_id=self.school_id, account=account)
            exp_qs = Expense.objects.filter(school_id=self.school_id, account=account)
            tfr_in_qs = Transfer.objects.filter(school_id=self.school_id, to_account=account)
            tfr_out_qs = Transfer.objects.filter(school_id=self.school_id, from_account=account)

            if date_from:
                fee_qs = fee_qs.filter(payment_date__gte=date_from)
                other_qs = other_qs.filter(date__gte=date_from)
                exp_qs = exp_qs.filter(date__gte=date_from)
                tfr_in_qs = tfr_in_qs.filter(date__gte=date_from)
                tfr_out_qs = tfr_out_qs.filter(date__gte=date_from)
            if date_to:
                fee_qs = fee_qs.filter(payment_date__lte=date_to)
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
