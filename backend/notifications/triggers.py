"""
Notification trigger functions.
Called by other modules to fire notifications through the engine.
"""

import logging
from django.db.models import Q
from django.utils import timezone
from notifications.recipients import (
    get_admin_users,
    get_parent_users_for_student,
    get_school_membership_users,
    get_student_user,
)

logger = logging.getLogger(__name__)


def _daily_notification_already_sent(
    *,
    school,
    event_type,
    channel,
    recipient_user,
    title,
    body,
    target_date,
    student=None,
):
    """Return True when the same daily notification already exists for a recipient."""
    from .models import NotificationLog

    filters = {
        'school': school,
        'event_type': event_type,
        'channel': channel,
        'recipient_user': recipient_user,
        'title': title,
        'body': body,
        'created_at__date': target_date,
        'status__in': ['PENDING', 'SCHEDULED', 'SENT', 'DELIVERED', 'READ'],
    }
    if student is not None:
        filters['student'] = student
    return NotificationLog.objects.filter(**filters).exists()


def _monthly_notification_already_sent(
    *,
    school,
    event_type,
    channel,
    recipient_user,
    title,
    body,
    month,
    year,
    student=None,
):
    """Return True when the same monthly notification already exists for a recipient."""
    from .models import NotificationLog

    filters = {
        'school': school,
        'event_type': event_type,
        'channel': channel,
        'recipient_user': recipient_user,
        'title': title,
        'body': body,
        'created_at__month': month,
        'created_at__year': year,
        'status__in': ['PENDING', 'SCHEDULED', 'SENT', 'DELIVERED', 'READ'],
    }
    if student is not None:
        filters['student'] = student
    return NotificationLog.objects.filter(**filters).exists()


def _notification_already_sent(
    *,
    school,
    event_type,
    channel,
    recipient_user,
    title,
    body,
    student=None,
):
    """Return True when the same notification already exists for a recipient."""
    from .models import NotificationLog

    filters = {
        'school': school,
        'event_type': event_type,
        'channel': channel,
        'recipient_user': recipient_user,
        'title': title,
        'body': body,
        'status__in': ['PENDING', 'SCHEDULED', 'SENT', 'DELIVERED', 'READ'],
    }
    if student is not None:
        filters['student'] = student
    return NotificationLog.objects.filter(**filters).exists()


def _get_config(school):
    """Get school notification config, returns None if not configured."""
    from .models import SchoolNotificationConfig
    try:
        return SchoolNotificationConfig.objects.get(school=school)
    except SchoolNotificationConfig.DoesNotExist:
        return None


