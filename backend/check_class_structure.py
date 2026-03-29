#!/usr/bin/env python
"""Check actual class structure."""
import os, sys, django
sys.path.insert(0, '.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from academic_sessions.models import StudentEnrollment
from students.models import Class

# Check promoted class distribution
promoted = StudentEnrollment.objects.filter(
    academic_year_id=11,
    status='PROMOTED'
).values('class_obj__name').annotate(
    count=__import__('django.db.models', fromlist=['Count']).Count('id')
).order_by('class_obj__name')

print('Classes with PROMOTED students:')
for row in promoted:
    print(f'  {row["class_obj__name"]}: {row["count"]} students')

# Show class structure
print('\nAll classes (with details):')
for cls in Class.objects.filter(school_id=1).order_by('grade_level', 'name'):
    sec = f" ({cls.section})" if cls.section else ""
    print(f'  {cls.name}{sec} - Grade Level: {cls.grade_level}')
