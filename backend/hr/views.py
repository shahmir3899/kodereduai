"""
HR & Staff Management views.
"""

import logging
from datetime import date, timedelta

from decimal import Decimal

from django.db.models import Count, Q, Sum
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from core.permissions import HasSchoolAccess, get_effective_role, ModuleAccessMixin
from core.mixins import TenantQuerySetMixin, ensure_tenant_schools, ensure_tenant_school_id
from .models import (
    StaffDepartment, StaffDesignation, StaffMember,
    SalaryStructure, Payslip, LeavePolicy, LeaveApplication,
    StaffAttendance, PerformanceAppraisal, StaffQualification, StaffDocument,
)
from .serializers import (
    StaffDepartmentSerializer, StaffDepartmentCreateSerializer,
    StaffDesignationSerializer, StaffDesignationCreateSerializer,
    StaffMemberSerializer, StaffMemberCreateSerializer, StaffMemberUpdateSerializer,
    SalaryStructureSerializer, SalaryStructureCreateSerializer,
    PayslipSerializer, PayslipCreateSerializer,
    LeavePolicySerializer, LeavePolicyCreateSerializer,
    LeaveApplicationSerializer, LeaveApplicationCreateSerializer,
    StaffAttendanceSerializer, StaffAttendanceCreateSerializer,
    PerformanceAppraisalSerializer, PerformanceAppraisalCreateSerializer,
    StaffQualificationSerializer, StaffQualificationCreateSerializer,
    StaffDocumentSerializer, StaffDocumentCreateSerializer,
)
from .permissions import IsHRManagerOrAdminOrReadOnly

logger = logging.getLogger(__name__)


def _resolve_school_id(request):
    """Resolve school_id from header → params → user fallback."""
    tenant_sid = ensure_tenant_school_id(request)
    if tenant_sid:
        return tenant_sid

    school_id = (
        request.query_params.get('school_id')
        or request.data.get('school_id')
        or request.data.get('school')
    )
    if school_id:
        return int(school_id)

    if request.user.school_id:
        return request.user.school_id

    if request.user.is_super_admin:
        from schools.models import School
        schools = list(School.objects.filter(is_active=True).values_list('id', flat=True)[:2])
        if len(schools) == 1:
            return schools[0]

    return None


# ── Department ViewSet ────────────────────────────────────────────────────────

class StaffDepartmentViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for staff departments."""
    required_module = 'hr'
    queryset = StaffDepartment.objects.all()
    permission_classes = [IsAuthenticated, IsHRManagerOrAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['school_id'] = _resolve_school_id(self.request)
        return context

    def get_serializer_class(self):
        if self.action == 'create':
            return StaffDepartmentCreateSerializer
        if self.action in ('update', 'partial_update'):
            return StaffDepartmentCreateSerializer
        return StaffDepartmentSerializer

    def get_queryset(self):
        queryset = StaffDepartment.objects.select_related('school').prefetch_related('staff_members')

        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        return queryset.filter(is_active=True)

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()


# ── Designation ViewSet ───────────────────────────────────────────────────────

class StaffDesignationViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for staff designations."""
    required_module = 'hr'
    queryset = StaffDesignation.objects.all()
    permission_classes = [IsAuthenticated, IsHRManagerOrAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['school_id'] = _resolve_school_id(self.request)
        return context

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return StaffDesignationCreateSerializer
        return StaffDesignationSerializer

    def get_queryset(self):
        queryset = StaffDesignation.objects.select_related('school', 'department')

        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Filter by department if provided
        department = self.request.query_params.get('department')
        if department:
            queryset = queryset.filter(department_id=department)

        return queryset.filter(is_active=True)

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()


# ── Staff Member ViewSet ──────────────────────────────────────────────────────

class StaffMemberViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for staff members with search, filter, and dashboard stats."""
    required_module = 'hr'
    queryset = StaffMember.objects.all()
    permission_classes = [IsAuthenticated, IsHRManagerOrAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action == 'create':
            return StaffMemberCreateSerializer
        if self.action in ('update', 'partial_update'):
            return StaffMemberUpdateSerializer
        return StaffMemberSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['school_id'] = _resolve_school_id(self.request)
        return context

    def get_queryset(self):
        queryset = StaffMember.objects.select_related(
            'school', 'department', 'designation', 'user',
        )

        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Filters
        department = self.request.query_params.get('department')
        if department:
            queryset = queryset.filter(department_id=department)

        employment_status = self.request.query_params.get('employment_status')
        if employment_status:
            queryset = queryset.filter(employment_status=employment_status.upper())

        employment_type = self.request.query_params.get('employment_type')
        if employment_type:
            queryset = queryset.filter(employment_type=employment_type.upper())

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        # Name search
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(first_name__icontains=search) |
                Q(last_name__icontains=search) |
                Q(email__icontains=search) |
                Q(employee_id__icontains=search)
            )

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()

    @action(detail=False, methods=['get'])
    def dashboard_stats(self, request):
        """HR dashboard summary stats."""
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)

        staff_qs = StaffMember.objects.filter(school_id=school_id)

        total_staff = staff_qs.count()
        active_staff = staff_qs.filter(is_active=True, employment_status='ACTIVE').count()

        # Department breakdown
        department_breakdown = list(
            staff_qs.filter(is_active=True, department__isnull=False)
            .values('department__id', 'department__name')
            .annotate(count=Count('id'))
            .order_by('-count')
        )

        # Employment status breakdown
        status_breakdown = list(
            staff_qs.filter(is_active=True)
            .values('employment_status')
            .annotate(count=Count('id'))
            .order_by('-count')
        )

        # Employment type breakdown
        type_breakdown = list(
            staff_qs.filter(is_active=True)
            .values('employment_type')
            .annotate(count=Count('id'))
            .order_by('-count')
        )

        # Recent joiners (last 30 days)
        thirty_days_ago = date.today() - timedelta(days=30)
        recent_joiners = staff_qs.filter(
            date_of_joining__gte=thirty_days_ago,
        ).count()

        # Total departments
        total_departments = StaffDepartment.objects.filter(
            school_id=school_id, is_active=True,
        ).count()

        # Payroll stats (current month)
        today = date.today()
        payslips_this_month = Payslip.objects.filter(
            school_id=school_id, month=today.month, year=today.year,
        )
        total_payroll_this_month = payslips_this_month.aggregate(
            total=Sum('net_salary'),
        )['total'] or Decimal('0')
        pending_payroll_approvals = payslips_this_month.filter(status='DRAFT').count()

        # Leave stats
        pending_leave_applications = LeaveApplication.objects.filter(
            school_id=school_id, status='PENDING',
        ).count()
        staff_on_leave_today = LeaveApplication.objects.filter(
            school_id=school_id,
            status='APPROVED',
            start_date__lte=today,
            end_date__gte=today,
        ).count()

        # Attendance today
        attendance_today_qs = StaffAttendance.objects.filter(
            school_id=school_id, date=today,
        )
        attendance_present = attendance_today_qs.filter(
            status__in=('PRESENT', 'LATE'),
        ).count()
        attendance_marked = attendance_today_qs.count()

        return Response({
            'total_staff': total_staff,
            'active_staff': active_staff,
            'total_departments': total_departments,
            'recent_joiners': recent_joiners,
            'department_breakdown': department_breakdown,
            'status_breakdown': status_breakdown,
            'type_breakdown': type_breakdown,
            'total_payroll_this_month': str(total_payroll_this_month),
            'pending_payroll_approvals': pending_payroll_approvals,
            'pending_leave_applications': pending_leave_applications,
            'staff_on_leave_today': staff_on_leave_today,
            'attendance_present_today': attendance_present,
            'attendance_marked_today': attendance_marked,
        })


# ── Salary Structure ViewSet ─────────────────────────────────────────────────

class SalaryStructureViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for salary structures."""
    required_module = 'hr'
    queryset = SalaryStructure.objects.all()
    permission_classes = [IsAuthenticated, IsHRManagerOrAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return SalaryStructureCreateSerializer
        return SalaryStructureSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['school_id'] = _resolve_school_id(self.request)
        return context

    def get_queryset(self):
        queryset = SalaryStructure.objects.select_related(
            'school', 'staff_member', 'staff_member__department',
        )

        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Filters
        staff_member = self.request.query_params.get('staff_member')
        if staff_member:
            queryset = queryset.filter(staff_member_id=staff_member)

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(staff_member__first_name__icontains=search) |
                Q(staff_member__last_name__icontains=search) |
                Q(staff_member__employee_id__icontains=search)
            )

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()

    @action(detail=False, methods=['get'])
    def current(self, request):
        """Get the current active salary structure for a staff member."""
        staff_member = request.query_params.get('staff_member')
        if not staff_member:
            return Response({'detail': 'staff_member query param required.'}, status=400)

        school_id = _resolve_school_id(request)
        today = date.today()
        salary = SalaryStructure.objects.filter(
            school_id=school_id,
            staff_member_id=staff_member,
            is_active=True,
            effective_from__lte=today,
        ).filter(
            Q(effective_to__isnull=True) | Q(effective_to__gte=today)
        ).select_related('staff_member', 'staff_member__department').first()

        if not salary:
            return Response({'detail': 'No active salary structure found.'}, status=404)

        return Response(SalaryStructureSerializer(salary).data)


# ── Payslip ViewSet ───────────────────────────────────────────────────────────

class PayslipViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for payslips with bulk generation, approval, and payment actions."""
    required_module = 'hr'
    queryset = Payslip.objects.all()
    permission_classes = [IsAuthenticated, IsHRManagerOrAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return PayslipCreateSerializer
        return PayslipSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['school_id'] = _resolve_school_id(self.request)
        return context

    def get_queryset(self):
        queryset = Payslip.objects.select_related(
            'school', 'staff_member', 'staff_member__department', 'generated_by',
        )

        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Filters
        month = self.request.query_params.get('month')
        year = self.request.query_params.get('year')
        if month:
            queryset = queryset.filter(month=int(month))
        if year:
            queryset = queryset.filter(year=int(year))

        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter.upper())

        staff_member = self.request.query_params.get('staff_member')
        if staff_member:
            queryset = queryset.filter(staff_member_id=staff_member)

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id, generated_by=self.request.user)

    @action(detail=False, methods=['post'])
    def generate_payslips(self, request):
        """Bulk generate payslips for all active staff with salary structures."""
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)

        month = request.data.get('month')
        year = request.data.get('year')
        if not month or not year:
            return Response({'detail': 'month and year are required.'}, status=400)

        month, year = int(month), int(year)
        today = date.today()

        # Get active staff with salary structures
        active_staff = StaffMember.objects.filter(
            school_id=school_id, is_active=True, employment_status='ACTIVE',
        )

        created = 0
        skipped = 0
        for staff in active_staff:
            # Check if payslip already exists
            if Payslip.objects.filter(
                school_id=school_id, staff_member=staff, month=month, year=year,
            ).exists():
                skipped += 1
                continue

            # Find active salary structure
            salary = SalaryStructure.objects.filter(
                school_id=school_id,
                staff_member=staff,
                is_active=True,
                effective_from__lte=today,
            ).filter(
                Q(effective_to__isnull=True) | Q(effective_to__gte=today)
            ).first()

            if not salary:
                skipped += 1
                continue

            Payslip.objects.create(
                school_id=school_id,
                staff_member=staff,
                month=month,
                year=year,
                basic_salary=salary.basic_salary,
                total_allowances=sum(Decimal(str(v)) for v in salary.allowances.values()),
                total_deductions=sum(Decimal(str(v)) for v in salary.deductions.values()),
                net_salary=salary.net_salary,
                allowances_breakdown=salary.allowances,
                deductions_breakdown=salary.deductions,
                status='DRAFT',
                generated_by=request.user,
            )
            created += 1

        return Response({
            'created': created,
            'skipped': skipped,
            'message': f'{created} payslip(s) generated, {skipped} skipped.',
        })

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """Approve a draft payslip."""
        payslip = self.get_object()
        if payslip.status != 'DRAFT':
            return Response(
                {'detail': f'Cannot approve payslip with status {payslip.status}.'},
                status=400,
            )
        payslip.status = 'APPROVED'
        payslip.save()
        return Response(PayslipSerializer(payslip).data)

    @action(detail=True, methods=['post'])
    def mark_paid(self, request, pk=None):
        """Mark a payslip as paid."""
        payslip = self.get_object()
        if payslip.status not in ('DRAFT', 'APPROVED'):
            return Response(
                {'detail': f'Cannot mark payslip as paid with status {payslip.status}.'},
                status=400,
            )
        payslip.status = 'PAID'
        payslip.payment_date = request.data.get('payment_date', date.today())
        payslip.save()
        return Response(PayslipSerializer(payslip).data)

    @action(detail=False, methods=['get'])
    def payroll_summary(self, request):
        """Get payroll summary for a given month/year."""
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)

        month = request.query_params.get('month', date.today().month)
        year = request.query_params.get('year', date.today().year)

        payslips = Payslip.objects.filter(
            school_id=school_id, month=int(month), year=int(year),
        )

        totals = payslips.aggregate(
            total_basic=Sum('basic_salary'),
            total_allowances=Sum('total_allowances'),
            total_deductions=Sum('total_deductions'),
            total_net=Sum('net_salary'),
        )

        status_counts = dict(
            payslips.values_list('status').annotate(count=Count('id')).values_list('status', 'count')
        )

        return Response({
            'month': int(month),
            'year': int(year),
            'total_payslips': payslips.count(),
            'total_basic': str(totals['total_basic'] or 0),
            'total_allowances': str(totals['total_allowances'] or 0),
            'total_deductions': str(totals['total_deductions'] or 0),
            'total_net': str(totals['total_net'] or 0),
            'draft_count': status_counts.get('DRAFT', 0),
            'approved_count': status_counts.get('APPROVED', 0),
            'paid_count': status_counts.get('PAID', 0),
        })


# ── Leave Policy ViewSet ─────────────────────────────────────────────────────

class LeavePolicyViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for leave policies."""
    required_module = 'hr'
    queryset = LeavePolicy.objects.all()
    permission_classes = [IsAuthenticated, IsHRManagerOrAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return LeavePolicyCreateSerializer
        return LeavePolicySerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['school_id'] = _resolve_school_id(self.request)
        return context

    def get_queryset(self):
        queryset = LeavePolicy.objects.filter()

        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        return queryset.filter(is_active=True)

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()


# ── Leave Application ViewSet ────────────────────────────────────────────────

class LeaveApplicationViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for leave applications with approve/reject/cancel actions."""
    required_module = 'hr'
    queryset = LeaveApplication.objects.all()
    permission_classes = [IsAuthenticated, IsHRManagerOrAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return LeaveApplicationCreateSerializer
        return LeaveApplicationSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['school_id'] = _resolve_school_id(self.request)
        return context

    def get_queryset(self):
        queryset = LeaveApplication.objects.select_related(
            'school', 'staff_member', 'leave_policy', 'approved_by',
        )

        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Filters
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter.upper())

        staff_member = self.request.query_params.get('staff_member')
        if staff_member:
            queryset = queryset.filter(staff_member_id=staff_member)

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(staff_member__first_name__icontains=search) |
                Q(staff_member__last_name__icontains=search) |
                Q(staff_member__employee_id__icontains=search)
            )

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """Approve a pending leave application."""
        leave = self.get_object()
        if leave.status != 'PENDING':
            return Response(
                {'detail': f'Cannot approve leave with status {leave.status}.'},
                status=400,
            )
        leave.status = 'APPROVED'
        leave.approved_by = request.user
        leave.admin_remarks = request.data.get('admin_remarks', '')
        leave.save()
        return Response(LeaveApplicationSerializer(leave).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """Reject a pending leave application."""
        leave = self.get_object()
        if leave.status != 'PENDING':
            return Response(
                {'detail': f'Cannot reject leave with status {leave.status}.'},
                status=400,
            )
        leave.status = 'REJECTED'
        leave.approved_by = request.user
        leave.admin_remarks = request.data.get('admin_remarks', '')
        leave.save()
        return Response(LeaveApplicationSerializer(leave).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """Cancel a leave application (pending or approved)."""
        leave = self.get_object()
        if leave.status not in ('PENDING', 'APPROVED'):
            return Response(
                {'detail': f'Cannot cancel leave with status {leave.status}.'},
                status=400,
            )
        leave.status = 'CANCELLED'
        leave.save()
        return Response(LeaveApplicationSerializer(leave).data)

    @action(detail=False, methods=['get'])
    def leave_balance(self, request):
        """Get leave balance for a staff member across all policies."""
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)

        staff_member = request.query_params.get('staff_member')
        if not staff_member:
            return Response({'detail': 'staff_member query param required.'}, status=400)

        current_year = date.today().year
        policies = LeavePolicy.objects.filter(school_id=school_id, is_active=True)

        balances = []
        for policy in policies:
            used = LeaveApplication.objects.filter(
                school_id=school_id,
                staff_member_id=staff_member,
                leave_policy=policy,
                status='APPROVED',
                start_date__year=current_year,
            ).count()

            # Sum actual days used
            approved_leaves = LeaveApplication.objects.filter(
                school_id=school_id,
                staff_member_id=staff_member,
                leave_policy=policy,
                status='APPROVED',
                start_date__year=current_year,
            )
            days_used = sum(la.total_days for la in approved_leaves)

            balances.append({
                'policy_id': policy.id,
                'policy_name': policy.name,
                'leave_type': policy.leave_type,
                'leave_type_display': policy.get_leave_type_display(),
                'days_allowed': policy.days_allowed,
                'days_used': days_used,
                'days_remaining': max(0, policy.days_allowed - days_used),
                'applications_count': used,
            })

        return Response(balances)


# ── Staff Attendance ViewSet ─────────────────────────────────────────────────

class StaffAttendanceViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'hr'
    """CRUD for staff attendance with bulk marking and summary."""
    queryset = StaffAttendance.objects.all()
    permission_classes = [IsAuthenticated, IsHRManagerOrAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return StaffAttendanceCreateSerializer
        return StaffAttendanceSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['school_id'] = _resolve_school_id(self.request)
        return context

    def get_queryset(self):
        queryset = StaffAttendance.objects.select_related(
            'school', 'staff_member', 'staff_member__department', 'marked_by',
        )

        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Filters
        att_date = self.request.query_params.get('date')
        if att_date:
            queryset = queryset.filter(date=att_date)

        staff_member = self.request.query_params.get('staff_member')
        if staff_member:
            queryset = queryset.filter(staff_member_id=staff_member)

        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter.upper())

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id, marked_by=self.request.user)

    @action(detail=False, methods=['post'])
    def bulk_mark(self, request):
        """Bulk mark attendance for multiple staff on a given date."""
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)

        records = request.data.get('records', [])
        att_date = request.data.get('date')
        if not records or not att_date:
            return Response({'detail': 'date and records are required.'}, status=400)

        created = 0
        updated = 0
        for record in records:
            staff_id = record.get('staff_member')
            att_status = record.get('status')
            if not staff_id or not att_status:
                continue

            obj, was_created = StaffAttendance.objects.update_or_create(
                school_id=school_id,
                staff_member_id=staff_id,
                date=att_date,
                defaults={
                    'status': att_status,
                    'check_in': record.get('check_in') or None,
                    'check_out': record.get('check_out') or None,
                    'notes': record.get('notes', ''),
                    'marked_by': request.user,
                },
            )
            if was_created:
                created += 1
            else:
                updated += 1

        return Response({
            'created': created,
            'updated': updated,
            'message': f'{created} created, {updated} updated.',
        })

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Attendance summary for a date range."""
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)

        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')
        if not date_from or not date_to:
            return Response({'detail': 'date_from and date_to are required.'}, status=400)

        records = StaffAttendance.objects.filter(
            school_id=school_id,
            date__gte=date_from,
            date__lte=date_to,
        ).values('staff_member', 'staff_member__first_name', 'staff_member__last_name',
                 'staff_member__employee_id').annotate(
            present=Count('id', filter=Q(status='PRESENT')),
            absent=Count('id', filter=Q(status='ABSENT')),
            late=Count('id', filter=Q(status='LATE')),
            half_day=Count('id', filter=Q(status='HALF_DAY')),
            on_leave=Count('id', filter=Q(status='ON_LEAVE')),
            total=Count('id'),
        ).order_by('staff_member__first_name')

        return Response(list(records))


# ── Performance Appraisal ViewSet ────────────────────────────────────────────

class PerformanceAppraisalViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'hr'
    """CRUD for performance appraisals."""
    queryset = PerformanceAppraisal.objects.all()
    permission_classes = [IsAuthenticated, IsHRManagerOrAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return PerformanceAppraisalCreateSerializer
        return PerformanceAppraisalSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['school_id'] = _resolve_school_id(self.request)
        return context

    def get_queryset(self):
        queryset = PerformanceAppraisal.objects.select_related(
            'school', 'staff_member', 'staff_member__department', 'reviewer',
        )

        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Filters
        staff_member = self.request.query_params.get('staff_member')
        if staff_member:
            queryset = queryset.filter(staff_member_id=staff_member)

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(staff_member__first_name__icontains=search) |
                Q(staff_member__last_name__icontains=search) |
                Q(staff_member__employee_id__icontains=search)
            )

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id, reviewer=self.request.user)


