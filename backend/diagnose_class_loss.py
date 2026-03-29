#!/usr/bin/env python
"""Diagnose why Class 1 and Class 3 show 0 students and if recoverable."""
import os
import sys
import django
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from schools.models import School
from students.models import Student, Class
from academic_sessions.models import StudentEnrollment, AcademicYear
from django.db.models import Count


def class_key(name, section):
    sec = (section or '').strip()
    return f"{name} ({sec})" if sec else name


def print_school_report(school_id):
    school = School.objects.get(id=school_id)
    print("=" * 100)
    print(f"SCHOOL {school.id}: {school.name}")
    print("=" * 100)

    # 1) Current class distribution from Student table (what class management UI often shows)
    print("\n1) CURRENT Student.class_obj distribution")
    current_counts = (
        Student.objects.filter(school=school)
        .values('class_obj__id', 'class_obj__name', 'class_obj__section')
        .annotate(count=Count('id'))
        .order_by('class_obj__grade_level', 'class_obj__name', 'class_obj__section')
    )

    current_map = {}
    total_students = 0
    for row in current_counts:
        key = class_key(row['class_obj__name'], row['class_obj__section'])
        current_map[row['class_obj__id']] = row['count']
        total_students += row['count']
        print(f"  - {key:20} : {row['count']:3}")
    print(f"  TOTAL students: {total_students}")

    # 2) Session enrollment snapshots
    print("\n2) Enrollment snapshots by academic year")
    years = AcademicYear.objects.filter(school=school).order_by('id')
    for y in years:
        enroll_qs = StudentEnrollment.objects.filter(school=school, academic_year=y)
        print(f"\n  Year ID {y.id} ({y.name}) -> {enroll_qs.count()} enrollments")
        by_class = (
            enroll_qs.values('class_obj__name', 'class_obj__section')
            .annotate(count=Count('id'))
            .order_by('class_obj__name', 'class_obj__section')
        )
        for row in by_class:
            key = class_key(row['class_obj__name'], row['class_obj__section'])
            print(f"    {key:20} : {row['count']:3}")

    # 3) Recoverability check from most recent non-empty prior year
    print("\n3) Recoverability analysis")
    non_empty_years = [
        y for y in years
        if StudentEnrollment.objects.filter(school=school, academic_year=y).exists()
    ]
    if not non_empty_years:
        print("  No enrollment history found -> cannot auto-recover from snapshots.")
        return

    source_year = non_empty_years[-1]
    source_enroll = StudentEnrollment.objects.filter(school=school, academic_year=source_year)
    print(f"  Source snapshot chosen: Year ID {source_year.id} ({source_year.name})")
    print(f"  Source enrollments available: {source_enroll.count()}")

    # students whose current class differs from source-year class
    mismatch = []
    for e in source_enroll.select_related('student', 'class_obj'):
        s = e.student
        if s.class_obj_id != e.class_obj_id:
            mismatch.append((s.id, s.name, s.class_obj.name if s.class_obj else 'None', e.class_obj.name, e.class_obj.section or ''))

    print(f"  Students with current class != source snapshot class: {len(mismatch)}")
    for item in mismatch[:15]:
        sid, name, now_cls, src_cls, src_sec = item
        src_display = f"{src_cls} ({src_sec})" if src_sec else src_cls
        print(f"    ID {sid}: {name} | current={now_cls} | source={src_display}")
    if len(mismatch) > 15:
        print(f"    ... and {len(mismatch) - 15} more")


if __name__ == '__main__':
    # Branch 1 and Branch 2
    for sid in [1, 2]:
        print_school_report(sid)
        print("\n")