def trigger_absence_notification(attendance_record):
    """
    Send in-app absence notification when a student is marked absent.

    Recipients (if profiles/accounts exist):
    - SCHOOL_ADMIN and PRINCIPAL users
    - Class teacher user for the student's class
    - Linked parent profile users for the student
    - Linked student profile user

    Args:
        attendance_record: AttendanceRecord instance (status=ABSENT)
    """
    from .engine import NotificationEngine
    from .models import NotificationLog
    from academics.models import ClassTeacherAssignment

    student = attendance_record.student
    school = attendance_record.school

    config = _get_config(school)
    if config and not config.absence_notification_enabled:
        logger.info(f"Absence notifications disabled for {school.name}, skipping")
        return None

    engine = NotificationEngine(school)

    context = {
        'student_name': student.name,
        'class_name': student.class_obj.name,
        'date': attendance_record.date.strftime('%d %B %Y') if attendance_record.date else '',
        'school_name': school.name,
        'roll_number': student.roll_number,
    }

    title = f"Absence: {student.name} ({student.class_obj.name})"
    body = f"{student.name} was marked absent on {context['date']}"

    # Build recipient set with explicit recipient type per user ID.
    recipient_types_by_user_id = {}

    # 1) Admin recipients (includes principals).
    for user in _get_admin_users(school):
        if user:
            recipient_types_by_user_id[user.id] = 'ADMIN'

    # 2) Class teacher recipients for this class and relevant academic year.
    teacher_assignments = ClassTeacherAssignment.objects.filter(
        school=school,
        class_obj=student.class_obj,
        is_active=True,
    ).select_related('teacher__user')
    if attendance_record.academic_year_id:
        teacher_assignments = teacher_assignments.filter(
            Q(academic_year_id=attendance_record.academic_year_id) |
            Q(academic_year__isnull=True)
        )
    else:
        teacher_assignments = teacher_assignments.filter(
            Q(academic_year__is_current=True) |
            Q(academic_year__isnull=True)
        )
    for assignment in teacher_assignments:
        teacher_user = getattr(getattr(assignment, 'teacher', None), 'user', None)
        if teacher_user:
            recipient_types_by_user_id.setdefault(teacher_user.id, 'STAFF')

    # 3) Parent recipients linked to this student.
    for parent_user in get_parent_users_for_student(student):
        recipient_types_by_user_id.setdefault(parent_user.id, 'PARENT')

    # 4) Student recipient if student profile exists.
    student_user = get_student_user(student)
    if student_user:
        # Reuse PARENT recipient_type for family/student audience in current enum.
        recipient_types_by_user_id.setdefault(student_user.id, 'PARENT')

    if not recipient_types_by_user_id:
        return None

    users_by_id = {}
    for user in _get_admin_users(school):
        if user:
            users_by_id[user.id] = user
    for assignment in teacher_assignments:
        teacher_user = getattr(getattr(assignment, 'teacher', None), 'user', None)
        if teacher_user:
            users_by_id[teacher_user.id] = teacher_user
    for parent_user in get_parent_users_for_student(student):
        users_by_id[parent_user.id] = parent_user
    if student_user:
        users_by_id[student_user.id] = student_user

    # Idempotency guard: each recipient gets exactly one in-app notification
    # for this student/date message regardless of repeated attendance saves.
    sent_any = False
    for user_id, recipient_type in recipient_types_by_user_id.items():
        recipient_user = users_by_id.get(user_id)
        if not recipient_user:
            continue
        already_sent = NotificationLog.objects.filter(
            school=school,
            event_type='ABSENCE',
            channel='IN_APP',
            student=student,
            recipient_user=recipient_user,
            title=title,
            body=body,
        ).exists()
        if already_sent:
            continue
        engine.send(
            event_type='ABSENCE',
            channel='IN_APP',
            context=context,
            recipient_identifier=str(recipient_user.id),
            recipient_type=recipient_type,
            recipient_user=recipient_user,
            student=student,
            title=title,
            body=body,
        )
        sent_any = True

    return True if sent_any else None


def trigger_fee_reminder(school, month, year):
    """
    Send fee reminders to parents of students with unpaid fees.

    Args:
        school: School instance
        month: Month number (1-12)
        year: Year (e.g. 2025)
    """
    config = _get_config(school)
    if config and not config.fee_reminder_enabled:
        logger.info(f"Fee reminders disabled for {school.name}, skipping")
        return 0

    from finance.models import FeePayment
    from .engine import NotificationEngine

    engine = NotificationEngine(school)

    unpaid = FeePayment.objects.filter(
        school=school,
        month=month,
        year=year,
        status__in=['PENDING', 'PARTIAL'],
    ).select_related('student', 'student__class_obj')

    sent = 0
    for payment in unpaid:
        student = payment.student
        if not student.parent_phone:
            continue

        context = {
            'student_name': student.name,
            'class_name': student.class_obj.name,
            'month': timezone.datetime(year, month, 1).strftime('%B %Y'),
            'amount_due': str(payment.amount_due),
            'amount_paid': str(payment.amount_paid),
            'school_name': school.name,
        }

        engine.send(
            event_type='FEE_DUE',
            channel='WHATSAPP',
            context=context,
            recipient_identifier=student.parent_phone,
            recipient_type='PARENT',
            student=student,
        )
        sent += 1

    logger.info(f"Fee reminders sent: {sent} for {school.name} ({month}/{year})")
    return sent


