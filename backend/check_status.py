#!/usr/bin/env python
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from academic_sessions.models import AcademicYear, StudentEnrollment
from django.db.models import Count

# Get 2025-26 session
year_2025_26 = AcademicYear.objects.get(id=11)
print(f"Checking enrollment STATUS in {year_2025_26.name} (ID: {year_2025_26.id})")
print("="*100)

# Get all classes in 2025-26 ordered
classes_data = (
    StudentEnrollment.objects
    .filter(academic_year=year_2025_26)
    .values('class_obj__name', 'class_obj__section')
    .distinct()
    .order_by('class_obj__name', 'class_obj__section')
)

class_list = []
for c in classes_data:
    name = c['class_obj__name']
    section = c['class_obj__section'] or ''
    display = f"{name} - {section}" if section else name
    class_list.append((display, name, section))

total_all_statuses = {}

for display, class_name, section in class_list:
    print(f"\n{display.upper()}")
    print("-" * 100)
    
    # Get all statuses for this class
    status_breakdown = (
        StudentEnrollment.objects
        .filter(academic_year=year_2025_26, class_obj__name=class_name)
    )
    
    if section:
        status_breakdown = status_breakdown.filter(class_obj__section=section)
    
    status_breakdown = (
        status_breakdown
        .values('status')
        .annotate(count=Count('id'))
        .order_by('status')
    )
    
    class_total = 0
    for status_info in status_breakdown:
        status = status_info['status'] or 'NO_STATUS'
        count = status_info['count']
        class_total += count
        
        # Track totals
        if status not in total_all_statuses:
            total_all_statuses[status] = 0
        total_all_statuses[status] += count
        
        print(f"  {status:15} : {count:3} students")
    
    print(f"  {'TOTAL':15} : {class_total:3} students")

print("\n" + "="*100)
print("GRAND SUMMARY - ALL CLASSES IN 2025-26")
print("="*100)

grand_total = 0
for status in sorted(total_all_statuses.keys()):
    count = total_all_statuses[status]
    grand_total += count
    print(f"  {status:15} : {count:3} students")

print(f"  {'GRAND TOTAL':15} : {grand_total:3} students")

print("\n" + "="*100)
print("STATUS EXPLANATION")
print("="*100)
print("""
  ACTIVE       : Student is currently active in this class (no action taken)
  PROMOTED     : Student was promoted to next class (should be in 2026-27)
  GRADUATED    : Student graduated (completed highest class)
  REPEAT       : Student is repeating the same class
  TRANSFERRED  : Student transferred to another school
  WITHDRAWN    : Student withdrew/left school
""")
