"""
Rich hypothetical data for demo / graph dashboards.

Run after base school data exists (e.g. seed_test_data.py School Alpha, or
seed_demo_portal.py for the public demo tenant).

Usage:
    python manage.py seed_showcase_graphs --school-id=37
    python manage.py seed_showcase_graphs --school-id=37 --reset

Does not add/remove students or master Class rows — only related rows
(enrollments, attendance, finance, exams, timetable, HR, LMS, calendar,
uploads).

Naming convention: most seeded rows are foundational/idempotent (kept fresh
in place via get_or_create/update_or_create on a stable natural key) and use
plain, presentable names since several tenants use this seeder to populate a
tenant shown to prospects (demo.kodereduai.pk). Only genuinely time-rolling
data — rows keyed off "today" that would otherwise accumulate stale entries
as the anchor date drifts forward (attendance, fee payments, staff
attendance, payslips, attendance uploads) — is tagged via an internal
`notes`/`image_url` marker and cleared by `--reset` before regenerating.
Earlier runs of this seeder used a literal "SHOWCASE_" prefix on some
user-visible names (subject, account, fee category, exam type, leave
policy, calendar entry, session class); `_migrate_legacy_showcase_names`
folds those into clean names in place, once, on every run.
"""

from __future__ import annotations

import hashlib
from calendar import monthrange
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.db import IntegrityError
from django.db.models import Max
from django.utils import timezone as dj_timezone

# Legacy marker, still recognized for one-time cleanup of old rows.
SHOWCASE_PREFIX = "SHOWCASE_"
# Internal marker for rolling/time-windowed rows (attendance, payments, payslips).
# Lives in non-primary-display fields (notes / image_url), not in a name shown
# to users as the "title" of a record.
SHOWCASE_TAG = "__showcase_graph_seed__"


def _clamp_date_to_ay(d: date, ay) -> date:
    if d < ay.start_date:
        return ay.start_date
    if d > ay.end_date:
        return ay.end_date
    return d


def _anchor_today_in_ay(ay) -> date:
    return _clamp_date_to_ay(date.today(), ay)


def _weekday_dates_in_range(start: date, end: date) -> list[date]:
    out = []
    cur = start
    while cur <= end:
        if cur.weekday() < 5:
            out.append(cur)
        cur += timedelta(days=1)
    return out


def _deterministic_present(student_id: int, d: date) -> bool:
    h = hashlib.sha256(f"{student_id}-{d.isoformat()}".encode()).hexdigest()
    return int(h[:4], 16) % 10 < 8  # ~80% present


def _migrate_legacy_showcase_names(school, school_id: int) -> None:
    """
    One-time, idempotent cleanup of earlier seed runs that put a literal
    "SHOWCASE_" prefix on fields that render as visible text in the UI
    (subject/account/fee-category/exam-type/leave-policy/calendar-entry
    names). Safe to call on every run — becomes a no-op once migrated.
    """
    from academic_sessions.models import SchoolCalendarEntry
    from academics.models import ClassSubject, Subject, TimetableEntry, TimetableSlot
    from examinations.models import ExamSubject, ExamType, StudentMark
    from finance.models import Account, FeePayment, MonthlyFeeCategory
    from hr.models import LeavePolicy

    legacy_subject = Subject.objects.filter(
        school_id=school_id, code=f"{SHOWCASE_PREFIX}MATH",
    ).first()
    if legacy_subject:
        legacy_exam_subjects = ExamSubject.objects.filter(
            school_id=school_id, subject=legacy_subject,
        )
        StudentMark.objects.filter(
            school_id=school_id, exam_subject__in=legacy_exam_subjects,
        ).delete()
        legacy_exam_subjects.delete()
        ClassSubject.objects.filter(school_id=school_id, subject=legacy_subject).delete()
        TimetableEntry.objects.filter(school_id=school_id, subject=legacy_subject).delete()
        legacy_subject.delete()

    legacy_cat = MonthlyFeeCategory.objects.filter(
        school_id=school_id, name=f"{SHOWCASE_PREFIX}Tuition",
    ).first()
    if legacy_cat:
        FeePayment.objects.filter(school_id=school_id, monthly_category=legacy_cat).delete()
        legacy_cat.delete()

    ExamType.objects.filter(
        school_id=school_id, name=f"{SHOWCASE_PREFIX}Formative",
    ).update(name="Formative Assessment")
    Account.objects.filter(
        school_id=school_id, name=f"{SHOWCASE_PREFIX}Cash Desk",
    ).update(name="Cash Desk")
    LeavePolicy.objects.filter(
        school_id=school_id, name=f"{SHOWCASE_PREFIX}Casual pool",
    ).update(name="Casual Leave")
    TimetableSlot.objects.filter(
        school_id=school_id, name=f"{SHOWCASE_PREFIX}Period 1",
    ).update(name="Period 1")
    TimetableSlot.objects.filter(
        school_id=school_id, name=f"{SHOWCASE_PREFIX}Period 2",
    ).update(name="Period 2")
    SchoolCalendarEntry.objects.filter(
        school_id=school_id, name=f"{SHOWCASE_PREFIX}Spring break",
    ).update(name="Spring Break")


