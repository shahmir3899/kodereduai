"""
Baseline roster + academic structure for the public demo tenant (subdomain `demo`).

Used when demo.kodereduai.pk school exists but has no classes/students/terms yet.
Then run showcase graphs: `ensure_showcase_graph_data(school.id)` from seed_showcase_graphs.

Does not delete existing non-demo data except resetting `is_current` on academic years for the school.
"""

from __future__ import annotations

from datetime import date

from django.contrib.auth import get_user_model

User = get_user_model()

DEMO_ADMIN_USERNAME = "qaisar"
DEMO_ADMIN_PASSWORD = "Abcd1234"


def resolve_demo_school(*, school_id: int | None = None):
    from schools.models import School

    if school_id is not None:
        try:
            return School.objects.get(pk=school_id)
        except School.DoesNotExist as e:
            raise ValueError(f"No school with id={school_id}") from e
    try:
        return School.objects.get(subdomain__iexact="demo")
    except School.DoesNotExist as e:
        raise ValueError("No school with subdomain 'demo' (expected for demo.kodereduai.pk).") from e


def ensure_demo_portal_baseline(school_id: int | None = None) -> dict:
    """
    Ensure demo tenant has current academic year, two terms, three classes,
    students, minimal HR staff for graphs, and a known admin password.
    """
    from academic_sessions.models import AcademicYear, Term
    from hr.models import StaffDepartment, StaffDesignation, StaffMember
    from schools.models import School, UserSchoolMembership
    from students.models import Class, Student

    school = resolve_demo_school(school_id=school_id)
    sid = school.id
    summary = {"school_id": sid, "academic_years_set_current": 0, "terms": 0, "classes": 0, "students": 0, "staff": 0}

    # --- Academic year (single current) ---
    ay = AcademicYear.objects.filter(school_id=sid).order_by("-start_date").first()
    if not ay:
        ay = AcademicYear.objects.create(
            school=school,
            name="2026-2027",
            start_date=date(2026, 4, 1),
            end_date=date(2027, 3, 31),
            is_current=True,
            is_active=True,
        )
        summary["academic_years_set_current"] = 1
    else:
        AcademicYear.objects.filter(school_id=sid).exclude(pk=ay.pk).update(is_current=False)
        if not ay.is_current:
            ay.is_current = True
            ay.save(update_fields=["is_current"])
            summary["academic_years_set_current"] = 1

    # --- Terms ---
    if not Term.objects.filter(school_id=sid, academic_year=ay).exists():
        Term.objects.create(
            school=school,
            academic_year=ay,
            name="Term 1",
            term_type=Term.TermType.TERM,
            order=1,
            start_date=ay.start_date,
            end_date=date(ay.start_date.year, 9, 30),
            is_current=True,
            is_active=True,
        )
        Term.objects.create(
            school=school,
            academic_year=ay,
            name="Term 2",
            term_type=Term.TermType.TERM,
            order=2,
            start_date=date(ay.start_date.year, 10, 1),
            end_date=ay.end_date,
            is_current=False,
            is_active=True,
        )
        summary["terms"] = 2

    # --- Classes ---
    class_specs = [
        ("Grade 1", "A", 1),
        ("Grade 2", "B", 2),
        ("Grade 3", "C", 3),
    ]
    classes: list[Class] = []
    for name, section, level in class_specs:
        c, created = Class.objects.get_or_create(
            school=school,
            name=name,
            section=section,
            defaults={"grade_level": level, "is_active": True},
        )
        classes.append(c)
        if created:
            summary["classes"] += 1

    # --- Students (4 + 3 + 3 per class) ---
    roll_plan = [
        (classes[0], [("1", "Demo Ali"), ("2", "Demo Sara"), ("3", "Demo Usman"), ("4", "Demo Fatima")]),
        (classes[1], [("1", "Demo Hamza"), ("2", "Demo Ayesha"), ("3", "Demo Bilal")]),
        (classes[2], [("1", "Demo Zara"), ("2", "Demo Omar"), ("3", "Demo Hira")]),
    ]
    for cls, pairs in roll_plan:
        for roll, sname in pairs:
            _, created = Student.objects.get_or_create(
                school=school,
                class_obj=cls,
                roll_number=roll,
                defaults={
                    "name": sname,
                    "is_active": True,
                    "status": Student.Status.ACTIVE,
                    "gender": "",
                },
            )
            if created:
                summary["students"] += 1

    # --- HR: one department + designation + staff (for payslips / timetable teacher) ---
    dept, _ = StaffDepartment.objects.get_or_create(
        school=school,
        name="Academic",
        defaults={"description": "Teaching staff", "is_active": True},
    )
    desig, _ = StaffDesignation.objects.get_or_create(
        school=school,
        name="Teacher",
        defaults={"department": dept, "is_active": True},
    )

    org = school.organization
    for i in range(1, 4):
        uname = f"demoportal{sid}t{i}"
        tu, _ = User.objects.get_or_create(
            username=uname,
            defaults={
                "email": f"{uname}@demo.kodereduai.pk",
                "role": "TEACHER",
                "school": school,
                "organization": org,
            },
        )
        if tu.school_id != sid:
            continue
        tu.set_password(DEMO_ADMIN_PASSWORD)
        tu.save()
        UserSchoolMembership.objects.get_or_create(
            user=tu,
            school=school,
            defaults={"role": "TEACHER", "is_default": True},
        )
        sm, sm_created = StaffMember.objects.get_or_create(
            school=school,
            employee_id=f"DEMOP-{sid}-T{i:03d}",
            defaults={
                "user": tu,
                "first_name": f"DemoTeacher{i}",
                "last_name": "Portal",
                "email": tu.email,
                "department": dept,
                "designation": desig,
                "employment_status": StaffMember.EmploymentStatus.ACTIVE,
                "employment_type": StaffMember.EmploymentType.FULL_TIME,
                "date_of_joining": date(2024, 1, 1),
            },
        )
        if sm_created:
            summary["staff"] += 1

    # --- Admin password (documented demo login) ---
    admin = User.objects.filter(username=DEMO_ADMIN_USERNAME, school_id=sid).first()
    if admin:
        admin.set_password(DEMO_ADMIN_PASSWORD)
        admin.save()

    return summary


__all__ = [
    "DEMO_ADMIN_USERNAME",
    "DEMO_ADMIN_PASSWORD",
    "ensure_demo_portal_baseline",
    "resolve_demo_school",
]
