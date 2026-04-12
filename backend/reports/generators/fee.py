"""
Fee report generators.
"""

from collections import defaultdict
from datetime import date
from django.db.models import Q
from .base import BaseReportGenerator


class FeeCollectionReportGenerator(BaseReportGenerator):
    """Monthly fee collection summary by class."""

    def get_data(self):
        from finance.models import FeePayment

        month = self.parameters.get('month', date.today().month)
        year = self.parameters.get('year', date.today().year)
        academic_year_id = self._academic_year_id()

        payments = FeePayment.objects.filter(
            school=self.school,
            month=month,
            year=year,
        )
        if academic_year_id:
            payments = payments.filter(academic_year_id=academic_year_id)
        payments = payments.select_related('student', 'student__class_obj')

        enrollment_map = self._get_enrollment_map(
            payments.values_list('student_id', flat=True).distinct()
        )

        class_stats = defaultdict(lambda: {'total_due': 0.0, 'total_paid': 0.0})
        for payment in payments:
            class_name = self._resolve_class_name(payment.student, enrollment_map)
            class_stats[class_name]['total_due'] += float(payment.amount_due or 0)
            class_stats[class_name]['total_paid'] += float(payment.amount_paid or 0)

        rows = []
        grand_due = 0
        grand_paid = 0
        for class_name in sorted(class_stats.keys()):
            due = class_stats[class_name]['total_due']
            paid = class_stats[class_name]['total_paid']
            grand_due += due
            grand_paid += paid
            rate = round(paid / due * 100, 1) if due > 0 else 0
            rows.append([
                class_name or 'Unknown',
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
        academic_year_id = self._academic_year_id()

        defaulters = FeePayment.objects.filter(
            school=self.school,
            month=month,
            year=year,
            status__in=['PENDING', 'PARTIAL'],
        )
        if academic_year_id:
            defaulters = defaulters.filter(academic_year_id=academic_year_id)
        defaulters = defaulters.select_related(
            'student', 'student__class_obj'
        ).order_by('student__class_obj__name', 'student__roll_number')

        enrollment_map = self._get_enrollment_map(
            defaulters.values_list('student_id', flat=True).distinct()
        )

        rows = []
        for fp in defaulters:
            outstanding = float(fp.amount_due - fp.amount_paid)
            rows.append([
                self._resolve_class_name(fp.student, enrollment_map),
                self._resolve_roll_number(fp.student, enrollment_map),
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