def trigger_fee_overdue(school, month, year):
    """
    Send overdue fee alerts for payments not received after the due period.
    """
    config = _get_config(school)
    if config and not config.fee_overdue_enabled:
        logger.info(f"Fee overdue alerts disabled for {school.name}, skipping")
        return 0

    from finance.models import FeePayment
    from .engine import NotificationEngine

    engine = NotificationEngine(school)

    overdue = FeePayment.objects.filter(
        school=school,
        month=month,
        year=year,
        status='PENDING',
        amount_paid=0,
    ).select_related('student', 'student__class_obj')

    sent = 0
    for payment in overdue:
        student = payment.student
        if not student.parent_phone:
            continue

        context = {
            'student_name': student.name,
            'class_name': student.class_obj.name,
            'month': timezone.datetime(year, month, 1).strftime('%B %Y'),
            'amount_due': str(payment.amount_due),
            'school_name': school.name,
        }

        engine.send(
            event_type='FEE_OVERDUE',
            channel='WHATSAPP',
            context=context,
            recipient_identifier=student.parent_phone,
            recipient_type='PARENT',
            student=student,
        )
        sent += 1

    logger.info(f"Fee overdue alerts sent: {sent} for {school.name} ({month}/{year})")
    return sent


def trigger_exam_result(student, exam):
    """
    Notify parent when exam results are published.
    """
    from .engine import NotificationEngine

    school = student.school

    config = _get_config(school)
    if config and not config.exam_result_enabled:
        logger.info(f"Exam result notifications disabled for {school.name}, skipping")
        return None

    if not student.parent_phone:
        return None

    engine = NotificationEngine(school)

    context = {
        'student_name': student.name,
        'class_name': student.class_obj.name,
        'exam_name': exam.name if hasattr(exam, 'name') else str(exam),
        'school_name': school.name,
    }

    return engine.send(
        event_type='EXAM_RESULT',
        channel='WHATSAPP',
        context=context,
        recipient_identifier=student.parent_phone,
        recipient_type='PARENT',
        student=student,
    )


def trigger_general(school, title, body, recipient_users=None):
    """
    Send a general announcement to staff/admins.

    Args:
        school: School instance
        title: Notification title
        body: Notification body
        recipient_users: List of User objects (defaults to all admins)
    """
    from schools.models import UserSchoolMembership
    from .engine import NotificationEngine

    engine = NotificationEngine(school)

    if recipient_users is None:
        recipient_users = get_school_membership_users(
            school,
            roles=[
                UserSchoolMembership.Role.SCHOOL_ADMIN,
                UserSchoolMembership.Role.PRINCIPAL,
                UserSchoolMembership.Role.TEACHER,
            ],
        )

    sent = 0
    for user in recipient_users:
        recipient_type = 'ADMIN' if user.role in {'SCHOOL_ADMIN', 'PRINCIPAL'} else 'STAFF'
        engine.send(
            event_type='GENERAL',
            channel='IN_APP',
            context={},
            recipient_identifier=str(user.id),
            recipient_type=recipient_type,
            recipient_user=user,
            title=title,
            body=body,
        )
        sent += 1

    return sent


def _get_admin_users(school):
    """Backward-compatible local wrapper for admin recipient resolution."""
    return get_admin_users(school)


