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

from core.permissions import IsSchoolAdmin, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess, get_effective_role
from core.mixins import TenantQuerySetMixin, ensure_tenant_schools, ensure_tenant_school_id
from students.models import Student, Class
from .models import (
    Account, Transfer, FeeStructure, FeePayment, Expense, OtherIncome,
    FinanceAIChatMessage, MonthlyClosing, AccountSnapshot,
)
from .serializers import (
    AccountSerializer, AccountCreateSerializer,
    TransferSerializer, TransferCreateSerializer,
    FeeStructureSerializer, FeeStructureCreateSerializer, BulkFeeStructureSerializer,
    FeePaymentSerializer, FeePaymentCreateSerializer, FeePaymentUpdateSerializer,
    GenerateMonthlySerializer,
    ExpenseSerializer, ExpenseCreateSerializer,
    OtherIncomeSerializer, OtherIncomeCreateSerializer,
    FinanceAIChatMessageSerializer, FinanceAIChatInputSerializer,
    CloseMonthSerializer, MonthlyClosingSerializer,
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


class FeeStructureViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for fee structures (class-level and student-level)."""
    queryset = FeeStructure.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action == 'create':
            return FeeStructureCreateSerializer
        return FeeStructureSerializer

    def get_queryset(self):
        queryset = FeeStructure.objects.select_related('school', 'class_obj', 'student')

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

        class_id = self.request.query_params.get('class_id')
        if class_id:
            queryset = queryset.filter(Q(class_obj_id=class_id) | Q(student__class_obj_id=class_id))

        student_id = self.request.query_params.get('student_id')
        if student_id:
            queryset = queryset.filter(student_id=student_id)

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)

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

                # Deactivate existing active class-level fee structures for this class
                FeeStructure.objects.filter(
                    school_id=school_id,
                    class_obj_id=class_id,
                    student__isnull=True,
                    is_active=True,
                ).update(is_active=False)

                # Create new fee structure
                FeeStructure.objects.create(
                    school_id=school_id,
                    class_obj_id=class_id,
                    monthly_amount=monthly_amount,
                    effective_from=effective_from,
                )
                created_count += 1
        except Exception as e:
            logger.error(f"Bulk fee structure error: {e}")
            return Response({'detail': str(e)}, status=400)

        return Response({'created': created_count})


class FeePaymentViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD + bulk generation + summaries for fee payments."""
    queryset = FeePayment.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action == 'create':
            return FeePaymentCreateSerializer
        if self.action in ('update', 'partial_update'):
            return FeePaymentUpdateSerializer
        return FeePaymentSerializer

    def get_queryset(self):
        queryset = FeePayment.objects.select_related(
            'school', 'student', 'student__class_obj', 'collected_by', 'account'
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
        month = self.request.query_params.get('month')
        year = self.request.query_params.get('year')
        class_id = self.request.query_params.get('class_id')
        fee_status = self.request.query_params.get('status')
        student_id = self.request.query_params.get('student_id')

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

        return queryset

    def perform_create(self, serializer):
        school_id = self.request.data.get('school') or _resolve_school_id(self.request)
        if school_id:
            serializer.save(school_id=school_id, collected_by=self.request.user)
        else:
            serializer.save(collected_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(collected_by=self.request.user)

    @action(detail=False, methods=['post'])
    def generate_monthly(self, request):
        """Bulk generate fee payment records for a month/year."""
        serializer = GenerateMonthlySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        month = serializer.validated_data['month']
        year = serializer.validated_data['year']
        class_id = serializer.validated_data.get('class_id')

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account. Please contact an administrator.'}, status=400)

        # 1. Fetch all active students (1 query)
        students = list(Student.objects.filter(school_id=school_id, is_active=True))
        if class_id:
            students = [s for s in students if s.class_obj_id == int(class_id)]

        prev_month = month - 1
        prev_year = year
        if prev_month == 0:
            prev_month = 12
            prev_year = year - 1

        # 2. Existing records for this month — skip these (1 query)
        existing_ids = set(
            FeePayment.objects.filter(
                school_id=school_id, month=month, year=year
            ).values_list('student_id', flat=True)
        )

        # 3. Fee structures — build lookup in memory (1 query)
        today = date.today()
        fee_structures = FeeStructure.objects.filter(
            school_id=school_id, is_active=True, effective_from__lte=today,
        ).filter(
            Q(effective_to__isnull=True) | Q(effective_to__gte=today)
        ).order_by('-effective_from')

        student_fees = {}
        class_fees = {}
        for fs in fee_structures:
            if fs.student_id:
                if fs.student_id not in student_fees:
                    student_fees[fs.student_id] = fs.monthly_amount
            elif fs.class_obj_id:
                if fs.class_obj_id not in class_fees:
                    class_fees[fs.class_obj_id] = fs.monthly_amount

        # 4. Previous month balances for carry-forward (1 query)
        prev_balances = {}
        for fp in FeePayment.objects.filter(
            school_id=school_id, month=prev_month, year=prev_year
        ):
            prev_balances[fp.student_id] = fp.amount_due - fp.amount_paid

        # 5. Build all payment objects in memory (0 queries)
        created_count = 0
        skipped_count = 0
        no_fee_count = 0
        to_create = []

        for student in students:
            if student.id in existing_ids:
                skipped_count += 1
                continue

            monthly_fee = student_fees.get(student.id)
            if monthly_fee is None:
                monthly_fee = class_fees.get(student.class_obj_id)
            if monthly_fee is None:
                no_fee_count += 1
                continue

            prev_balance = prev_balances.get(student.id, Decimal('0'))

            to_create.append(FeePayment(
                school_id=school_id,
                student=student,
                month=month,
                year=year,
                previous_balance=prev_balance,
                amount_due=prev_balance + monthly_fee,
                amount_paid=0,
            ))
            created_count += 1

        # 6. Single bulk insert (1 query), atomic
        with transaction.atomic():
            FeePayment.objects.bulk_create(to_create)

        return Response({
            'created': created_count,
            'skipped': skipped_count,
            'no_fee_structure': no_fee_count,
            'month': month,
            'year': year,
        })

    @action(detail=False, methods=['post'])
    def bulk_update(self, request):
        """Bulk update amount_paid for multiple fee payment records."""
        records = request.data.get('records', [])
        if not records:
            return Response({'detail': 'No records provided.'}, status=400)

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account.'}, status=400)

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

        deleted_count, _ = FeePayment.objects.filter(
            id__in=ids, school_id=school_id
        ).delete()

        return Response({'deleted': deleted_count})

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


class ExpenseViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD + category summaries for school expenses."""
    queryset = Expense.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action == 'create':
            return ExpenseCreateSerializer
        return ExpenseSerializer

    def get_queryset(self):
        queryset = Expense.objects.select_related('school', 'recorded_by', 'account')

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
            queryset = queryset.filter(category=category.upper())
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

        queryset = Expense.objects.filter(school_id=school_id)

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

        summary = queryset.values('category').annotate(
            total_amount=Sum('amount'),
            count=Count('id'),
        ).order_by('-total_amount')

        # Add display names
        category_map = dict(Expense.Category.choices)
        result = [
            {
                'category': item['category'],
                'category_display': category_map.get(item['category'], item['category']),
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


class OtherIncomeViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for non-student-linked income (book sales, donations, etc.)."""
    queryset = OtherIncome.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action == 'create':
            return OtherIncomeCreateSerializer
        return OtherIncomeSerializer

    def get_queryset(self):
        queryset = OtherIncome.objects.select_related('school', 'recorded_by', 'account')

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

class AccountViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for accounts + balance computation."""
    queryset = Account.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]
    pagination_class = None

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
        # When snapshot exists, txn_start is the floor (NULLs excluded — they're in snapshot).
        # When no snapshot, date_from is the floor (original behavior).
        effective_floor = txn_start or (date_from if date_from else None)
        if effective_floor:
            fee_qs = fee_qs.filter(payment_date__gte=effective_floor)
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

        last_day = calendar.monthrange(year, month)[1]
        month_end = date(year, month, last_day).isoformat()

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


class TransferViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for inter-account transfers."""
    queryset = Transfer.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess]
    pagination_class = None

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


class FinanceReportsView(APIView):
    """Financial reports: summary and monthly trends."""
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
            fee_qs = fee_qs.filter(payment_date__gte=date_from)
            expense_qs = expense_qs.filter(date__gte=date_from)
            other_income_qs = other_income_qs.filter(date__gte=date_from)
        if date_to:
            fee_qs = fee_qs.filter(payment_date__lte=date_to)
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


class FinanceAIChatView(APIView):
    """AI chat assistant for financial queries."""
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
