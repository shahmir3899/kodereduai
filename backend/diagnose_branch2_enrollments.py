#!/usr/bin/env python
"""
Diagnose enrollment data discrepancy for Branch 2 (The Focus Montessori).

Checks:
  1. Find the school ID for Branch 2
  2. List all Class objects for that school (detect duplicates)
  3. Enrollment count per class per academic year
  4. Students with class_obj set but NO enrollment in 2026-27  (finance vs portal gap)
  5. Students enrolled in 2026-27 Junior 1 with NO 2025-26 enrollment (ghost PG)
  6. PromotionEvent trace for ghost PG students
  7. FeePayment records for students missing 2026-27 enrollment (confirms finance gap)
"""
import os
import sys
import django

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db.models import Count, Q
from schools.models import School
from students.models import Class, Student
from academic_sessions.models import AcademicYear, StudentEnrollment, PromotionEvent
from finance.models import FeePayment

SEP = "=" * 70
SEP2 = "-" * 70

# ---------------------------------------------------------------------------
# CHECK 1 — Find school
# ---------------------------------------------------------------------------
print(SEP)
print("CHECK 1 — Find 'Branch 2' school")
print(SEP)

schools = School.objects.filter(
    Q(name__icontains='Focus') | Q(name__icontains='Branch')
).order_by('id')

if not schools.exists():
    print("  No schools found with 'Focus' or 'Branch' in name.")
    print("  All schools:")
    for s in School.objects.all().order_by('id'):
        print(f"    ID {s.id}: {s.name}")
else:
    for s in schools:
        print(f"  ID {s.id}: {s.name}")

school_id = None
for s in schools:
    if 'branch 2' in s.name.lower() or 'branch2' in s.name.lower():
        school_id = s.id
        break

# Fallback: pick by input
if school_id is None and schools.count() == 1:
    school_id = schools.first().id

if school_id is None:
    print("\n  Could not auto-detect Branch 2 school ID.")
    print("  Enter the school ID from the list above and re-run with SCHOOL_ID env var.")
    env_id = os.environ.get('SCHOOL_ID')
    if env_id:
        school_id = int(env_id)
        print(f"  Using SCHOOL_ID={school_id} from environment.")
    else:
        sys.exit(1)

school = School.objects.get(id=school_id)
print(f"\n>>> Using School ID={school_id}: {school.name}")

# ---------------------------------------------------------------------------
# Find academic years for this school
# ---------------------------------------------------------------------------
print()
print(SEP)
print("Academic Years for this school")
print(SEP)

years = AcademicYear.objects.filter(school_id=school_id).order_by('start_date')
year_2025 = None
year_2026 = None

for y in years:
    is_current = " [CURRENT]" if y.is_current else ""
    total_enr = StudentEnrollment.objects.filter(school_id=school_id, academic_year=y).count()
    print(f"  ID {y.id}: {y.name}{is_current}  |  {total_enr} enrollment rows")
    if '2025' in y.name and '26' in y.name:
        year_2025 = y
    if '2026' in y.name and '27' in y.name:
        year_2026 = y

if not year_2025:
    print("\n  WARNING: Could not find 2025-26 year by name.")
if not year_2026:
    print("\n  WARNING: Could not find 2026-27 year by name.")

# ---------------------------------------------------------------------------
# CHECK 2 — All Class objects for this school
# ---------------------------------------------------------------------------
print()
print(SEP)
print("CHECK 2 — All Class objects for this school (look for duplicates)")
print(SEP)

all_classes = Class.objects.filter(school_id=school_id).order_by('grade_level', 'name', 'section', 'id')

print(f"  {'ID':<6} {'Name':<20} {'Section':<10} {'GL':<5} {'Active':<8} "
      f"{'Students(class_obj)':<22} {'Enrollments 2026-27'}")
print(SEP2)

name_count = {}
for cls in all_classes:
    name_count[cls.name] = name_count.get(cls.name, 0) + 1