def trigger_class_teacher_attendance_pending(school, target_date=None):
    """
    Notify class teachers at/after 11:00 if student attendance is still not marked.

    Conditions:
    1) Day is NOT an OFF day for that class
    2) Teacher is marked PRESENT for that date
    3) No student attendance record exists for that class/date
    """
    from django.db.models import Q
    from academic_sessions.calendar_rules import is_off_day_for_date
    from academics.models import ClassTeacherAssignment
    from attendance.models import AttendanceRecord
    from hr.models import StaffAttendance
    from students.models import Student
    from .engine import NotificationEngine
    from .models import NotificationLog

    local_now = timezone.localtime()
    target_date = target_date or local_now.date()

    config = _get_config(school)
    if config and not config.class_teacher_attendance_reminder_enabled:
        return 0

    # Guard to avoid early execution if task is manually invoked before 11:00.
    if local_now.hour < 11 and target_date == local_now.date():
        return 0

    engine = NotificationEngine(school)
    assignments = (
        ClassTeacherAssignment.objects
        .filter(
            school=school,
            is_active=True,
        )
        .filter(Q(academic_year__isnull=True) | Q(academic_year__is_current=True))
        .select_related('teacher', 'teacher__user', 'class_obj', 'session_class')
    )

    sent = 0
    for assignment in assignments:
        teacher = assignment.teacher
        teacher_user = getattr(teacher, 'user', None)
        if not teacher_user:
            continue

        class_obj = assignment.class_obj
        if not class_obj:
            continue

        if is_off_day_for_date(school.id, target_date, class_id=class_obj.id):
            continue

        is_teacher_present = StaffAttendance.objects.filter(
            school=school,
            staff_member=teacher,
            date=target_date,
            status=StaffAttendance.Status.PRESENT,
        ).exists()
        if not is_teacher_present:
            continue

        students_qs = Student.objects.filter(
            school=school,
            is_active=True,
        )
        attendance_qs = AttendanceRecord.objects.filter(
            school=school,
            date=target_date,
        )

        if assignment.academic_year_id:
            students_qs = students_qs.filter(
                enrollments__academic_year_id=assignment.academic_year_id,
                enrollments__class_obj_id=class_obj.id,
                enrollments__is_active=True,
            ).distinct()
            attendance_qs = attendance_qs.filter(
                student__enrollments__academic_year_id=assignment.academic_year_id,
                student__enrollments__class_obj_id=class_obj.id,
                student__enrollments__is_active=True,
            ).distinct()
        else:
            students_qs = students_qs.filter(class_obj=class_obj)
            attendance_qs = attendance_qs.filter(student__class_obj=class_obj)

        if not students_qs.exists():
            continue
        if attendance_qs.exists():
            continue

        class_label = class_obj.name
        if assignment.session_class and assignment.session_class.section:
            class_label = f"{class_obj.name} - {assignment.session_class.section}"

        full_name = teacher.full_name
        title = f"Attendance Reminder - {class_label}"
        body = f"Dear {full_name}, you are class teacher of class {class_label}, Please mark attendance"

        already_sent = NotificationLog.objects.filter(
            school=school,
            channel='IN_APP',
            event_type='GENERAL',
            recipient_user=teacher_user,
            title=title,
            body=body,
            created_at__date=target_date,
        ).exists()
        if already_sent:
            continue

        engine.send(
            event_type='GENERAL',
            channel='IN_APP',
            context={},
            recipient_identifier=str(teacher_user.id),
            recipient_type='STAFF',
            recipient_user=teacher_user,
            title=title,
            body=body,
        )
        sent += 1

    logger.info(
        f"Class-teacher attendance reminders sent: {sent} for {school.name} on {target_date}"
    )
    return sent


