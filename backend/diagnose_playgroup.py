#!/usr/bin/env python
"""Full diagnosis: Playgroup students in 2026-27 for both schools."""
import os, sys, django
sys.path.insert(0, '.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from academic_sessions.models import StudentEnrollment, AcademicYear
from schools.models import School

print("=" * 90)
print("DIAGNOSIS: Playgroup students in Academic Year 2026-27")
print("=" * 90)

# Find both schools
schools = School.objects.filter(name__icontains='Focus').order_by('id')
print("\nAll Focus schools found:")
for s in schools:
    print(f"  ID {s.id}: {s.name}")

print("\n" + "=" * 90)

# Check each school's 2026-27 academic years and Playgroup students
for school in schools:
    print(f"\n--- {school.name} (ID {school.id}) ---")
    
    years_2026_27 = AcademicYear.objects.filter(school=school, name__icontains='2026-27')
    if not years_2026_27.exists():
        print("  No 2026-27 academic year found!")
        continue
    
    for year in years_2026_27:
        print(f"  Academic Year: {year.name} (ID {year.id})")
        
        # All enrollments in this year
        total = StudentEnrollment.objects.filter(academic_year=year).count()
        print(f"  Total enrollments: {total}")
        
        # Playgroup specifically
        playgroup = StudentEnrollment.objects.filter(
            academic_year=year,
            class_obj__name__icontains='Playgroup'
        )
        print(f"  Playgroup students: {playgroup.count()}")
        
        if playgroup.count() > 0:
            for e in playgroup[:5]:
                print(f"    - {e.student.name} (Roll {e.roll_number}, Status: {e.status})")
            if playgroup.count() > 5:
                print(f"    ... and {playgroup.count() - 5} more")
        
        # All classes breakdown
        if total > 0:
            print(f"  Classes breakdown:")
            for row in StudentEnrollment.objects.filter(academic_year=year).values(
                'class_obj__name'
            ).annotate(
                count=__import__('django.db.models', fromlist=['Count']).Count('id')
            ).order_by('class_obj__name'):
                print(f"    {row['class_obj__name']}: {row['count']}")

print("\n" + "=" * 90)
print("RECOVERY CLUE: Checking if Branch 2 Playgroup students exist in any year...")
branch2 = School.objects.filter(name__icontains='Branch 2').first()
if branch2:
    playgroup_any_year = StudentEnrollment.objects.filter(
        school=branch2,
        class_obj__name__icontains='Playgroup'
    ).select_related('academic_year', 'student')
    
    print(f"\nBranch 2 Playgroup students across ALL years: {playgroup_any_year.count()}")
    for e in playgroup_any_year:
        print(f"  {e.student.name} | Year: {e.academic_year.name} (ID {e.academic_year.id}) | Status: {e.status}")
