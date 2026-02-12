"""
One-time fix: Class 1A duplicate Roll#17 caused crossed/missing FeePayment data.

Fixes:
  1. Iltija Khan (Roll#17):  due 1000→1950, paid 1000→1950
  2. Ihitiram Ali (Roll#21): due 1950→1000, paid 1950→1000
  3. Imran Ali (Roll#22):    CREATE due=1950, paid=1950, account=Principal

Usage:
    python fix_cl1a.py          # dry-run
    python fix_cl1a.py --apply  # write to DB
"""
import os, sys, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from students.models import Class, Student
from finance.models import FeePayment, Account
from decimal import Decimal

SCHOOL_ID = 1
apply = '--apply' in sys.argv
print(f'MODE: {"APPLY" if apply else "DRY RUN"}')

cls = Class.objects.get(school_id=SCHOOL_ID, name='Class 1A')
principal = Account.objects.get(school_id=SCHOOL_ID, name='Principal')

fixes = [
    # (roll, name, amount_due, amount_paid, action)
    ('17', 'Iltija Khan',   Decimal('1950'), Decimal('1950'), 'update'),
    ('21', 'Ihitiram Ali',  Decimal('1000'), Decimal('1000'), 'update'),
    ('22', 'Imran Ali',     Decimal('1950'), Decimal('1950'), 'create'),
]

for roll, name, due, paid, action in fixes:
    student = Student.objects.get(school_id=SCHOOL_ID, class_obj=cls, roll_number=roll)
    print(f'\n  {name} (Roll#{roll}, Student ID={student.id}):')

    if action == 'update':
        fp = FeePayment.objects.get(school_id=SCHOOL_ID, student=student, month=2, year=2026)
        print(f'    Current: due={fp.amount_due}, paid={fp.amount_paid}, status={fp.status}')
        print(f'    Target:  due={due}, paid={paid}')
        if apply:
            fp.amount_due = due
            fp.amount_paid = paid
            fp.account = principal
            fp.save()
            print(f'    -> UPDATED (status={fp.status})')
        else:
            print(f'    -> WILL UPDATE')

    elif action == 'create':
        existing = FeePayment.objects.filter(school_id=SCHOOL_ID, student=student, month=2, year=2026).first()
        if existing:
            print(f'    Already exists: due={existing.amount_due}, paid={existing.amount_paid}')
            print(f'    -> SKIP')
        else:
            print(f'    Target: due={due}, paid={paid}, account=Principal')
            if apply:
                fp = FeePayment(
                    school_id=SCHOOL_ID, student=student,
                    month=2, year=2026,
                    amount_due=due, previous_balance=Decimal('0'),
                    amount_paid=paid, account=principal,
                )
                fp.save()
                print(f'    -> CREATED (status={fp.status})')
            else:
                print(f'    -> WILL CREATE')

# Verify totals
print('\n--- Class 1A After Fix ---')
from django.db.models import Sum, Count
fps = FeePayment.objects.filter(school_id=SCHOOL_ID, student__class_obj=cls, month=2, year=2026)
agg = fps.aggregate(total_due=Sum('amount_due'), total_paid=Sum('amount_paid'), count=Count('id'))
print(f'  Students: {agg["count"]}  Total Fee: {agg["total_due"]}  Received: {agg["total_paid"]}')
print(f'  Expected: 21 students, Total Fee: 34200, Received: 34200')
