from django.contrib import admin
from .models import (
    Account, Transfer, FeeStructure, FeePayment, Expense, OtherIncome,
    FinanceAIChatMessage, MonthlyClosing, AccountSnapshot,
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
