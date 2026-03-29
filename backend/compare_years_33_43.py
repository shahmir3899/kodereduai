#!/usr/bin/env python
"""Check academic year 33 (original consistent data)."""
import os, sys, django
sys.path.insert(0, '.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from academic_sessions.models import StudentEnrollment, AcademicYear

year33 = AcademicYear.objects.get(id=33)
year43 = AcademicYear.objects.get(id=43)

print(f'Year 33: {year33.name} (School: {year33.school.name})')
print(f'Year 43: {year43.name} (School: {year43.school.name})')

print('\n' + '='*80)
print('YEAR 33 (ID 33) - ORIGINAL CONSISTENT DATA')
print('='*80)

year33_enrollments = StudentEnrollment.objects.filter(academic_year_id=33)
print(f'Total enrollments: {year33_enrollments.count()}')

print('\nBy class:')
for row in year33_enrollments.values('class_obj__name').annotate(
    count=__import__('django.db.models', fromlist=['Count']).Count('id')
).order_by('class_obj__name'):
    print(f'  {row["class_obj__name"]}: {row["count"]} students')

print('\n' + '='*80)
print('YEAR 43 (ID 43) - CURRENT STATE (AFTER DELETIONS)')
print('='*80)
year43_count = StudentEnrollment.objects.filter(academic_year_id=43).count()
print(f'Total enrollments: {year43_count}')

if year43_count == 0:
    print('(Empty - all enrollments were deleted)')
