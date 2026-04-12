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
        academic_year_id = self._academic_year_id()

        if isinstance(report_date, str):
            report_date = date.fromisoformat(report_date)

        filters = {'school': self.school, 'date': report_date}
        if academic_year_id:
            filters['academic_year_id'] = academic_year_id
        if class_id:
            if academic_year_id:
                filters['student__enrollments__academic_year_id'] = academic_year_id
                filters['student__enrollments__class_obj_id'] = class_id
                filters['student__enrollments__is_active'] = True
            else:
                filters['student__class_obj_id'] = class_id

        records = AttendanceRecord.objects.filter(**filters).select_related(
            'student', 'student__class_obj'
        ).order_by('student__name', 'date').distinct()

        enrollment_map = self._get_enrollment_map([r.student_id for r in records])

        total = records.count()
        present = records.filter(status='PRESENT').count()
        absent = records.filter(status='ABSENT').count()

        rows = []
        for r in records:
            rows.append([
                self._resolve_class_name(r.student, enrollment_map),
                self._resolve_roll_number(r.student, enrollment_map),
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

        month = self.parameters.get('month', date.today().month)
        year = self.parameters.get('year', date.today().year)
        class_id = self.parameters.get('class_id')
        academic_year_id = self._academic_year_id()

        filters = {
            'school': self.school,
            'date__month': month,
            'date__year': year,
        }
        if academic_year_id:
            filters['academic_year_id'] = academic_year_id
        if class_id:
            if academic_year_id:
                filters['student__enrollments__academic_year_id'] = academic_year_id
                filters['student__enrollments__class_obj_id'] = class_id
                filters['student__enrollments__is_active'] = True
            else:
                filters['student__class_obj_id'] = class_id

        records = AttendanceRecord.objects.filter(**filters).select_related(
            'student', 'student__class_obj'
        ).distinct()

        enrollment_map = self._get_enrollment_map([r.student_id for r in records])

        student_stats = {}
        for record in records:
            sid = record.student_id
            if sid not in student_stats:
                student_stats[sid] = {
                    'class_name': self._resolve_class_name(record.student, enrollment_map),
                    'roll_number': self._resolve_roll_number(record.student, enrollment_map),
                    'student_name': record.student.name,
                    'present': 0,
                    'absent': 0,
                    'total': 0,
                }
            student_stats[sid]['total'] += 1
            if record.status == 'PRESENT':
                student_stats[sid]['present'] += 1
            elif record.status == 'ABSENT':
                student_stats[sid]['absent'] += 1

        rows = []
        sorted_stats = sorted(
            student_stats.values(),
            key=lambda s: (s['class_name'], str(s['roll_number'])),
        )
        for s in sorted_stats:
            total = s['total']
            rate = round(s['present'] / total * 100, 1) if total > 0 else 0
            rows.append([
                s['class_name'],
                s['roll_number'],
                s['student_name'],
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