def reset_showcase_graph_data(school_id: int) -> None:
    """
    Remove rows created by showcase seeding for this school that are
    time-windowed relative to "today" and would otherwise accumulate stale
    entries as the anchor date drifts forward on repeated runs. Foundational
    setup rows (subjects, exam types, grade scales, fee structures, salary
    structures, lesson plans, etc.) are NOT deleted here — they're kept
    fresh in place by get_or_create/update_or_create on a stable key, so
    there's nothing to reset.
    """
    from attendance.models import AttendanceRecord, AttendanceUpload
    from hr.models import LeaveApplication, LeavePolicy, Payslip, StaffAttendance
    from finance.models import FeePayment
    from students.models import Student
    from academic_sessions.models import AcademicYear

    ay = (
        AcademicYear.objects.filter(school_id=school_id, is_current=True)
        .order_by("-start_date")
        .first()
    )
    if not ay:
        ay = AcademicYear.objects.filter(school_id=school_id).order_by("-start_date").first()
    stu_ids = list(
        Student.objects.filter(school_id=school_id, is_active=True).values_list("id", flat=True)
    )

    anchor = _anchor_today_in_ay(ay) if ay else date.today()
    att_start = anchor - timedelta(days=120)
    att_end = anchor

    if ay and stu_ids:
        AttendanceRecord.objects.filter(
            school_id=school_id,
            academic_year_id=ay.id,
            student_id__in=stu_ids,
            source=AttendanceRecord.Source.MANUAL,
            date__gte=att_start,
            date__lte=att_end,
        ).delete()

    FeePayment.objects.filter(school_id=school_id, notes=SHOWCASE_TAG).delete()
    StaffAttendance.objects.filter(school_id=school_id, notes=SHOWCASE_TAG).delete()
    Payslip.objects.filter(school_id=school_id, notes=SHOWCASE_TAG).delete()
    AttendanceUpload.objects.filter(
        school_id=school_id,
        image_url__contains="showcase-graph-seed",
    ).delete()

    pol = LeavePolicy.objects.filter(school_id=school_id, name="Casual Leave").first()
    if pol:
        LeaveApplication.objects.filter(school_id=school_id, leave_policy=pol).delete()