def trigger_class_teacher_fee_pending(school, month, year):
    """
    Send a consolidated fee-pending notification to each class teacher.

    Each teacher receives ONE in-app notification listing all students in
    their class who still have unpaid/partial fees for the given month/year.
    Teachers with no pending students receive nothing.

    Args:
        school: School instance
        month: int (1-12)
        year:  int
    """
    config = _get_config(school)
    if config and not getattr(config, 'class_teacher_fee_reminder_enabled', True):
        logger.info(f"Class-teacher fee reminders disabled for {school.name}, skipping")
        return 0

    from finance.models import FeePayment
    from academics.models import ClassTeacherAssignment
    from .engine import NotificationEngine

    engine = NotificationEngine(school)

    month_label = timezone.datetime(year, month, 1).strftime('%B %Y')

    # Build teacher → class_obj mapping from ClassTeacherAssignment
    assignments = (
        ClassTeacherAssignment.objects
        .filter(school=school, is_active=True)
        .select_related('teacher__user', 'class_obj')
    )

    sent = 0
    for assignment in assignments:
        teacher = assignment.teacher
        if not teacher or not teacher.user_id:
            continue  # no user account for this teacher

        class_obj = assignment.class_obj

        # Find unpaid/partial fees for students in this class
        pending_payments = (
            FeePayment.objects
            .filter(
                school=school,
                month=month,
                year=year,
                status__in=['PENDING', 'PARTIAL'],
                student__class_obj=class_obj,
                student__is_active=True,
            )
            .select_related('student')
            .order_by('student__name')
        )

        if not pending_payments.exists():
            continue

        # Build consolidated student list
        lines = []
        teacher_user = teacher.user
        greeting_name = (
            teacher_user.get_full_name().strip()
            or teacher_user.first_name
            or teacher_user.username
            or 'Teacher'
        )
        idx = 1
        for payment in pending_payments:
            balance = float(payment.amount_due) - float(payment.amount_paid)
            lines.append(f"{idx}. {payment.student.name} ({balance:,.0f})")
            idx += 1

        body = (
            f"Dear {greeting_name}, following fee are still pending:\n"
            + "\n".join(lines)
        )
        title = f"Fee Pending — {class_obj.name} ({month_label})"

        try:
            if _notification_already_sent(
                school=school,
                event_type='FEE_DUE',
                channel='IN_APP',
                recipient_user=teacher_user,
                title=title,
                body=body,
            ):
                logger.info(
                    "Skipped class-teacher fee reminder",
                    extra={'reason_code': 'skipped_due_to_dedupe', 'teacher_user_id': teacher_user.id},
                )
                continue

            engine.send(
                event_type='FEE_DUE',
                channel='IN_APP',
                context={},
                recipient_identifier=str(teacher_user.id),
                recipient_type='STAFF',
                recipient_user=teacher_user,
                title=title,
                body=body,
            )
            sent += 1
        except Exception as e:
            logger.error(f"Class-teacher fee reminder failed for teacher {teacher.id}: {e}")

    logger.info(f"Class-teacher fee reminders sent: {sent} teachers for {school.name} ({month}/{year})")
    return sent


def trigger_lesson_plan_published(lesson_plan):
    """
    Notify all active students in the lesson plan's class when a lesson plan
    is published. Uses IN_APP channel targeting student User accounts.

    Args:
        lesson_plan: LessonPlan instance (status=PUBLISHED)
    """
    config = _get_config(lesson_plan.school)
    if config and not getattr(config, 'lesson_plan_notification_enabled', True):
        logger.info(f"Lesson plan notifications disabled for {lesson_plan.school.name}, skipping")
        return 0

    from students.models import Student
    from .engine import NotificationEngine

    engine = NotificationEngine(lesson_plan.school)

    subject_name = lesson_plan.subject.name if lesson_plan.subject else 'a subject'
    date_label = lesson_plan.lesson_date.strftime('%d %B %Y') if lesson_plan.lesson_date else ''

    title = f"New Lesson Plan: {lesson_plan.title}"
    body = (
        f"A new {subject_name} lesson plan has been published"
        + (f" for {date_label}" if date_label else "")
        + "."
    )
    if lesson_plan.objectives:
        body += f"\n\nObjectives: {lesson_plan.objectives[:200]}"

    students = (
        Student.objects
        .filter(
            class_obj=lesson_plan.class_obj,
            school=lesson_plan.school,
            is_active=True,
        )
        .select_related('user_profile__user')
    )

    sent = 0
    target_date = timezone.localdate()
    for student in students:
        # Only notify students with a linked StudentProfile user account.
        student_user = get_student_user(student)
        if not student_user:
            continue
        try:
            if _daily_notification_already_sent(
                school=lesson_plan.school,
                event_type='GENERAL',
                channel='IN_APP',
                recipient_user=student_user,
                student=student,
                title=title,
                body=body,
                target_date=target_date,
            ):
                logger.info(
                    "Skipped lesson plan notification",
                    extra={'reason_code': 'skipped_due_to_dedupe', 'student_id': student.id},
                )
                continue

            engine.send(
                event_type='GENERAL',
                channel='IN_APP',
                context={},
                recipient_identifier=str(student_user.id),
                recipient_type='PARENT',
                recipient_user=student_user,
                student=student,
                title=title,
                body=body,
            )
            sent += 1
        except Exception as e:
            logger.error(f"Lesson plan notification failed for student {student.id}: {e}")

    logger.info(
        f"Lesson plan '{lesson_plan.title}' notifications sent: {sent} students "
        f"in {lesson_plan.class_obj.name} for {lesson_plan.school.name}"
    )
    return sent


