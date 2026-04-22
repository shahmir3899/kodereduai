"""
Bootstrap endpoint — returns multiple dashboard data sections in a single request.
Intended for SCHOOL_ADMIN / PRINCIPAL / HR_MANAGER to minimise login-time round trips.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.utils.dateparse import parse_date
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.mixins import ensure_tenant_school_id
from core.permissions import HasSchoolAccess, get_effective_role


_ALLOWED_ROLES = {'SCHOOL_ADMIN', 'PRINCIPAL', 'HR_MANAGER'}


def _get_attendance_section(school_id, date_obj, academic_year_id):
    """Return daily attendance summary — mirrors AttendanceRecordViewSet.daily_report."""
    from academic_sessions.calendar_rules import is_off_day_for_date, off_day_types_for_date
    from attendance.models import AttendanceRecord
    from attendance.serializers import AttendanceRecordSerializer
    from students.models import Student

    students_qs = Student.objects.filter(school_id=school_id, is_active=True)
    if academic_year_id:
        students_qs = students_qs.filter(
            enrollments__academic_year_id=academic_year_id,
            enrollments__is_active=True,
        )
    total = students_qs.values('id').distinct().count()

    records = AttendanceRecord.objects.filter(
        school_id=school_id,
        date=date_obj,
    ).select_related('student', 'student__class_obj', 'academic_year')

    counts = records.aggregate(
        present_count=Count('id', filter=Q(status=AttendanceRecord.AttendanceStatus.PRESENT)),
        absent_count=Count('id', filter=Q(status=AttendanceRecord.AttendanceStatus.ABSENT)),
    )
    absent_records = records.filter(status=AttendanceRecord.AttendanceStatus.ABSENT)

    is_off_day = is_off_day_for_date(school_id, date_obj)
    return {
        'date': str(date_obj),
        'is_off_day': is_off_day,
        'off_day_types': off_day_types_for_date(school_id, date_obj),
        'total_students': total,
        'present_count': counts.get('present_count') or 0,
        'absent_count': counts.get('absent_count') or 0,
        'absent_students': AttendanceRecordSerializer(absent_records, many=True).data,
    }


def _get_pending_reviews_count(school_id, academic_year_id):
    """Return count of pending attendance uploads awaiting review."""
    from attendance.models import AttendanceUpload

    qs = AttendanceUpload.objects.filter(school_id=school_id, status='PENDING_REVIEW')
    if academic_year_id:
        qs = qs.filter(academic_year_id=academic_year_id)
    return qs.count()


def _get_hr_section(school_id):
    """Return HR dashboard stats — mirrors StaffMemberViewSet.dashboard_stats."""
    from hr.models import StaffMember, StaffDepartment, Payslip, LeaveApplication, StaffAttendance

    today = date.today()
    thirty_days_ago = today - timedelta(days=30)

    staff_qs = StaffMember.objects.filter(school_id=school_id)

    staff_counts = staff_qs.aggregate(
        total_staff=Count('id'),
        active_staff=Count('id', filter=Q(is_active=True, employment_status='ACTIVE')),
        recent_joiners=Count('id', filter=Q(date_of_joining__gte=thirty_days_ago)),
    )

    total_departments = StaffDepartment.objects.filter(
        school_id=school_id, is_active=True,
    ).count()

    payroll_stats = Payslip.objects.filter(
        school_id=school_id, month=today.month, year=today.year,
    ).aggregate(
        total=Sum('net_salary'),
        pending_approvals=Count('id', filter=Q(status='DRAFT')),
    )

    leave_stats = LeaveApplication.objects.filter(school_id=school_id).aggregate(
        pending_leave_applications=Count('id', filter=Q(status='PENDING')),
        staff_on_leave_today=Count(
            'id',
            filter=Q(status='APPROVED', start_date__lte=today, end_date__gte=today),
        ),
    )

    attendance_stats = StaffAttendance.objects.filter(
        school_id=school_id, date=today,
    ).aggregate(
        attendance_present=Count('id', filter=Q(status__in=('PRESENT', 'LATE'))),
        attendance_marked=Count('id'),
    )

    return {
        'total_staff': staff_counts.get('total_staff', 0),
        'active_staff': staff_counts.get('active_staff', 0),
        'total_departments': total_departments,
        'recent_joiners': staff_counts.get('recent_joiners', 0),
        'total_payroll_this_month': str(payroll_stats.get('total') or Decimal('0')),
        'pending_payroll_approvals': payroll_stats.get('pending_approvals') or 0,
        'pending_leave_applications': leave_stats.get('pending_leave_applications', 0),
        'staff_on_leave_today': leave_stats.get('staff_on_leave_today', 0),
        'attendance_present_today': attendance_stats.get('attendance_present', 0),
        'attendance_marked_today': attendance_stats.get('attendance_marked', 0),
    }


def _get_finance_section(school_id, month, year, academic_year_id):
    """Return finance monthly summary — mirrors FeePaymentViewSet.monthly_summary."""
    from finance.models import FeePayment

    payments = FeePayment.objects.filter(school_id=school_id, month=month, year=year)
    if academic_year_id:
        payments = payments.filter(academic_year_id=academic_year_id)

    totals = payments.aggregate(
        total_due=Sum('amount_due'),
        total_collected=Sum('amount_paid'),
    )
    total_due = totals['total_due'] or Decimal('0')
    total_collected = totals['total_collected'] or Decimal('0')

    status_counts = payments.values('status').annotate(count=Count('id'))
    counts = {item['status']: item['count'] for item in status_counts}

    return {
        'month': month,
        'year': year,
        'total_due': str(total_due),
        'total_collected': str(total_collected),
        'total_pending': str(max(Decimal('0'), total_due - total_collected)),
        'paid_count': counts.get('PAID', 0),
        'partial_count': counts.get('PARTIAL', 0),
        'unpaid_count': counts.get('UNPAID', 0),
    }


class AdminDashboardBootstrapView(APIView):
    """
    GET /api/bootstrap/admin-dashboard/

    Returns attendance, hr, and finance dashboard sections in one request.
    Only accessible to SCHOOL_ADMIN, PRINCIPAL, and HR_MANAGER.

    Query params:
      date            YYYY-MM-DD  (default: today)
      academic_year   int id      (optional)
      month           int         (default: current month)
      year            int         (default: current year)
      sections        comma-separated list of: attendance,hr,finance
                      (default: all three)
    """

    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request):
        role = get_effective_role(request)
        if role not in _ALLOWED_ROLES:
            return Response({'detail': 'Forbidden.'}, status=403)

        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)

        # Parse params
        date_param = request.query_params.get('date')
        date_obj = parse_date(date_param) if date_param else date.today()
        if not date_obj:
            return Response({'detail': 'Invalid date format. Use YYYY-MM-DD.'}, status=400)

        today = date.today()
        month = int(request.query_params.get('month', today.month))
        year = int(request.query_params.get('year', today.year))
        academic_year_id = request.query_params.get('academic_year') or None

        sections_param = request.query_params.get('sections', 'attendance,hr,finance')
        requested = {s.strip() for s in sections_param.split(',')}

        # Check which modules are enabled for this school
        from schools.models import School
        try:
            school = School.objects.only('enabled_modules').get(id=school_id)
            enabled = school.enabled_modules or {}
        except School.DoesNotExist:
            enabled = {}

        def module_on(key):
            return enabled.get(key, {}).get('enabled', False)

        result = {}

        if 'attendance' in requested and module_on('attendance'):
            try:
                result['attendance'] = _get_attendance_section(school_id, date_obj, academic_year_id)
                result['pending_reviews_count'] = _get_pending_reviews_count(school_id, academic_year_id)
            except Exception:
                result['attendance'] = None
                result['pending_reviews_count'] = None

        if 'hr' in requested and module_on('hr') and role in {'SCHOOL_ADMIN', 'PRINCIPAL', 'HR_MANAGER'}:
            try:
                result['hr'] = _get_hr_section(school_id)
            except Exception:
                result['hr'] = None

        if 'finance' in requested and module_on('finance') and role in {'SCHOOL_ADMIN', 'PRINCIPAL'}:
            try:
                result['finance'] = _get_finance_section(school_id, month, year, academic_year_id)
            except Exception:
                result['finance'] = None

        return Response(result)
