"""
Attendance report generators.
"""

from datetime import date
from django.db.models import Count, Q
from .base import BaseReportGenerator


class DailyAttendanceReportGenerator(BaseReportGenerator):
    """Daily attendance register for a specific date and class."""

    def get_data(self):
        from attendance.models import AttendanceRecord
        from students.models import Class

        report_date = self.parameters.get('date', date.today())
        class_id = self.parameters.get('class_id')

        if isinstance(report_date, str):
            report_date = date.fromisoformat(report_date)

        filters = {'school': self.school, 'date': report_date}
        if class_id:
            filters['class_obj_id'] = class_id

        records = AttendanceRecord.objects.filter(**filters).select_related(
            'student', 'student__class_obj'
        ).order_by('student__class_obj__name', 'student__roll_number')

        total = records.count()
        present = records.filter(status='PRESENT').count()
        absent = records.filter(status='ABSENT').count()

        rows = []
        for r in records:
            rows.append([
                r.student.class_obj.name,
                r.student.roll_number,
                r.student.name,
                r.get_status_display() if hasattr(r, 'get_status_display') else r.status,
            ])

        class_name = ''
        if class_id:
            cls = Class.objects.filter(id=class_id).first()
            class_name = f" - {cls.name}" if cls else ''

        return {
            'title': f"Daily Attendance Report{class_name}",
            'subtitle': f"Date: {report_date.strftime('%d %B %Y')}",
            'summary': {
                'Total Students': total,
                'Present': present,
                'Absent': absent,
                'Attendance Rate': f"{round(present / total * 100, 1)}%" if total > 0 else 'N/A',
            },
            'table_headers': ['Class', 'Roll #', 'Student Name', 'Status'],
            'table_rows': rows,
        }


class MonthlyAttendanceReportGenerator(BaseReportGenerator):
    """Monthly attendance summary per student."""

    def get_data(self):
        from attendance.models import AttendanceRecord
        from students.models import Student

        month = self.parameters.get('month', date.today().month)
        year = self.parameters.get('year', date.today().year)
        class_id = self.parameters.get('class_id')

        filters = {
            'school': self.school,
            'date__month': month,
            'date__year': year,
        }
        if class_id:
            filters['class_obj_id'] = class_id

        # Aggregate per student
        student_stats = AttendanceRecord.objects.filter(**filters).values(
            'student__id', 'student__name', 'student__roll_number',
            'student__class_obj__name',
        ).annotate(
            present=Count('id', filter=Q(status='PRESENT')),
            absent=Count('id', filter=Q(status='ABSENT')),
            total=Count('id'),
        ).order_by('student__class_obj__name', 'student__roll_number')

        rows = []
        for s in student_stats:
            total = s['total']
            rate = round(s['present'] / total * 100, 1) if total > 0 else 0
            rows.append([
                s['student__class_obj__name'],
                s['student__roll_number'],
                s['student__name'],
                s['present'],
                s['absent'],
                total,
                f"{rate}%",
            ])

        month_name = date(year, month, 1).strftime('%B %Y')
        return {
            'title': 'Monthly Attendance Summary',
            'subtitle': f"Period: {month_name}",
            'summary': {
                'Total Students': len(rows),
            },
            'table_headers': ['Class', 'Roll #', 'Name', 'Present', 'Absent', 'Total', 'Rate'],
            'table_rows': rows,
        }
