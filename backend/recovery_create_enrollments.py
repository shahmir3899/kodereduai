#!/usr/bin/env python
"""
Recovery script: Create missing 2026-27 enrollments for PROMOTED students.
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

# Target year
TARGET_YEAR_ID = 43
SOURCE_YEAR_ID = 11
SCHOOL_ID = 1  # Adjust to your school

# Define class promotion hierarchy
CLASS_PROMOTION_MAP = {
    'Class 1 - A': 'Class 2',
    'Class 1 - B': 'Class 2',
    'Class 2': 'Class 3',
    'Class 3': 'Class 4',
    'Class 4': 'Class 5',
    'Class 5': None,  # Graduated, no enrollment
}

print("Recovery: Creating missing 2026-27 enrollments for PROMOTED students...")
print("=" * 100)

# Get all PROMOTED students in 2025-26
promoted = StudentEnrollment.objects.filter(
    academic_year_id=SOURCE_YEAR_ID,
    status='PROMOTED'
).select_related('student', 'class_obj', 'school')

print(f"Found {promoted.count()} PROMOTED students in 2025-26\n")

# Get target year for reference
from academic_sessions.models import AcademicYear
try:
    target_year = AcademicYear.objects.get(id=TARGET_YEAR_ID)
except:
    print("ERROR: Target year 2026-27 not found")
    sys.exit(1)

created = 0
skipped = 0
errors = []

with transaction.atomic():
    for enroll in promoted:
        source_class_name = enroll.class_obj.name
        
        # Determine target class
        target_class_name = CLASS_PROMOTION_MAP.get(source_class_name)
        
        if target_class_name is None:
            # Graduated, no need to create enrollment
            skipped += 1
            continue
        
        # Find target class object
        try:
            target_class = enroll.school.classes.get(name=target_class_name)
        except:
            errors.append(f"Target class '{target_class_name}' not found for {enroll.student.name}")
            skipped += 1
            continue
        
        # Check if enrollment already exists
        existing = StudentEnrollment.objects.filter(
            student=enroll.student,
            academic_year_id=TARGET_YEAR_ID,
            class_obj=target_class
        ).exists()
        
        if existing:
            skipped += 1
            continue
        
        # Create new enrollment
        try:
            StudentEnrollment.objects.create(
                school=enroll.school,
                student=enroll.student,
                academic_year_id=TARGET_YEAR_ID,
                class_obj=target_class,
                roll_number=enroll.roll_number,
                status='ACTIVE',
                is_active=True
            )
            created += 1
        except Exception as e:
            errors.append(f"Failed to create enrollment for {enroll.student.name}: {str(e)}")

print(f"RESULTS:")
print(f"  Created: {created} new enrollments in 2026-27")
print(f"  Skipped: {skipped} (already exist or graduated)")
if errors:
    print(f"  Errors: {len(errors)}")
    for err in errors[:5]:
        print(f"    - {err}")
    if len(errors) > 5:
        print(f"    ... and {len(errors) - 5} more errors")

print("\n" + "=" * 100)

# Verify results
from_2026 = StudentEnrollment.objects.filter(academic_year_id=TARGET_YEAR_ID).count()
print(f"Total students in 2026-27 after recovery: {from_2026}")
