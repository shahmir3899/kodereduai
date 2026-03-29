#!/usr/bin/env python
"""
Recovery script v2: Create missing 2026-27 enrollments with detailed logging.
"""
import os
import sys
import django

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db import transaction
from academic_sessions.models import StudentEnrollment
from students.models import Class

TARGET_YEAR_ID = 43
SOURCE_YEAR_ID = 11

# Define class promotion hierarchy - VERIFY THESE MATCH YOUR ACTUAL CLASS NAMES
CLASS_PROMOTION_MAP = {
    'Class 1 - A': 'Class 2',
    'Class 1 - B': 'Class 2',
    'Class 2': 'Class 3',
    'Class 3': 'Class 4',
    'Class 4': 'Class 5',
    'Class 5': None,  # Graduated
}

print("Checking class names in database...")
all_classes = Class.objects.all().values_list('name', flat=True).distinct()
print(f"Classes found: {sorted(set(all_classes))}\n")

print("Recovery v2: Creating missing 2026-27 enrollments...")
print("=" * 100)

promoted = StudentEnrollment.objects.filter(
    academic_year_id=SOURCE_YEAR_ID,
    status='PROMOTED'
).select_related('student', 'class_obj', 'school')

print(f"Total PROMOTED students in 2025-26: {promoted.count()}\n")

created = 0
already_exists = 0
graduated = 0
missing_target_class = 0
errors_list = []

for enroll in promoted[:5]:  # Log first 5
    source_class = enroll.class_obj.name
    target_class_name = CLASS_PROMOTION_MAP.get(source_class)
    print(f"  {enroll.student.name}: {source_class} → {target_class_name}")

print("...\n")

with transaction.atomic():
    for enroll in promoted:
        source_class = enroll.class_obj.name
        target_class_name = CLASS_PROMOTION_MAP.get(source_class)
        
        if target_class_name is None:
            graduated += 1
            continue
        
        # Find target class
        try:
            target_class = Class.objects.get(name=target_class_name, school=enroll.school)
        except Class.DoesNotExist:
            missing_target_class += 1
            errors_list.append(f"Class '{target_class_name}' not found for school {enroll.school.name}")
            continue
        
        # Check if already exists
        if StudentEnrollment.objects.filter(
            student=enroll.student,
            academic_year_id=TARGET_YEAR_ID
        ).exists():
            already_exists += 1
            continue
        
        try:
            StudentEnrollment.objects.create(
                school=enroll.school,
                student=enroll.student,
                academic_year_id=TARGET_YEAR_ID,
                class_obj=target_class,
                roll_number=enroll.roll_number,
                status='ACTIVE'
            )
            created += 1
        except Exception as e:
            errors_list.append(f"{enroll.student.name}: {str(e)}")

print(f"\nRESULTS:")
print(f"  Created: {created}")
print(f"  Already Existed: {already_exists}")
print(f"  Graduated (no enrollment): {graduated}")
print(f"  Missing target class: {missing_target_class}")
print(f"  Errors: {len(errors_list)}")

if errors_list:
    print(f"\nFirst 10 errors:")
    for err in errors_list[:10]:
        print(f"  - {err}")

# Final count
total_2026 = StudentEnrollment.objects.filter(academic_year_id=TARGET_YEAR_ID).count()
print(f"\nFinal: {total_2026} total enrollments in 2026-27")