for cls in all_classes:
    student_count = Student.objects.filter(school_id=school_id, class_obj=cls, is_active=True).count()
    enr_2026 = (
        StudentEnrollment.objects.filter(school_id=school_id, class_obj=cls, academic_year=year_2026).count()
        if year_2026 else 'N/A'
    )
    dup_marker = " <<< DUPLICATE NAME" if name_count[cls.name] > 1 else ""
    inactive_marker = " [INACTIVE]" if not cls.is_active else ""
    print(f"  {cls.id:<6} {cls.name:<20} {cls.section or '':<10} {cls.grade_level:<5} "
          f"{'Yes' if cls.is_active else 'No':<8} {student_count:<22} {enr_2026}{dup_marker}{inactive_marker}")

# ---------------------------------------------------------------------------
# CHECK 3 — Enrollment count per class, per year
# ---------------------------------------------------------------------------
def print_enrollment_breakdown(year, label):
    if not year:
        print(f"  Year not found for {label}.")
        return

    print()
    print(f"  {label} (Year ID={year.id})")
    print(SEP2)
    rows = (
        StudentEnrollment.objects
        .filter(school_id=school_id, academic_year=year)
        .values('class_obj__name', 'class_obj__section', 'class_obj_id', 'status')
        .annotate(count=Count('id'))
        .order_by('class_obj__name', 'class_obj__section', 'status')
    )
    if not rows.exists():
        print("  *** NO ENROLLMENT ROWS FOUND ***")
        return

    total = 0
    for r in rows:
        name = r['class_obj__name'] or '(no class)'
        sec = f" - {r['class_obj__section']}" if r['class_obj__section'] else ''
        cid = r['class_obj_id']
        status = r['status']
        count = r['count']
        total += count
        print(f"    Class {name}{sec} (ID={cid})  status={status:<12}  {count} rows")
    print(f"  TOTAL: {total} enrollment rows")


print()
print(SEP)
print("CHECK 3 — Enrollment breakdown per class and status")
print(SEP)

print_enrollment_breakdown(year_2025, "2025-26")
print_enrollment_breakdown(year_2026, "2026-27")

# ---------------------------------------------------------------------------
# CHECK 4 — Students with class_obj but NO 2026-27 enrollment
# ---------------------------------------------------------------------------
print()
print(SEP)
print("CHECK 4 — Students with class_obj set but NO active enrollment in 2026-27")
print("          (Finance sees them, Students portal does not)")
print(SEP)

if year_2026:
    enrolled_ids_2026 = set(
        StudentEnrollment.objects.filter(school_id=school_id, academic_year=year_2026)
        .values_list('student_id', flat=True)
    )
    all_active_students = Student.objects.filter(
        school_id=school_id,
        is_active=True,
    ).select_related('class_obj').order_by('class_obj__name', 'roll_number')

    missing = [s for s in all_active_students if s.id not in enrolled_ids_2026]

    print(f"  Active students with NO 2026-27 enrollment: {len(missing)}")
    if missing:
        print()
        print(f"  {'ID':<8} {'Name':<30} {'Roll':<8} {'class_obj (current)':<25} {'Admission Date'}")
        print(SEP2)
        by_class = {}
        for s in missing:
            cname = s.class_obj.name if s.class_obj else '(none)'
            by_class.setdefault(cname, []).append(s)

        for cname in sorted(by_class.keys()):
            print(f"\n  --- {cname} ({len(by_class[cname])} students) ---")
            for s in by_class[cname]:
                adm = s.admission_date.strftime('%Y-%m-%d') if s.admission_date else 'N/A'
                print(f"  {s.id:<8} {s.name:<30} {s.roll_number:<8} {cname:<25} {adm}")
else:
    print("  2026-27 year not found, skipping.")

# ---------------------------------------------------------------------------
# CHECK 5 — Students in 2026-27 Junior 1 with NO 2025-26 enrollment (ghost PG)
# ---------------------------------------------------------------------------
print()
print(SEP)
print("CHECK 5 — Students in 2026-27 Junior 1 (or Playgroup) with NO 2025-26 enrollment")
print("          (These are the 2025-26 Playgroup students whose past enrollment is missing)")
print(SEP)

