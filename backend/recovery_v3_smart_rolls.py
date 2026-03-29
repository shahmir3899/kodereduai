#!/usr/bin/env python
"""Recovery v3: Assign new roll numbers when moving students."""
import os, sys, django
sys.path.insert(0, '.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db import transaction
from academic_sessions.models import StudentEnrollment
from students.models import Class

SOURCE_YEAR = 11
TARGET_YEAR = 43

print("Recovery v3: Class 1 → Class 2 with intelligent roll reassignment")
print("=" * 80)

# Get promoted Class 1 students
class1_promoted = StudentEnrollment.objects.filter(
    academic_year_id=SOURCE_YEAR,
    class_obj__name='Class 1',
    status='PROMOTED'
).select_related('student', 'class_obj', 'school')

print(f"Found {class1_promoted.count()} Class 1 PROMOTED students\n")

first_promoted = class1_promoted.first()
if not first_promoted:
    print("No students found")
    sys.exit(1)

school = first_promoted.school
class2 = Class.objects.filter(name='Class 2', school=school).first()

if not class2:
    print(f"ERROR: Class 2 not found in {school.name}")
    sys.exit(1)

created = 0
skipped = 0
errors_list = []

with transaction.atomic():
    # Get highest roll number currently in Class 2
    max_roll = StudentEnrollment.objects.filter(
        academic_year_id=TARGET_YEAR,
        class_obj=class2
    ).values_list('roll_number', flat=True)
    
    # Convert to integers if possible
    max_num = 0
    for roll in max_roll:
        try:
            num = int(roll)
            max_num = max(max_num, num)
        except:
            pass
    
    next_roll = max_num + 1
    
    for enroll in class1_promoted:
        # Check if student already in ANY class in 2026-27
        existing = StudentEnrollment.objects.filter(
            student=enroll.student,
            academic_year_id=TARGET_YEAR
        ).first()
        
        if existing:
            skipped += 1
            continue
        
        try:
            StudentEnrollment.objects.create(
                school=school,
                student=enroll.student,
                academic_year_id=TARGET_YEAR,
                class_obj=class2,
                roll_number=str(next_roll),
                status='ACTIVE'
            )
            created += 1
            next_roll += 1
        except Exception as e:
            errors_list.append(f"{enroll.student.name}: {str(e)}")

print(f"\nRESULTS:")
print(f"  Created: {created} new enrollments")
print(f"  Skipped (already in 2026-27): {skipped}")
if errors_list:
    print(f"  Errors: {len(errors_list)}")

# Verify
total_2026 = StudentEnrollment.objects.filter(academic_year_id=TARGET_YEAR).count()
class2_2026 = StudentEnrollment.objects.filter(
    academic_year_id=TARGET_YEAR,
    class_obj=class2
).count()

print(f"\nAfter recovery:")
print(f"  Total enrollments in 2026-27: {total_2026}")
print(f"  Students in Class 2: {class2_2026}")
