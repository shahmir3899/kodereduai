#!/usr/bin/env python
"""Check which class objects have students in 2026-27."""
import os, sys, django
sys.path.insert(0, '.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from academic_sessions.models import StudentEnrollment

enrollments_2026_27 = StudentEnrollment.objects.filter(academic_year_id=43)

print("Classes with students in 2026-27:")
for row in enrollments_2026_27.values('class_obj_id', 'class_obj__name', 'class_obj__section').annotate(
    count=__import__('django.db.models', fromlist=['Count']).Count('id')
).order_by('class_obj__name'):
    section = row['class_obj__section'] or '(none)'
    print(f"  ID {row['class_obj_id']:2}: {row['class_obj__name']:12} section={section}: {row['count']} students")
