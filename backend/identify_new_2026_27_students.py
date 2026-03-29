#!/usr/bin/env python
"""
Option B: Identify Branch 2 students admitted in 2026-27 (Playgroup).
These are students who:
  1. Belong to school=Branch 2
  2. Have NO enrollment in 2025-26 (Year 10) — meaning they were newly admitted in 2026-27
  3. Their student record was created in 2026 (after the academic year 2026-27 started)
"""
import os, sys, django
sys.path.insert(0, '.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from students.models import Student
from academic_sessions.models import StudentEnrollment, AcademicYear
from schools.models import School

BRANCH2_SCHOOL_ID = 2
YEAR_2025_26_ID = 10
YEAR_2026_27_ID = 43

branch2 = School.objects.get(id=BRANCH2_SCHOOL_ID)
print(f"School: {branch2.name}")
print("=" * 80)

# All Branch 2 students
all_branch2_students = Student.objects.filter(school=branch2)
print(f"Total students in Branch 2: {all_branch2_students.count()}")

# Students WITH enrollment in 2025-26
enrolled_2025_26 = StudentEnrollment.objects.filter(
    school=branch2,
    academic_year_id=YEAR_2025_26_ID
).values_list('student_id', flat=True)

# Students WITHOUT enrollment in 2025-26
new_students = all_branch2_students.exclude(id__in=enrolled_2025_26)
print(f"Students with NO 2025-26 enrollment (potential new 2026-27 admissions): {new_students.count()}")

print("\nThese students have no 2025-26 enrollment record:")
print("-" * 80)
for s in new_students:
    created_date = s.created_at.strftime('%Y-%m-%d') if hasattr(s, 'created_at') and s.created_at else 'unknown'
    # Check if they have any enrollment at all
    any_enroll = StudentEnrollment.objects.filter(student=s, school=branch2).values(
        'academic_year__name', 'class_obj__name', 'roll_number', 'status', 'academic_year_id'
    )
    enroll_str = ', '.join([f"{e['academic_year__name']} - {e['class_obj__name']} (Roll {e['roll_number']}, {e['status']})" for e in any_enroll]) or 'NO ENROLLMENTS'
    print(f"  ID {s.id:4}: {s.name:30} | Created: {created_date} | Enrollments: {enroll_str}")

print("\n" + "=" * 80)
print("SUMMARY:")
print(f"  These {new_students.count()} students were NOT in 2025-26.")
print(f"  If they were admitted freshly to Playgroup in 2026-27, they are the ones to re-enroll.")
