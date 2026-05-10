"""
Rich hypothetical data for demo / graph dashboards.

Run after base school data exists (e.g. seed_test_data.py School Alpha).

Usage:
    python manage.py seed_showcase_graphs --school-id=37
    python manage.py seed_showcase_graphs --school-id=37 --reset

Does not add/remove students or master Class rows — only related rows
(enrollments, attendance, finance, exams, timetable, HR, calendar, uploads).
"""

from __future__ import annotations

import hashlib
from calendar import monthrange
from datetime import date, time, timedelta
from decimal import Decimal

from django.db import IntegrityError
from django.db.models import Max

# Markers for idempotent cleanup
SHOWCASE_PREFIX = "SHOWCASE_"
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


def reset_showcase_graph_data(school_id: int) -> None:
    """Remove rows created by showcase seeding for this school."""
    from attendance.models import AttendanceRecord, AttendanceUpload
    from academic_sessions.models import AcademicYear, SchoolCalendarEntry, SessionClass, StudentEnrollment
    from academics.models import ClassSubject, Subject, TimetableEntry, TimetableSlot
    from examinations.models import Exam, ExamGroup, ExamSubject, ExamType, StudentMark
    from finance.models import Account, FeePayment, MonthlyFeeCategory
    from hr.models import LeaveApplication, LeavePolicy, Payslip, StaffAttendance
    from students.models import Student

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

    StudentMark.objects.filter(
        school_id=school_id,
        exam_subject__exam__name__startswith=SHOWCASE_PREFIX,
    ).delete()
    ExamSubject.objects.filter(
        school_id=school_id,
        exam__name__startswith=SHOWCASE_PREFIX,
    ).delete()
    Exam.objects.filter(school_id=school_id, name__startswith=SHOWCASE_PREFIX).delete()
    ExamGroup.objects.filter(school_id=school_id, name__startswith=SHOWCASE_PREFIX).delete()
    ExamType.objects.filter(school_id=school_id, name__startswith=SHOWCASE_PREFIX).delete()

    TimetableEntry.objects.filter(
        school_id=school_id,
        subject__code__startswith=SHOWCASE_PREFIX,
    ).delete()
    ClassSubject.objects.filter(
        school_id=school_id,
        subject__code__startswith=SHOWCASE_PREFIX,
    ).delete()
    Subject.objects.filter(school_id=school_id, code__startswith=SHOWCASE_PREFIX).delete()

    TimetableSlot.objects.filter(school_id=school_id, name__startswith=SHOWCASE_PREFIX).delete()

    FeePayment.objects.filter(school_id=school_id, notes=SHOWCASE_TAG).delete()
    MonthlyFeeCategory.objects.filter(
        school_id=school_id,
        name__startswith=SHOWCASE_PREFIX,
    ).delete()
    Account.objects.filter(school_id=school_id, name__startswith=SHOWCASE_PREFIX).delete()

    StaffAttendance.objects.filter(school_id=school_id, notes=SHOWCASE_TAG).delete()
    LeaveApplication.objects.filter(
        school_id=school_id,
        reason__startswith="[SHOWCASE]",
    ).delete()
    LeavePolicy.objects.filter(school_id=school_id, name__startswith=SHOWCASE_PREFIX).delete()
    Payslip.objects.filter(school_id=school_id, notes=SHOWCASE_TAG).delete()

    SchoolCalendarEntry.objects.filter(
        school_id=school_id,
        name__startswith=SHOWCASE_PREFIX,
    ).delete()

    AttendanceUpload.objects.filter(
        school_id=school_id,
        image_url__contains="showcase-graph-seed",
    ).delete()

    if ay and stu_ids:
        AttendanceRecord.objects.filter(
            school_id=school_id,
            academic_year_id=ay.id,
            student_id__in=stu_ids,
            source=AttendanceRecord.Source.MANUAL,
            date__gte=att_start,
            date__lte=att_end,
        ).delete()

    StudentEnrollment.objects.filter(
        school_id=school_id,
        session_class__display_name__startswith=SHOWCASE_PREFIX,
    ).delete()
    SessionClass.objects.filter(
        school_id=school_id,
        display_name__startswith=SHOWCASE_PREFIX,
    ).delete()


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
    from academics.models import ClassSubject, Subject, TimetableEntry, TimetableSlot
    from examinations.models import Exam, ExamSubject, ExamType, StudentMark
    from finance.models import Account, FeePayment, FeeType, MonthlyFeeCategory
    from hr.models import (
        LeaveApplication,
        LeavePolicy,
        Payslip,
        StaffAttendance,
        StaffMember,
    )
    from users.models import User

    school = School.objects.filter(id=school_id).first()
    if not school:
        raise ValueError(f"School id={school_id} not found.")

    if reset:
        reset_showcase_graph_data(school_id)
        school.refresh_from_db()

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
        "exams": 0,
        "marks": 0,
        "timetable_entries": 0,
        "uploads": 0,
    }

    # --- Session classes + enrollments ---
    session_by_class_id = {}
    for cls in classes:
        sc = SessionClass.objects.filter(
            school=school,
            academic_year=ay,
            class_obj=cls,
            display_name__startswith=SHOWCASE_PREFIX,
        ).first()
        if sc is None:
            try:
                sc = SessionClass.objects.create(
                    school=school,
                    academic_year=ay,
                    class_obj=cls,
                    display_name=f"{SHOWCASE_PREFIX}{cls.name}",
                    section=cls.section or "",
                    grade_level=cls.grade_level or 0,
                    is_active=True,
                )
                summary["session_classes"] += 1
            except IntegrityError:
                sc = SessionClass.objects.filter(
                    school=school,
                    academic_year=ay,
                    display_name=f"{SHOWCASE_PREFIX}{cls.name}",
                    section=cls.section or "",
                ).first()
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
        name=f"{SHOWCASE_PREFIX}Spring break",
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
    dates = _weekday_dates_in_range(att_start, anchor)
    for d in dates:
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

    # --- Finance ---
    acct, _ = Account.objects.get_or_create(
        school=school,
        name=f"{SHOWCASE_PREFIX}Cash Desk",
        defaults={
            "account_type": Account.AccountType.CASH,
            "opening_balance": Decimal("0"),
            "is_active": True,
        },
    )
    cat, _ = MonthlyFeeCategory.objects.get_or_create(
        school=school,
        name=f"{SHOWCASE_PREFIX}Tuition",
        defaults={"description": "Demo tuition", "is_active": True},
    )

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

    # --- Subjects + exams + marks ---
    sub_math, _ = Subject.objects.get_or_create(
        school=school,
        code=f"{SHOWCASE_PREFIX}MATH",
        defaults={
            "name": f"{SHOWCASE_PREFIX}Mathematics",
            "is_elective": False,
            "is_active": True,
        },
    )
    etype, _ = ExamType.objects.get_or_create(
        school=school,
        name=f"{SHOWCASE_PREFIX}Formative",
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
                "name": f"{SHOWCASE_PREFIX}Cycle Test — {cls.name}",
                "start_date": term.start_date,
                "end_date": term.start_date + timedelta(days=5),
                "status": Exam.Status.COMPLETED,
                "is_active": True,
            },
        )
        if ex_created:
            summary["exams"] += 1

        ex_sub, _ = ExamSubject.objects.update_or_create(
            school=school,
            exam=exam,
            subject=sub_math,
            defaults={
                "total_marks": Decimal("75"),
                "passing_marks": Decimal("30"),
                "exam_date": term.start_date,
                "is_active": True,
            },
        )

        for stu in students:
            if stu.class_obj_id != cls.id:
                continue
            enr = StudentEnrollment.objects.filter(
                school_id=school_id,
                student=stu,
                academic_year=ay,
            ).first()
            base = 45 + (stu.id % 25)
            marks = Decimal(str(base))
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

    # --- Timetable (slots + entries) ---
    slot1 = TimetableSlot.objects.filter(
        school=school, name=f"{SHOWCASE_PREFIX}Period 1"
    ).first()
    if not slot1:
        max_order = (
            TimetableSlot.objects.filter(school_id=school_id).aggregate(m=Max("order"))["m"]
            or 0
        )
        slot1 = TimetableSlot.objects.create(
            school=school,
            name=f"{SHOWCASE_PREFIX}Period 1",
            order=max_order + 1,
            slot_type=TimetableSlot.SlotType.PERIOD,
            start_time=time(8, 0),
            end_time=time(8, 45),
            is_active=True,
        )
    slot2 = TimetableSlot.objects.filter(
        school=school, name=f"{SHOWCASE_PREFIX}Period 2"
    ).first()
    if not slot2:
        max_order = (
            TimetableSlot.objects.filter(school_id=school_id).aggregate(m=Max("order"))["m"]
            or 0
        )
        slot2 = TimetableSlot.objects.create(
            school=school,
            name=f"{SHOWCASE_PREFIX}Period 2",
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
                te, te_created = TimetableEntry.objects.get_or_create(
                    school=school,
                    class_obj=cls,
                    day=day,
                    slot=slot,
                    defaults={
                        "academic_year": ay,
                        "subject": sub_math if slot == slot1 else None,
                        "teacher": primary_teacher,
                        "room": "",
                    },
                )
                if te_created:
                    summary["timetable_entries"] += 1

        ClassSubject.objects.get_or_create(
            school=school,
            academic_year=ay,
            session_class=session_by_class_id[cls.id],
            subject=sub_math,
            defaults={
                "class_obj": cls,
                "teacher": primary_teacher,
                "periods_per_week": 5,
                "is_active": True,
            },
        )

    # --- HR ---
    pol, _ = LeavePolicy.objects.get_or_create(
        school=school,
        name=f"{SHOWCASE_PREFIX}Casual pool",
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
                "reason": "[SHOWCASE] Family commitment",
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
                    "reason": "[SHOWCASE] Medical appointment",
                    "status": LeaveApplication.Status.APPROVED,
                    "approved_by": admin_user,
                },
            )

        staff_days = [anchor - timedelta(days=i) for i in range(1, 15) if i % 2 == 1]
        for sm in staff_members[:5]:
            for d in staff_days:
                if d.weekday() >= 5:
                    continue
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
                if sta_created:
                    pass

        prev_month = anchor.month - 1 or 12
        prev_year = anchor.year if anchor.month > 1 else anchor.year - 1
        for sm in staff_members:
            net = Decimal("55000.00") + Decimal(sm.id % 5) * Decimal("1200")
            Payslip.objects.update_or_create(
                school=school,
                staff_member=sm,
                month=anchor.month,
                year=anchor.year,
                defaults={
                    "basic_salary": net * Decimal("0.7"),
                    "total_allowances": net * Decimal("0.15"),
                    "total_deductions": net * Decimal("0.05"),
                    "net_salary": net,
                    "allowances_breakdown": {"housing": float(net * Decimal("0.1"))},
                    "deductions_breakdown": {"tax": float(net * Decimal("0.05"))},
                    "working_days": 22,
                    "present_days": 20,
                    "status": Payslip.Status.APPROVED,
                    "notes": SHOWCASE_TAG,
                    "generated_by": admin_user,
                },
            )
            Payslip.objects.update_or_create(
                school=school,
                staff_member=sm,
                month=prev_month,
                year=prev_year,
                defaults={
                    "basic_salary": net * Decimal("0.7"),
                    "total_allowances": net * Decimal("0.15"),
                    "total_deductions": net * Decimal("0.05"),
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
