#!/usr/bin/env python
"""Remove promotion-created enrollments from Branch 1 2026-27, keep Playgroup."""
import os, sys, django
sys.path.insert(0, '.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db import transaction
from academic_sessions.models import StudentEnrollment

BRANCH1_SCHOOL_ID = 1
YEAR_2026_27_ID = 33

print("Branch 1 - Year 2026-27 (ID 33) enrollment breakdown BEFORE:")
print("=" * 70)

all_enrollments = StudentEnrollment.objects.filter(
    school_id=BRANCH1_SCHOOL_ID,
    academic_year_id=YEAR_2026_27_ID
)

for row in all_enrollments.values('class_obj__name').annotate(
    count=__import__('django.db.models', fromlist=['Count']).Count('id')
).order_by('class_obj__name'):
    keep = "KEEP" if 'playgroup' in row['class_obj__name'].lower() else "DELETE"
    print(f"  {row['class_obj__name']:15}: {row['count']:3} students  [{keep}]")

print(f"\n  TOTAL: {all_enrollments.count()}")

# Identify what to delete (everything except Playgroup)
to_delete = all_enrollments.exclude(class_obj__name__icontains='Playgroup')
to_keep = all_enrollments.filter(class_obj__name__icontains='Playgroup')

print(f"\nWill DELETE: {to_delete.count()} enrollments (Class 2, 4, 5)")
print(f"Will KEEP:   {to_keep.count()} enrollments (Playgroup)")

print("\nProceeding with deletion...")
with transaction.atomic():
    deleted_count = to_delete.count()
    to_delete.delete()

print(f"\n✅ Deleted {deleted_count} promotion-created enrollments from Branch 1 2026-27")

# Verify
remaining = StudentEnrollment.objects.filter(
    school_id=BRANCH1_SCHOOL_ID,
    academic_year_id=YEAR_2026_27_ID
)
print(f"\nBranch 1 2026-27 AFTER:")
for row in remaining.values('class_obj__name').annotate(
    count=__import__('django.db.models', fromlist=['Count']).Count('id')
).order_by('class_obj__name'):
    print(f"  {row['class_obj__name']}: {row['count']} students")
print(f"  TOTAL: {remaining.count()}")
