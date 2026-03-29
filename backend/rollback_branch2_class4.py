#!/usr/bin/env python
"""Rollback Branch 2 Class 4 lost students only.
Restores students whose 2025-26 snapshot class was Class 4 but current class is different.
"""
import os
import sys
import django

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db import transaction
from django.db.models import Count
from academic_sessions.models import StudentEnrollment
from students.models import Student

SCHOOL_ID = 2
SOURCE_YEAR_ID = 10  # Branch 2 2025-26

snapshot = StudentEnrollment.objects.filter(
    school_id=SCHOOL_ID,
    academic_year_id=SOURCE_YEAR_ID,
    class_obj__name='Class 4',
).select_related('student', 'class_obj', 'student__class_obj').order_by('roll_number')

candidates = [e for e in snapshot if e.student.class_obj_id != e.class_obj_id]

print('=' * 90)
print('ACTUAL ROLLBACK - BRANCH 2 (Class 4 only)')
print('=' * 90)
print(f'Candidates: {len(candidates)}')
for e in candidates:
    print(f"  ID {e.student_id}: {e.student.name} | {e.student.class_obj.name} -> {e.class_obj.name} | roll {e.roll_number}")

with transaction.atomic():
    updated = 0
    for e in candidates:
        s = e.student
        s.class_obj_id = e.class_obj_id
        s.roll_number = e.roll_number
        s.save(update_fields=['class_obj', 'roll_number', 'updated_at'])
        updated += 1

print(f'\nUpdated: {updated}')

print('\nCurrent class distribution (Branch 2):')
rows = (
    Student.objects.filter(school_id=SCHOOL_ID)
    .values('class_obj__name', 'class_obj__section')
    .annotate(count=Count('id'))
    .order_by('class_obj__grade_level', 'class_obj__name', 'class_obj__section')
)
for r in rows:
    sec = r['class_obj__section'] or ''
    label = f"{r['class_obj__name']} ({sec})" if sec else r['class_obj__name']
    print(f"  {label:14}: {r['count']}")

print('\nRollback complete.')
