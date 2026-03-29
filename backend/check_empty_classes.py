#!/usr/bin/env python
"""Check which classes have no students in 2025-26."""
import os, sys, django
sys.path.insert(0, '.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from students.models import Class
from academic_sessions.models import StudentEnrollment

YEAR_2025_26 = 11

print("Classes in school 1 and their 2025-26 enrollment status:")
print("=" * 80)

school_classes = Class.objects.filter(school_id=1).order_by('grade_level', 'name')

empty = []
populated = []

for cls in school_classes:
    count = StudentEnrollment.objects.filter(
        class_obj=cls,
        academic_year_id=YEAR_2025_26
    ).count()
    
    status = "✓" if count > 0 else "✗ EMPTY"
    print(f"  {cls.name:20} (Grade {cls.grade_level}, Section: {cls.section or 'None':5}): {count:3} students {status}")
    
    if count == 0:
        empty.append(cls.name)
    else:
        populated.append(cls.name)

print("\n" + "=" * 80)
print(f"\nSUMMARY:")
print(f"  Populated classes: {len(populated)}")
for name in populated:
    print(f"    - {name}")

if empty:
    print(f"\n  EMPTY classes in 2025-26: {len(empty)}")
    for name in empty:
        print(f"    - {name}")
else:
    print(f"\n  No empty classes - all classes are populated.")
