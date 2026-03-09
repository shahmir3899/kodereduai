#!/usr/bin/env python
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from finance.models import Expense, OtherIncome, Transfer

print('\n════════════════════════════════════════════════════════════')
print('AUDITING FIELDS IN FINANCE MODELS')
print('════════════════════════════════════════════════════════════')

# Check Expense model
print('\n1. EXPENSE MODEL:')
expense = Expense.objects.first()
if expense:
    print(f'   Sample Record ID: {expense.id}')
    print(f'   Date (from frontend): {expense.date}')
    print(f'   Recorded By: {expense.recorded_by} ({expense.recorded_by.username if expense.recorded_by else "NULL"})')
    print(f'   Created At: {expense.created_at}')
    print(f'   Updated At: {expense.updated_at}')
    print(f'   ✓ Has recorded_by: YES')
    print(f'   ✓ Has created_at: YES')
    print(f'   ✓ Has updated_at: YES')
else:
    print(f'   ✗ No expense records found')

# Check OtherIncome model
print('\n2. OTHER INCOME MODEL:')
income = OtherIncome.objects.first()
if income:
    print(f'   Sample Record ID: {income.id}')
    print(f'   Date (from frontend): {income.date}')
    print(f'   Recorded By: {income.recorded_by} ({income.recorded_by.username if income.recorded_by else "NULL"})')
    print(f'   Created At: {income.created_at}')
    print(f'   Updated At: {income.updated_at}')
    print(f'   ✓ Has recorded_by: YES')
    print(f'   ✓ Has created_at: YES')
    print(f'   ✓ Has updated_at: YES')
else:
    print(f'   ✗ No income records found')

# Check Transfer model
print('\n3. TRANSFER MODEL:')
transfer = Transfer.objects.first()
if transfer:
    print(f'   Sample Record ID: {transfer.id}')
    print(f'   Date (from frontend): {transfer.date}')
    print(f'   Recorded By: {transfer.recorded_by} ({transfer.recorded_by.username if transfer.recorded_by else "NULL"})')
    print(f'   Created At: {transfer.created_at}')
    print(f'   Updated At: {transfer.updated_at}')
    print(f'   ✓ Has recorded_by: YES')
    print(f'   ✓ Has created_at: YES')
    print(f'   ✓ Has updated_at: YES')
else:
    print(f'   ✗ No transfer records found')

print('\n════════════════════════════════════════════════════════════')
print('AUDIT TRAIL ANALYSIS')
print('════════════════════════════════════════════════════════════')

# Check if recorded_by is NULL anywhere
print('\nExpense - NULL recorded_by:')
null_exp = Expense.objects.filter(recorded_by__isnull=True).count()
print(f'  Records without recorded_by: {null_exp}')

print('\nOtherIncome - NULL recorded_by:')
null_inc = OtherIncome.objects.filter(recorded_by__isnull=True).count()
print(f'  Records without recorded_by: {null_inc}')

print('\nTransfer - NULL recorded_by:')
null_trans = Transfer.objects.filter(recorded_by__isnull=True).count()
print(f'  Records without recorded_by: {null_trans}')

# Show totals
print('\nTOTAL COUNTS:')
print(f'  Expenses: {Expense.objects.count()}')
print(f'  Other Income: {OtherIncome.objects.count()}')
print(f'  Transfers: {Transfer.objects.count()}')

print('\n════════════════════════════════════════════════════════════')
print('RECENT SAMPLES WITH DATES')
print('════════════════════════════════════════════════════════════')

print('\nRecent Expenses:')
for exp in Expense.objects.order_by('-created_at')[:5]:
    print(f'  ID {exp.id}: Date={exp.date}, CreatedAt={exp.created_at}, RecordedBy={exp.recorded_by.username if exp.recorded_by else "NULL"}')

print('\nRecent Other Income:')
for inc in OtherIncome.objects.order_by('-created_at')[:5]:
    print(f'  ID {inc.id}: Date={inc.date}, CreatedAt={inc.created_at}, RecordedBy={inc.recorded_by.username if inc.recorded_by else "NULL"}')

print('\nRecent Transfers:')
for tra in Transfer.objects.order_by('-created_at')[:5]:
    print(f'  ID {tra.id}: Date={tra.date}, CreatedAt={tra.created_at}, RecordedBy={tra.recorded_by.username if tra.recorded_by else "NULL"}')
