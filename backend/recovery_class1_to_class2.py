#!/usr/bin/env python
"""Recovery: Create Class 1 → Class 2 enrollments for 44 PROMOTED students."""
import os, sys, django
sys.path.insert(0, '.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db import transaction
from academic_sessions.models import StudentEnrollment
from students.models import Class

SOURCE_YEAR = 11
TARGET_YEAR = 43

print("Recovery: Class 1 PROMOTED students → Class 2 (2026-27)")
print("=" * 80)

# Get all Class 1 PROMOTED students
class1_promoted = StudentEnrollment.objects.filter(
    academic_year_id=SOURCE_YEAR,
    class_obj__name='Class 1',
    status='PROMOTED'
).select_related('student', 'class_obj', 'school')

print(f"Found {class1_promoted.count()} Class 1 PROMOTED students\n")

# Find Class 2 in the same school as the promoted students
first_promoted = class1_promoted.first()
if not first_promoted:
    print("No Class 1 PROMOTED students found")
    sys.exit(1)

school = first_promoted.school

# Get Class 2 (any section will do)
class2 = Class.objects.filter(
    name='Class 2',
    school=school
).first()

if not class2:
    print(f"ERROR: Class 2 not found in school {school.name}")
    sys.exit(1)

created = 0
already_exists = 0
errors_list = []

with transaction.atomic():
    for enroll in class1_promoted:
        # Check if already exists in 2026-27
        exists = StudentEnrollment.objects.filter(
            student=enroll.student,
            academic_year_id=TARGET_YEAR
        ).exists()
        
        if exists:
            already_exists += 1
            print(f"  SKIP: {enroll.student.name} - already in 2026-27")
            continue
        
        # Create enrollment
        try:
            StudentEnrollment.objects.create(
                school=enroll.school,
                student=enroll.student,
                academic_year_id=TARGET_YEAR,
                class_obj=class2,
                roll_number=enroll.roll_number,
                status='ACTIVE'
            )
            created += 1
        except Exception as e:
            errors_list.append(f"{enroll.student.name}: {str(e)}")

print(f"\nRESULTS:")
print(f"  Created: {created} new Class 2 enrollments")
print(f"  Already Existed: {already_exists}")
print(f"  Errors: {len(errors_list)}")

if errors_list:
    for err in errors_list[:5]:
        print(f"    {err}")

# Check final count
total_2026 = StudentEnrollment.objects.filter(academic_year_id=TARGET_YEAR).count()
print(f"\nFinal total in 2026-27: {total_2026} enrollments")
