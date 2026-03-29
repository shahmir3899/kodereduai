#!/usr/bin/env python
"""Preview-only recovery report for Branch 1 using 2025-26 snapshot.
No writes are performed.
"""
import os
import sys
import django
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from academic_sessions.models import StudentEnrollment

SCHOOL_ID = 1
SOURCE_YEAR_ID = 11  # 2025-26 snapshot

snapshot = (
    StudentEnrollment.objects.filter(
        school_id=SCHOOL_ID,
        academic_year_id=SOURCE_YEAR_ID,
    )
    .select_related('student', 'class_obj', 'student__class_obj')
    .order_by('class_obj__grade_level', 'class_obj__name', 'class_obj__section', 'roll_number')
)

def cls_display(cls):
    if not cls:
        return 'None'
    return f"{cls.name} ({cls.section})" if cls.section else cls.name

# moved students = current class differs from source snapshot class
moved = []
for e in snapshot:
    if e.student.class_obj_id != e.class_obj_id:
        moved.append({
            'student_id': e.student_id,
            'name': e.student.name,
            'source_class': cls_display(e.class_obj),
            'current_class': cls_display(e.student.class_obj),
            'source_status': e.status,
            'source_roll': e.roll_number,
        })

# group by transitions
groups = defaultdict(list)
for m in moved:
    key = (m['source_class'], m['current_class'])
    groups[key].append(m)

print("=" * 110)
print("PREVIEW ONLY - BRANCH 1 CLASS ROLLBACK CANDIDATES (NO CHANGES APPLIED)")
print("=" * 110)
print(f"Source snapshot year: 2025-26 (ID {SOURCE_YEAR_ID})")
print(f"Total students in snapshot: {snapshot.count()}")
print(f"Total moved students: {len(moved)}")

# focused counts for requested issue
class1_3 = [m for m in moved if m['source_class'].startswith('Class 1') or m['source_class'].startswith('Class 3')]
print(f"Class 1/Class 3 impacted students: {len(class1_3)}")

print("\nTransition summary:")
for (src, cur), rows in sorted(groups.items()):
    print(f"  {src:20} -> {cur:20} : {len(rows)}")

print("\nDetailed list (Class 1/Class 3 impacted students):")
print("-" * 110)
for m in class1_3:
    print(
        f"ID {m['student_id']:4} | {m['name'][:35]:35} | "
        f"{m['source_class']:12} -> {m['current_class']:12} | "
        f"status={m['source_status']}, roll={m['source_roll']}"
    )

print("\nDetailed list (all moved students):")
print("-" * 110)
for m in moved:
    print(
        f"ID {m['student_id']:4} | {m['name'][:35]:35} | "
        f"{m['source_class']:12} -> {m['current_class']:12} | "
        f"status={m['source_status']}, roll={m['source_roll']}"
    )

print("\n" + "=" * 110)
print("END OF PREVIEW - NO DATABASE WRITE PERFORMED")
print("=" * 110)
