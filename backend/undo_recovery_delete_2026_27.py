#!/usr/bin/env python
"""Remove all 2026-27 enrollments created during recovery."""
import os, sys, django
sys.path.insert(0, '.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from academic_sessions.models import StudentEnrollment

YEAR_2026_27 = 43

# Get all enrollments in 2026-27
all_2026_27 = StudentEnrollment.objects.filter(academic_year_id=YEAR_2026_27)

print(f"2026-27 enrollments before deletion: {all_2026_27.count()}")
print("\nEnrollments by class:")
for row in all_2026_27.values('class_obj__name').annotate(
    count=__import__('django.db.models', fromlist=['Count']).Count('id')
).order_by('class_obj__name'):
    print(f"  {row['class_obj__name']}: {row['count']}")

# Delete all 2026-27 enrollments
count_deleted = all_2026_27.count()
all_2026_27.delete()

print(f"\n✓ Deleted {count_deleted} enrollments from 2026-27")

# Verify
remaining = StudentEnrollment.objects.filter(academic_year_id=YEAR_2026_27).count()
print(f"Remaining enrollments in 2026-27: {remaining}")