def trigger_daily_school_report(school, date):
    """
    Build and send a comprehensive daily school report to all SCHOOL_ADMIN
    and PRINCIPAL users.  Covers:
      - Student attendance (present / absent / rate)
      - Lesson plans submitted today (published + draft)
      - Current-month pending fee count
      - Teachers on approved leave today

    Args:
        school: School instance
        date:   datetime.date — the report date (usually today)
    """
    config = _get_config(school)
    if config and not getattr(config, 'daily_report_enabled', True):
        logger.info(f"Daily report disabled for {school.name}, skipping")
        return 0

    from .engine import NotificationEngine
    from attendance.models import AttendanceRecord
    from lms.models import LessonPlan

    engine = NotificationEngine(school)

    # --- Student attendance ---
    present = AttendanceRecord.objects.filter(school=school, date=date, status='PRESENT').count()
    absent = AttendanceRecord.objects.filter(school=school, date=date, status='ABSENT').count()
    total_att = present + absent
    att_rate = round(present / total_att * 100, 1) if total_att else 0

    # --- Lesson plans ---
    published_plans = LessonPlan.objects.filter(
        school=school, lesson_date=date, status='PUBLISHED', is_active=True,
    ).count()
    draft_plans = LessonPlan.objects.filter(
        school=school, lesson_date=date, status='DRAFT', is_active=True,
    ).count()

    # --- Pending fees (current month) ---
    try:
        from finance.models import FeePayment
        pending_fees = FeePayment.objects.filter(
            school=school,
            month=date.month,
            year=date.year,
            status__in=['PENDING', 'PARTIAL'],
        ).values('student_id').distinct().count()
    except Exception:
        pending_fees = None

    # --- Teachers on leave today ---
    try:
        from hr.models import LeaveApplication
        teachers_on_leave = LeaveApplication.objects.filter(
            school=school,
            status='APPROVED',
            start_date__lte=date,
            end_date__gte=date,
        ).count()
    except Exception:
        teachers_on_leave = None

    # --- Build report body ---
    date_label = date.strftime('%d %B %Y')
    lines = [f"Daily School Report — {school.name} ({date_label})", ""]
    lines.append("📋 Student Attendance")
    if total_att:
        lines.append(f"  Present: {present}  |  Absent: {absent}  |  Total: {total_att}  |  Rate: {att_rate}%")
    else:
        lines.append("  No attendance records for today.")

    lines.append("")
    lines.append("📚 Lesson Plans")
    lines.append(f"  Published: {published_plans}  |  Draft: {draft_plans}")

    if pending_fees is not None:
        lines.append("")
        lines.append("💰 Fee Status (this month)")
        lines.append(f"  Students with pending/partial fees: {pending_fees}")

    if teachers_on_leave is not None:
        lines.append("")
        lines.append("🏖 Staff Leave")
        lines.append(f"  Staff on approved leave today: {teachers_on_leave}")

    title = f"Daily Report — {date_label}"
    body = "\n".join(lines)

    admin_users = _get_admin_users(school)
    sent = 0
    for admin_user in admin_users:
        try:
            if _daily_notification_already_sent(
                school=school,
                event_type='GENERAL',
                channel='IN_APP',
                recipient_user=admin_user,
                title=title,
                body=body,
                target_date=timezone.localdate(),
            ):
                logger.info(
                    "Skipped daily school report",
                    extra={'reason_code': 'skipped_due_to_dedupe', 'recipient_user_id': admin_user.id},
                )
                continue

            engine.send(
                event_type='GENERAL',
                channel='IN_APP',
                context={},
                recipient_identifier=str(admin_user.id),
                recipient_type='ADMIN',
                recipient_user=admin_user,
                title=title,
                body=body,
            )
            sent += 1
        except Exception as e:
            logger.error(f"Daily report failed for user {admin_user.id}: {e}")

    logger.info(f"Daily school report sent: {sent} admins for {school.name} on {date}")
    return sent

