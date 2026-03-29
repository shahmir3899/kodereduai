#!/usr/bin/env python
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from academic_sessions.models import AcademicYear, StudentEnrollment
from django.db.models import Count

# Get all academic years
print("All Available Academic Years:")
all_years = AcademicYear.objects.all().order_by('start_date')
print("="*80)
for year in all_years:
    count = StudentEnrollment.objects.filter(academic_year=year).count()
    print(f"  ID {year.id}: {year.name} - {count} enrollments")

# Find the right years
print("\n" + "="*80)
year_2025_26 = None
year_2026_27 = None

for year in all_years:
    if 'Academic Year 2025-26' in year.name or year.name == 'Academic Year 2025-26':
        year_2025_26 = year
    elif 'Academic Year 2026-27' in year.name or year.name == 'Academic Year 2026-27':
        year_2026_27 = year

if not year_2025_26:
    # Try alternative matching
    for year in all_years:
        if '2025' in year.name and '26' in year.name:
            year_2025_26 = year
            break

if not year_2026_27:
    # Try alternative matching
    for year in all_years:
        if '2026' in year.name and '27' in year.name:
            year_2026_27 = year
            break

print("STUDENTS BY CLASS - SESSION 2025-26")
print("="*80)

if year_2025_26:
    print(f"Using: {year_2025_26.name} (ID: {year_2025_26.id})\n")
    enrollments_2025_26 = (
        StudentEnrollment.objects
        .filter(academic_year=year_2025_26)
        .values('class_obj__name', 'class_obj__section')
        .annotate(count=Count('id'))
        .order_by('class_obj__name', 'class_obj__section')
    )
    
    total = 0
    if enrollments_2025_26.exists():
        for enrollment in enrollments_2025_26:
            class_name = enrollment['class_obj__name']
            section = enrollment['class_obj__section'] or ''
            count = enrollment['count']
            display = f"{class_name} - {section}" if section else class_name
            print(f"  {display}: {count} students")
            total += count
        print(f"\nTotal in 2025-26: {total} students")
    else:
        print("  No enrollments found for this session")
else:
    print("  Session 2025-26 not found")

print("\n" + "="*80)
print("STUDENTS BY CLASS - SESSION 2026-27")
print("="*80)

if year_2026_27:
    print(f"Using: {year_2026_27.name} (ID: {year_2026_27.id})\n")
    enrollments_2026_27 = (
        StudentEnrollment.objects
        .filter(academic_year=year_2026_27)
        .values('class_obj__name', 'class_obj__section')
        .annotate(count=Count('id'))
        .order_by('class_obj__name', 'class_obj__section')
    )
    
    total = 0
    if enrollments_2026_27.exists():
        for enrollment in enrollments_2026_27:
            class_name = enrollment['class_obj__name']
            section = enrollment['class_obj__section'] or ''
            count = enrollment['count']
            display = f"{class_name} - {section}" if section else class_name
            print(f"  {display}: {count} students")
            total += count
        print(f"\nTotal in 2026-27: {total} students")
    else:
        print("  No enrollments found for this session")
else:
    print("  Session 2026-27 not found")
