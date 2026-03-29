#!/usr/bin/env python
"""Diagnose Branch 2 Class 4 loss using 2025-26 snapshot."""
import os
import sys
import django
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from academic_sessions.models import StudentEnrollment

SCHOOL_ID = 2
YEAR_2025 = 10

snapshot = StudentEnrollment.objects.filter(
    school_id=SCHOOL_ID,
    academic_year_id=YEAR_2025,
).select_related('student', 'class_obj', 'student__class_obj')

moved = []
for e in snapshot:
    if e.student.class_obj_id != e.class_obj_id:
        src = f"{e.class_obj.name}{' (' + e.class_obj.section + ')' if e.class_obj.section else ''}"
        cur = f"{e.student.class_obj.name}{' (' + e.student.class_obj.section + ')' if e.student.class_obj.section else ''}"
        moved.append((e.student_id, e.student.name, src, cur, e.status, e.roll_number))

print(f"Snapshot students (2025-26): {snapshot.count()}")
print(f"Moved students: {len(moved)}")

summary = Counter((m[2], m[3]) for m in moved)
print("\nMove summary:")
for (src, cur), cnt in sorted(summary.items()):
    print(f"  {src:12} -> {cur:12} : {cnt}")

class4_lost = [m for m in moved if m[2].startswith('Class 4')]
print(f"\nClass 4 lost candidates: {len(class4_lost)}")
for m in class4_lost:
    sid, name, src, cur, status, roll = m
    print(f"  ID {sid}: {name} | {src} -> {cur} | status={status}, roll={roll}")
