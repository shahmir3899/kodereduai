#!/usr/bin/env python
"""
Diagnose PROMOTED students missing from 2026-27.
Find which PROMOTED students lack target enrollments.
"""
import os
import sys
import django

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db.models import Q
from academic_sessions.models import StudentEnrollment
from students.models import Student

# Target year 2026-27
target_year_id = 43
source_year_id = 11

print("Checking PROMOTED students lacking target enrollment in 2026-27...")
print("=" * 100)

# Get all PROMOTED students in 2025-26
promoted_enrollments = StudentEnrollment.objects.filter(
    academic_year_id=source_year_id,
    status='PROMOTED'
).select_related('student', 'class_obj')

print(f"\nTotal PROMOTED students in 2025-26: {promoted_enrollments.count()}\n")

# Check which have target enrollments
missing_target = []
has_target = []

for enroll in promoted_enrollments:
    student_id = enroll.student_id
    # Check if target enrollment exists
    target_enroll = StudentEnrollment.objects.filter(
        student_id=student_id,
        academic_year_id=target_year_id
    ).first()
    
    student_name = enroll.student.name
    source_class = enroll.class_obj.name
    
    if target_enroll:
        has_target.append({
            'student': student_name,
            'soure_class': source_class,
            'target_class': target_enroll.class_obj.name,
            'target_status': target_enroll.status
        })
    else:
        missing_target.append({
            'student': student_name,
            'source_class': source_class,
            'target_class': getattr(enroll, 'target_class_for_promotion', 'NOT SET')
        })

print(f"PROMOTED students WITH target enrollment in 2026-27: {len(has_target)}")
for item in has_target[:5]:
    print(f"  {item['student']} → {item['target_class']}")
if len(has_target) > 5:
    print(f"  ... and {len(has_target) - 5} more")

print(f"\nPROMOTED students MISSING target enrollment in 2026-27: {len(missing_target)}")
for item in missing_target[:10]:
    print(f"  {item['student']} from {item['source_class']} (target: {item['target_class']})")
if len(missing_target) > 10:
    print(f"  ... and {len(missing_target) - 10} more")

print("\n" + "=" * 100)
print(f"SUMMARY: {len(missing_target)}/{promoted_enrollments.count()} PROMOTED students are missing from 2026-27")
print("=" * 100)
