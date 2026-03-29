#!/usr/bin/env python
"""Restore 19 Playgroup students to Branch 2 Academic Year 2026-27."""
import os, sys, django
sys.path.insert(0, '.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db import transaction
from students.models import Student, Class
from academic_sessions.models import StudentEnrollment, AcademicYear
from schools.models import School

BRANCH2_SCHOOL_ID = 2
YEAR_2026_27_ID = 43
YEAR_2025_26_ID = 10

branch2 = School.objects.get(id=BRANCH2_SCHOOL_ID)
year = AcademicYear.objects.get(id=YEAR_2026_27_ID)

# Playgroup class for Branch 2
playgroup = Class.objects.filter(school=branch2, name__icontains='Playgroup').first()
if not playgroup:
    print("ERROR: Playgroup class not found for Branch 2")
    sys.exit(1)

print(f"School: {branch2.name}")
print(f"Year:   {year.name} (ID {year.id})")
print(f"Class:  {playgroup.name} (ID {playgroup.id})")
print("=" * 70)

# Get the 19 students
enrolled_2025_26 = StudentEnrollment.objects.filter(
    school=branch2, academic_year_id=YEAR_2025_26_ID
).values_list('student_id', flat=True)

students_to_restore = Student.objects.filter(
    school=branch2
).exclude(id__in=enrolled_2025_26).order_by('id')

print(f"\nStudents to restore: {students_to_restore.count()}")

with transaction.atomic():
    created = 0
    for roll_num, student in enumerate(students_to_restore, start=1):
        enrollment = StudentEnrollment.objects.create(
            school=branch2,
            student=student,
            academic_year=year,
            class_obj=playgroup,
            roll_number=str(roll_num),
            status='ACTIVE',
            is_active=True
        )
        print(f"  ✓ Restored: {student.name} (Roll {roll_num})")
        created += 1

print(f"\n{'='*70}")
print(f"✅ Restored {created} Playgroup enrollments in 2026-27 for Branch 2")

# Verify
final_count = StudentEnrollment.objects.filter(
    academic_year_id=YEAR_2026_27_ID,
    school=branch2,
    class_obj=playgroup
).count()
print(f"Verified: {final_count} Playgroup students now active in 2026-27")