if year_2025 and year_2026:
    enrolled_ids_2025 = set(
        StudentEnrollment.objects.filter(school_id=school_id, academic_year=year_2025)
        .values_list('student_id', flat=True)
    )

    # Find Junior 1 and Playgroup classes
    early_classes = Class.objects.filter(
        school_id=school_id,
        name__iregex=r'(junior\s*1|playgroup|play\s*group|nursery|pre-?k)',
    )
    early_class_ids = list(early_classes.values_list('id', flat=True))

    if not early_class_ids:
        # Fallback: use grade_level <= 1 classes if name matching fails
        early_classes = Class.objects.filter(school_id=school_id, grade_level__lte=1)
        early_class_ids = list(early_classes.values_list('id', flat=True))

    print(f"  Checking these classes (earliest grade levels): "
          f"{list(early_classes.values('id', 'name', 'grade_level'))}")

    # Students enrolled in 2026-27 in those classes who have no 2025-26 enrollment
    enr_2026_early = StudentEnrollment.objects.filter(
        school_id=school_id,
        academic_year=year_2026,
        class_obj_id__in=early_class_ids,
    ).select_related('student', 'class_obj')

    ghost_pg = [e for e in enr_2026_early if e.student_id not in enrolled_ids_2025]
    print(f"\n  Students in Junior 1/PG for 2026-27 with NO 2025-26 enrollment: {len(ghost_pg)}")

    if ghost_pg:
        print(f"\n  {'Student ID':<12} {'Name':<30} {'Roll':<8} {'Class 2026-27':<20} {'Adm Date'}")
        print(SEP2)
        for e in ghost_pg:
            adm = e.student.admission_date.strftime('%Y-%m-%d') if e.student.admission_date else 'N/A'
            print(f"  {e.student_id:<12} {e.student.name:<30} {e.roll_number:<8} {e.class_obj.name:<20} {adm}")

    # Also check students with NO any enrollment at all in 2025-26 but active in school
    all_active_ids = set(Student.objects.filter(school_id=school_id, is_active=True).values_list('id', flat=True))
    completely_missing_2025 = all_active_ids - enrolled_ids_2025
    print(f"\n  Total active students with zero 2025-26 enrollment: {len(completely_missing_2025)}")
else:
    print("  One or both years not found, skipping.")

# ---------------------------------------------------------------------------
# CHECK 6 — PromotionEvent trace for ghost PG students
# ---------------------------------------------------------------------------
print()
print(SEP)
print("CHECK 6 — PromotionEvent records for students with no 2025-26 enrollment")
print("          (Were they promoted via the system? Or were enrollments bypassed?)")
print(SEP)

if year_2025 and year_2026:
    promo_events = PromotionEvent.objects.filter(
        school_id=school_id,
        source_academic_year=year_2025,
        target_academic_year=year_2026,
    ).select_related('student').order_by('event_type')

    print(f"  Total PromotionEvent rows (2025-26 → 2026-27): {promo_events.count()}")

    by_type = {}
    for e in promo_events:
        by_type.setdefault(e.event_type, []).append(e)

    for etype, events in sorted(by_type.items()):
        print(f"\n  event_type={etype}: {len(events)} events")
        for e in events[:5]:
            pname = e.student.name if e.student else f'student_id={e.student_id}'
            print(f"    student_id={e.student_id} ({pname})  "
                  f"source_class={e.source_class_id} → target_class={e.target_class_id}  "
                  f"old_status={e.old_status} → new_status={e.new_status}")
        if len(events) > 5:
            print(f"    ... and {len(events)-5} more")

    if promo_events.count() == 0:
        print("\n  *** NO promotion events found for this transition.")
        print("  *** This confirms enrollments were NOT created through the promotion page.")
        print("  *** They were likely set via direct Student.class_obj updates (bulk import / manual admin).")
else:
    print("  Years not found, skipping.")

# ---------------------------------------------------------------------------
# CHECK 7 — FeePayment records for students missing 2026-27 enrollment
# ---------------------------------------------------------------------------
print()
print(SEP)
print("CHECK 7 — FeePayment records belonging to students with no 2026-27 enrollment")
print("          (Confirms Finance shows them; portal/enrollment does not)")
print(SEP)

