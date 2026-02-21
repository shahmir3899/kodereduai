"""
Finance views for fee structures, payments, expenses, reports, and AI chat.
"""

import calendar
import logging
from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum, Count, Q
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated

from core.permissions import IsSchoolAdmin, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess, get_effective_role, ModuleAccessMixin
from core.mixins import TenantQuerySetMixin, ensure_tenant_schools, ensure_tenant_school_id
from students.models import Student, Class
from django.utils import timezone
from .models import (
    Account, Transfer, FeeStructure, FeePayment, Expense, OtherIncome,
    ExpenseCategory, IncomeCategory,
    DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES,
    FinanceAIChatMessage, MonthlyClosing, AccountSnapshot,
    Discount, Scholarship, StudentDiscount, PaymentGatewayConfig, OnlinePayment,
    SiblingGroup, SiblingGroupMember, SiblingSuggestion,
    resolve_fee_amount,
)
from .serializers import (
    AccountSerializer, AccountCreateSerializer,
    TransferSerializer, TransferCreateSerializer,
    FeeStructureSerializer, FeeStructureCreateSerializer, BulkFeeStructureSerializer, BulkStudentFeeStructureSerializer,
    FeePaymentSerializer, FeePaymentCreateSerializer, FeePaymentUpdateSerializer,
    GenerateMonthlySerializer, GenerateOnetimeFeesSerializer,
    ExpenseCategorySerializer, IncomeCategorySerializer,
    ExpenseSerializer, ExpenseCreateSerializer,
    OtherIncomeSerializer, OtherIncomeCreateSerializer,
    FinanceAIChatMessageSerializer, FinanceAIChatInputSerializer,
    CloseMonthSerializer, MonthlyClosingSerializer,
    DiscountSerializer, ScholarshipSerializer,
    StudentDiscountSerializer, StudentDiscountCreateSerializer,
    PaymentGatewayConfigSerializer,
    OnlinePaymentSerializer, OnlinePaymentInitiateSerializer,
    FeeBreakdownSerializer, SiblingDetectionSerializer,
    SiblingGroupMemberSerializer, SiblingGroupSerializer,
    SiblingSuggestionSerializer,
)

logger = logging.getLogger(__name__)


def _resolve_school_id(request):
    """
    Resolve school_id from: X-School-ID header → request params → user.school_id → fallback.
    """
    # 1. Active school from header (handles JWT auth timing)
    tenant_sid = ensure_tenant_school_id(request)
    if tenant_sid:
        return tenant_sid

    # 2. Explicit request params (super admin use-case)
    school_id = (
        request.query_params.get('school_id')
        or request.data.get('school_id')
        or request.data.get('school')
    )
    if school_id:
        return int(school_id)

    # 3. User's school FK (deprecated but still works)
    if request.user.school_id:
        return request.user.school_id

    # 4. Super admin fallback: if only one school exists, use it
    if request.user.is_super_admin:
        from schools.models import School
        schools = list(School.objects.filter(is_active=True).values_list('id', flat=True)[:2])
        if len(schools) == 1:
            return schools[0]

    return None


def _is_staff_user(request):
    """Check if current user is a staff-level member (not admin/superadmin)."""
    from core.permissions import STAFF_LEVEL_ROLES
    role = get_effective_role(request)
    return role in STAFF_LEVEL_ROLES


def _get_staff_visible_accounts(school_id):
    """Return account IDs that are visible to staff."""
    return list(
        Account.objects.filter(
            school_id=school_id, is_active=True, staff_visible=True
        ).values_list('id', flat=True)
    )


class FeeStructureViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for fee structures (class-level and student-level)."""
    required_module = 'finance'
    queryset = FeeStructure.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action == 'create':
            return FeeStructureCreateSerializer
        return FeeStructureSerializer

    def get_queryset(self):
        queryset = FeeStructure.objects.select_related('school', 'class_obj', 'student', 'academic_year')

        # Filter by active school (works for all users including super admin)
        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        academic_year = self.request.query_params.get('academic_year')
        if academic_year:
            queryset = queryset.filter(Q(academic_year_id=academic_year) | Q(academic_year__isnull=True))

        class_id = self.request.query_params.get('class_id')
        if class_id:
            queryset = queryset.filter(Q(class_obj_id=class_id) | Q(student__class_obj_id=class_id))

        student_id = self.request.query_params.get('student_id')
        if student_id:
            queryset = queryset.filter(student_id=student_id)

        fee_type = self.request.query_params.get('fee_type')
        if fee_type:
            queryset = queryset.filter(fee_type=fee_type.upper())

        return queryset

    def perform_create(self, serializer):
        from academic_sessions.models import AcademicYear
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})

        extra_kwargs = {'school_id': school_id}

        # Auto-resolve current academic year if not provided
        if not serializer.validated_data.get('academic_year'):
            academic_year = AcademicYear.objects.filter(
                school_id=school_id, is_current=True, is_active=True,
            ).first()
            if academic_year:
                extra_kwargs['academic_year'] = academic_year

        serializer.save(**extra_kwargs)

    @action(detail=False, methods=['post'])
    def bulk_set(self, request):
        """Bulk set fee structures for multiple classes at once."""
        serializer = BulkFeeStructureSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with user.'}, status=400)

        effective_from = serializer.validated_data['effective_from']
        structures = serializer.validated_data['structures']
        created_count = 0

        try:
            for item in structures:
                class_id = item['class_obj']
                monthly_amount = item['monthly_amount']
                fee_type = item.get('fee_type', 'MONTHLY')

                # Deactivate existing active class-level fee structures for this class + fee_type
                FeeStructure.objects.filter(
                    school_id=school_id,
                    class_obj_id=class_id,
                    student__isnull=True,
                    fee_type=fee_type,
                    is_active=True,
                ).update(is_active=False)

                # Create new fee structure
                FeeStructure.objects.create(
                    school_id=school_id,
                    class_obj_id=class_id,
                    fee_type=fee_type,
                    monthly_amount=monthly_amount,
                    effective_from=effective_from,
                )
                created_count += 1
        except Exception as e:
            logger.error(f"Bulk fee structure error: {e}")
            return Response({'detail': str(e)}, status=400)

        return Response({'created': created_count})

    @action(detail=False, methods=['post'], url_path='bulk_set_students')
    def bulk_set_students(self, request):
        """Bulk set student-level fee structure overrides for a class."""
        serializer = BulkStudentFeeStructureSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with user.'}, status=400)

        class_id = serializer.validated_data['class_id']
        fee_type = serializer.validated_data['fee_type']
        effective_from = serializer.validated_data['effective_from']
        students_data = serializer.validated_data['students']

        created_count = 0

        try:
            with transaction.atomic():
                for item in students_data:
                    student_id = item['student_id']
                    monthly_amount = item['monthly_amount']

                    # Deactivate any existing student-level fee structure
                    FeeStructure.objects.filter(
                        school_id=school_id,
                        student_id=student_id,
                        fee_type=fee_type,
                        is_active=True,
                    ).update(is_active=False)

                    # Create student-level fee structure (no academic_year,
                    # consistent with class-level bulk_set; resolve_fee_amount
                    # uses effective_from, not academic_year)
                    FeeStructure.objects.create(
                        school_id=school_id,
                        student_id=student_id,
                        fee_type=fee_type,
                        monthly_amount=monthly_amount,
                        effective_from=effective_from,
                    )
                    created_count += 1

        except Exception as e:
            logger.error(f"Bulk student fee structure error: {e}")
            return Response({'detail': str(e)}, status=400)

        return Response({'created': created_count})


class FeePaymentViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD + bulk generation + summaries for fee payments."""
    required_module = 'finance'
    queryset = FeePayment.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action == 'create':
            return FeePaymentCreateSerializer
        if self.action in ('update', 'partial_update'):
            return FeePaymentUpdateSerializer
        return FeePaymentSerializer

    def get_queryset(self):
        queryset = FeePayment.objects.select_related(
            'school', 'student', 'student__class_obj', 'collected_by', 'account',
            'academic_year',
        )

        # Filter by active school (works for all users including super admin)
        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Staff: restrict to payments linked to visible accounts (or no account)
        if _is_staff_user(self.request):
            school_id = school_id or _resolve_school_id(self.request)
            if school_id:
                visible_accounts = _get_staff_visible_accounts(school_id)
                queryset = queryset.filter(
                    Q(account_id__in=visible_accounts) | Q(account__isnull=True)
                )

        # Filters
        academic_year = self.request.query_params.get('academic_year')
        month = self.request.query_params.get('month')
        year = self.request.query_params.get('year')
        class_id = self.request.query_params.get('class_id')
        fee_status = self.request.query_params.get('status')
        student_id = self.request.query_params.get('student_id')

        if academic_year:
            queryset = queryset.filter(academic_year_id=academic_year)

        if month:
            queryset = queryset.filter(month=month)
        if year:
            queryset = queryset.filter(year=year)
        if class_id:
            queryset = queryset.filter(student__class_obj_id=class_id)
        if fee_status:
            queryset = queryset.filter(status=fee_status.upper())
        if student_id:
            queryset = queryset.filter(student_id=student_id)

        fee_type = self.request.query_params.get('fee_type')
        if fee_type:
            queryset = queryset.filter(fee_type=fee_type.upper())

        return queryset

    def perform_create(self, serializer):
        from academic_sessions.models import AcademicYear
        school_id = self.request.data.get('school') or _resolve_school_id(self.request)
        extra_kwargs = {'collected_by': self.request.user}
        if school_id:
            extra_kwargs['school_id'] = school_id
        # Auto-resolve academic year if not provided
        if not serializer.validated_data.get('academic_year'):
            if school_id:
                ay = AcademicYear.objects.filter(
                    school_id=school_id, is_current=True, is_active=True
                ).first()
                if ay:
                    extra_kwargs['academic_year'] = ay
        serializer.save(**extra_kwargs)

    def perform_update(self, serializer):
        instance = serializer.instance
        amount_paid = serializer.validated_data.get('amount_paid', instance.amount_paid)
        if amount_paid and amount_paid > 0 and not serializer.validated_data.get('payment_date') and not instance.payment_date:
            serializer.save(collected_by=self.request.user, payment_date=date.today())
        else:
            serializer.save(collected_by=self.request.user)

    @action(detail=False, methods=['get'])
    def resolve_amount(self, request):
        """Resolve fee amount for a student + fee_type from FeeStructure."""
        student_id = request.query_params.get('student_id')
        fee_type = request.query_params.get('fee_type', 'MONTHLY')

        if not student_id:
            return Response({'detail': 'student_id is required.'}, status=400)

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school context.'}, status=400)

        try:
            student = Student.objects.get(id=student_id, school_id=school_id)
        except Student.DoesNotExist:
            return Response({'detail': 'Student not found.'}, status=404)

        amount = resolve_fee_amount(student, fee_type)
        source = None
        if amount is not None:
            has_student_override = FeeStructure.objects.filter(
                school_id=school_id, student=student, fee_type=fee_type, is_active=True
            ).exists()
            source = 'student_override' if has_student_override else 'class_default'

        return Response({
            'student_id': int(student_id),
            'fee_type': fee_type,
            'amount': str(amount) if amount is not None else None,
            'source': source,
        })

    @action(detail=False, methods=['get'])
    def preview_generation(self, request):
        """Dry-run preview: shows what generate would create without making changes."""
        fee_type = request.query_params.get('fee_type', 'MONTHLY')
        class_id = request.query_params.get('class_id')
        year_param = request.query_params.get('year', date.today().year)
        month_param = request.query_params.get('month', date.today().month)
        academic_year_id = request.query_params.get('academic_year')

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school context.'}, status=400)

        students = Student.objects.filter(school_id=school_id, is_active=True)
        if academic_year_id:
            students = students.filter(
                enrollments__academic_year_id=academic_year_id,
                enrollments__is_active=True,
            )
        if class_id:
            students = students.filter(class_obj_id=class_id)
        students = students.select_related('class_obj').distinct()

        m = int(month_param) if fee_type == 'MONTHLY' else 0
        existing_ids = set(
            FeePayment.objects.filter(
                school_id=school_id, month=m, year=int(year_param), fee_type=fee_type
            ).values_list('student_id', flat=True)
        )

        will_create = []
        already_exist = 0
        no_fee_structure = 0
        for s in students:
            if s.id in existing_ids:
                already_exist += 1
                continue
            amount = resolve_fee_amount(s, fee_type)
            if amount is None:
                no_fee_structure += 1
            else:
                will_create.append({
                    'student_id': s.id,
                    'student_name': s.name,
                    'class_name': s.class_obj.name if s.class_obj else '',
                    'amount': str(amount),
                })

        from decimal import Decimal as D
        total = sum(D(s['amount']) for s in will_create)

        return Response({
            'will_create': len(will_create),
            'already_exist': already_exist,
            'no_fee_structure': no_fee_structure,
            'total_amount': str(total),
            'students': will_create[:50],
            'has_more': len(will_create) > 50,
        })

    @action(detail=False, methods=['post'])
    def generate_monthly(self, request):
        """Bulk generate fee payment records (background task)."""
        serializer = GenerateMonthlySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        month = serializer.validated_data['month']
        year = serializer.validated_data['year']
        class_id = serializer.validated_data.get('class_id')
        academic_year_id = serializer.validated_data.get('academic_year')

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account.'}, status=400)

        # Quick validation — block closed periods before dispatching task
        if MonthlyClosing.objects.filter(school_id=school_id, year=year, month=month).exists():
            return Response({
                'detail': f'Period {year}/{month:02d} is closed. Reopen it before generating fees.'
            }, status=400)

        from core.models import BackgroundTask
        from .tasks import generate_monthly_fees_task

        task_kwargs = {
            'school_id': school_id,
            'month': month,
            'year': year,
            'class_id': class_id,
            'academic_year_id': academic_year_id,
        }
        title = f"Generating fees for {month}/{year}"

        student_qs = Student.objects.filter(school_id=school_id, is_active=True)
        if academic_year_id:
            student_qs = student_qs.filter(
                enrollments__academic_year_id=academic_year_id,
                enrollments__is_active=True,
            )
        if class_id:
            student_qs = student_qs.filter(class_obj_id=class_id)
        student_qs = student_qs.distinct()
        student_count = student_qs.count()

        if student_count < 100:
            from core.task_utils import run_task_sync
            try:
                bg_task = run_task_sync(
                    generate_monthly_fees_task, BackgroundTask.TaskType.FEE_GENERATION,
                    title, school_id, request.user, task_kwargs=task_kwargs,
                )
            except Exception as e:
                return Response({'detail': str(e)}, status=500)
            return Response({
                'task_id': bg_task.celery_task_id,
                'message': bg_task.result_data.get('message', 'Fees generated.') if bg_task.result_data else 'Fees generated.',
                'result': bg_task.result_data,
            })
        else:
            from core.task_utils import dispatch_background_task
            bg_task = dispatch_background_task(
                celery_task_func=generate_monthly_fees_task,
                task_type=BackgroundTask.TaskType.FEE_GENERATION,
                title=title, school_id=school_id, user=request.user,
                task_kwargs=task_kwargs,
            )
            return Response({
                'task_id': bg_task.celery_task_id,
                'message': 'Fee generation started.',
            }, status=202)

    @action(detail=False, methods=['post'], url_path='generate_onetime_fees')
    def generate_onetime_fees(self, request):
        """Generate one-time fee records (ADMISSION, ANNUAL, BOOKS, etc.) for specified students."""
        serializer = GenerateOnetimeFeesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        student_ids = serializer.validated_data['student_ids']
        fee_types = serializer.validated_data['fee_types']
        year = serializer.validated_data['year']
        month_for_monthly = serializer.validated_data.get('month', 0)

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated.'}, status=400)

        # Resolve academic year
        from academic_sessions.models import AcademicYear
        academic_year_id = serializer.validated_data.get('academic_year')
        if not academic_year_id:
            ay = AcademicYear.objects.filter(
                school_id=school_id, is_current=True, is_active=True
            ).first()
            if ay:
                academic_year_id = ay.id

        students = Student.objects.filter(
            id__in=student_ids, school_id=school_id, is_active=True
        ).select_related('class_obj')

        created_count = 0
        skipped_count = 0
        no_fee_count = 0

        for student in students:
            for ft in fee_types:
                m = month_for_monthly if (ft == 'MONTHLY' and month_for_monthly >= 1) else (date.today().month if ft == 'MONTHLY' else 0)

                if FeePayment.objects.filter(
                    school_id=school_id, student=student,
                    month=m, year=year, fee_type=ft,
                ).exists():
                    skipped_count += 1
                    continue

                amount = resolve_fee_amount(student, ft)
                if amount is None:
                    no_fee_count += 1
                    continue

                FeePayment.objects.create(
                    school_id=school_id, student=student,
                    fee_type=ft, month=m, year=year,
                    amount_due=amount, amount_paid=0,
                    academic_year_id=academic_year_id,
                )
                created_count += 1

        return Response({
            'created': created_count,
            'skipped': skipped_count,
            'no_fee_structure': no_fee_count,
            'message': f'{created_count} fee record(s) created.',
        })

    @action(detail=False, methods=['post'])
    def bulk_update(self, request):
        """Bulk update amount_paid for multiple fee payment records.

        Supports two modes:
        - Normal: records=[{id, amount_paid, account, ...}]
        - Pay full: pay_full=true, ids=[...], account=N, payment_method=...
          Sets each record's amount_paid = amount_due automatically.
        """
        pay_full = request.data.get('pay_full', False)
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account.'}, status=400)

        if pay_full:
            ids = request.data.get('ids', [])
            account_id = request.data.get('account')
            payment_method = request.data.get('payment_method', 'CASH')
            if not ids:
                return Response({'detail': 'No IDs provided.'}, status=400)
            if not account_id:
                return Response({'detail': 'Please select account'}, status=400)

            payments = FeePayment.objects.filter(id__in=ids, school_id=school_id)
            updated_count = 0
            for payment in payments:
                payment.amount_paid = payment.amount_due
                payment.account_id = account_id
                payment.payment_method = payment_method
                payment.collected_by = request.user
                if not payment.payment_date:
                    payment.payment_date = date.today()
                payment.save()
                updated_count += 1
            return Response({'updated': updated_count, 'errors': []})

        records = request.data.get('records', [])
        if not records:
            return Response({'detail': 'No records provided.'}, status=400)

        # Validate that all records have an account
        for item in records:
            if not item.get('account'):
                return Response({'detail': 'Please select account'}, status=400)

        updated_count = 0
        errors = []
        for item in records:
            try:
                payment = FeePayment.objects.get(id=item['id'], school_id=school_id)
                if 'amount_paid' in item:
                    payment.amount_paid = Decimal(str(item['amount_paid']))
                if 'payment_date' in item:
                    payment.payment_date = item['payment_date']
                elif Decimal(str(item.get('amount_paid', 0))) > 0 and not payment.payment_date:
                    payment.payment_date = date.today()
                if 'payment_method' in item:
                    payment.payment_method = item['payment_method']
                if 'account' in item:
                    payment.account_id = item['account']
                payment.collected_by = request.user
                payment.save()
                updated_count += 1
            except FeePayment.DoesNotExist:
                errors.append(f"Record {item.get('id')} not found")
            except Exception as e:
                errors.append(f"Record {item.get('id')}: {str(e)}")

        return Response({'updated': updated_count, 'errors': errors})

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        """Bulk delete fee payment records by IDs."""
        ids = request.data.get('ids', [])
        if not ids:
            return Response({'detail': 'No IDs provided.'}, status=400)

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account.'}, status=400)

        payments = FeePayment.objects.filter(id__in=ids, school_id=school_id)
        deleted_count = 0
        errors = []
        for payment in payments:
            try:
                payment.delete()
                deleted_count += 1
            except Exception as e:
                errors.append(f"Record {payment.id}: {str(e)}")

        result = {'deleted': deleted_count}
        if errors:
            result['errors'] = errors
        return Response(result)

    @action(detail=False, methods=['get'])
    def monthly_summary(self, request):
        """Get aggregated summary for a month/year."""
        month = request.query_params.get('month', date.today().month)
        year = request.query_params.get('year', date.today().year)
        school_id = _resolve_school_id(request)

        if not school_id:
            return Response({'detail': 'No school associated with your account. Please contact an administrator.'}, status=400)

        payments = FeePayment.objects.filter(
            school_id=school_id, month=month, year=year
        )

        academic_year = request.query_params.get('academic_year')
        if academic_year:
            payments = payments.filter(academic_year_id=academic_year)

        fee_type = request.query_params.get('fee_type')
        if fee_type:
            payments = payments.filter(fee_type=fee_type.upper())

        totals = payments.aggregate(
            total_due=Sum('amount_due'),
            total_collected=Sum('amount_paid'),
        )

        total_due = totals['total_due'] or Decimal('0')
        total_collected = totals['total_collected'] or Decimal('0')

        status_counts = payments.values('status').annotate(count=Count('id'))
        counts = {item['status']: item['count'] for item in status_counts}

        # Per-class breakdown
        by_class = payments.values(
            'student__class_obj__id', 'student__class_obj__name'
        ).annotate(
            total_due=Sum('amount_due'),
            total_collected=Sum('amount_paid'),
            count=Count('id'),
        ).order_by('student__class_obj__name')

        return Response({
            'month': int(month),
            'year': int(year),
            'total_due': total_due,
            'total_collected': total_collected,
            'total_pending': max(Decimal('0'), total_due - total_collected),
            'paid_count': counts.get('PAID', 0),
            'partial_count': counts.get('PARTIAL', 0),
            'unpaid_count': counts.get('UNPAID', 0),
            'advance_count': counts.get('ADVANCE', 0),
            'by_class': [
                {
                    'class_id': item['student__class_obj__id'],
                    'class_name': item['student__class_obj__name'],
                    'total_due': item['total_due'],
                    'total_collected': item['total_collected'],
                    'count': item['count'],
                }
                for item in by_class
            ],
        })

    @action(detail=False, methods=['get'])
    def student_ledger(self, request):
        """Get all payment records for a specific student."""
        student_id = request.query_params.get('student_id')
        if not student_id:
            return Response({'detail': 'student_id is required.'}, status=400)

        payments = self.get_queryset().filter(student_id=student_id).order_by('-year', '-month')
        serializer = FeePaymentSerializer(payments, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='monthly_summary_all')
    def monthly_summary_all(self, request):
        """Fee collection summary across all accessible schools in the org."""
        from schools.models import School
        month = int(request.query_params.get('month', date.today().month))
        year = int(request.query_params.get('year', date.today().year))

        school_ids = ensure_tenant_schools(request)
        if not school_ids:
            return Response({'detail': 'No schools accessible.'}, status=400)

        schools = School.objects.filter(id__in=school_ids, is_active=True)

        results = []
        grand_due = grand_collected = Decimal('0')
        for school in schools:
            totals = FeePayment.objects.filter(
                school=school, month=month, year=year
            ).aggregate(
                total_due=Sum('amount_due'),
                total_collected=Sum('amount_paid'),
            )
            due = totals['total_due'] or Decimal('0')
            collected = totals['total_collected'] or Decimal('0')
            results.append({
                'school_id': school.id,
                'school_name': school.name,
                'total_due': due,
                'total_collected': collected,
                'total_pending': max(Decimal('0'), due - collected),
            })
            grand_due += due
            grand_collected += collected

        return Response({
            'month': month,
            'year': year,
            'schools': results,
            'grand_total_due': grand_due,
            'grand_total_collected': grand_collected,
            'grand_total_pending': max(Decimal('0'), grand_due - grand_collected),
        })


