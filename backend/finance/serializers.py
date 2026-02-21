"""
Finance serializers for fee structures, payments, expenses, other income, and AI chat.
"""

from rest_framework import serializers
from .models import (
    Account, Transfer, FeeStructure, FeePayment, Expense, OtherIncome,
    ExpenseCategory, IncomeCategory,
    FinanceAIChatMessage, MonthlyClosing, AccountSnapshot,
    Discount, Scholarship, StudentDiscount, PaymentGatewayConfig, OnlinePayment,
)


class AccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = Account
        fields = [
            'id', 'school', 'name', 'account_type',
            'opening_balance', 'is_active', 'staff_visible',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get('request')
        if request and hasattr(request.user, 'is_staff_member') and request.user.is_staff_member:
            fields.pop('staff_visible', None)
        return fields


class AccountCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Account
        fields = ['name', 'account_type', 'opening_balance']


class TransferSerializer(serializers.ModelSerializer):
    from_account_name = serializers.CharField(source='from_account.name', read_only=True)
    to_account_name = serializers.CharField(source='to_account.name', read_only=True)
    recorded_by_name = serializers.CharField(source='recorded_by.username', read_only=True, default=None)

    class Meta:
        model = Transfer
        fields = [
            'id', 'school',
            'from_account', 'from_account_name',
            'to_account', 'to_account_name',
            'amount', 'date', 'description',
            'recorded_by', 'recorded_by_name',
            'is_sensitive',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get('request')
        if request and hasattr(request.user, 'is_staff_member') and request.user.is_staff_member:
            fields.pop('is_sensitive', None)
        return fields


class TransferCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transfer
        fields = ['from_account', 'to_account', 'amount', 'date', 'description']

    def validate(self, attrs):
        if attrs['from_account'] == attrs['to_account']:
            raise serializers.ValidationError("Cannot transfer to the same account.")
        if attrs['amount'] <= 0:
            raise serializers.ValidationError({"amount": "Amount must be positive."})
        return attrs


class FeeStructureSerializer(serializers.ModelSerializer):
    class_name = serializers.CharField(source='class_obj.name', read_only=True, default=None)
    student_name = serializers.CharField(source='student.name', read_only=True, default=None)
    school_name = serializers.CharField(source='school.name', read_only=True)
    academic_year_name = serializers.CharField(source='academic_year.name', read_only=True, default=None)
    fee_type_display = serializers.CharField(source='get_fee_type_display', read_only=True)

    class Meta:
        model = FeeStructure
        fields = [
            'id', 'school', 'school_name',
            'class_obj', 'class_name',
            'student', 'student_name',
            'academic_year', 'academic_year_name',
            'fee_type', 'fee_type_display',
            'monthly_amount', 'effective_from', 'effective_to',
            'is_active', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class FeeStructureCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeeStructure
        fields = ['class_obj', 'student', 'fee_type', 'monthly_amount', 'effective_from', 'effective_to']

    def validate(self, attrs):
        if not attrs.get('class_obj') and not attrs.get('student'):
            raise serializers.ValidationError("Either class_obj or student must be set.")
        if attrs.get('class_obj') and attrs.get('student'):
            raise serializers.ValidationError(
                "Set either class_obj (for class-level fee) or student (for student-level override), not both."
            )
        return attrs


class BulkFeeStructureItemSerializer(serializers.Serializer):
    class_obj = serializers.IntegerField()
    monthly_amount = serializers.DecimalField(max_digits=10, decimal_places=2)
    fee_type = serializers.ChoiceField(
        choices=[('MONTHLY', 'Monthly'), ('ANNUAL', 'Annual'), ('ADMISSION', 'Admission'),
                 ('BOOKS', 'Books'), ('FINE', 'Fine')],
        default='MONTHLY',
        required=False,
    )


class BulkFeeStructureSerializer(serializers.Serializer):
    structures = BulkFeeStructureItemSerializer(many=True)
    effective_from = serializers.DateField()


class BulkStudentFeeStructureItemSerializer(serializers.Serializer):
    student_id = serializers.IntegerField()
    monthly_amount = serializers.DecimalField(max_digits=10, decimal_places=2)


class BulkStudentFeeStructureSerializer(serializers.Serializer):
    class_id = serializers.IntegerField()
    fee_type = serializers.ChoiceField(
        choices=[('MONTHLY', 'Monthly'), ('ANNUAL', 'Annual'), ('ADMISSION', 'Admission'),
                 ('BOOKS', 'Books'), ('FINE', 'Fine')],
    )
    effective_from = serializers.DateField()
    students = BulkStudentFeeStructureItemSerializer(many=True)


class FeePaymentSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source='student.name', read_only=True, default='Deleted Student')
    student_roll = serializers.CharField(source='student.roll_number', read_only=True, default=None)
    class_name = serializers.SerializerMethodField()
    class_obj_id = serializers.IntegerField(source='student.class_obj.id', read_only=True, default=None)
    collected_by_name = serializers.CharField(source='collected_by.username', read_only=True, default=None)
    account_name = serializers.CharField(source='account.name', read_only=True, default=None)
    academic_year_name = serializers.CharField(source='academic_year.name', read_only=True, default=None)
    fee_type_display = serializers.CharField(source='get_fee_type_display', read_only=True)

    def get_class_name(self, obj):
        cls = obj.student.class_obj if obj.student else None
        if not cls:
            return None
        return f"{cls.name} - {cls.section}" if cls.section else cls.name

    class Meta:
        model = FeePayment
        fields = [
            'id', 'school', 'student',
            'student_name', 'student_roll', 'class_name', 'class_obj_id',
            'academic_year', 'academic_year_name',
            'fee_type', 'fee_type_display',
            'month', 'year', 'previous_balance', 'amount_due', 'amount_paid',
            'status', 'payment_date', 'payment_method',
            'receipt_number', 'notes',
            'collected_by', 'collected_by_name',
            'account', 'account_name',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'status', 'created_at', 'updated_at']


class FeePaymentCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeePayment
        fields = [
            'school', 'student', 'fee_type', 'month', 'year',
            'academic_year', 'amount_due', 'amount_paid',
            'payment_date', 'payment_method',
            'receipt_number', 'notes',
            'account',
        ]

    def validate(self, attrs):
        fee_type = attrs.get('fee_type', 'MONTHLY')
        month = attrs.get('month')
        if fee_type == 'MONTHLY':
            if month is not None and (month < 1 or month > 12):
                raise serializers.ValidationError({'month': 'Month must be between 1 and 12 for monthly fees.'})
        else:
            # ANNUAL, ADMISSION, BOOKS, FINE use month=0
            if month is not None and month != 0:
                raise serializers.ValidationError({'month': 'Month should be 0 for non-monthly fee types.'})
        return attrs


class FeePaymentUpdateSerializer(serializers.ModelSerializer):
    """For recording/updating a payment on an existing FeePayment record."""
    class Meta:
        model = FeePayment
        fields = [
            'amount_paid', 'payment_date', 'payment_method',
            'receipt_number', 'notes', 'account'
        ]

    def validate(self, attrs):
        amount = attrs.get('amount_paid')
        account = attrs.get('account')
        # If amount_paid > 0, require an account (either in payload or already on the record)
        if amount is not None and amount > 0:
            if not account and (not self.instance or not self.instance.account):
                raise serializers.ValidationError({'account': 'Please select account'})
        return attrs


class GenerateMonthlySerializer(serializers.Serializer):
    month = serializers.IntegerField(min_value=1, max_value=12)
    year = serializers.IntegerField(min_value=2020, max_value=2100)
    class_id = serializers.IntegerField(required=False)
    academic_year = serializers.IntegerField(required=False)


class GenerateOnetimeFeesSerializer(serializers.Serializer):
    """For generating ADMISSION/ANNUAL/BOOKS fee records for specific students."""
    student_ids = serializers.ListField(
        child=serializers.IntegerField(),
        min_length=1,
        help_text='List of student IDs to generate fees for.',
    )
    fee_types = serializers.ListField(
        child=serializers.ChoiceField(
            choices=['ADMISSION', 'ANNUAL', 'BOOKS', 'FINE', 'MONTHLY'],
        ),
        min_length=1,
        help_text='Which fee types to generate.',
    )
    year = serializers.IntegerField(min_value=2020, max_value=2100)
    month = serializers.IntegerField(
        min_value=0, max_value=12,
        required=False,
        default=0,
        help_text='Month for monthly fee (1-12). Use 0 for annual/admission/books/fine.',
    )
    academic_year = serializers.IntegerField(
        required=False,
        help_text='Academic year ID. Auto-resolved to current if not provided.',
    )


class ExpenseCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseCategory
        fields = ['id', 'name', 'code', 'is_active']


class IncomeCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = IncomeCategory
        fields = ['id', 'name', 'code', 'is_active']


class ExpenseSerializer(serializers.ModelSerializer):
    recorded_by_name = serializers.CharField(source='recorded_by.username', read_only=True, default=None)
    category_name = serializers.CharField(source='category.name', read_only=True, default=None)
    account_name = serializers.CharField(source='account.name', read_only=True, default=None)

    class Meta:
        model = Expense
        fields = [
            'id', 'school', 'category', 'category_name',
            'amount', 'date', 'description',
            'recorded_by', 'recorded_by_name',
            'account', 'account_name',
            'is_sensitive',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get('request')
        if request and hasattr(request.user, 'is_staff_member') and request.user.is_staff_member:
            fields.pop('is_sensitive', None)
        return fields

    def validate(self, attrs):
        # On update, require account
        account = attrs.get('account', getattr(self.instance, 'account', None) if self.instance else None)
        if not account:
            raise serializers.ValidationError({'account': 'Please select account'})
        return attrs


class ExpenseCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Expense
        fields = ['school', 'category', 'amount', 'date', 'description', 'account', 'is_sensitive']
        extra_kwargs = {
            'school': {'required': False},
        }

    def validate(self, attrs):
        if not attrs.get('account'):
            raise serializers.ValidationError({'account': 'Please select account'})
        return attrs


class FinanceAIChatMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = FinanceAIChatMessage
        fields = ['id', 'role', 'content', 'metadata', 'created_at']
        read_only_fields = ['id', 'created_at']


class OtherIncomeSerializer(serializers.ModelSerializer):
    recorded_by_name = serializers.CharField(source='recorded_by.username', read_only=True, default=None)
    category_name = serializers.CharField(source='category.name', read_only=True, default=None)
    account_name = serializers.CharField(source='account.name', read_only=True, default=None)

    class Meta:
        model = OtherIncome
        fields = [
            'id', 'school', 'category', 'category_name',
            'amount', 'date', 'description',
            'recorded_by', 'recorded_by_name',
            'account', 'account_name',
            'is_sensitive',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get('request')
        if request and hasattr(request.user, 'is_staff_member') and request.user.is_staff_member:
            fields.pop('is_sensitive', None)
        return fields


class OtherIncomeCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = OtherIncome
        fields = ['category', 'amount', 'date', 'description', 'account']

    def validate(self, attrs):
        if not attrs.get('account'):
            raise serializers.ValidationError({'account': 'Please select account'})
        return attrs


class FinanceAIChatInputSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=1000)


class CloseMonthSerializer(serializers.Serializer):
    year = serializers.IntegerField(min_value=2020, max_value=2100)
    month = serializers.IntegerField(min_value=1, max_value=12)
    notes = serializers.CharField(required=False, allow_blank=True, default='')


class MonthlyClosingSerializer(serializers.ModelSerializer):
    closed_by_name = serializers.CharField(
        source='closed_by.username', read_only=True, default=None
    )

    class Meta:
        model = MonthlyClosing
        fields = [
            'id', 'school', 'year', 'month',
            'closed_by', 'closed_by_name', 'closed_at',
            'notes',
        ]
        read_only_fields = ['id', 'closed_at']


# =============================================================================
# Phase 3: Discount & Scholarship Serializers
# =============================================================================

class DiscountSerializer(serializers.ModelSerializer):
    """Full CRUD serializer for Discount model."""
    discount_type_display = serializers.CharField(
        source='get_discount_type_display', read_only=True
    )
    applies_to_display = serializers.CharField(
        source='get_applies_to_display', read_only=True
    )
    target_class_name = serializers.CharField(
        source='target_class.name', read_only=True, default=None
    )
    academic_year_name = serializers.CharField(
        source='academic_year.name', read_only=True, default=None
    )
    usage_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Discount
        fields = [
            'id', 'school', 'academic_year', 'academic_year_name',
            'name', 'discount_type', 'discount_type_display',
            'value', 'applies_to', 'applies_to_display',
            'target_grade_level',
            'target_class', 'target_class_name',
            'start_date', 'end_date', 'is_active',
            'max_uses', 'stackable', 'usage_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']

    def validate(self, attrs):
        applies_to = attrs.get('applies_to', getattr(self.instance, 'applies_to', 'ALL'))
        if applies_to == 'GRADE_LEVEL' and attrs.get('target_grade_level') is None and getattr(self.instance, 'target_grade_level', None) is None:
            raise serializers.ValidationError(
                {'target_grade_level': 'Target grade level is required when applies_to is GRADE_LEVEL.'}
            )
        if applies_to == 'CLASS' and not attrs.get('target_class') and not getattr(self.instance, 'target_class_id', None):
            raise serializers.ValidationError(
                {'target_class': 'Target class is required when applies_to is CLASS.'}
            )
        discount_type = attrs.get('discount_type', getattr(self.instance, 'discount_type', None))
        value = attrs.get('value', getattr(self.instance, 'value', None))
        if discount_type == 'PERCENTAGE' and value is not None:
            if value < 0 or value > 100:
                raise serializers.ValidationError(
                    {'value': 'Percentage value must be between 0 and 100.'}
                )
        return attrs


class ScholarshipSerializer(serializers.ModelSerializer):
    """Full CRUD serializer for Scholarship model."""
    scholarship_type_display = serializers.CharField(
        source='get_scholarship_type_display', read_only=True
    )
    coverage_display = serializers.CharField(
        source='get_coverage_display', read_only=True
    )
    academic_year_name = serializers.CharField(
        source='academic_year.name', read_only=True, default=None
    )
    recipient_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Scholarship
        fields = [
            'id', 'school', 'academic_year', 'academic_year_name',
            'name', 'description',
            'scholarship_type', 'scholarship_type_display',
            'coverage', 'coverage_display',
            'value', 'max_recipients', 'is_active',
            'recipient_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']

    def validate(self, attrs):
        coverage = attrs.get('coverage', getattr(self.instance, 'coverage', None))
        value = attrs.get('value', getattr(self.instance, 'value', None))
        if coverage == 'PERCENTAGE' and value is not None:
            if value < 0 or value > 100:
                raise serializers.ValidationError(
                    {'value': 'Percentage value must be between 0 and 100.'}
                )
        return attrs


class StudentDiscountSerializer(serializers.ModelSerializer):
    """Read serializer for StudentDiscount with nested names."""
    student_name = serializers.CharField(source='student.name', read_only=True, default='Deleted Student')
    student_roll = serializers.CharField(source='student.roll_number', read_only=True, default=None)
    class_name = serializers.CharField(source='student.class_obj.name', read_only=True, default=None)
    discount_name = serializers.CharField(source='discount.name', read_only=True, default=None)
    scholarship_name = serializers.CharField(source='scholarship.name', read_only=True, default=None)
    academic_year_name = serializers.CharField(source='academic_year.name', read_only=True, default=None)
    approved_by_name = serializers.CharField(source='approved_by.username', read_only=True, default=None)

    class Meta:
        model = StudentDiscount
        fields = [
            'id', 'school',
            'student', 'student_name', 'student_roll', 'class_name',
            'discount', 'discount_name',
            'scholarship', 'scholarship_name',
            'academic_year', 'academic_year_name',
            'approved_by', 'approved_by_name', 'approved_at',
            'is_active', 'notes', 'created_at',
        ]
        read_only_fields = ['id', 'school', 'approved_by', 'approved_at', 'created_at']


class StudentDiscountCreateSerializer(serializers.Serializer):
    """Create serializer for assigning a discount or scholarship to a student."""
    student_id = serializers.IntegerField()
    discount_id = serializers.IntegerField(required=False, allow_null=True, default=None)
    scholarship_id = serializers.IntegerField(required=False, allow_null=True, default=None)
    academic_year_id = serializers.IntegerField()
    notes = serializers.CharField(required=False, allow_blank=True, default='')

    def validate(self, attrs):
        if not attrs.get('discount_id') and not attrs.get('scholarship_id'):
            raise serializers.ValidationError(
                'Either discount_id or scholarship_id must be provided.'
            )
        if attrs.get('discount_id') and attrs.get('scholarship_id'):
            raise serializers.ValidationError(
                'Provide either discount_id or scholarship_id, not both.'
            )
        return attrs


# =============================================================================
# Phase 3: Payment Gateway Serializers
# =============================================================================

class PaymentGatewayConfigSerializer(serializers.ModelSerializer):
    """Admin serializer for PaymentGatewayConfig. Hides sensitive config on read."""
    gateway_display = serializers.CharField(source='get_gateway_display', read_only=True)

    class Meta:
        model = PaymentGatewayConfig
        fields = [
            'id', 'school', 'gateway', 'gateway_display',
            'is_active', 'is_default', 'config', 'currency',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        # On read (list/retrieve), mask sensitive config keys
        if request and request.method in ('GET', 'HEAD', 'OPTIONS'):
            config = data.get('config', {})
            if isinstance(config, dict):
                masked = {}
                for key, val in config.items():
                    if isinstance(val, str) and len(val) > 4:
                        masked[key] = val[:4] + '****'
                    else:
                        masked[key] = '****'
                data['config'] = masked
        return data


class OnlinePaymentSerializer(serializers.ModelSerializer):
    """Read-only serializer for OnlinePayment."""
    student_name = serializers.CharField(source='student.name', read_only=True, default='Deleted Student')
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    fee_payment_month = serializers.IntegerField(source='fee_payment.month', read_only=True)
    fee_payment_year = serializers.IntegerField(source='fee_payment.year', read_only=True)
    initiated_by_name = serializers.CharField(source='initiated_by.username', read_only=True, default=None)

    class Meta:
        model = OnlinePayment
        fields = [
            'id', 'school',
            'fee_payment', 'fee_payment_month', 'fee_payment_year',
            'student', 'student_name',
            'gateway', 'gateway_order_id', 'gateway_payment_id',
            'amount', 'currency', 'status', 'status_display',
            'initiated_by', 'initiated_by_name',
            'initiated_at', 'completed_at', 'failure_reason',
        ]
        read_only_fields = fields


class OnlinePaymentInitiateSerializer(serializers.Serializer):
    """Serializer for initiating an online payment."""
    fee_payment_id = serializers.IntegerField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    gateway = serializers.ChoiceField(choices=[
        ('STRIPE', 'Stripe'),
        ('RAZORPAY', 'Razorpay'),
        ('JAZZCASH', 'JazzCash'),
        ('EASYPAISA', 'Easypaisa'),
        ('MANUAL', 'Manual/Offline'),
    ])

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Amount must be positive.')
        return value


# =============================================================================
# Phase 3: Fee Breakdown & Sibling Detection Serializers
# =============================================================================

class DiscountAppliedSerializer(serializers.Serializer):
    """Represents a single discount applied in a fee breakdown."""
    id = serializers.IntegerField()
    name = serializers.CharField()
    type = serializers.CharField()  # 'discount' or 'scholarship'
    discount_type = serializers.CharField()  # PERCENTAGE / FIXED / FULL
    value = serializers.DecimalField(max_digits=10, decimal_places=2)
    amount_off = serializers.DecimalField(max_digits=10, decimal_places=2)


class FeeBreakdownSerializer(serializers.Serializer):
    """Computed fee breakdown for a student."""
    student_id = serializers.IntegerField()
    student_name = serializers.CharField()
    class_name = serializers.CharField()
    base_amount = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    discounts_applied = DiscountAppliedSerializer(many=True)
    scholarship_applied = DiscountAppliedSerializer(allow_null=True)
    discount_total = serializers.DecimalField(max_digits=10, decimal_places=2)
    final_amount = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)


class SiblingStudentSerializer(serializers.Serializer):
    """A sibling student detected by matching phone."""
    id = serializers.IntegerField()
    name = serializers.CharField()
    class_name = serializers.CharField()
    roll_number = serializers.CharField()
    parent_phone = serializers.CharField()
    guardian_phone = serializers.CharField()


class SiblingDetectionSerializer(serializers.Serializer):
    """Response serializer for sibling detection."""
    student_id = serializers.IntegerField()
    student_name = serializers.CharField()
    matched_phone = serializers.CharField()
    siblings = SiblingStudentSerializer(many=True)
    sibling_group = serializers.DictField(allow_null=True, required=False)
    pending_suggestions_count = serializers.IntegerField(required=False, default=0)


# =============================================================================
# Sibling Group & Suggestion Serializers
# =============================================================================

class SiblingGroupMemberSerializer(serializers.Serializer):
    """Read-only representation of a sibling group member."""
    id = serializers.IntegerField(source='student.id')
    name = serializers.CharField(source='student.name')
    class_name = serializers.SerializerMethodField()
    roll_number = serializers.CharField(source='student.roll_number')
    order_index = serializers.IntegerField()
    has_sibling_discount = serializers.SerializerMethodField()

    def get_class_name(self, obj):
        return obj.student.class_obj.name if obj.student.class_obj else ''

    def get_has_sibling_discount(self, obj):
        from finance.models import StudentDiscount
        return StudentDiscount.objects.filter(
            student=obj.student,
            discount__applies_to='SIBLING',
            is_active=True,
        ).exists()


class SiblingGroupSerializer(serializers.Serializer):
    """Read-only serializer for a confirmed sibling group."""
    id = serializers.IntegerField()
    name = serializers.CharField()
    is_active = serializers.BooleanField()
    confirmed_by_name = serializers.SerializerMethodField()
    confirmed_at = serializers.DateTimeField()
    member_count = serializers.SerializerMethodField()
    members = SiblingGroupMemberSerializer(many=True, read_only=True)
    created_at = serializers.DateTimeField()

    def get_confirmed_by_name(self, obj):
        return obj.confirmed_by.username if obj.confirmed_by else None

    def get_member_count(self, obj):
        return obj.members.count()


class SiblingSuggestionSerializer(serializers.Serializer):
    """Read-only serializer for sibling suggestions."""
    id = serializers.IntegerField()
    student_a = serializers.IntegerField(source='student_a.id')
    student_a_name = serializers.CharField(source='student_a.name')
    student_a_class = serializers.SerializerMethodField()
    student_a_roll = serializers.CharField(source='student_a.roll_number')
    student_b = serializers.IntegerField(source='student_b.id')
    student_b_name = serializers.CharField(source='student_b.name')
    student_b_class = serializers.SerializerMethodField()
    student_b_roll = serializers.CharField(source='student_b.roll_number')
    confidence_score = serializers.IntegerField()
    match_signals = serializers.JSONField()
    status = serializers.CharField()
    reviewed_by_name = serializers.SerializerMethodField()
    reviewed_at = serializers.DateTimeField()
    sibling_group = serializers.IntegerField(source='sibling_group.id', allow_null=True, default=None)
    created_at = serializers.DateTimeField()

    def get_student_a_class(self, obj):
        return obj.student_a.class_obj.name if obj.student_a.class_obj else ''

    def get_student_b_class(self, obj):
        return obj.student_b.class_obj.name if obj.student_b.class_obj else ''

    def get_reviewed_by_name(self, obj):
        return obj.reviewed_by.username if obj.reviewed_by else None
