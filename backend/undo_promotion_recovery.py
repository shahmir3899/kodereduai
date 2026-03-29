#!/usr/bin/env python
"""Remove only promotion-created enrollments (Class 2, 4, 5 in 2026-27).
Keep Playgroup (new admissions)."""
import os, sys, django
sys.path.insert(0, '.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from academic_sessions.models import StudentEnrollment
from students.models import Class

YEAR_2026_27 = 43

# Get class IDs for promoted classes
class2_id = Class.objects.filter(name='Class 2', section__isnull=True).first().id
class4_id = Class.objects.filter(name='Class 4', section__isnull=True).first().id
class5_id = Class.objects.filter(name='Class 5', section__isnull=True).first().id

print("Removing promotion-created enrollments from 2026-27...")
print("=" * 80)

# Count before
before_class2 = StudentEnrollment.objects.filter(academic_year_id=YEAR_2026_27, class_obj_id=class2_id).count()
before_class4 = StudentEnrollment.objects.filter(academic_year_id=YEAR_2026_27, class_obj_id=class4_id).count()
before_class5 = StudentEnrollment.objects.filter(academic_year_id=YEAR_2026_27, class_obj_id=class5_id).count()
before_playgroup = StudentEnrollment.objects.filter(academic_year_id=YEAR_2026_27, class_obj__name='Playgroup').count()

print(f"Before deletion:")
print(f"  Class 2: {before_class2}")
print(f"  Class 4: {before_class4}")
print(f"  Class 5: {before_class5}")
print(f"  Playgroup: {before_playgroup} (KEEP)")

# Delete only promoted classes
delete_class2 = StudentEnrollment.objects.filter(academic_year_id=YEAR_2026_27, class_obj_id=class2_id).delete()[0]
delete_class4 = StudentEnrollment.objects.filter(academic_year_id=YEAR_2026_27, class_obj_id=class4_id).delete()[0]
delete_class5 = StudentEnrollment.objects.filter(academic_year_id=YEAR_2026_27, class_obj_id=class5_id).delete()[0]

total_deleted = delete_class2 + delete_class4 + delete_class5

print(f"\nAfter deletion:")
print(f"  Deleted Class 2: {delete_class2}")
print(f"  Deleted Class 4: {delete_class4}")
print(f"  Deleted Class 5: {delete_class5}")
print(f"  TOTAL DELETED: {total_deleted}")

# Verify Playgroup is still there
after_playgroup = StudentEnrollment.objects.filter(academic_year_id=YEAR_2026_27, class_obj__name='Playgroup').count()
print(f"\nPlaygroup students (new admissions) - PRESERVED: {after_playgroup}")

# Final count
total_remaining = StudentEnrollment.objects.filter(academic_year_id=YEAR_2026_27).count()
print(f"\nTotal remaining in 2026-27: {total_remaining}")
print("=" * 80)