def ensure_showcase_graph_data(school_id: int, *, reset: bool = False) -> dict:
    """
    Create or refresh showcase rows for graphs and admin bootstrap.

    Returns a small summary dict for the management command to print.
    """
    from schools.models import School
    from academic_sessions.models import (
        AcademicYear,
        SchoolCalendarEntry,
        SessionClass,
        StudentEnrollment,
        Term,
    )
    from academic_sessions.calendar_rules import is_off_day_for_date
    from students.models import Class, Student
    from attendance.models import AttendanceRecord, AttendanceUpload
    from academics.models import (
        ClassSubject,
        ClassTeacherAssignment,
        Subject,
        TimetableEntry,
        TimetableSlot,
    )
    from examinations.models import (
        Exam,
        ExamSubject,
        ExamType,
        GradeScale,
        StudentMark,
        StudentTermAssessment,
    )
    from finance.models import (
        Account,
        Discount,
        Expense,
        ExpenseCategory,
        FeePayment,
        FeeStructure,
        FeeType,
        IncomeCategory,
        MonthlyFeeCategory,
        OtherIncome,
        Scholarship,
        StudentDiscount,
    )
    from hr.models import (
        LeaveApplication,
        LeavePolicy,
        Payslip,
        SalaryStructure,
        StaffAttendance,
        StaffDepartment,
        StaffDesignation,
        StaffDocument,
        StaffMember,
        StaffQualification,
    )
    from lms.models import Assignment, AssignmentSubmission, Book, Chapter, LessonPlan, Tag, Topic
    from users.models import User

    school = School.objects.filter(id=school_id).first()
    if not school:
        raise ValueError(f"School id={school_id} not found.")

    if reset:
        reset_showcase_graph_data(school_id)
        school.refresh_from_db()

    _migrate_legacy_showcase_names(school, school_id)

    ay = (
        AcademicYear.objects.filter(school_id=school_id, is_current=True)
        .order_by("-start_date")
        .first()
    )
    if not ay:
        ay = AcademicYear.objects.filter(school_id=school_id).order_by("-start_date").first()
    if not ay:
        raise ValueError(f"No academic year for school id={school_id}.")

    term = Term.objects.filter(school_id=school_id, academic_year=ay).order_by("order").first()
    if not term:
        raise ValueError(f"No term for academic year id={ay.id}.")

    anchor = _anchor_today_in_ay(ay)
    admin_user = User.objects.filter(school_id=school_id, role="SCHOOL_ADMIN").first()

    classes = list(
        Class.objects.filter(school_id=school_id, is_active=True).order_by("grade_level", "name")
    )
    students = list(
        Student.objects.filter(school_id=school_id, is_active=True).order_by(
            "class_obj_id", "roll_number"
        )
    )
    if not classes or not students:
        raise ValueError("School needs at least one class and one active student.")

    staff_members = list(
        StaffMember.objects.filter(school_id=school_id, is_active=True).order_by("id")[:10]
    )
    primary_teacher = staff_members[0] if staff_members else None

    summary = {
        "school_id": school_id,
        "academic_year_id": ay.id,
        "session_classes": 0,
        "enrollments": 0,
        "attendance_records": 0,
        "fee_payments": 0,
        "fee_structures": 0,
        "exams": 0,
        "marks": 0,
        "grade_scales": 0,
        "term_assessments": 0,
        "timetable_entries": 0,
        "class_teacher_assignments": 0,
        "salary_structures": 0,
        "lesson_plans": 0,
        "assignments": 0,
        "assignment_submissions": 0,
        "uploads": 0,
    }

    # --- Session classes + enrollments ---
    session_by_class_id = {}
    for cls in classes:
        clean_display_name = cls.name
        sc = SessionClass.objects.filter(
            school=school, academic_year=ay, class_obj=cls,
        ).first()
        if sc is None:
            try:
                sc = SessionClass.objects.create(
                    school=school,
                    academic_year=ay,
                    class_obj=cls,
                    display_name=clean_display_name,
                    section=cls.section or "",
                    grade_level=cls.grade_level or 0,
                    is_active=True,
                )
                summary["session_classes"] += 1
            except IntegrityError:
                sc = SessionClass.objects.filter(
                    school=school,
                    academic_year=ay,
                    display_name=clean_display_name,
                    section=cls.section or "",
                ).first()
        elif sc.display_name != clean_display_name and not SessionClass.objects.filter(
            school=school, academic_year=ay, display_name=clean_display_name, section=sc.section,
        ).exclude(pk=sc.pk).exists():
            sc.display_name = clean_display_name
            sc.save(update_fields=["display_name"])
        if sc is None:
            raise RuntimeError(
                f"Could not resolve SessionClass for class id={cls.id} after showcase insert."
            )
        session_by_class_id[cls.id] = sc

    for stu in students:
        sc = session_by_class_id.get(stu.class_obj_id)
        if not sc:
            continue
        enr, enr_created = StudentEnrollment.objects.update_or_create(
            school=school,
            student=stu,
            academic_year=ay,
            defaults={
                "session_class": sc,
                "class_obj": stu.class_obj,
                "roll_number": stu.roll_number or "1",
                "status": StudentEnrollment.Status.ACTIVE,
                "is_active": True,
            },
        )
        if enr_created:
            summary["enrollments"] += 1

    # --- Calendar (holidays) ---
    hol1_start = _clamp_date_to_ay(anchor - timedelta(days=45), ay)
    SchoolCalendarEntry.objects.update_or_create(
        school=school,
        academic_year=ay,
        name="Spring Break",
        defaults={
            "entry_kind": SchoolCalendarEntry.EntryKind.OFF_DAY,
            "off_day_type": SchoolCalendarEntry.OffDayType.OTHER,
            "scope": SchoolCalendarEntry.Scope.SCHOOL,
            "start_date": hol1_start,
            "end_date": hol1_start + timedelta(days=2),
            "is_active": True,
        },
    )

    # --- Attendance (manual, weekday, skip school off days) ---
    att_start = _clamp_date_to_ay(anchor - timedelta(days=45), ay)
    attendance_dates = _weekday_dates_in_range(att_start, anchor)
    for d in attendance_dates:
        if is_off_day_for_date(school_id, d):
            continue
        for stu in students:
            present = _deterministic_present(stu.id, d)
            _, created = AttendanceRecord.objects.update_or_create(
                student=stu,
                date=d,
                defaults={
                    "school_id": school_id,
                    "academic_year": ay,
                    "status": (
                        AttendanceRecord.AttendanceStatus.PRESENT
                        if present
                        else AttendanceRecord.AttendanceStatus.ABSENT
                    ),
                    "source": AttendanceRecord.Source.MANUAL,
                    "upload": None,
                },
            )
            if created:
                summary["attendance_records"] += 1

    # --- Academics: real teaching subjects (reuse existing "Mathematics" /
    # "English" subjects if present; create plain-named ones otherwise) ---
    def _resolve_teaching_subjects():
        subs = []
        for name in ("Mathematics", "English"):
            s = Subject.objects.filter(school_id=school_id, name__iexact=name).first()
            if not s:
                s = Subject.objects.create(
                    school=school, name=name, code=name[:4].upper(), is_active=True,
                )
            subs.append(s)
        return subs

    sub_math, sub_english = _resolve_teaching_subjects()
    teaching_subjects = (sub_math, sub_english)

    # --- Finance ---
    acct, _ = Account.objects.get_or_create(
        school=school,
        name="Cash Desk",
        defaults={
            "account_type": Account.AccountType.CASH,
            "opening_balance": Decimal("0"),
            "is_active": True,
        },
    )
    bank_acct, _ = Account.objects.get_or_create(
        school=school,
        name="Bank Account",
        defaults={
            "account_type": Account.AccountType.BANK,
            "opening_balance": Decimal("50000.00"),
            "is_active": True,
        },
    )
    cat = MonthlyFeeCategory.objects.filter(school_id=school_id, name="Tuition Fee").first()
    if not cat:
        cat, _ = MonthlyFeeCategory.objects.get_or_create(
            school=school,
            name="Tuition Fee",
            defaults={"description": "Standard monthly tuition charge", "is_active": True},
        )

    for cls in classes:
        _, fs_created = FeeStructure.objects.get_or_create(
            school=school,
            academic_year=ay,
            class_obj=cls,
            monthly_category=cat,
            fee_type=FeeType.MONTHLY,
            defaults={
                "monthly_amount": Decimal("8500.00"),
                "effective_from": ay.start_date,
                "is_active": True,
            },
        )
        if fs_created:
            summary["fee_structures"] += 1

    ym_pairs = []
    y, m = anchor.year, anchor.month
    for _ in range(5):
        ym_pairs.append((y, m))
        m -= 1
        if m < 1:
            m = 12
            y -= 1

    for year, month in ym_pairs:
        last_d = monthrange(year, month)[1]
        pay_date = date(year, month, min(15, last_d))

        for idx, stu in enumerate(students):
            status_cycle = ("PAID", "PARTIAL", "UNPAID")
            st = status_cycle[idx % 3]
            due = Decimal("8500.00") + Decimal(idx * 50)
            paid = Decimal("0")
            pym_status = FeePayment.PaymentStatus.UNPAID
            if st == "PAID":
                paid = due
                pym_status = FeePayment.PaymentStatus.PAID
            elif st == "PARTIAL":
                paid = (due * Decimal("0.55")).quantize(Decimal("0.01"))
                pym_status = FeePayment.PaymentStatus.PARTIAL

            fp, fp_created = FeePayment.objects.update_or_create(
                school=school,
                student=stu,
                month=month,
                year=year,
                fee_type=FeeType.MONTHLY,
                annual_category=None,
                monthly_category=cat,
                defaults={
                    "academic_year": ay,
                    "amount_due": due,
                    "previous_balance": Decimal("0"),
                    "base_monthly_fee": due,
                    "amount_paid": paid,
                    "status": pym_status,
                    "payment_date": pay_date if paid > 0 else None,
                    "payment_method": FeePayment.PaymentMethod.CASH,
                    "notes": SHOWCASE_TAG,
                    "account": acct if paid > 0 else None,
                },
            )
            if fp_created:
                summary["fee_payments"] += 1

    expense_specs = [
        ("Rent", Decimal("45000.00"), 5, "Monthly building rent"),
        ("Utilities", Decimal("15000.00"), 12, "Electricity and water bill"),
        ("Supplies", Decimal("8000.00"), 20, "Stationery and classroom supplies"),
        ("Maintenance", Decimal("6000.00"), 35, "Facility upkeep and repairs"),
    ]
    for cat_name, amount, day_offset, description in expense_specs:
        exp_cat = ExpenseCategory.objects.filter(school_id=school_id, name=cat_name).first()
        if not exp_cat:
            continue
        exp_date = _clamp_date_to_ay(term.start_date + timedelta(days=day_offset), ay)
        Expense.objects.get_or_create(
            school=school,
            category=exp_cat,
            date=exp_date,
            amount=amount,
            defaults={"description": description, "account": acct, "recorded_by": admin_user},
        )

    income_specs = [
        ("Donation", Decimal("20000.00"), 8, "Community fundraiser donation"),
        ("Event Income", Decimal("12000.00"), 25, "Annual sports day ticket sales"),
    ]
    for cat_name, amount, day_offset, description in income_specs:
        inc_cat = IncomeCategory.objects.filter(school_id=school_id, name=cat_name).first()
        if not inc_cat:
            continue
        inc_date = _clamp_date_to_ay(term.start_date + timedelta(days=day_offset), ay)
        OtherIncome.objects.get_or_create(
            school=school,
            category=inc_cat,
            date=inc_date,
            amount=amount,
            defaults={"description": description, "account": acct, "recorded_by": admin_user},
        )

    discount, _ = Discount.objects.get_or_create(
        school=school,
        name="Sibling Discount",
        defaults={
            "discount_type": "PERCENTAGE",
            "value": Decimal("10.00"),
            "applies_to": "SIBLING",
            "is_active": True,
        },
    )
    scholarship, _ = Scholarship.objects.get_or_create(
        school=school,
        name="Merit Scholarship",
        defaults={
            "scholarship_type": "MERIT",
            "coverage": "PERCENTAGE",
            "value": Decimal("25.00"),
            "is_active": True,
        },
    )
    if students:
        StudentDiscount.objects.get_or_create(
            school=school,
            student=students[0],
            scholarship=scholarship,
            academic_year=ay,
            defaults={"is_active": True, "notes": "Top academic performer"},
        )
    if len(students) > 1:
        StudentDiscount.objects.get_or_create(
            school=school,
            student=students[1],
            discount=discount,
            academic_year=ay,
            defaults={"is_active": True, "notes": "Sibling enrollment"},
        )

    # --- Exams + marks + grading ---
    etype, _ = ExamType.objects.get_or_create(
        school=school,
        name="Formative Assessment",
        defaults={"weight": Decimal("40.00"), "is_active": True},
    )

    for cls in classes:
        exam, ex_created = Exam.objects.update_or_create(
            school=school,
            exam_type=etype,
            class_obj=cls,
            term=term,
            defaults={
                "academic_year": ay,
                "name": f"Cycle Test — {cls.name}",
                "start_date": term.start_date,
                "end_date": term.start_date + timedelta(days=5),
                "status": Exam.Status.PUBLISHED,
                "is_active": True,
            },
        )
        if ex_created:
            summary["exams"] += 1

        class_students = [s for s in students if s.class_obj_id == cls.id]
        for subj_idx, subject in enumerate(teaching_subjects):
            ex_sub, _ = ExamSubject.objects.update_or_create(
                school=school,
                exam=exam,
                subject=subject,
                defaults={
                    "total_marks": Decimal("75"),
                    "passing_marks": Decimal("30"),
                    "exam_date": term.start_date,
                    "is_active": True,
                },
            )

            for stu in class_students:
                enr = StudentEnrollment.objects.filter(
                    school_id=school_id,
                    student=stu,
                    academic_year=ay,
                ).first()
                base = 45 + (stu.id % 25) + (subj_idx * 5)
                marks = Decimal(str(min(base, 74)))
                sm, sm_created = StudentMark.objects.update_or_create(
                    school=school,
                    exam_subject=ex_sub,
                    student=stu,
                    defaults={
                        "marks_obtained": marks,
                        "is_absent": False,
                        "enrollment": enr,
                    },
                )
                if sm_created:
                    summary["marks"] += 1

    grade_scale_specs = [
        ("A", Decimal("90.00"), Decimal("100.00"), Decimal("4.0"), 1),
        ("B", Decimal("80.00"), Decimal("89.99"), Decimal("3.5"), 2),
        ("C", Decimal("70.00"), Decimal("79.99"), Decimal("3.0"), 3),
        ("D", Decimal("60.00"), Decimal("69.99"), Decimal("2.0"), 4),
        ("E", Decimal("50.00"), Decimal("59.99"), Decimal("1.0"), 5),
        ("F", Decimal("0.00"), Decimal("49.99"), Decimal("0.0"), 6),
    ]
    for label, min_pct, max_pct, gpa, order in grade_scale_specs:
        _, gs_created = GradeScale.objects.get_or_create(
            school=school,
            grade_label=label,
            defaults={
                "min_percentage": min_pct,
                "max_percentage": max_pct,
                "gpa_points": gpa,
                "order": order,
                "is_active": True,
            },
        )
        if gs_created:
            summary["grade_scales"] += 1

    rating_cycle = [3, 4, 5, 4, 3]
    for stu in students:
        rating = rating_cycle[stu.id % len(rating_cycle)]
        _, ta_created = StudentTermAssessment.objects.update_or_create(
            school=school,
            student=stu,
            academic_year=ay,
            month=anchor.month,
            defaults={
                "term": term,
                "listening": rating,
                "speaking": rating,
                "writing": max(rating - 1, 1),
                "reading": rating,
                "participation": rating,
                "confidence": max(rating - 1, 1),
                "social_skills": rating,
                "discipline": rating,
                "respect": rating,
                "teamwork": rating,
                "class_participation": rating,
                "responsibility": rating,
                "teacher_remark": f"{stu.name} is making steady progress this term.",
                "principal_remark": "Keep up the good work.",
                "updated_by": admin_user,
            },
        )
        if ta_created:
            summary["term_assessments"] += 1

    # --- Timetable (slots + entries, both subjects) ---
    slot1, _ = TimetableSlot.objects.get_or_create(
        school=school, name="Period 1",
        defaults={
            "order": 1, "slot_type": TimetableSlot.SlotType.PERIOD,
            "start_time": time(8, 0), "end_time": time(8, 45), "is_active": True,
        },
    )
    slot2 = TimetableSlot.objects.filter(school=school, name="Period 2").first()
    if not slot2:
        max_order = (
            TimetableSlot.objects.filter(school_id=school_id).aggregate(m=Max("order"))["m"]
            or 0
        )
        slot2 = TimetableSlot.objects.create(
            school=school,
            name="Period 2",
            order=max_order + 1,
            slot_type=TimetableSlot.SlotType.PERIOD,
            start_time=time(9, 0),
            end_time=time(9, 45),
            is_active=True,
        )

    days = (
        TimetableEntry.Day.MON,
        TimetableEntry.Day.TUE,
        TimetableEntry.Day.WED,
        TimetableEntry.Day.THU,
        TimetableEntry.Day.FRI,
    )
    for cls in classes:
        for day in days:
            for slot in (slot1, slot2):
                te, te_created = TimetableEntry.objects.update_or_create(
                    school=school,
                    class_obj=cls,
                    day=day,
                    slot=slot,
                    defaults={
                        "academic_year": ay,
                        "subject": sub_math if slot == slot1 else sub_english,
                        "teacher": primary_teacher,
                        "room": "",
                    },
                )
                if te_created:
                    summary["timetable_entries"] += 1

        for subject in teaching_subjects:
            ClassSubject.objects.get_or_create(
                school=school,
                academic_year=ay,
                session_class=session_by_class_id[cls.id],
                subject=subject,
                defaults={
                    "class_obj": cls,
                    "teacher": primary_teacher,
                    "periods_per_week": 5,
                    "is_active": True,
                },
            )

        cta, cta_created = ClassTeacherAssignment.objects.get_or_create(
            school=school,
            class_obj=cls,
            defaults={
                "academic_year": ay,
                "session_class": session_by_class_id.get(cls.id),
                "teacher": primary_teacher,
                "is_active": True,
            },
        )
        if cta_created:
            summary["class_teacher_assignments"] += 1

    # --- HR ---
    pol, _ = LeavePolicy.objects.get_or_create(
        school=school,
        name="Casual Leave",
        defaults={
            "leave_type": LeavePolicy.LeaveType.CASUAL,
            "days_allowed": 12,
            "is_active": True,
        },
    )

    if staff_members:
        LeaveApplication.objects.get_or_create(
            school=school,
            staff_member=staff_members[0],
            start_date=anchor - timedelta(days=14),
            end_date=anchor - timedelta(days=12),
            defaults={
                "leave_policy": pol,
                "reason": "Family commitment",
                "status": LeaveApplication.Status.PENDING,
            },
        )
        if len(staff_members) > 1:
            LeaveApplication.objects.get_or_create(
                school=school,
                staff_member=staff_members[1],
                start_date=anchor - timedelta(days=40),
                end_date=anchor - timedelta(days=38),
                defaults={
                    "leave_policy": pol,
                    "reason": "Medical appointment",
                    "status": LeaveApplication.Status.APPROVED,
                    "approved_by": admin_user,
                },
            )

        for sm in staff_members[:5]:
            for d in attendance_dates:
                sta, sta_created = StaffAttendance.objects.update_or_create(
                    school=school,
                    staff_member=sm,
                    date=d,
                    defaults={
                        "status": (
                            StaffAttendance.Status.PRESENT
                            if sm.id % 3 or d.day % 2
                            else StaffAttendance.Status.LATE
                        ),
                        "notes": SHOWCASE_TAG,
                        "marked_by": admin_user,
                    },
                )

        for sm in staff_members:
            net = Decimal("55000.00") + Decimal(sm.id % 5) * Decimal("1200")
            basic = (net * Decimal("0.7")).quantize(Decimal("0.01"))
            allowances = (net * Decimal("0.15")).quantize(Decimal("0.01"))
            deductions = (net * Decimal("0.05")).quantize(Decimal("0.01"))
            _, sal_created = SalaryStructure.objects.get_or_create(
                staff_member=sm,
                school=school,
                is_active=True,
                defaults={
                    "basic_salary": basic,
                    "allowances": {"housing": float(net * Decimal("0.1"))},
                    "deductions": {"tax": float(deductions)},
                    "effective_from": ay.start_date,
                },
            )
            if sal_created:
                summary["salary_structures"] += 1

            Payslip.objects.update_or_create(
                school=school,
                staff_member=sm,
                month=anchor.month,
                year=anchor.year,
                defaults={
                    "basic_salary": basic,
                    "total_allowances": allowances,
                    "total_deductions": deductions,
                    "net_salary": net,
                    "allowances_breakdown": {"housing": float(net * Decimal("0.1"))},
                    "deductions_breakdown": {"tax": float(deductions)},
                    "working_days": 22,
                    "present_days": 20,
                    "status": Payslip.Status.APPROVED,
                    "notes": SHOWCASE_TAG,
                    "generated_by": admin_user,
                },
            )
            prev_month = anchor.month - 1 or 12
            prev_year = anchor.year if anchor.month > 1 else anchor.year - 1
            Payslip.objects.update_or_create(
                school=school,
                staff_member=sm,
                month=prev_month,
                year=prev_year,
                defaults={
                    "basic_salary": basic,
                    "total_allowances": allowances,
                    "total_deductions": deductions,
                    "net_salary": net,
                    "allowances_breakdown": {},
                    "deductions_breakdown": {},
                    "working_days": 22,
                    "present_days": 21,
                    "status": Payslip.Status.DRAFT,
                    "notes": SHOWCASE_TAG,
                    "generated_by": admin_user,
                },
            )

            StaffQualification.objects.get_or_create(
                staff_member=sm,
                school=school,
                qualification_name="B.Ed — Education",
                defaults={
                    "qualification_type": StaffQualification.QualificationType.DEGREE,
                    "institution": "National Teachers College",
                    "year_of_completion": 2020,
                    "grade_or_percentage": "A",
                },
            )
            StaffDocument.objects.get_or_create(
                staff_member=sm,
                school=school,
                document_type=StaffDocument.DocumentType.CONTRACT,
                title="Employment Contract",
                defaults={
                    "file_url": f"https://demo-seed.invalid/staff/{sm.id}/contract.pdf",
                },
            )

    # A non-teaching staff role so department/designation views aren't all "Teacher".
    admin_dept, _ = StaffDepartment.objects.get_or_create(
        school=school,
        name="Administration",
        defaults={"description": "Administrative and finance staff", "is_active": True},
    )
    accountant_desig, _ = StaffDesignation.objects.get_or_create(
        school=school,
        name="Accountant",
        defaults={"department": admin_dept, "is_active": True},
    )
    accountant, acc_created = StaffMember.objects.get_or_create(
        school=school,
        employee_id=f"DEMOP-{school_id}-ACC001",
        defaults={
            "first_name": "Demo",
            "last_name": "Accountant",
            "email": "",
            "department": admin_dept,
            "designation": accountant_desig,
            "employment_status": StaffMember.EmploymentStatus.ACTIVE,
            "employment_type": StaffMember.EmploymentType.FULL_TIME,
            "date_of_joining": date(2024, 6, 1),
        },
    )

    # --- LMS: curriculum books, lesson plans, assignments ---
    def _ensure_curriculum_book(cls, subject):
        book, _ = Book.objects.get_or_create(
            school=school,
            class_obj=cls,
            subject=subject,
            defaults={
                "title": f"{subject.name} — {cls.name}",
                "language": Book.Language.ENGLISH,
                "description": f"Core {subject.name.lower()} curriculum for {cls.name}.",
                "is_active": True,
            },
        )
        chapter_specs = [
            (1, f"Introduction to {subject.name}", ["Getting Started", "Key Concepts"]),
            (2, f"Core {subject.name} Skills", ["Guided Practice", "Review & Assessment"]),
        ]
        topics = []
        for chapter_number, chapter_title, topic_titles in chapter_specs:
            chapter, _ = Chapter.objects.get_or_create(
                book=book,
                chapter_number=chapter_number,
                defaults={"title": chapter_title, "is_active": True},
            )
            for topic_number, topic_title in enumerate(topic_titles, start=1):
                topic, _ = Topic.objects.get_or_create(
                    chapter=chapter,
                    topic_number=topic_number,
                    defaults={"title": topic_title, "is_active": True},
                )
                topics.append(topic)
        return topics

    lesson_specs = [
        ("DRAFT", "FREEFORM", 5, False),
        ("PUBLISHED", "TOPICS", 12, True),
    ]
    for cls in classes:
        for subject in teaching_subjects:
            topics = _ensure_curriculum_book(cls, subject)
            for status, mode, day_offset, use_topics in lesson_specs:
                lesson_date = _clamp_date_to_ay(
                    term.start_date + timedelta(days=day_offset), ay,
                )
                plan, plan_created = LessonPlan.objects.get_or_create(
                    school=school,
                    class_obj=cls,
                    subject=subject,
                    teacher=primary_teacher,
                    lesson_date=lesson_date,
                    defaults={
                        "academic_year": ay,
                        "title": f"{subject.name} Lesson — {cls.name}",
                        "description": (
                            f"Lesson plan covering foundational {subject.name.lower()} "
                            f"skills for {cls.name}."
                        ),
                        "objectives": (
                            f"Students will strengthen core {subject.name.lower()} "
                            "skills through guided practice."
                        ),
                        "duration_minutes": 40,
                        "materials_needed": "Textbook, whiteboard, worksheets",
                        "teaching_methods": "Direct instruction, guided practice, group activity",
                        "content_mode": mode,
                        "status": status,
                        "is_active": True,
                    },
                )
                if plan_created:
                    summary["lesson_plans"] += 1
                    if use_topics and topics:
                        plan.planned_topics.set(topics[:1])
                        plan.compute_display_text()
                        plan.save(update_fields=["display_text"])

    assignment_specs = [
        ("HOMEWORK", 20, 50),
        ("PROJECT", 30, 100),
    ]
    for cls in classes:
        class_students = [s for s in students if s.class_obj_id == cls.id]
        for subject in teaching_subjects:
            for a_type, day_offset, total_marks in assignment_specs:
                due_date = dj_timezone.make_aware(
                    datetime.combine(
                        _clamp_date_to_ay(term.start_date + timedelta(days=day_offset), ay),
                        time(23, 59),
                    ),
                )
                assignment, a_created = Assignment.objects.get_or_create(
                    school=school,
                    class_obj=cls,
                    subject=subject,
                    teacher=primary_teacher,
                    title=f"{subject.name} {a_type.title()} — {cls.name}",
                    defaults={
                        "academic_year": ay,
                        "description": f"{a_type.title()} assignment for {subject.name}.",
                        "instructions": "Complete and submit before the due date.",
                        "assignment_type": a_type,
                        "requires_submission": True,
                        "due_date": due_date,
                        "total_marks": total_marks,
                        "status": Assignment.Status.PUBLISHED,
                        "is_active": True,
                    },
                )
                if a_created:
                    summary["assignments"] += 1
                for idx, stu in enumerate(class_students[:2]):
                    graded = idx == 0
                    _, sub_created = AssignmentSubmission.objects.get_or_create(
                        assignment=assignment,
                        student=stu,
                        defaults={
                            "school": school,
                            "submission_text": f"{stu.name}'s submission for {assignment.title}.",
                            "status": (
                                AssignmentSubmission.Status.GRADED
                                if graded
                                else AssignmentSubmission.Status.SUBMITTED
                            ),
                            "marks_obtained": (
                                Decimal(str(total_marks - 5)) if graded else None
                            ),
                            "feedback": "Good work!" if graded else "",
                        },
                    )
                    if sub_created:
                        summary["assignment_submissions"] += 1

    tag_specs = [
        ("Addition & Subtraction", Tag.TagType.CONCEPT, sub_math),
        ("Problem Solving", Tag.TagType.SKILL, sub_math),
        ("Grammar Basics", Tag.TagType.CONCEPT, sub_english),
        ("Vocabulary Building", Tag.TagType.SKILL, sub_english),
    ]
    for name, tag_type, subject in tag_specs:
        Tag.objects.get_or_create(
            name=name,
            defaults={"tag_type": tag_type, "subject": subject, "school": school},
        )

    # --- Attendance uploads (pipeline KPIs) ---
    statuses = (
        AttendanceUpload.Status.CONFIRMED,
        AttendanceUpload.Status.REVIEW_REQUIRED,
        AttendanceUpload.Status.PROCESSING,
        AttendanceUpload.Status.FAILED,
    )
    for i, cls in enumerate(classes[:3]):
        up_date = _clamp_date_to_ay(anchor - timedelta(days=i + 1), ay)
        up, up_created = AttendanceUpload.objects.get_or_create(
            school=school,
            class_obj=cls,
            date=up_date,
            session_class=None,
            defaults={
                "academic_year": ay,
                "image_url": f"https://showcase-graph-seed.invalid/{school_id}/{cls.id}/{up_date.isoformat()}",
                "status": statuses[i % len(statuses)],
                "created_by": admin_user,
            },
        )
        if up_created:
            summary["uploads"] += 1

    return summary


__all__ = [
    "SHOWCASE_PREFIX",
    "SHOWCASE_TAG",
    "ensure_showcase_graph_data",
    "reset_showcase_graph_data",
]
