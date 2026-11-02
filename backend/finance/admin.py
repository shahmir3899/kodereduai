from django.contrib import admin
from .models import (
    Account, Transfer, FeeStructure, FeePayment, Expense, OtherIncome,
    FinanceAIChatMessage, MonthlyClosing, AccountSnapshot, AnnualFeeCategory,
    MonthlyFeeCategory,
    KuickpayBiller, KuickpaySchoolMapping, KuickpayBill, KuickpayTransaction,
    KuickpayPaymentAllocation, KuickpayCallbackLog, KuickpayReconciliationEvent,
)


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = ['school', 'name', 'account_type', 'opening_balance', 'is_active']
    list_filter = ['school', 'account_type', 'is_active']
    search_fields = ['name']


@admin.register(Transfer)
class TransferAdmin(admin.ModelAdmin):
    list_display = ['school', 'from_account', 'to_account', 'amount', 'date', 'recorded_by']
    list_filter = ['school', 'date']
    search_fields = ['description']


@admin.register(FeeStructure)
class FeeStructureAdmin(admin.ModelAdmin):
    list_display = ['school', 'class_obj', 'student', 'monthly_amount', 'effective_from', 'is_active']
    list_filter = ['school', 'is_active']
    search_fields = ['student__name', 'class_obj__name']


@admin.register(FeePayment)
class FeePaymentAdmin(admin.ModelAdmin):
    list_display = ['student', 'month', 'year', 'amount_due', 'amount_paid', 'status', 'payment_date']
    list_filter = ['school', 'status', 'year', 'month']
    search_fields = ['student__name', 'receipt_number']


@admin.register(AnnualFeeCategory)
class AnnualFeeCategoryAdmin(admin.ModelAdmin):
    list_display = ['school', 'name', 'is_active']
    list_filter = ['school', 'is_active']
    search_fields = ['name']


@admin.register(MonthlyFeeCategory)
class MonthlyFeeCategoryAdmin(admin.ModelAdmin):
    list_display = ['school', 'name', 'is_active']
    list_filter = ['school', 'is_active']
    search_fields = ['name']


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ['school', 'category', 'amount', 'date', 'description', 'recorded_by']
    list_filter = ['school', 'category', 'date']
    search_fields = ['description']


@admin.register(OtherIncome)
class OtherIncomeAdmin(admin.ModelAdmin):
    list_display = ['school', 'category', 'amount', 'date', 'description', 'recorded_by']
    list_filter = ['school', 'category', 'date']
    search_fields = ['description']


@admin.register(FinanceAIChatMessage)
class FinanceAIChatMessageAdmin(admin.ModelAdmin):
    list_display = ['school', 'user', 'role', 'created_at']
    list_filter = ['school', 'role']


@admin.register(MonthlyClosing)
class MonthlyClosingAdmin(admin.ModelAdmin):
    list_display = ['school', 'year', 'month', 'closed_by', 'closed_at']
    list_filter = ['school', 'year']
    ordering = ['-year', '-month']


@admin.register(AccountSnapshot)
class AccountSnapshotAdmin(admin.ModelAdmin):
    list_display = ['closing', 'account', 'closing_balance', 'opening_balance_used']
    list_filter = ['closing__school', 'closing__year', 'closing__month']
    search_fields = ['account__name']


# ── Kuickpay ──────────────────────────────────────────────────────────────────────────────
# Setup records (biller, school mapping) are editable. Everything the integration writes is a
# financial or audit record and is read-only here: no adds, edits or deletes through the admin.

@admin.register(KuickpayBiller)
class KuickpayBillerAdmin(admin.ModelAdmin):
    list_display = ['name', 'prefix', 'mode', 'consumer_number_length', 'is_enabled']
    list_filter = ['mode', 'is_enabled']
    search_fields = ['name', 'prefix']


@admin.register(KuickpaySchoolMapping)
class KuickpaySchoolMappingAdmin(admin.ModelAdmin):
    # Saving runs KuickpaySchoolMapping.clean(): the account must be this school's Bank account, and an
    # enabled mapping needs the school's own contact email (<= 30 chars) and phone (92... or 03...).
    list_display = ['school', 'biller', 'settlement_account', 'due_day', 'is_enabled']
    list_filter = ['is_enabled', 'biller']


class _ReadOnlyAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(KuickpayBill)
class KuickpayBillAdmin(_ReadOnlyAdmin):
    list_display = ['consumer_number', 'school', 'student_ref', 'year', 'month', 'status', 'suspend_reason']
    list_filter = ['status', 'school']
    search_fields = ['consumer_number']


@admin.register(KuickpayTransaction)
class KuickpayTransactionAdmin(_ReadOnlyAdmin):
    list_display = ['id', 'consumer_number', 'tran_auth_id', 'tran_date', 'amount', 'status', 'reason', 'urgent']
    list_filter = ['status', 'urgent']
    search_fields = ['consumer_number', 'tran_auth_id']


@admin.register(KuickpayPaymentAllocation)
class KuickpayPaymentAllocationAdmin(_ReadOnlyAdmin):
    list_display = ['transaction', 'fee_payment_ref', 'amount', 'period_year', 'period_month', 'posting_date']


@admin.register(KuickpayCallbackLog)
class KuickpayCallbackLogAdmin(_ReadOnlyAdmin):
    list_display = ['received_at', 'endpoint', 'auth_ok', 'consumer_number', 'result_code', 'latency_ms']
    list_filter = ['endpoint', 'auth_ok', 'result_code']


@admin.register(KuickpayReconciliationEvent)
class KuickpayReconciliationEventAdmin(_ReadOnlyAdmin):
    list_display = ['transaction', 'action', 'actor', 'created_at']