def _seed_expense_categories(school_id):
    """Create default expense categories for a school if none exist."""
    for code, name in DEFAULT_EXPENSE_CATEGORIES:
        ExpenseCategory.objects.get_or_create(
            school_id=school_id, name=name, defaults={'code': code},
        )


def _seed_income_categories(school_id):
    """Create default income categories for a school if none exist."""
    for code, name in DEFAULT_INCOME_CATEGORIES:
        IncomeCategory.objects.get_or_create(
            school_id=school_id, name=name, defaults={'code': code},
        )


class ExpenseCategoryViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for school expense categories. Auto-seeds defaults on first access."""
    required_module = 'finance'
    queryset = ExpenseCategory.objects.all()
    serializer_class = ExpenseCategorySerializer
    permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]

    def list(self, request, *args, **kwargs):
        school_id = _resolve_school_id(request)
        if school_id and not ExpenseCategory.objects.filter(school_id=school_id).exists():
            _seed_expense_categories(school_id)
        return super().list(request, *args, **kwargs)

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        serializer.save(school_id=school_id)


class IncomeCategoryViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for school income categories. Auto-seeds defaults on first access."""
    required_module = 'finance'
    queryset = IncomeCategory.objects.all()
    serializer_class = IncomeCategorySerializer
    permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]

    def list(self, request, *args, **kwargs):
        school_id = _resolve_school_id(request)
        if school_id and not IncomeCategory.objects.filter(school_id=school_id).exists():
            _seed_income_categories(school_id)
        return super().list(request, *args, **kwargs)

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        serializer.save(school_id=school_id)


class ExpenseViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD + category summaries for school expenses."""
    required_module = 'finance'
    queryset = Expense.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action == 'create':
            return ExpenseCreateSerializer
        return ExpenseSerializer

    def get_queryset(self):
        queryset = Expense.objects.select_related('school', 'recorded_by', 'account', 'category')

        # Filter by active school (works for all users including super admin)
        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Staff: hide sensitive expenses and restrict to visible accounts
        if _is_staff_user(self.request):
            queryset = queryset.filter(is_sensitive=False)
            if school_id:
                visible_accounts = _get_staff_visible_accounts(school_id)
                queryset = queryset.filter(
                    Q(account_id__in=visible_accounts) | Q(account__isnull=True)
                )

        # Filters
        category = self.request.query_params.get('category')
        date_from = self.request.query_params.get('date_from')
        date_to = self.request.query_params.get('date_to')

        if category:
            queryset = queryset.filter(category_id=category)
        if date_from:
            queryset = queryset.filter(date__gte=date_from)
        if date_to:
            queryset = queryset.filter(date__lte=date_to)

        return queryset

    def perform_create(self, serializer):
        school_id = self.request.data.get('school') or _resolve_school_id(self.request)
        if school_id:
            serializer.save(school_id=school_id, recorded_by=self.request.user)
        else:
            serializer.save(recorded_by=self.request.user)

    @action(detail=False, methods=['get'])
    def category_summary(self, request):
        """Get expenses grouped by category for a date range."""
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account. Please contact an administrator.'}, status=400)

        queryset = Expense.objects.filter(school_id=school_id).select_related('category')

        # Staff: hide sensitive expenses and restrict to visible accounts
        if _is_staff_user(request):
            queryset = queryset.filter(is_sensitive=False)
            visible_accounts = _get_staff_visible_accounts(school_id)
            queryset = queryset.filter(
                Q(account_id__in=visible_accounts) | Q(account__isnull=True)
            )

        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')
        if date_from:
            queryset = queryset.filter(date__gte=date_from)
        if date_to:
            queryset = queryset.filter(date__lte=date_to)

        summary = queryset.values('category', 'category__name').annotate(
            total_amount=Sum('amount'),
            count=Count('id'),
        ).order_by('-total_amount')

        result = [
            {
                'category': item['category'],
                'category_display': item['category__name'] or 'Uncategorized',
                'total_amount': item['total_amount'],
                'count': item['count'],
            }
            for item in summary
        ]

        total = queryset.aggregate(total=Sum('amount'))['total'] or Decimal('0')

        return Response({
            'categories': result,
            'total': total,
        })


class OtherIncomeViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for non-student-linked income (book sales, donations, etc.)."""
    required_module = 'finance'
    queryset = OtherIncome.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action == 'create':
            return OtherIncomeCreateSerializer
        return OtherIncomeSerializer

    def get_queryset(self):
        queryset = OtherIncome.objects.select_related('school', 'recorded_by', 'account', 'category')

        # Filter by active school (works for all users including super admin)
        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Staff: hide sensitive income and restrict to visible accounts
        if _is_staff_user(self.request):
            queryset = queryset.filter(is_sensitive=False)
            if school_id:
                visible_accounts = _get_staff_visible_accounts(school_id)
                queryset = queryset.filter(
                    Q(account_id__in=visible_accounts) | Q(account__isnull=True)
                )

        category = self.request.query_params.get('category')
        date_from = self.request.query_params.get('date_from')
        date_to = self.request.query_params.get('date_to')

        if category:
            queryset = queryset.filter(category=category.upper())
        if date_from:
            queryset = queryset.filter(date__gte=date_from)
        if date_to:
            queryset = queryset.filter(date__lte=date_to)

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        serializer.save(school_id=school_id, recorded_by=self.request.user)

class AccountViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for accounts + balance computation."""
    required_module = 'finance'
    queryset = Account.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action == 'create':
            return AccountCreateSerializer
        return AccountSerializer

    def get_queryset(self):
        queryset = Account.objects.filter(is_active=True)
        user = self.request.user

        # Filter by active school + org-level shared accounts
        school_id = _resolve_school_id(self.request)
        if school_id:
            from schools.models import School
            try:
                org_id = School.objects.values_list('organization_id', flat=True).get(id=school_id)
            except School.DoesNotExist:
                org_id = None
            q = Q(school_id=school_id)
            if org_id:
                q |= Q(school__isnull=True, organization_id=org_id)
            queryset = queryset.filter(q)
        elif not user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                org_id = user.organization_id
                q = Q(school_id__in=tenant_schools)
                if org_id:
                    q |= Q(school__isnull=True, organization_id=org_id)
                queryset = queryset.filter(q)
            else:
                return queryset.none()

        # Staff can only see accounts marked as staff_visible
        if _is_staff_user(self.request):
            queryset = queryset.filter(staff_visible=True)

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)

    @staticmethod
    def _find_prior_snapshot(account_id, school_id, before_year, before_month):
        """Find the latest AccountSnapshot whose closing month is strictly
        before the given (year, month). Returns snapshot or None."""
        q = (
            Q(closing__year__lt=before_year) |
            Q(closing__year=before_year, closing__month__lt=before_month)
        )
        return (
            AccountSnapshot.objects
            .filter(q, account_id=account_id, closing__school_id=school_id)
            .select_related('closing')
            .order_by('-closing__year', '-closing__month')
            .first()
        )

    @staticmethod
    def _compute_account_balance(account, scope_ids, date_from=None, date_to=None,
                                  is_staff=False, snapshot_school_id=None):
        """Compute balance for a single account across given school IDs.

        If snapshot_school_id is provided, attempts to use a prior monthly
        snapshot as the BBF starting point to avoid scanning all historical
        transactions. Falls back to account.opening_balance if no snapshot.
        """
        base_bbf = account.opening_balance
        txn_start = None  # None = sum from beginning of time

        # --- Snapshot lookup ---
        if snapshot_school_id:
            if date_from:
                dt = date_from if isinstance(date_from, date) else date.fromisoformat(str(date_from))
                snap_year, snap_month = dt.year, dt.month
            else:
                snap_year, snap_month = 9999, 12

            snapshot = AccountViewSet._find_prior_snapshot(
                account.id, snapshot_school_id, snap_year, snap_month
            )
            if snapshot:
                base_bbf = snapshot.closing_balance
                last_day = calendar.monthrange(snapshot.closing.year, snapshot.closing.month)[1]
                snapshot_end = date(snapshot.closing.year, snapshot.closing.month, last_day)
                txn_start = snapshot_end + timedelta(days=1)

        # --- Build base querysets ---
        fee_qs = FeePayment.objects.filter(school_id__in=scope_ids, account=account)
        income_qs = OtherIncome.objects.filter(school_id__in=scope_ids, account=account)
        expense_qs = Expense.objects.filter(school_id__in=scope_ids, account=account)
        tfr_in_qs = Transfer.objects.filter(school_id__in=scope_ids, to_account=account)
        tfr_out_qs = Transfer.objects.filter(school_id__in=scope_ids, from_account=account)

        if is_staff:
            income_qs = income_qs.filter(is_sensitive=False)
            expense_qs = expense_qs.filter(is_sensitive=False)
            tfr_in_qs = tfr_in_qs.filter(is_sensitive=False)
            tfr_out_qs = tfr_out_qs.filter(is_sensitive=False)

        # Apply date floor: txn_start (from snapshot) or date_from (user filter)
        # When snapshot exists, txn_start is the floor — NULLs are EXCLUDED (already in snapshot).
        # When no snapshot, date_from is the floor — NULLs are INCLUDED (real payments without date).
        effective_floor = txn_start or (date_from if date_from else None)
        if effective_floor:
            if txn_start:
                fee_qs = fee_qs.filter(payment_date__gte=effective_floor)
            else:
                fee_qs = fee_qs.filter(Q(payment_date__gte=effective_floor) | Q(payment_date__isnull=True))
            income_qs = income_qs.filter(date__gte=effective_floor)
            expense_qs = expense_qs.filter(date__gte=effective_floor)
            tfr_in_qs = tfr_in_qs.filter(date__gte=effective_floor)
            tfr_out_qs = tfr_out_qs.filter(date__gte=effective_floor)

        # Apply date_to ceiling
        # Include NULL payment_dates for FeePayment (they have no date but are real payments)
        if date_to:
            fee_qs = fee_qs.filter(Q(payment_date__lte=date_to) | Q(payment_date__isnull=True))
            income_qs = income_qs.filter(date__lte=date_to)
            expense_qs = expense_qs.filter(date__lte=date_to)
            tfr_in_qs = tfr_in_qs.filter(date__lte=date_to)
            tfr_out_qs = tfr_out_qs.filter(date__lte=date_to)

        # Compute totals for full range (txn_start..date_to)
        all_receipts = (
            (fee_qs.aggregate(t=Sum('amount_paid'))['t'] or Decimal('0')) +
            (income_qs.aggregate(t=Sum('amount'))['t'] or Decimal('0'))
        )
        all_payments = expense_qs.aggregate(t=Sum('amount'))['t'] or Decimal('0')
        all_tfr_in = tfr_in_qs.aggregate(t=Sum('amount'))['t'] or Decimal('0')
        all_tfr_out = tfr_out_qs.aggregate(t=Sum('amount'))['t'] or Decimal('0')

        # If date_from is set and there's a gap between txn_start and date_from,
        # fold gap transactions into effective BBF so displayed columns only
        # show the user's requested period.
        if date_from and txn_start and str(txn_start) < str(date_from):
            pre_end = (date.fromisoformat(str(date_from)) - timedelta(days=1)).isoformat()
            pre_filters = {'date__gte': txn_start, 'date__lte': pre_end}

            pre_fee = FeePayment.objects.filter(
                school_id__in=scope_ids, account=account,
                payment_date__gte=txn_start, payment_date__lte=pre_end,
            )
            pre_income = OtherIncome.objects.filter(school_id__in=scope_ids, account=account, **pre_filters)
            pre_expense = Expense.objects.filter(school_id__in=scope_ids, account=account, **pre_filters)
            pre_tfr_in = Transfer.objects.filter(school_id__in=scope_ids, to_account=account, **pre_filters)
            pre_tfr_out = Transfer.objects.filter(school_id__in=scope_ids, from_account=account, **pre_filters)

            if is_staff:
                pre_income = pre_income.filter(is_sensitive=False)
                pre_expense = pre_expense.filter(is_sensitive=False)
                pre_tfr_in = pre_tfr_in.filter(is_sensitive=False)
                pre_tfr_out = pre_tfr_out.filter(is_sensitive=False)

            pre_receipts = (
                (pre_fee.aggregate(t=Sum('amount_paid'))['t'] or Decimal('0')) +
                (pre_income.aggregate(t=Sum('amount'))['t'] or Decimal('0'))
            )
            pre_payments = pre_expense.aggregate(t=Sum('amount'))['t'] or Decimal('0')
            pre_tfr_in_amt = pre_tfr_in.aggregate(t=Sum('amount'))['t'] or Decimal('0')
            pre_tfr_out_amt = pre_tfr_out.aggregate(t=Sum('amount'))['t'] or Decimal('0')

            effective_bbf = base_bbf + pre_receipts - pre_payments + pre_tfr_in_amt - pre_tfr_out_amt
            receipts = all_receipts - pre_receipts
            payments = all_payments - pre_payments
            transfers_in = all_tfr_in - pre_tfr_in_amt
            transfers_out = all_tfr_out - pre_tfr_out_amt
        else:
            effective_bbf = base_bbf
            receipts = all_receipts
            payments = all_payments
            transfers_in = all_tfr_in
            transfers_out = all_tfr_out

        return {
            'id': account.id,
            'name': account.name,
            'account_type': account.account_type,
            'opening_balance': effective_bbf,
            'receipts': receipts,
            'payments': payments,
            'transfers_in': transfers_in,
            'transfers_out': transfers_out,
            'net_balance': effective_bbf + receipts - payments + transfers_in - transfers_out,
            'is_shared': account.school_id is None,
        }

    @action(detail=False, methods=['get'])
    def balances(self, request):
        """Get all accounts with computed balances for the active school.

        School-specific accounts: transactions filtered to that school only.
        Org-level shared accounts (school=NULL): transactions across ALL schools in the org.
        """
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account.'}, status=400)

        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')

        from schools.models import School
        try:
            school_obj = School.objects.select_related('organization').get(id=school_id)
            org_id = school_obj.organization_id
        except School.DoesNotExist:
            org_id = None

        # PRINCIPAL sees only their school's accounts (no shared/org-level)
        # SCHOOL_ADMIN and SUPER_ADMIN see all (school + shared)
        effective_role = get_effective_role(request)
        is_principal = effective_role == 'PRINCIPAL'

        q = Q(school_id=school_id, is_active=True)
        if org_id and not is_principal:
            q |= Q(school__isnull=True, organization_id=org_id, is_active=True)
        accounts = Account.objects.filter(q)

        is_staff = _is_staff_user(request)
        if is_staff:
            accounts = accounts.filter(staff_visible=True)

        if org_id:
            org_school_ids = list(School.objects.filter(organization_id=org_id).values_list('id', flat=True))
        else:
            org_school_ids = [school_id]

        results = []
        for account in accounts:
            scope_ids = org_school_ids if account.school_id is None else [account.school_id]
            results.append(self._compute_account_balance(
                account, scope_ids, date_from, date_to, is_staff,
                snapshot_school_id=school_id,
            ))

        grand_total = sum(r['net_balance'] for r in results)

        return Response({
            'accounts': results,
            'grand_total': grand_total,
            'date_from': date_from,
            'date_to': date_to,
        })

    @action(detail=False, methods=['get'], url_path='balances_all')
    def balances_all(self, request):
        """Get account balances across ALL accessible schools, grouped by school.

        For admins with multiple schools: returns per-school sections + shared accounts.
        Staff users get 403 — they should use the regular balances endpoint.
        """
        if _is_staff_user(request):
            return Response({'detail': 'Staff members should use the regular balances endpoint.'}, status=403)

        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')

        from schools.models import School
        tenant_schools = ensure_tenant_schools(request)
        if not tenant_schools:
            return Response({'detail': 'No schools accessible.'}, status=400)

        schools = School.objects.filter(id__in=tenant_schools, is_active=True).order_by('name')

        # Determine org for shared accounts
        org_ids = set(schools.values_list('organization_id', flat=True))
        org_ids.discard(None)
        if org_ids:
            org_school_ids = list(School.objects.filter(organization_id__in=org_ids).values_list('id', flat=True))
        else:
            org_school_ids = list(tenant_schools)

        # Build per-school groups
        groups = []
        seen_shared_ids = set()

        for school_obj in schools:
            school_accounts = Account.objects.filter(school_id=school_obj.id, is_active=True)
            account_results = []
            for account in school_accounts:
                account_results.append(self._compute_account_balance(
                    account, [account.school_id], date_from, date_to,
                    snapshot_school_id=school_obj.id,
                ))

            subtotal = sum(r['net_balance'] for r in account_results)
            groups.append({
                'school_id': school_obj.id,
                'school_name': school_obj.name,
                'accounts': account_results,
                'subtotal': subtotal,
            })

        # Shared (org-level) accounts
        shared_accounts = Account.objects.filter(
            school__isnull=True, organization_id__in=org_ids, is_active=True
        ) if org_ids else Account.objects.none()

        shared_results = []
        for account in shared_accounts:
            shared_results.append(self._compute_account_balance(
                account, org_school_ids, date_from, date_to
            ))

        shared_subtotal = sum(r['net_balance'] for r in shared_results)
        grand_total = sum(g['subtotal'] for g in groups) + shared_subtotal

        return Response({
            'groups': groups,
            'shared': {
                'accounts': shared_results,
                'subtotal': shared_subtotal,
            },
            'grand_total': grand_total,
            'date_from': date_from,
            'date_to': date_to,
        })

    @action(detail=False, methods=['post'], permission_classes=[IsAuthenticated, IsSchoolAdmin, HasSchoolAccess])
    def close_month(self, request):
        """Close a month: compute and store balance snapshots for all accounts."""
        serializer = CloseMonthSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        year = serializer.validated_data['year']
        month = serializer.validated_data['month']
        notes = serializer.validated_data.get('notes', '')

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated.'}, status=400)

        # --- Safeguard 3: pre-close validation ---
        # Reject close if any fee payments in the target month have dirty data
        dirty_fees = FeePayment.objects.filter(
            school_id=school_id, month=month, year=year,
            amount_paid__gt=0,
        ).filter(
            Q(payment_date__isnull=True) | Q(account__isnull=True)
        )
        dirty_count = dirty_fees.count()
        if dirty_count > 0:
            samples = list(
                dirty_fees.select_related('student')
                .values_list('student__name', flat=True)[:5]
            )
            return Response({
                'detail': (
                    f"Cannot close {year}/{month:02d}: {dirty_count} fee payment(s) "
                    f"have amount_paid > 0 but are missing payment_date or account. "
                    f"Fix them first."
                ),
                'dirty_count': dirty_count,
                'sample_students': samples,
            }, status=400)

        # Reject close if there are no transactions at all for this month
        last_day = calendar.monthrange(year, month)[1]
        month_start = date(year, month, 1)
        month_end_date = date(year, month, last_day)
        has_fees = FeePayment.objects.filter(
            school_id=school_id, month=month, year=year,
        ).exists()
        has_expenses = Expense.objects.filter(
            school_id=school_id, date__gte=month_start, date__lte=month_end_date,
        ).exists()
        has_income = OtherIncome.objects.filter(
            school_id=school_id, date__gte=month_start, date__lte=month_end_date,
        ).exists()
        if not has_fees and not has_expenses and not has_income:
            return Response({
                'detail': (
                    f"Cannot close {year}/{month:02d}: no transactions found for this month. "
                    f"There must be at least some data before closing."
                ),
            }, status=400)

        month_end = month_end_date.isoformat()

        from schools.models import School
        try:
            school_obj = School.objects.select_related('organization').get(id=school_id)
            org_id = school_obj.organization_id
        except School.DoesNotExist:
            org_id = None

        q = Q(school_id=school_id, is_active=True)
        if org_id:
            q |= Q(school__isnull=True, organization_id=org_id, is_active=True)
        accounts = Account.objects.filter(q)

        if org_id:
            org_school_ids = list(School.objects.filter(organization_id=org_id).values_list('id', flat=True))
        else:
            org_school_ids = [school_id]

        from django.utils import timezone as tz
        with transaction.atomic():
            closing, created = MonthlyClosing.objects.update_or_create(
                school_id=school_id, year=year, month=month,
                defaults={
                    'closed_by': request.user,
                    'closed_at': tz.now(),
                    'notes': notes,
                },
            )
            if not created:
                closing.snapshots.all().delete()

            snapshots = []
            for account in accounts:
                scope_ids = org_school_ids if account.school_id is None else [account.school_id]
                result = self._compute_account_balance(
                    account, scope_ids,
                    date_from=None, date_to=month_end,
                    is_staff=False, snapshot_school_id=school_id,
                )
                snapshots.append(AccountSnapshot(
                    closing=closing,
                    account=account,
                    closing_balance=result['net_balance'],
                    opening_balance_used=result['opening_balance'],
                    receipts=result['receipts'],
                    payments=result['payments'],
                    transfers_in=result['transfers_in'],
                    transfers_out=result['transfers_out'],
                ))
            AccountSnapshot.objects.bulk_create(snapshots)

        return Response({
            'id': closing.id,
            'year': year,
            'month': month,
            'accounts_closed': len(snapshots),
            'closed_at': closing.closed_at.isoformat(),
        })

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated, IsSchoolAdmin, HasSchoolAccess])
    def closings(self, request):
        """List all monthly closings for the active school."""
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated.'}, status=400)

        qs = (
            MonthlyClosing.objects
            .filter(school_id=school_id)
            .select_related('closed_by')
            .order_by('-year', '-month')
        )
        serializer = MonthlyClosingSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['delete'], url_path='reopen',
            permission_classes=[IsAuthenticated, IsSchoolAdmin, HasSchoolAccess])
    def reopen_month(self, request, pk=None):
        """Delete a monthly closing and its snapshots (reopen the month)."""
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated.'}, status=400)

        try:
            closing = MonthlyClosing.objects.get(id=pk, school_id=school_id)
        except MonthlyClosing.DoesNotExist:
            return Response({'detail': 'Closing not found.'}, status=404)

        year, month = closing.year, closing.month
        closing.delete()

        return Response({'detail': f'Month {year}/{month:02d} reopened.', 'year': year, 'month': month})

    @action(detail=False, methods=['get'], url_path='recent_entries',
            permission_classes=[IsAuthenticated, IsSchoolAdmin, HasSchoolAccess])
    def recent_entries(self, request):
        """Return recent finance entries across all transaction types. Admin+ only."""
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated.'}, status=400)

        limit = min(int(request.query_params.get('limit', 20)), 50)
        entries = []

        # Recent fee payments (where money was actually received)
        fee_payments = (
            FeePayment.objects
            .filter(school_id=school_id, amount_paid__gt=0)
            .select_related('student', 'student__class_obj', 'account', 'collected_by')
            .order_by('-updated_at')[:limit]
        )
        for fp in fee_payments:
            entries.append({
                'type': 'fee_payment',
                'id': fp.id,
                'description': f"{fp.student.name} ({fp.student.class_obj.name if fp.student.class_obj else 'N/A'})",
                'amount': float(fp.amount_paid),
                'date': str(fp.payment_date) if fp.payment_date else None,
                'account_name': fp.account.name if fp.account else None,
                'recorded_by': fp.collected_by.get_full_name() if fp.collected_by else None,
                'timestamp': fp.updated_at.isoformat(),
            })

        # Recent other income
        other_income = (
            OtherIncome.objects
            .filter(school_id=school_id)
            .select_related('account', 'recorded_by', 'category')
            .order_by('-created_at')[:limit]
        )
        for oi in other_income:
            entries.append({
                'type': 'other_income',
                'id': oi.id,
                'description': f"{oi.category.name if oi.category else 'Uncategorized'}{(' — ' + oi.description) if oi.description else ''}",
                'amount': float(oi.amount),
                'date': str(oi.date),
                'account_name': oi.account.name if oi.account else None,
                'recorded_by': oi.recorded_by.get_full_name() if oi.recorded_by else None,
                'timestamp': oi.created_at.isoformat(),
            })

        # Recent expenses
        expenses = (
            Expense.objects
            .filter(school_id=school_id)
            .select_related('account', 'recorded_by', 'category')
            .order_by('-created_at')[:limit]
        )
        for exp in expenses:
            entries.append({
                'type': 'expense',
                'id': exp.id,
                'description': f"{exp.category.name if exp.category else 'Uncategorized'}{(' — ' + exp.description) if exp.description else ''}",
                'amount': float(exp.amount),
                'date': str(exp.date),
                'account_name': exp.account.name if exp.account else None,
                'recorded_by': exp.recorded_by.get_full_name() if exp.recorded_by else None,
                'timestamp': exp.created_at.isoformat(),
            })

        # Recent transfers
        transfers = (
            Transfer.objects
            .filter(school_id=school_id)
            .select_related('from_account', 'to_account', 'recorded_by')
            .order_by('-created_at')[:limit]
        )
        for tfr in transfers:
            entries.append({
                'type': 'transfer',
                'id': tfr.id,
                'description': f"{tfr.from_account.name} → {tfr.to_account.name}{(' — ' + tfr.description) if tfr.description else ''}",
                'amount': float(tfr.amount),
                'date': str(tfr.date),
                'account_name': None,
                'recorded_by': tfr.recorded_by.get_full_name() if tfr.recorded_by else None,
                'timestamp': tfr.created_at.isoformat(),
            })

        # Sort all by timestamp descending, take top N
        entries.sort(key=lambda e: e['timestamp'], reverse=True)
        return Response(entries[:limit])


class TransferViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for inter-account transfers."""
    required_module = 'finance'
    queryset = Transfer.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action == 'create':
            return TransferCreateSerializer
        return TransferSerializer

    def get_queryset(self):
        queryset = Transfer.objects.select_related(
            'from_account', 'to_account', 'recorded_by'
        )

        # Filter by active school (works for all users including super admin)
        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Staff: hide sensitive transfers and restrict to visible accounts
        if _is_staff_user(self.request):
            queryset = queryset.filter(is_sensitive=False)
            if school_id:
                visible_accounts = _get_staff_visible_accounts(school_id)
                queryset = queryset.filter(
                    from_account_id__in=visible_accounts,
                    to_account_id__in=visible_accounts,
                )

        account_id = self.request.query_params.get('account_id')
        date_from = self.request.query_params.get('date_from')
        date_to = self.request.query_params.get('date_to')

        if account_id:
            queryset = queryset.filter(
                Q(from_account_id=account_id) | Q(to_account_id=account_id)
            )
        if date_from:
            queryset = queryset.filter(date__gte=date_from)
        if date_to:
            queryset = queryset.filter(date__lte=date_to)

        return queryset

    def perform_create(self, serializer):
        from rest_framework.exceptions import ValidationError
        school_id = _resolve_school_id(self.request)
        if not school_id:
            raise ValidationError({'detail': 'No school associated with your account.'})

        # Validate that from_account and to_account are accessible
        from schools.models import School
        try:
            org_id = School.objects.values_list('organization_id', flat=True).get(id=school_id)
        except School.DoesNotExist:
            org_id = None

        accessible_q = Q(school_id=school_id, is_active=True)
        if org_id:
            accessible_q |= Q(school__isnull=True, organization_id=org_id, is_active=True)
        accessible_ids = set(Account.objects.filter(accessible_q).values_list('id', flat=True))

        from_id = serializer.validated_data['from_account'].id
        to_id = serializer.validated_data['to_account'].id
        if from_id not in accessible_ids:
            raise ValidationError({'from_account': 'This account is not accessible for your school.'})
        if to_id not in accessible_ids:
            raise ValidationError({'to_account': 'This account is not accessible for your school.'})

        serializer.save(school_id=school_id, recorded_by=self.request.user)


