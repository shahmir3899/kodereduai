#!/usr/bin/env python
"""Verify 2025-26 data was not modified by recovery."""
import os, sys, django
sys.path.insert(0, '.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from academic_sessions.models import StudentEnrollment
from django.utils import timezone
from datetime import timedelta

# Check enrollments modified in last hour
one_hour_ago = timezone.now() - timedelta(hours=1)

recent_2025_26 = StudentEnrollment.objects.filter(
    academic_year_id=11,
    updated_at__gte=one_hour_ago
).order_by('-updated_at')

print(f"2025-26 enrollments modified in the last hour: {recent_2025_26.count()}")
if recent_2025_26.count() == 0:
    print("✓ GOOD: No 2025-26 data was touched during recovery\n")
else:
    print("⚠ WARNING: Some 2025-26 data was modified:")

for e in recent_2025_26[:10]:
    print(f"  {e.student.name} → {e.class_obj.name} (Status: {e.status})")
    print(f"    Updated: {e.updated_at.strftime('%Y-%m-%d %H:%M:%S')}")
