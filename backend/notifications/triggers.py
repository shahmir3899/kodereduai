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

FEE_PENDING_STATUSES = ['UNPAID', 'PARTIAL', 'PENDING']


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


def _get_config(school):
    """Get school notification config, returns None if not configured."""
    from .models import SchoolNotificationConfig
    try:
        return SchoolNotificationConfig.objects.get(school=school)
    except SchoolNotificationConfig.DoesNotExist:
        return None


def trigger_fee_pending_in_app(school, month, year):
    """
    Consolidated in-app fee pending notifications.

    Recipients:
    - SCHOOL_ADMIN / PRINCIPAL: one message per class with pending total
    - Class teacher: one message for each assigned class with pending total
    - Parent users linked to student: self-only pending amount
    - Student user (if linked): self-only pending amount
    """
    config = _get_config(school)
    if config and not config.fee_reminder_enabled:
        logger.info(f"Fee pending notifications disabled for {school.name}, skipping")
        return 0

    from finance.models import FeePayment
    from academics.models import ClassTeacherAssignment
    from .engine import NotificationEngine

    engine = NotificationEngine(school)
    pending_payments = (
        FeePayment.objects
        .filter(
            school=school,
            month=month,
            year=year,
            status__in=FEE_PENDING_STATUSES,
            student__is_active=True,
        )
        .select_related('student', 'student__class_obj')
    )
    if not pending_payments.exists():
        return 0

    class_totals = {}
    student_totals = {}
    student_by_id = {}
    for payment in pending_payments:
        student = payment.student
        due = float(payment.amount_due or 0)
        paid = float(payment.amount_paid or 0)
        balance = max(due - paid, 0)
        if balance <= 0:
            continue
        class_totals.setdefault(student.class_obj_id, {'class_name': student.class_obj.name, 'amount': 0.0})
        class_totals[student.class_obj_id]['amount'] += balance
        student_totals[student.id] = student_totals.get(student.id, 0.0) + balance
        student_by_id[student.id] = student

    if not class_totals and not student_totals:
        return 0

    sent = 0
    # Admin/principal: one message per class.
    admin_users = _get_admin_users(school)
    for class_id, payload in class_totals.items():
        class_name = payload['class_name']
        amount_label = f"{payload['amount']:,.0f}"
        title = f"Fee Pending — {class_name}"
        body = f"An amount of Rs {amount_label} is pending for {class_name}."
        for admin_user in admin_users:
            if _monthly_notification_already_sent(
                school=school,
                event_type='FEE_DUE',
                channel='IN_APP',
                recipient_user=admin_user,
                title=title,
                body=body,
                month=month,
                year=year,
            ):
                continue
            engine.send(
                event_type='FEE_DUE',
                channel='IN_APP',
                context={},
                recipient_identifier=str(admin_user.id),
                recipient_type='ADMIN',
                recipient_user=admin_user,
                title=title,
                body=body,
            )
            sent += 1

    # Class teachers: only assigned classes. Section-scoped assignments
    # (session_class set) only see their own section's pending total.
    from academic_sessions.models import StudentEnrollment
    teacher_assignments = (
        ClassTeacherAssignment.objects
        .filter(school=school, is_active=True)
        .filter(Q(academic_year__is_current=True) | Q(academic_year__isnull=True))
        .select_related('teacher__user', 'class_obj', 'session_class')
    )
    for assignment in teacher_assignments:
        teacher_user = getattr(getattr(assignment, 'teacher', None), 'user', None)
        if not teacher_user:
            continue

        if assignment.session_class_id:
            section_student_ids = set(
                StudentEnrollment.objects.filter(
                    session_class_id=assignment.session_class_id,
                    is_active=True,
                ).values_list('student_id', flat=True)
            )
            relevant_ids = section_student_ids & student_totals.keys()
            if not relevant_ids:
                continue
            amount = sum(student_totals[sid] for sid in relevant_ids)
            class_name = assignment.class_obj.name if assignment.class_obj else ''
            if assignment.session_class.section:
                class_name = f"{class_name} - {assignment.session_class.section}"
        else:
            payload = class_totals.get(assignment.class_obj_id)
            if not payload:
                continue
            class_name = payload['class_name']
            amount = payload['amount']

        amount_label = f"{amount:,.0f}"
        title = f"Fee Pending — {class_name}"
        body = f"An amount of Rs {amount_label} is pending for {class_name}."
        if _monthly_notification_already_sent(
            school=school,
            event_type='FEE_DUE',
            channel='IN_APP',
            recipient_user=teacher_user,
            title=title,
            body=body,
            month=month,
            year=year,
        ):
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

    # Parent + student self notifications.
    for student_id, amount in student_totals.items():
        student = student_by_id.get(student_id)
        if not student:
            continue
        amount_label = f"{amount:,.0f}"
        title = f"Fee Pending — {student.name}"
        body = f"Dear {student.name}, your fee amounting to Rs {amount_label} is pending."
        for parent_user in get_parent_users_for_student(student):
            if _monthly_notification_already_sent(
                school=school,
                event_type='FEE_DUE',
                channel='IN_APP',
                recipient_user=parent_user,
                title=title,
                body=body,
                month=month,
                year=year,
                student=student,
            ):
                continue
            engine.send(
                event_type='FEE_DUE',
                channel='IN_APP',
                context={},
                recipient_identifier=str(parent_user.id),
                recipient_type='PARENT',
                recipient_user=parent_user,
                student=student,
                title=title,
                body=body,
            )
            sent += 1

        student_user = get_student_user(student)
        if student_user and not _monthly_notification_already_sent(
            school=school,
            event_type='FEE_DUE',
            channel='IN_APP',
            recipient_user=student_user,
            title=title,
            body=body,
            month=month,
            year=year,
            student=student,
        ):
            engine.send(
                event_type='FEE_DUE',
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

    logger.info(f"Fee pending in-app notifications sent: {sent} for {school.name} ({month}/{year})")
    return sent



def trigger_exam_result(student, exam):
    """
    Backward-compatible per-student exam result notification.
    """
    from .engine import NotificationEngine

    school = student.school

    config = _get_config(school)
    if config and not config.exam_result_enabled:
        logger.info(f"Exam result notifications disabled for {school.name}, skipping")
        return None

    engine = NotificationEngine(school)
    exam_name = exam.name if hasattr(exam, 'name') else str(exam)
    title = f"Exam Results Published — {exam_name}"
    body = f"Result for {exam_name} exam has been published. Please log in to see more details."

    sent_log = None
    for parent_user in get_parent_users_for_student(student):
        sent_log = engine.send(
            event_type='EXAM_RESULT',
            channel='IN_APP',
            context={},
            recipient_identifier=str(parent_user.id),
            recipient_type='PARENT',
            recipient_user=parent_user,
            student=student,
            title=title,
            body=body,
        )
    student_user = get_student_user(student)
    if student_user:
        sent_log = engine.send(
            event_type='EXAM_RESULT',
            channel='IN_APP',
            context={},
            recipient_identifier=str(student_user.id),
            recipient_type='PARENT',
            recipient_user=student_user,
            student=student,
            title=title,
            body=body,
        )
    return sent_log


def trigger_exam_result_published(exam):
    """
    Notify admins, principals, assigned class teachers, parents, and students
    when an exam is published.
    """
    from students.models import Student
    from academics.models import ClassTeacherAssignment
    from .engine import NotificationEngine

    school = exam.school
    config = _get_config(school)
    if config and not config.exam_result_enabled:
        logger.info(f"Exam result notifications disabled for {school.name}, skipping")
        return 0

    exam_name = exam.name if hasattr(exam, 'name') else str(exam)
    title = "Exam Results Published"
    body = f"Result for {exam_name} exam has been published. Please log in to see more details."
    engine = NotificationEngine(school)
    sent = 0
    today = timezone.localdate()

    # Admin + principal
    for admin_user in _get_admin_users(school):
        if _daily_notification_already_sent(
            school=school,
            event_type='EXAM_RESULT',
            channel='IN_APP',
            recipient_user=admin_user,
            title=title,
            body=body,
            target_date=today,
        ):
            continue
        engine.send(
            event_type='EXAM_RESULT',
            channel='IN_APP',
            context={},
            recipient_identifier=str(admin_user.id),
            recipient_type='ADMIN',
            recipient_user=admin_user,
            title=title,
            body=body,
        )
        sent += 1

    # Assigned class teachers
    teacher_assignments = (
        ClassTeacherAssignment.objects
        .filter(school=school, class_obj=exam.class_obj, is_active=True)
        .filter(Q(academic_year__isnull=True) | Q(academic_year_id=exam.academic_year_id))
        .select_related('teacher__user')
    )
    for assignment in teacher_assignments:
        teacher_user = getattr(getattr(assignment, 'teacher', None), 'user', None)
        if not teacher_user:
            continue
        if _daily_notification_already_sent(
            school=school,
            event_type='EXAM_RESULT',
            channel='IN_APP',
            recipient_user=teacher_user,
            title=title,
            body=body,
            target_date=today,
        ):
            continue
        engine.send(
            event_type='EXAM_RESULT',
            channel='IN_APP',
            context={},
            recipient_identifier=str(teacher_user.id),
            recipient_type='STAFF',
            recipient_user=teacher_user,
            title=title,
            body=body,
        )
        sent += 1

    # Parents + students in this class
    students = Student.objects.filter(
        school=school,
        class_obj=exam.class_obj,
        is_active=True,
    ).select_related('user_profile__user')
    for student in students:
        for parent_user in get_parent_users_for_student(student):
            if _daily_notification_already_sent(
                school=school,
                event_type='EXAM_RESULT',
                channel='IN_APP',
                recipient_user=parent_user,
                title=title,
                body=body,
                target_date=today,
                student=student,
            ):
                continue
            engine.send(
                event_type='EXAM_RESULT',
                channel='IN_APP',
                context={},
                recipient_identifier=str(parent_user.id),
                recipient_type='PARENT',
                recipient_user=parent_user,
                student=student,
                title=title,
                body=body,
            )
            sent += 1

        student_user = get_student_user(student)
        if student_user and not _daily_notification_already_sent(
            school=school,
            event_type='EXAM_RESULT',
            channel='IN_APP',
            recipient_user=student_user,
            title=title,
            body=body,
            target_date=today,
            student=student,
        ):
            engine.send(
                event_type='EXAM_RESULT',
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

    return sent


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
    Notify class teachers if student attendance is still not marked for the day.
    Admin-triggered on demand (see notifications "Remind Teachers to Mark
    Attendance" action) — no longer runs on a fixed 11:00 schedule.

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
            if assignment.session_class_id:
                students_qs = students_qs.filter(
                    enrollments__academic_year_id=assignment.academic_year_id,
                    enrollments__session_class_id=assignment.session_class_id,
                    enrollments__is_active=True,
                ).distinct()
                attendance_qs = attendance_qs.filter(
                    student__enrollments__academic_year_id=assignment.academic_year_id,
                    student__enrollments__session_class_id=assignment.session_class_id,
                    student__enrollments__is_active=True,
                ).distinct()
            else:
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

    if lesson_plan.session_class_id:
        # Section-scoped plan: notify only students enrolled in that section
        # (for the plan's academic year, if known), not the whole master class.
        enrollment_filter = {
            'enrollments__session_class_id': lesson_plan.session_class_id,
            'enrollments__is_active': True,
        }
        if lesson_plan.academic_year_id:
            enrollment_filter['enrollments__academic_year_id'] = lesson_plan.academic_year_id
        students = (
            Student.objects
            .filter(
                school=lesson_plan.school,
                is_active=True,
                **enrollment_filter,
            )
            .distinct()
            .select_related('user_profile__user')
        )
    else:
        # No session_class set: legacy behavior — applies to every section
        # of the master class.
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
    on_leave = AttendanceRecord.objects.filter(school=school, date=date, status='LEAVE').count()
    total_att = present + absent + on_leave
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
        lines.append(f"  Present: {present}  |  Absent: {absent}  |  Leave: {on_leave}  |  Total: {total_att}  |  Rate: {att_rate}%")
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