class FinanceReportsView(ModuleAccessMixin, APIView):
    """Financial reports: summary and monthly trends."""
    required_module = 'finance'
    permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]

    def get(self, request):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account. Please contact an administrator.'}, status=400)

        report_type = request.query_params.get('type', 'summary')

        if report_type == 'monthly_trend':
            return self._monthly_trend(request, school_id)
        return self._summary(request, school_id)

    def _summary(self, request, school_id):
        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')
        is_staff = _is_staff_user(request)

        # Income from fee payments
        fee_qs = FeePayment.objects.filter(school_id=school_id)
        expense_qs = Expense.objects.filter(school_id=school_id)
        other_income_qs = OtherIncome.objects.filter(school_id=school_id)

        # Staff: filter to visible accounts and non-sensitive transactions
        if is_staff:
            visible_accounts = _get_staff_visible_accounts(school_id)
            fee_qs = fee_qs.filter(
                Q(account_id__in=visible_accounts) | Q(account__isnull=True)
            )
            expense_qs = expense_qs.filter(
                is_sensitive=False
            ).filter(
                Q(account_id__in=visible_accounts) | Q(account__isnull=True)
            )
            other_income_qs = other_income_qs.filter(
                is_sensitive=False
            ).filter(
                Q(account_id__in=visible_accounts) | Q(account__isnull=True)
            )

        if date_from:
            fee_qs = fee_qs.filter(Q(payment_date__gte=date_from) | Q(payment_date__isnull=True))
            expense_qs = expense_qs.filter(date__gte=date_from)
            other_income_qs = other_income_qs.filter(date__gte=date_from)
        if date_to:
            fee_qs = fee_qs.filter(Q(payment_date__lte=date_to) | Q(payment_date__isnull=True))
            expense_qs = expense_qs.filter(date__lte=date_to)
            other_income_qs = other_income_qs.filter(date__lte=date_to)

        fee_income = fee_qs.aggregate(total=Sum('amount_paid'))['total'] or Decimal('0')
        other_income = other_income_qs.aggregate(total=Sum('amount'))['total'] or Decimal('0')
        total_income = fee_income + other_income
        total_expenses = expense_qs.aggregate(total=Sum('amount'))['total'] or Decimal('0')

        return Response({
            'total_income': total_income,
            'fee_income': fee_income,
            'other_income': other_income,
            'total_expenses': total_expenses,
            'balance': total_income - total_expenses,
            'date_from': date_from,
            'date_to': date_to,
        })

    def _monthly_trend(self, request, school_id):
        """Get month-by-month income/expense data."""
        months_count = int(request.query_params.get('months', 6))
        today = date.today()
        is_staff = _is_staff_user(request)
        visible_accounts = _get_staff_visible_accounts(school_id) if is_staff else None

        trend = []
        for i in range(months_count - 1, -1, -1):
            # Calculate month/year going back
            m = today.month - i
            y = today.year
            while m <= 0:
                m += 12
                y -= 1

            fee_qs = FeePayment.objects.filter(
                school_id=school_id, month=m, year=y
            )
            other_qs = OtherIncome.objects.filter(
                school_id=school_id, date__year=y, date__month=m,
            )
            expense_qs = Expense.objects.filter(
                school_id=school_id, date__year=y, date__month=m,
            )

            if is_staff:
                fee_qs = fee_qs.filter(
                    Q(account_id__in=visible_accounts) | Q(account__isnull=True)
                )
                other_qs = other_qs.filter(is_sensitive=False).filter(
                    Q(account_id__in=visible_accounts) | Q(account__isnull=True)
                )
                expense_qs = expense_qs.filter(is_sensitive=False).filter(
                    Q(account_id__in=visible_accounts) | Q(account__isnull=True)
                )

            fee_income = fee_qs.aggregate(total=Sum('amount_paid'))['total'] or Decimal('0')
            other_income = other_qs.aggregate(total=Sum('amount'))['total'] or Decimal('0')
            income = fee_income + other_income
            expense = expense_qs.aggregate(total=Sum('amount'))['total'] or Decimal('0')

            trend.append({
                'month': m,
                'year': y,
                'income': income,
                'fee_income': fee_income,
                'other_income': other_income,
                'expenses': expense,
                'balance': income - expense,
            })

        return Response({'trend': trend})


