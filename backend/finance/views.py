"""
Finance views for fee structures, payments, expenses, reports, and AI chat.
"""

import logging
from datetime import date
from decimal import Decimal

from django.db.models import Sum, Count, Q
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated

from core.permissions import IsSchoolAdmin, IsSchoolAdminOrStaffReadOnly, HasSchoolAccess
from core.mixins import TenantQuerySetMixin, ensure_tenant_schools
from students.models import Student, Class
from .models import Account, Transfer, FeeStructure, FeePayment, Expense, OtherIncome, FinanceAIChatMessage, resolve_fee_amount
from .serializers import (
    AccountSerializer, AccountCreateSerializer,
    TransferSerializer, TransferCreateSerializer,
    FeeStructureSerializer, FeeStructureCreateSerializer, BulkFeeStructureSerializer,
    FeePaymentSerializer, FeePaymentCreateSerializer, FeePaymentUpdateSerializer,
    GenerateMonthlySerializer,
    ExpenseSerializer, ExpenseCreateSerializer,
    OtherIncomeSerializer, OtherIncomeCreateSerializer,
    FinanceAIChatMessageSerializer, FinanceAIChatInputSerializer,
)

logger = logging.getLogger(__name__)


def _resolve_school_id(request):
    """
    Resolve school_id from user or request params.
    School admins use their own school. Super admins can pass school_id as a parameter.
    """
    school_id = request.user.school_id
    if school_id:
        return school_id

    # Super admin: try to get from request params
    school_id = (
        request.query_params.get('school_id')
        or request.data.get('school_id')
        or request.data.get('school')
    )
    if school_id:
        return int(school_id)

    # Super admin: if only one school exists, use it
    if request.user.is_super_admin:
        from schools.models import School
        schools = list(School.objects.filter(is_active=True).values_list('id', flat=True)[:2])
        if len(schools) == 1:
            return schools[0]

    return None


def _is_staff_user(request):
    """Check if current user is a staff member (not admin/superadmin)."""
    return (
        request.user.is_authenticated and
        request.user.is_staff_member and
        not request.user.is_school_admin and
        not request.user.is_super_admin
    )


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
        user = self.request.user
        if not user.is_super_admin:
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
        user = self.request.user
        if not user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Staff: restrict to payments linked to visible accounts (or no account)
        if _is_staff_user(self.request):
            school_id = _resolve_school_id(self.request)
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

        # Get active students
        students = Student.objects.filter(school_id=school_id, is_active=True)
        if class_id:
            students = students.filter(class_obj_id=class_id)

        # Compute previous month/year for carry-forward
        prev_month = month - 1
        prev_year = year
        if prev_month == 0:
            prev_month = 12
            prev_year = year - 1

        created_count = 0
        skipped_count = 0
        no_fee_count = 0

        for student in students:
            # Check if record already exists
            if FeePayment.objects.filter(
                school_id=school_id, student=student, month=month, year=year
            ).exists():
                skipped_count += 1
                continue

            # Resolve fee amount
            monthly_fee = resolve_fee_amount(student)
            if monthly_fee is None:
                no_fee_count += 1
                continue

            # Compute carry-forward balance from previous month
            # Positive = debt carried forward, Negative = advance/credit
            prev_balance = Decimal('0')
            prev_record = FeePayment.objects.filter(
                school_id=school_id, student=student, month=prev_month, year=prev_year
            ).first()
            if prev_record:
                prev_balance = prev_record.amount_due - prev_record.amount_paid

            FeePayment.objects.create(
                school_id=school_id,
                student=student,
                month=month,
                year=year,
                previous_balance=prev_balance,
                amount_due=prev_balance + monthly_fee,
                amount_paid=0,
            )
            created_count += 1

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
        user = self.request.user
        if not user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Staff: hide sensitive expenses and restrict to visible accounts
        if _is_staff_user(self.request):
            queryset = queryset.filter(is_sensitive=False)
            school_id = _resolve_school_id(self.request)
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
        user = self.request.user
        if not user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Staff: hide sensitive income and restrict to visible accounts
        if _is_staff_user(self.request):
            queryset = queryset.filter(is_sensitive=False)
            school_id = _resolve_school_id(self.request)
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
        if not user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
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

    @action(detail=False, methods=['get'])
    def balances(self, request):
        """Get all accounts with computed balances (the 'MS New' equivalent)."""
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school associated with your account.'}, status=400)

        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')

        accounts = Account.objects.filter(school_id=school_id, is_active=True)
        is_staff = _is_staff_user(request)

        # Staff only sees staff-visible accounts
        if is_staff:
            accounts = accounts.filter(staff_visible=True)

        results = []

        for account in accounts:
            fee_qs = FeePayment.objects.filter(school_id=school_id, account=account)
            income_qs = OtherIncome.objects.filter(school_id=school_id, account=account)
            expense_qs = Expense.objects.filter(school_id=school_id, account=account)
            tfr_in_qs = Transfer.objects.filter(school_id=school_id, to_account=account)
            tfr_out_qs = Transfer.objects.filter(school_id=school_id, from_account=account)

            # Staff cannot see sensitive transactions
            if is_staff:
                income_qs = income_qs.filter(is_sensitive=False)
                expense_qs = expense_qs.filter(is_sensitive=False)
                tfr_in_qs = tfr_in_qs.filter(is_sensitive=False)
                tfr_out_qs = tfr_out_qs.filter(is_sensitive=False)

            if date_from:
                fee_qs = fee_qs.filter(payment_date__gte=date_from)
                income_qs = income_qs.filter(date__gte=date_from)
                expense_qs = expense_qs.filter(date__gte=date_from)
                tfr_in_qs = tfr_in_qs.filter(date__gte=date_from)
                tfr_out_qs = tfr_out_qs.filter(date__gte=date_from)
            if date_to:
                fee_qs = fee_qs.filter(payment_date__lte=date_to)
                income_qs = income_qs.filter(date__lte=date_to)
                expense_qs = expense_qs.filter(date__lte=date_to)
                tfr_in_qs = tfr_in_qs.filter(date__lte=date_to)
                tfr_out_qs = tfr_out_qs.filter(date__lte=date_to)

            receipts = (
                (fee_qs.aggregate(t=Sum('amount_paid'))['t'] or Decimal('0')) +
                (income_qs.aggregate(t=Sum('amount'))['t'] or Decimal('0'))
            )
            payments = expense_qs.aggregate(t=Sum('amount'))['t'] or Decimal('0')
            transfers_in = tfr_in_qs.aggregate(t=Sum('amount'))['t'] or Decimal('0')
            transfers_out = tfr_out_qs.aggregate(t=Sum('amount'))['t'] or Decimal('0')

            net_balance = account.opening_balance + receipts - payments + transfers_in - transfers_out

            results.append({
                'id': account.id,
                'name': account.name,
                'account_type': account.account_type,
                'opening_balance': account.opening_balance,
                'receipts': receipts,
                'payments': payments,
                'transfers_in': transfers_in,
                'transfers_out': transfers_out,
                'net_balance': net_balance,
            })

        grand_total = sum(r['net_balance'] for r in results)

        return Response({
            'accounts': results,
            'grand_total': grand_total,
            'date_from': date_from,
            'date_to': date_to,
        })


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
        user = self.request.user
        if not user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Staff: hide sensitive transfers and restrict to visible accounts
        if _is_staff_user(self.request):
            queryset = queryset.filter(is_sensitive=False)
            school_id = _resolve_school_id(self.request)
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
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
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
