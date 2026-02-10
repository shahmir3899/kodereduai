"""
Finance serializers for fee structures, payments, expenses, other income, and AI chat.
"""

from rest_framework import serializers
from .models import Account, Transfer, FeeStructure, FeePayment, Expense, OtherIncome, FinanceAIChatMessage


class AccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = Account
        fields = [
            'id', 'school', 'name', 'account_type',
            'opening_balance', 'is_active',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


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
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


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

    class Meta:
        model = FeeStructure
        fields = [
            'id', 'school', 'school_name',
            'class_obj', 'class_name',
            'student', 'student_name',
            'monthly_amount', 'effective_from', 'effective_to',
            'is_active', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class FeeStructureCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeeStructure
        fields = ['class_obj', 'student', 'monthly_amount', 'effective_from', 'effective_to']

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


class BulkFeeStructureSerializer(serializers.Serializer):
    structures = BulkFeeStructureItemSerializer(many=True)
    effective_from = serializers.DateField()


class FeePaymentSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source='student.name', read_only=True)
    student_roll = serializers.CharField(source='student.roll_number', read_only=True)
    class_name = serializers.CharField(source='student.class_obj.name', read_only=True)
    collected_by_name = serializers.CharField(source='collected_by.username', read_only=True, default=None)
    account_name = serializers.CharField(source='account.name', read_only=True, default=None)

    class Meta:
        model = FeePayment
        fields = [
            'id', 'school', 'student',
            'student_name', 'student_roll', 'class_name',
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
            'school', 'student', 'month', 'year',
            'amount_due', 'amount_paid',
            'payment_date', 'payment_method',
            'receipt_number', 'notes'
        ]

    def validate(self, attrs):
        if attrs.get('month') and (attrs['month'] < 1 or attrs['month'] > 12):
            raise serializers.ValidationError({'month': 'Month must be between 1 and 12.'})
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


class ExpenseSerializer(serializers.ModelSerializer):
    recorded_by_name = serializers.CharField(source='recorded_by.username', read_only=True, default=None)
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    account_name = serializers.CharField(source='account.name', read_only=True, default=None)

    class Meta:
        model = Expense
        fields = [
            'id', 'school', 'category', 'category_display',
            'amount', 'date', 'description',
            'recorded_by', 'recorded_by_name',
            'account', 'account_name',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate(self, attrs):
        # On update, require account
        account = attrs.get('account', getattr(self.instance, 'account', None) if self.instance else None)
        if not account:
            raise serializers.ValidationError({'account': 'Please select account'})
        return attrs


class ExpenseCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Expense
        fields = ['school', 'category', 'amount', 'date', 'description', 'account']

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
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    account_name = serializers.CharField(source='account.name', read_only=True, default=None)

    class Meta:
        model = OtherIncome
        fields = [
            'id', 'school', 'category', 'category_display',
            'amount', 'date', 'description',
            'recorded_by', 'recorded_by_name',
            'account', 'account_name',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


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