class FinanceAIChatView(ModuleAccessMixin, APIView):
    """AI chat assistant for financial queries."""
    required_module = 'finance'
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def get(self, request):
        """Get chat history."""
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account. Please contact an administrator.'}, status=400)

        messages = FinanceAIChatMessage.objects.filter(
            school_id=school_id, user=request.user
        ).order_by('created_at')[:100]

        serializer = FinanceAIChatMessageSerializer(messages, many=True)
        return Response(serializer.data)

    def post(self, request):
        """Send a message and get AI response."""
        serializer = FinanceAIChatInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user_message = serializer.validated_data['message']
        school_id = _resolve_school_id(request)

        if not school_id:
            return Response({'detail': 'No school associated with your account. Please contact an administrator.'}, status=400)

        # Save user message
        FinanceAIChatMessage.objects.create(
            school_id=school_id,
            user=request.user,
            role='user',
            content=user_message,
        )

        # Get AI response
        try:
            from .ai_agent import FinanceAIAgent
            agent = FinanceAIAgent(school_id=school_id)
            response_text = agent.process_query(user_message)
        except Exception as e:
            logger.error(f"Finance AI agent error: {e}")
            response_text = "I'm sorry, I encountered an error processing your question. Please try again."

        # Save assistant message
        assistant_msg = FinanceAIChatMessage.objects.create(
            school_id=school_id,
            user=request.user,
            role='assistant',
            content=response_text,
        )

        return Response({
            'response': response_text,
            'message': FinanceAIChatMessageSerializer(assistant_msg).data,
        })

    def delete(self, request):
        """Clear chat history for the current user."""
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account. Please contact an administrator.'}, status=400)

        deleted_count, _ = FinanceAIChatMessage.objects.filter(
            school_id=school_id, user=request.user
        ).delete()

        return Response({'deleted': deleted_count})


class FeePredictorView(ModuleAccessMixin, APIView):
    """AI fee default predictions."""
    required_module = 'finance'
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def get(self, request):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        month = request.query_params.get('month')
        year = request.query_params.get('year')

        from .fee_predictor_service import FeeCollectionPredictorService
        service = FeeCollectionPredictorService(school_id)
        predictions = service.predict_defaults(
            target_month=int(month) if month else None,
            target_year=int(year) if year else None,
        )
        return Response(predictions)


# =============================================================================
# Phase 3: Discount & Scholarship ViewSets
# =============================================================================

class DiscountViewSet(ModuleAccessMixin, viewsets.ModelViewSet):
    """CRUD for discount rules."""
    required_module = 'finance'
    queryset = Discount.objects.all()
    serializer_class = DiscountSerializer
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]


    def get_queryset(self):
        queryset = Discount.objects.select_related(
            'school', 'academic_year', 'target_class',
        ).annotate(
            usage_count=Count('student_assignments', filter=Q(student_assignments__is_active=True)),
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

        # Optional filters
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        academic_year = self.request.query_params.get('academic_year')
        if academic_year:
            queryset = queryset.filter(academic_year_id=academic_year)

        applies_to = self.request.query_params.get('applies_to')
        if applies_to:
            queryset = queryset.filter(applies_to=applies_to.upper())

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)

    def perform_update(self, serializer):
        serializer.save()


class ScholarshipViewSet(ModuleAccessMixin, viewsets.ModelViewSet):
    """CRUD for scholarship programs."""
    required_module = 'finance'
    queryset = Scholarship.objects.all()
    serializer_class = ScholarshipSerializer
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]


    def get_queryset(self):
        queryset = Scholarship.objects.select_related('school', 'academic_year').annotate(
            recipient_count=Count('student_assignments', filter=Q(student_assignments__is_active=True)),
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

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        academic_year = self.request.query_params.get('academic_year')
        if academic_year:
            queryset = queryset.filter(academic_year_id=academic_year)

        scholarship_type = self.request.query_params.get('scholarship_type')
        if scholarship_type:
            queryset = queryset.filter(scholarship_type=scholarship_type.upper())

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)

    def perform_update(self, serializer):
        serializer.save()


class StudentDiscountViewSet(ModuleAccessMixin, viewsets.ModelViewSet):
    """CRUD for student discount/scholarship assignments + bulk assign."""
    required_module = 'finance'
    queryset = StudentDiscount.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action == 'create':
            return StudentDiscountCreateSerializer
        return StudentDiscountSerializer

    def get_queryset(self):
        queryset = StudentDiscount.objects.select_related(
            'school', 'student', 'student__class_obj',
            'discount', 'scholarship', 'academic_year', 'approved_by',
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

        # Optional filters
        student_id = self.request.query_params.get('student_id')
        if student_id:
            queryset = queryset.filter(student_id=student_id)

        discount_id = self.request.query_params.get('discount_id')
        if discount_id:
            queryset = queryset.filter(discount_id=discount_id)

        scholarship_id = self.request.query_params.get('scholarship_id')
        if scholarship_id:
            queryset = queryset.filter(scholarship_id=scholarship_id)

        academic_year = self.request.query_params.get('academic_year')
        if academic_year:
            queryset = queryset.filter(academic_year_id=academic_year)

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        return queryset

    def perform_create(self, serializer):
        from django.utils import timezone as tz
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})

        data = serializer.validated_data
        StudentDiscount.objects.create(
            school_id=school_id,
            student_id=data['student_id'],
            discount_id=data.get('discount_id'),
            scholarship_id=data.get('scholarship_id'),
            academic_year_id=data['academic_year_id'],
            approved_by=self.request.user,
            approved_at=tz.now(),
            is_active=True,
            notes=data.get('notes', ''),
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response({'detail': 'Student discount assigned successfully.'}, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'])
    def bulk_assign(self, request):
        """Assign a discount to all students in a class or grade level."""
        from django.utils import timezone as tz

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account.'}, status=400)

        discount_id = request.data.get('discount_id')
        scholarship_id = request.data.get('scholarship_id')
        class_id = request.data.get('class_id')
        grade_level = request.data.get('grade_level')
        academic_year_id = request.data.get('academic_year_id')

        if not discount_id and not scholarship_id:
            return Response(
                {'detail': 'Either discount_id or scholarship_id is required.'},
                status=400,
            )
        if not academic_year_id:
            return Response({'detail': 'academic_year_id is required.'}, status=400)
        if not class_id and grade_level is None:
            return Response(
                {'detail': 'Either class_id or grade_level is required.'},
                status=400,
            )

        # Build student queryset
        students_qs = Student.objects.filter(school_id=school_id, is_active=True)
        if class_id:
            students_qs = students_qs.filter(class_obj_id=class_id)
        elif grade_level is not None:
            students_qs = students_qs.filter(class_obj__grade_level=grade_level)

        now = tz.now()
        created_count = 0
        skipped_count = 0

        for student in students_qs:
            # Check for existing active assignment
            existing = StudentDiscount.objects.filter(
                school_id=school_id,
                student=student,
                discount_id=discount_id if discount_id else None,
                scholarship_id=scholarship_id if scholarship_id else None,
                academic_year_id=academic_year_id,
                is_active=True,
            ).exists()

            if existing:
                skipped_count += 1
                continue

            StudentDiscount.objects.create(
                school_id=school_id,
                student=student,
                discount_id=discount_id,
                scholarship_id=scholarship_id,
                academic_year_id=academic_year_id,
                approved_by=request.user,
                approved_at=now,
                is_active=True,
            )
            created_count += 1

        return Response({
            'created': created_count,
            'skipped': skipped_count,
            'total_students': students_qs.count(),
        })


# =============================================================================
# Phase 3: Payment Gateway ViewSets
# =============================================================================

class PaymentGatewayConfigViewSet(ModuleAccessMixin, viewsets.ModelViewSet):
    """CRUD for payment gateway configurations (admin only)."""
    required_module = 'finance'
    queryset = PaymentGatewayConfig.objects.all()
    serializer_class = PaymentGatewayConfigSerializer
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]


    def get_queryset(self):
        queryset = PaymentGatewayConfig.objects.select_related('school')
        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()
        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)

    def perform_update(self, serializer):
        serializer.save()

    @action(detail=True, methods=['post'], url_path='test-connection')
    def test_connection(self, request, pk=None):
        """Test if gateway credentials are valid."""
        from .payment_gateway_service import get_gateway, PaymentGatewayError

        gateway_config = self.get_object()
        try:
            gw = get_gateway(gateway_config)
            result = gw.test_connection()
        except PaymentGatewayError as e:
            result = {'success': False, 'message': str(e)}
        return Response(result)

    @action(detail=True, methods=['post'], url_path='toggle-status')
    def toggle_status(self, request, pk=None):
        """Toggle gateway active/inactive."""
        gateway_config = self.get_object()
        gateway_config.is_active = not gateway_config.is_active
        gateway_config.save(update_fields=['is_active'])
        return Response(PaymentGatewayConfigSerializer(
            gateway_config, context={'request': request},
        ).data)

    @action(detail=True, methods=['post'], url_path='set-default')
    def set_default(self, request, pk=None):
        """Set this gateway as the default for the school."""
        gateway_config = self.get_object()
        # Un-default all others for this school
        PaymentGatewayConfig.objects.filter(
            school=gateway_config.school,
        ).update(is_default=False)
        gateway_config.is_default = True
        gateway_config.save(update_fields=['is_default'])
        return Response(PaymentGatewayConfigSerializer(
            gateway_config, context={'request': request},
        ).data)