if year_2026:
    enrolled_ids_2026_ = set(
        StudentEnrollment.objects.filter(school_id=school_id, academic_year=year_2026)
        .values_list('student_id', flat=True)
    )

    fee_for_missing = (
        FeePayment.objects
        .filter(school_id=school_id, academic_year=year_2026)
        .exclude(student_id__in=enrolled_ids_2026_)
        .filter(student__isnull=False)
        .select_related('student', 'student__class_obj')
        .order_by('student__class_obj__name', 'student__roll_number')
    )

    unique_missing_students = {}
    for fp in fee_for_missing:
        sid = fp.student_id
        if sid not in unique_missing_students:
            unique_missing_students[sid] = {
                'name': fp.student.name,
                'class': fp.student.class_obj.name if fp.student.class_obj else '(none)',
                'roll': fp.student.roll_number,
                'fee_record_count': 0,
            }
        unique_missing_students[sid]['fee_record_count'] += 1

    print(f"  Students with 2026-27 FeePayment records but NO enrollment: {len(unique_missing_students)}")

    if unique_missing_students:
        print()
        print(f"  {'Student ID':<12} {'Name':<30} {'Class':<20} {'Roll':<8} {'Fee Records'}")
        print(SEP2)
        by_class = {}
        for sid, info in unique_missing_students.items():
            by_class.setdefault(info['class'], []).append((sid, info))

        for cname in sorted(by_class.keys()):
            print(f"\n  --- {cname} ---")
            for sid, info in by_class[cname]:
                print(f"  {sid:<12} {info['name']:<30} {info['class']:<20} {info['roll']:<8} {info['fee_record_count']}")

        print()
        print(SEP2)
        print("  Detailed fee rows for students missing 2026-27 enrollment")
        print(SEP2)

        detailed_rows = (
            FeePayment.objects
            .filter(school_id=school_id, academic_year=year_2026)
            .exclude(student_id__in=enrolled_ids_2026_)
            .filter(student__isnull=False)
            .select_related('student', 'student__class_obj')
            .order_by('student__class_obj__name', 'student__roll_number', 'year', 'month', 'fee_type', 'id')
        )

        current_student_id = None
        for fee in detailed_rows:
            if fee.student_id != current_student_id:
                current_student_id = fee.student_id
                print()
                print(
                    f"  Student {fee.student_id}: {fee.student.name} | "
                    f"Roll {fee.student.roll_number} | Class {fee.student.class_obj.name}"
                )
            outstanding = (fee.previous_balance + fee.amount_due) - fee.amount_paid
            print(
                f"    FeePayment #{fee.id}: fee_type={fee.fee_type}, "
                f"month={fee.month}, year={fee.year}, status={fee.status}, "
                f"previous_balance={fee.previous_balance}, amount_due={fee.amount_due}, "
                f"amount_paid={fee.amount_paid}, outstanding={outstanding}"
            )
else:
    print("  2026-27 year not found, skipping.")

# ---------------------------------------------------------------------------
# SUMMARY
# ---------------------------------------------------------------------------
print()
print(SEP)
print("SUMMARY")
print(SEP)
print(f"  School: {school.name} (ID={school_id})")

if year_2025:
    c2025 = StudentEnrollment.objects.filter(school_id=school_id, academic_year=year_2025).count()
    print(f"  2025-26 (ID={year_2025.id}): {c2025} enrollment rows")
if year_2026:
    c2026 = StudentEnrollment.objects.filter(school_id=school_id, academic_year=year_2026).count()
    active_students = Student.objects.filter(school_id=school_id, is_active=True).count()
    print(f"  2026-27 (ID={year_2026.id}): {c2026} enrollment rows  |  {active_students} active students in Student table")
    gap = active_students - c2026
    if gap > 0:
        print(f"  GAP: {gap} students have no 2026-27 enrollment (they appear in Finance but not the portal)")

dup_names = [name for name, cnt in name_count.items() if cnt > 1]
if dup_names:
    print(f"\n  Duplicate class names found: {dup_names}")
    print("  These cause Finance to show the same class twice in fee summaries.")
else:
    print("\n  No duplicate class names found.")

print()
print("  Next steps:")
print("  1. Review the output above to confirm root causes.")
print("  2. Run fix_branch2_enrollments.py (to be written) to create missing enrollments.")
print("  3. Merge/deactivate duplicate Class objects if found.")
print(SEP)
