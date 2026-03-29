#!/usr/bin/env python
"""Compare Branch 1 current classes vs 2025-26 enrollment snapshot."""
import os
import sys
import django
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from academic_sessions.models import StudentEnrollment

SCHOOL_ID = 1
YEAR_2025 = 11

snapshot = StudentEnrollment.objects.filter(
    school_id=SCHOOL_ID,
    academic_year_id=YEAR_2025,
).select_related('student', 'class_obj')

moves = []
for e in snapshot:
    current_cls = e.student.class_obj
    src = f"{e.class_obj.name}{' (' + e.class_obj.section + ')' if e.class_obj.section else ''}"
    cur = f"{current_cls.name}{' (' + current_cls.section + ')' if current_cls and current_cls.section else ''}" if current_cls else 'None'
    if e.class_obj_id != e.student.class_obj_id:
        moves.append((e.student_id, e.student.name, src, cur, e.status))

print(f"2025 snapshot students: {snapshot.count()}")
print(f"Students moved away from their 2025 class: {len(moves)}")

# summarize by from->to
counter = Counter((m[2], m[3]) for m in moves)
print("\nMove summary (from 2025 class -> current class):")
for (src, cur), cnt in sorted(counter.items()):
    print(f"  {src:15} -> {cur:15} : {cnt}")

print("\nSample moved students:")
for m in moves[:25]:
    sid, name, src, cur, status = m
    print(f"  ID {sid}: {name} | {src} -> {cur} | status={status}")

# recoverability specific to Class 1 and Class 3
class1_or_3 = [m for m in moves if m[2].startswith('Class 1') or m[2].startswith('Class 3')]
print(f"\nRecoverable impacted students from Class 1/Class 3: {len(class1_or_3)}")
print("Breakdown:")
sub = Counter((m[2], m[3]) for m in class1_or_3)
for (src, cur), cnt in sorted(sub.items()):
    print(f"  {src:15} -> {cur:15} : {cnt}")