class OnlinePaymentViewSet(ModuleAccessMixin, viewsets.ReadOnlyModelViewSet):
    """Read-only listing of online payments with initiate, verify, and reconcile actions."""
    required_module = 'finance'
    queryset = OnlinePayment.objects.all()
    serializer_class = OnlinePaymentSerializer
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]


    def get_queryset(self):
        queryset = OnlinePayment.objects.select_related(
            'school', 'fee_payment', 'student', 'initiated_by',
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

        # Optional filters
        payment_status = self.request.query_params.get('status')
        if payment_status:
            queryset = queryset.filter(status=payment_status.upper())

        gateway = self.request.query_params.get('gateway')
        if gateway:
            queryset = queryset.filter(gateway=gateway.upper())

        student_id = self.request.query_params.get('student_id')
        if student_id:
            queryset = queryset.filter(student_id=student_id)

        return queryset

    @action(detail=False, methods=['post'])
    def initiate(self, request):
        """Initiate an online payment: create OnlinePayment with INITIATED status."""
        import uuid

        serializer = OnlinePaymentInitiateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account.'}, status=400)

        fee_payment_id = serializer.validated_data['fee_payment_id']
        amount = serializer.validated_data['amount']
        gateway = serializer.validated_data['gateway']

        # Validate fee_payment belongs to this school
        try:
            fee_payment = FeePayment.objects.get(id=fee_payment_id, school_id=school_id)
        except FeePayment.DoesNotExist:
            return Response({'detail': 'Fee payment not found.'}, status=404)

        # Validate gateway is configured and active for this school
        gateway_config = PaymentGatewayConfig.objects.filter(
            school_id=school_id, gateway=gateway, is_active=True,
        ).first()
        if not gateway_config:
            return Response(
                {'detail': f'Gateway {gateway} is not active for this school.'},
                status=400,
            )

        gateway_order_id = f"ORD-{uuid.uuid4().hex[:16].upper()}"

        online_payment = OnlinePayment.objects.create(
            school_id=school_id,
            fee_payment=fee_payment,
            student=fee_payment.student,
            gateway=gateway,
            gateway_order_id=gateway_order_id,
            amount=amount,
            currency=gateway_config.currency,
            status='INITIATED',
            initiated_by=request.user,
        )

        return Response(
            OnlinePaymentSerializer(online_payment).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'])
    def verify(self, request, pk=None):
        """Verify a payment (stub implementation - marks as SUCCESS and updates FeePayment)."""
        from django.utils import timezone as tz

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account.'}, status=400)

        try:
            online_payment = OnlinePayment.objects.get(id=pk, school_id=school_id)
        except OnlinePayment.DoesNotExist:
            return Response({'detail': 'Online payment not found.'}, status=404)

        if online_payment.status == 'SUCCESS':
            return Response({'detail': 'Payment already verified.'}, status=400)

        if online_payment.status not in ('INITIATED', 'PENDING'):
            return Response(
                {'detail': f'Cannot verify payment with status {online_payment.status}.'},
                status=400,
            )

        # Stub: mark as SUCCESS
        gateway_payment_id = request.data.get('gateway_payment_id', '')
        gateway_signature = request.data.get('gateway_signature', '')

        with transaction.atomic():
            online_payment.status = 'SUCCESS'
            online_payment.gateway_payment_id = gateway_payment_id
            online_payment.gateway_signature = gateway_signature
            online_payment.completed_at = tz.now()
            online_payment.gateway_response = request.data.get('gateway_response', {})
            online_payment.save()

            # Update the linked FeePayment
            fee_payment = online_payment.fee_payment
            fee_payment.amount_paid = fee_payment.amount_paid + online_payment.amount
            fee_payment.payment_date = tz.now().date()
            fee_payment.payment_method = 'ONLINE'
            fee_payment.save()

        return Response(OnlinePaymentSerializer(online_payment).data)

    @action(detail=False, methods=['get'])
    def reconcile(self, request):
        """List all payments with status breakdown for reconciliation."""
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account.'}, status=400)

        payments = OnlinePayment.objects.filter(school_id=school_id)

        status_breakdown = payments.values('status').annotate(
            count=Count('id'),
            total_amount=Sum('amount'),
        ).order_by('status')

        total = payments.aggregate(
            total_count=Count('id'),
            total_amount=Sum('amount'),
        )

        return Response({
            'status_breakdown': [
                {
                    'status': item['status'],
                    'count': item['count'],
                    'total_amount': item['total_amount'] or Decimal('0'),
                }
                for item in status_breakdown
            ],
            'total_count': total['total_count'] or 0,
            'total_amount': total['total_amount'] or Decimal('0'),
        })


# =============================================================================
# Phase 3: Fee Breakdown & Sibling Detection Views
# =============================================================================

class FeeBreakdownView(ModuleAccessMixin, APIView):
    """
    GET: Compute fee breakdown for a student with discount/scholarship deductions.
    Takes student_id from URL path.
    """
    required_module = 'finance'
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def get(self, request, student_id):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account.'}, status=400)

        try:
            student = Student.objects.select_related('class_obj').get(
                id=student_id, school_id=school_id,
            )
        except Student.DoesNotExist:
            return Response({'detail': 'Student not found.'}, status=404)

        # 1. Get base fee amount
        base_amount = resolve_fee_amount(student)

        if base_amount is None:
            return Response(FeeBreakdownSerializer({
                'student_id': student.id,
                'student_name': student.name,
                'class_name': student.class_obj.name,
                'base_amount': None,
                'discounts_applied': [],
                'scholarship_applied': None,
                'discount_total': Decimal('0'),
                'final_amount': None,
            }).data)

        # 2. Find active StudentDiscounts for this student
        student_discounts = StudentDiscount.objects.filter(
            school_id=school_id,
            student=student,
            is_active=True,
        ).select_related('discount', 'scholarship')

        discounts_applied = []
        scholarship_applied = None
        discount_total = Decimal('0')

        for sd in student_discounts:
            if sd.discount and sd.discount.is_active:
                disc = sd.discount
                if disc.discount_type == 'PERCENTAGE':
                    amount_off = (base_amount * disc.value / Decimal('100')).quantize(Decimal('0.01'))
                else:  # FIXED
                    amount_off = min(disc.value, base_amount)

                discounts_applied.append({
                    'id': disc.id,
                    'name': disc.name,
                    'type': 'discount',
                    'discount_type': disc.discount_type,
                    'value': disc.value,
                    'amount_off': amount_off,
                })
                discount_total += amount_off

            elif sd.scholarship and sd.scholarship.is_active:
                sch = sd.scholarship
                if sch.coverage == 'FULL':
                    amount_off = base_amount
                elif sch.coverage == 'PERCENTAGE':
                    amount_off = (base_amount * sch.value / Decimal('100')).quantize(Decimal('0.01'))
                else:  # FIXED
                    amount_off = min(sch.value, base_amount)

                scholarship_applied = {
                    'id': sch.id,
                    'name': sch.name,
                    'type': 'scholarship',
                    'discount_type': sch.coverage,
                    'value': sch.value,
                    'amount_off': amount_off,
                }
                discount_total += amount_off

        final_amount = max(Decimal('0'), base_amount - discount_total)

        return Response(FeeBreakdownSerializer({
            'student_id': student.id,
            'student_name': student.name,
            'class_name': student.class_obj.name,
            'base_amount': base_amount,
            'discounts_applied': discounts_applied,
            'scholarship_applied': scholarship_applied,
            'discount_total': discount_total,
            'final_amount': final_amount,
        }).data)


class SiblingDetectionView(ModuleAccessMixin, APIView):
    """
    GET: Detect siblings by matching guardian_phone or parent_phone in the same school.
    Takes student_id from URL path.
    """
    required_module = 'finance'
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def get(self, request, student_id):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account.'}, status=400)

        try:
            student = Student.objects.select_related('class_obj').get(
                id=student_id, school_id=school_id,
            )
        except Student.DoesNotExist:
            return Response({'detail': 'Student not found.'}, status=404)

        # Collect phone numbers to match on
        phones = set()
        if student.parent_phone and student.parent_phone.strip():
            phones.add(student.parent_phone.strip())
        if student.guardian_phone and student.guardian_phone.strip():
            phones.add(student.guardian_phone.strip())

        if not phones:
            return Response(SiblingDetectionSerializer({
                'student_id': student.id,
                'student_name': student.name,
                'matched_phone': '',
                'siblings': [],
            }).data)

        # Find other students in the same school with matching phone
        phone_q = Q()
        for phone in phones:
            phone_q |= Q(parent_phone=phone) | Q(guardian_phone=phone)

        siblings = Student.objects.filter(
            phone_q,
            school_id=school_id,
            is_active=True,
        ).exclude(id=student.id).select_related('class_obj').distinct()

        sibling_list = [
            {
                'id': s.id,
                'name': s.name,
                'class_name': s.class_obj.name if s.class_obj else '',
                'roll_number': s.roll_number,
                'parent_phone': s.parent_phone,
                'guardian_phone': s.guardian_phone,
            }
            for s in siblings
        ]

        matched_phone = ', '.join(sorted(phones))

        # Confirmed sibling group info
        membership = SiblingGroupMember.objects.filter(
            student=student, group__is_active=True,
        ).select_related('group').first()

        sibling_group_info = None
        if membership:
            group = membership.group
            members = group.members.select_related('student__class_obj').all()
            sibling_group_info = {
                'group_id': group.id,
                'group_name': group.name,
                'members': [
                    {
                        'id': m.student.id,
                        'name': m.student.name,
                        'class_name': m.student.class_obj.name if m.student.class_obj else '',
                        'order_index': m.order_index,
                    }
                    for m in members
                ],
            }

        # Pending suggestions count
        pending_count = SiblingSuggestion.objects.filter(
            Q(student_a=student) | Q(student_b=student),
            school_id=school_id,
            status='PENDING',
        ).count()

        return Response(SiblingDetectionSerializer({
            'student_id': student.id,
            'student_name': student.name,
            'matched_phone': matched_phone,
            'siblings': sibling_list,
            'sibling_group': sibling_group_info,
            'pending_suggestions_count': pending_count,
        }).data)


# =============================================================================
# Phase 6a: Sibling Suggestion & Group Management
# =============================================================================

class SiblingSuggestionListView(ModuleAccessMixin, APIView):
    """
    GET: List sibling suggestions for the current school.
    Query params: ?status=PENDING (default), ?page=1&page_size=20
    """
    required_module = 'finance'
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def get(self, request):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account.'}, status=400)

        status_filter = request.query_params.get('status', 'PENDING').upper()
        suggestions = SiblingSuggestion.objects.filter(
            school_id=school_id,
            status=status_filter,
        ).select_related(
            'student_a__class_obj', 'student_b__class_obj', 'reviewed_by',
            'sibling_group',
        ).order_by('-confidence_score', '-created_at')

        page = int(request.query_params.get('page', 1))
        page_size = int(request.query_params.get('page_size', 20))
        start = (page - 1) * page_size
        end = start + page_size

        total = suggestions.count()
        results = suggestions[start:end]

        return Response({
            'count': total,
            'results': SiblingSuggestionSerializer(results, many=True).data,
        })


class SiblingSuggestionActionView(ModuleAccessMixin, APIView):
    """
    POST /api/finance/sibling-suggestions/<id>/confirm/
    POST /api/finance/sibling-suggestions/<id>/reject/
    """
    required_module = 'finance'
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def post(self, request, suggestion_id, action):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account.'}, status=400)

        try:
            suggestion = SiblingSuggestion.objects.select_related(
                'student_a__class_obj', 'student_b__class_obj',
            ).get(id=suggestion_id, school_id=school_id, status='PENDING')
        except SiblingSuggestion.DoesNotExist:
            return Response(
                {'detail': 'Suggestion not found or already reviewed.'},
                status=404,
            )

        if action == 'reject':
            suggestion.status = 'REJECTED'
            suggestion.reviewed_by = request.user
            suggestion.reviewed_at = timezone.now()
            suggestion.save(update_fields=['status', 'reviewed_by', 'reviewed_at'])
            return Response({'detail': 'Suggestion rejected.'})

        if action == 'confirm':
            from finance.sibling_confirmation import confirm_sibling_suggestion
            group = confirm_sibling_suggestion(suggestion, request.user)
            members = group.members.select_related('student__class_obj').all()
            return Response({
                'detail': 'Siblings confirmed.',
                'sibling_group_id': group.id,
                'sibling_group_name': group.name,
                'members': SiblingGroupMemberSerializer(members, many=True).data,
            })

        return Response({'detail': f'Unknown action: {action}'}, status=400)


class SiblingSuggestionSummaryView(ModuleAccessMixin, APIView):
    """GET: Count of pending sibling suggestions (for dashboard badge)."""
    required_module = 'finance'
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def get(self, request):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account.'}, status=400)

        pending_count = SiblingSuggestion.objects.filter(
            school_id=school_id, status='PENDING',
        ).count()

        high_confidence_count = SiblingSuggestion.objects.filter(
            school_id=school_id, status='PENDING', confidence_score__gte=70,
        ).count()

        return Response({
            'pending_count': pending_count,
            'high_confidence_count': high_confidence_count,
        })


class SiblingGroupListView(ModuleAccessMixin, APIView):
    """GET: List confirmed sibling groups for the current school."""
    required_module = 'finance'
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def get(self, request):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account.'}, status=400)

        groups = SiblingGroup.objects.filter(
            school_id=school_id, is_active=True,
        ).prefetch_related(
            'members__student__class_obj',
        ).select_related('confirmed_by').order_by('-created_at')

        page = int(request.query_params.get('page', 1))
        page_size = int(request.query_params.get('page_size', 20))
        start = (page - 1) * page_size
        end = start + page_size

        total = groups.count()
        results = groups[start:end]

        return Response({
            'count': total,
            'results': SiblingGroupSerializer(results, many=True).data,
        })


# =============================================================================
# Phase 6: Payment Gateway Callbacks & Status
# =============================================================================

class JazzCashCallbackView(APIView):
    """
    POST callback from JazzCash after payment.
    Public endpoint (no auth) — verified via HMAC signature.
    """
    permission_classes = []
    authentication_classes = []

    def post(self, request):
        from .payment_gateway_service import get_gateway, PaymentGatewayError
        from django.utils import timezone as tz

        order_id = request.data.get('pp_TxnRefNo', '')
        if not order_id:
            return Response({'detail': 'Missing pp_TxnRefNo.'}, status=400)

        try:
            online_payment = OnlinePayment.objects.select_related(
                'fee_payment', 'school',
            ).get(gateway_order_id=order_id, gateway='JAZZCASH')
        except OnlinePayment.DoesNotExist:
            logger.warning(f'JazzCash callback: unknown order {order_id}')
            return Response({'detail': 'Payment not found.'}, status=404)

        gateway_config = PaymentGatewayConfig.objects.filter(
            school=online_payment.school, gateway='JAZZCASH', is_active=True,
        ).first()
        if not gateway_config:
            logger.error(f'JazzCash callback: no active config for school {online_payment.school_id}')
            return Response({'detail': 'Gateway not configured.'}, status=400)

        try:
            gw = get_gateway(gateway_config)
            result = gw.verify_callback(request.data)
        except PaymentGatewayError as e:
            logger.error(f'JazzCash callback error: {e}')
            return Response({'detail': str(e)}, status=400)

        with transaction.atomic():
            online_payment.gateway_response = result.get('raw', {})
            online_payment.gateway_payment_id = result.get('gateway_payment_id', '')

            if result['status'] == 'SUCCESS' and result.get('verified'):
                online_payment.status = 'SUCCESS'
                online_payment.completed_at = tz.now()

                fee_payment = online_payment.fee_payment
                fee_payment.amount_paid = fee_payment.amount_paid + online_payment.amount
                fee_payment.payment_date = tz.now().date()
                fee_payment.payment_method = 'ONLINE'
                fee_payment.save()
            elif result['status'] == 'PENDING':
                online_payment.status = 'PENDING'
            else:
                online_payment.status = 'FAILED'
                online_payment.failure_reason = result.get('response_message', 'Verification failed')

            online_payment.save()

        return Response({'status': online_payment.status, 'order_id': order_id})


class EasypaisaCallbackView(APIView):
    """
    POST callback from Easypaisa after payment.
    Public endpoint (no auth) — verified via postback URL.
    """
    permission_classes = []
    authentication_classes = []

    def post(self, request):
        from .payment_gateway_service import get_gateway, PaymentGatewayError
        from django.utils import timezone as tz

        order_id = request.data.get('orderRefNumber', '')
        if not order_id:
            return Response({'detail': 'Missing orderRefNumber.'}, status=400)

        try:
            online_payment = OnlinePayment.objects.select_related(
                'fee_payment', 'school',
            ).get(gateway_order_id=order_id, gateway='EASYPAISA')
        except OnlinePayment.DoesNotExist:
            logger.warning(f'Easypaisa callback: unknown order {order_id}')
            return Response({'detail': 'Payment not found.'}, status=404)

        gateway_config = PaymentGatewayConfig.objects.filter(
            school=online_payment.school, gateway='EASYPAISA', is_active=True,
        ).first()
        if not gateway_config:
            logger.error(f'Easypaisa callback: no active config for school {online_payment.school_id}')
            return Response({'detail': 'Gateway not configured.'}, status=400)

        try:
            gw = get_gateway(gateway_config)
            result = gw.verify_callback(request.data)
        except PaymentGatewayError as e:
            logger.error(f'Easypaisa callback error: {e}')
            return Response({'detail': str(e)}, status=400)

        with transaction.atomic():
            online_payment.gateway_response = result.get('raw', {})
            online_payment.gateway_payment_id = result.get('gateway_payment_id', '')

            if result['status'] == 'SUCCESS':
                online_payment.status = 'SUCCESS'
                online_payment.completed_at = tz.now()

                fee_payment = online_payment.fee_payment
                fee_payment.amount_paid = fee_payment.amount_paid + online_payment.amount
                fee_payment.payment_date = tz.now().date()
                fee_payment.payment_method = 'ONLINE'
                fee_payment.save()
            elif result['status'] == 'PENDING':
                online_payment.status = 'PENDING'
            else:
                online_payment.status = 'FAILED'
                online_payment.failure_reason = result.get('response_message', 'Payment failed')

            online_payment.save()

        return Response({'status': online_payment.status, 'order_id': order_id})


class PaymentStatusView(APIView):
    """
    GET /api/finance/payment-status/<order_id>/
    Check the status of an online payment by order ID.
    Accessible by authenticated users (parents checking their payment).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, order_id):
        try:
            online_payment = OnlinePayment.objects.select_related(
                'student', 'fee_payment',
            ).get(gateway_order_id=order_id)
        except OnlinePayment.DoesNotExist:
            return Response({'detail': 'Payment not found.'}, status=404)

        return Response({
            'order_id': online_payment.gateway_order_id,
            'status': online_payment.status,
            'status_display': online_payment.get_status_display(),
            'amount': str(online_payment.amount),
            'currency': online_payment.currency,
            'gateway': online_payment.gateway,
            'student_name': online_payment.student.name,
            'fee_month': online_payment.fee_payment.month,
            'fee_year': online_payment.fee_payment.year,
            'initiated_at': online_payment.initiated_at,
            'completed_at': online_payment.completed_at,
            'failure_reason': online_payment.failure_reason,
        })
