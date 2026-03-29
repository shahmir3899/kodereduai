#!/usr/bin/env python
"""Actual rollback: Branch 1 Class 1/Class 3 students back to 2025-26 snapshot class.
Scope-limited rollback only for transitions:
- Class 1 (A/B) -> Class 2 (A/B)
- Class 3 -> Class 4
No other students are touched.
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

SCHOOL_ID = 1
SOURCE_YEAR_ID = 11


def is_target_scope(src_class_name):
    return src_class_name == 'Class 3' or src_class_name == 'Class 1'


snapshot = (
    StudentEnrollment.objects.filter(
        school_id=SCHOOL_ID,
        academic_year_id=SOURCE_YEAR_ID,
    )
    .select_related('student', 'class_obj', 'student__class_obj')
    .order_by('student_id')
)

candidates = []
for e in snapshot:
    if not is_target_scope(e.class_obj.name):
        continue
    if e.student.class_obj_id == e.class_obj_id:
        continue
    candidates.append(e)

print('=' * 100)
print('ACTUAL ROLLBACK - BRANCH 1 (Class 1 + Class 3 only)')
print('=' * 100)
print(f'Candidates to rollback: {len(candidates)}')

# show summary by transition
summary = {}
for e in candidates:
    src = f"{e.class_obj.name}{' (' + e.class_obj.section + ')' if e.class_obj.section else ''}"
    cur = f"{e.student.class_obj.name}{' (' + e.student.class_obj.section + ')' if e.student.class_obj.section else ''}"
    summary[(src, cur)] = summary.get((src, cur), 0) + 1

print('\nTransition summary:')
for (src, cur), cnt in sorted(summary.items()):
    print(f'  {src:16} -> {cur:16} : {cnt}')

with transaction.atomic():
    updated = 0
    for e in candidates:
        student = e.student
        # restore class and roll based on trusted 2025-26 snapshot
        student.class_obj_id = e.class_obj_id
        student.roll_number = e.roll_number
        student.save(update_fields=['class_obj', 'roll_number', 'updated_at'])
        updated += 1

print(f'\nUpdated students: {updated}')

# verify final current class counts for Branch 1
print('\nCurrent class distribution (Branch 1) after rollback:')
counts = (
    Student.objects.filter(school_id=SCHOOL_ID)
    .values('class_obj__name', 'class_obj__section')
    .annotate(count=Count('id'))
    .order_by('class_obj__grade_level', 'class_obj__name', 'class_obj__section')
)
for row in counts:
    sec = row['class_obj__section'] or ''
    label = f"{row['class_obj__name']} ({sec})" if sec else row['class_obj__name']
    print(f"  {label:16} : {row['count']}")

print('\nRollback complete.')
