#!/usr/bin/env python
"""Cross-check admissions for Branch 2 with identified students."""
import os, sys, django
sys.path.insert(0, '.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from admissions.models import AdmissionEnquiry
from students.models import Student
from schools.models import School

BRANCH2_SCHOOL_ID = 2
branch2 = School.objects.get(id=BRANCH2_SCHOOL_ID)

print(f"School: {branch2.name}")
print("=" * 90)

# Check admissions/enquiries for Branch 2 created in 2026
print("\n--- Admissions/Enquiries in Branch 2 (created in 2026) ---")
enquiries = AdmissionEnquiry.objects.filter(
    school=branch2,
    created_at__year=2026
).order_by('created_at').select_related('converted_student')

print(f"Total 2026 enquiries: {enquiries.count()}\n")
for e in enquiries:
    student_info = f"→ Student ID {e.converted_student.id}: {e.converted_student.name}" if e.converted_student else "(not converted)"
    print(f"  [{e.created_at.strftime('%Y-%m-%d')}] {e.name} {student_info}")

# Also show the 19 identified students again
print("\n--- 19 identified DB students (no 2025-26 enrollment) ---")
from academic_sessions.models import StudentEnrollment
enrolled_2025_26 = StudentEnrollment.objects.filter(
    school=branch2, academic_year_id=10
).values_list('student_id', flat=True)

new_students = Student.objects.filter(school=branch2).exclude(id__in=enrolled_2025_26).order_by('id')
print(f"Count: {new_students.count()}\n")
for s in new_students:
    print(f"  ID {s.id:4}: {s.name:35} | Created: {s.created_at.strftime('%Y-%m-%d')}")
