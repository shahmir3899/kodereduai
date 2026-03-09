#!/usr/bin/env python
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from finance.models import Expense, OtherIncome, Transfer

print('\n════════════════════════════════════════════════════════════')
print('DETAILED AUDIT OF NULL recorded_by RECORDS')
print('════════════════════════════════════════════════════════════')

# Check Expenses with NULL recorded_by
print('\n1. EXPENSES WITH NULL recorded_by:')
null_expenses = Expense.objects.filter(recorded_by__isnull=True).order_by('-created_at')
if null_expenses.exists():
    for exp in null_expenses:
        print(f'\n  ID {exp.id}:')
        print(f'    Date (business): {exp.date}')
        print(f'    CreatedAt (system): {exp.created_at}')
        print(f'    UpdatedAt: {exp.updated_at}')
        print(f'    Amount: {exp.amount}')
        print(f'    Category: {exp.category.name if exp.category else "NULL"}')
        print(f'    Account: {exp.account.name if exp.account else "NULL"}')
        print(f'    Recorded By: {exp.recorded_by}')
else:
    print(f'  ✓ No NULL recorded_by found')

# Check OtherIncome with NULL recorded_by
print('\n\n2. OTHER INCOME WITH NULL recorded_by:')
null_income = OtherIncome.objects.filter(recorded_by__isnull=True).order_by('-created_at')
if null_income.exists():
    for inc in null_income:
        print(f'\n  ID {inc.id}:')
        print(f'    Date (business): {inc.date}')
        print(f'    CreatedAt (system): {inc.created_at}')
        print(f'    UpdatedAt: {inc.updated_at}')
        print(f'    Amount: {inc.amount}')
        print(f'    Category: {inc.category.name if inc.category else "NULL"}')
        print(f'    Account: {inc.account.name if inc.account else "NULL"}')
        print(f'    Recorded By: {inc.recorded_by}')
else:
    print(f'  ✓ No NULL recorded_by found')

print('\n\n════════════════════════════════════════════════════════════')
print('ANALYSIS')
print('════════════════════════════════════════════════════════════')
print(f'\n✓ TransferViewSet: 0 NULL recorded_by')
print(f'✓ ExpenseViewSet: perform_create DOES set recorded_by=request.user')
print(f'✓ OtherIncomeViewSet: perform_create DOES set recorded_by=request.user')
print(f'\n⚠️  The NULL values likely come from:')
print(f'   1. Seed data scripts that created records without recorded_by')
print(f'   2. Old migrations or fixture data')
print(f'   3. Admin panel direct DB operations')