# ── Staff Qualification ViewSet ──────────────────────────────────────────────

class StaffQualificationViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'hr'
    """CRUD for staff qualifications."""
    queryset = StaffQualification.objects.all()
    permission_classes = [IsAuthenticated, IsHRManagerOrAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return StaffQualificationCreateSerializer
        return StaffQualificationSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['school_id'] = _resolve_school_id(self.request)
        return context

    def get_queryset(self):
        queryset = StaffQualification.objects.select_related(
            'school', 'staff_member',
        )

        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        staff_member = self.request.query_params.get('staff_member')
        if staff_member:
            queryset = queryset.filter(staff_member_id=staff_member)

        q_type = self.request.query_params.get('qualification_type')
        if q_type:
            queryset = queryset.filter(qualification_type=q_type.upper())

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(staff_member__first_name__icontains=search) |
                Q(staff_member__last_name__icontains=search)
            )

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)


# ── Staff Document ViewSet ───────────────────────────────────────────────────

class StaffDocumentViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'hr'
    """CRUD for staff documents."""
    queryset = StaffDocument.objects.all()
    permission_classes = [IsAuthenticated, IsHRManagerOrAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return StaffDocumentCreateSerializer
        return StaffDocumentSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['school_id'] = _resolve_school_id(self.request)
        return context

    def get_queryset(self):
        queryset = StaffDocument.objects.select_related(
            'school', 'staff_member',
        )

        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        staff_member = self.request.query_params.get('staff_member')
        if staff_member:
            queryset = queryset.filter(staff_member_id=staff_member)

        doc_type = self.request.query_params.get('document_type')
        if doc_type:
            queryset = queryset.filter(document_type=doc_type.upper())

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(staff_member__first_name__icontains=search) |
                Q(staff_member__last_name__icontains=search) |
                Q(title__icontains=search)
            )

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)
