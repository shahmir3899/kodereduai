"""Daily attendance summary shared by the daily_report endpoint and the admin-dashboard bootstrap."""

from django.db.models import Count, Q

from academic_sessions.calendar_rules import is_off_day_for_date, off_day_types_for_date

from .models import AttendanceRecord
from .serializers import AttendanceRecordSerializer


def daily_attendance_summary(school_id, date_obj, academic_year_id=None):
    from students.models import Student

    students_qs = Student.objects.filter(school_id=school_id, is_active=True)
    if academic_year_id:
        students_qs = students_qs.filter(
            enrollments__academic_year_id=academic_year_id,
            enrollments__is_active=True,
        )
    enrolled_ids = set(students_qs.values_list('id', flat=True).distinct())

    records = AttendanceRecord.objects.filter(
        school_id=school_id,
        date=date_obj,
    ).select_related('student', 'student__class_obj', 'academic_year')

    Status = AttendanceRecord.AttendanceStatus
    counts = records.aggregate(
        present_count=Count('id', filter=Q(status=Status.PRESENT)),
        absent_count=Count('id', filter=Q(status=Status.ABSENT)),
        leave_count=Count('id', filter=Q(status=Status.LEAVE)),
    )
    absent_records = records.filter(status=Status.ABSENT)

    # Counted against the enrolled set rather than total - present - absent: LEAVE is a
    # marked state, and a record for a since-deactivated student must not skew the figure.
    marked_ids = set(records.values_list('student_id', flat=True))
    is_off_day = is_off_day_for_date(school_id, date_obj)
    not_marked = 0 if is_off_day else len(enrolled_ids - marked_ids)

    return {
        'date': date_obj,
        'is_off_day': is_off_day,
        'off_day_types': off_day_types_for_date(school_id, date_obj),
        'total_students': len(enrolled_ids),
        'present_count': counts.get('present_count') or 0,
        'absent_count': counts.get('absent_count') or 0,
        'leave_count': counts.get('leave_count') or 0,
        'not_marked_count': not_marked,
        'absent_students': AttendanceRecordSerializer(absent_records, many=True).data,
    }
