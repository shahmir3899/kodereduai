"""
Fee report generators.
"""

from datetime import date
from django.db.models import Sum, Q
from .base import BaseReportGenerator


class FeeCollectionReportGenerator(BaseReportGenerator):
    """Monthly fee collection summary by class."""

    def get_data(self):
        from finance.models import FeePayment
        from students.models import Class

        month = self.parameters.get('month', date.today().month)
        year = self.parameters.get('year', date.today().year)

        class_stats = FeePayment.objects.filter(
            school=self.school,
            month=month,
            year=year,
        ).values(
            'student__class_obj__name',
        ).annotate(
            total_due=Sum('amount_due'),
            total_paid=Sum('amount_paid'),
            count=Sum('id', filter=Q(id__isnull=False)),  # just count
            paid_count=Sum('id', filter=Q(status='PAID')),
        ).order_by('student__class_obj__name')

        rows = []
        grand_due = 0
        grand_paid = 0
        for s in class_stats:
            due = float(s['total_due'] or 0)
            paid = float(s['total_paid'] or 0)
            grand_due += due
            grand_paid += paid
            rate = round(paid / due * 100, 1) if due > 0 else 0
            rows.append([
                s['student__class_obj__name'] or 'Unknown',
                f"{due:,.0f}",
                f"{paid:,.0f}",
                f"{due - paid:,.0f}",
                f"{rate}%",
            ])

        month_name = date(year, month, 1).strftime('%B %Y')
        return {
            'title': 'Fee Collection Summary',
            'subtitle': f"Period: {month_name}",
            'summary': {
                'Total Due': f"PKR {grand_due:,.0f}",
                'Total Collected': f"PKR {grand_paid:,.0f}",
                'Outstanding': f"PKR {grand_due - grand_paid:,.0f}",
                'Collection Rate': f"{round(grand_paid / grand_due * 100, 1)}%" if grand_due > 0 else 'N/A',
            },
            'table_headers': ['Class', 'Total Due', 'Collected', 'Outstanding', 'Rate'],
            'table_rows': rows,
        }


class FeeDefaultersReportGenerator(BaseReportGenerator):
    """Students with unpaid fees."""

    def get_data(self):
        from finance.models import FeePayment

        month = self.parameters.get('month', date.today().month)
        year = self.parameters.get('year', date.today().year)

        defaulters = FeePayment.objects.filter(
            school=self.school,
            month=month,
            year=year,
            status__in=['PENDING', 'PARTIAL'],
        ).select_related(
            'student', 'student__class_obj'
        ).order_by('student__class_obj__name', 'student__roll_number')

        rows = []
        for fp in defaulters:
            outstanding = float(fp.amount_due - fp.amount_paid)
            rows.append([
                fp.student.class_obj.name,
                fp.student.roll_number,
                fp.student.name,
                fp.student.parent_phone or '-',
                f"{float(fp.amount_due):,.0f}",
                f"{float(fp.amount_paid):,.0f}",
                f"{outstanding:,.0f}",
                fp.get_status_display() if hasattr(fp, 'get_status_display') else fp.status,
            ])

        month_name = date(year, month, 1).strftime('%B %Y')
        return {
            'title': 'Fee Defaulters List',
            'subtitle': f"Period: {month_name}",
            'summary': {
                'Total Defaulters': len(rows),
            },
            'table_headers': ['Class', 'Roll #', 'Name', 'Phone', 'Due', 'Paid', 'Outstanding', 'Status'],
            'table_rows': rows,
        }
