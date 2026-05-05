"""
Scheduled in-app absence digests per class cohort.

Runs at 8:00 / 9:00 / 10:00 (see Celery beat). For each enrollment cohort
(class + optional session section + current academic year), once every enrolled
student has an AttendanceRecord for the date:

- Staff: one consolidated IN_APP message per cohort for school admins / principals
  (all cohorts) and class teachers assigned to that cohort.
- Parents: one IN_APP absence message per absent student (linked parent users only).

If attendance is incomplete at a scan, the cohort is skipped until a later scan.
Once processed, cohort staff rows are skipped for later scans the same day;
parent rows are tracked per student.
"""

from __future__ import annotations

import logging
from typing import Dict, Iterable, List, Optional, Tuple

from django.db import IntegrityError
from django.db.models import Q

from academic_sessions.calendar_rules import is_off_day_for_date
from academic_sessions.models import AcademicYear, SessionClass, StudentEnrollment
from academics.models import ClassTeacherAssignment
from attendance.models import AttendanceRecord
from notifications.engine import NotificationEngine
from notifications.models import (
    AttendanceAbsenceInAppDigestMarker,
    SchoolNotificationConfig,
)
from notifications.recipients import get_admin_users, get_parent_users_for_student
from students.models import Class as SchoolClass

logger = logging.getLogger(__name__)


def _staff_scope_key(class_obj_id: int, session_class_id: Optional[int]) -> str:
    sid = session_class_id or 0
    return f'class:{class_obj_id}:sess:{sid}'


def _parent_scope_key(student_id: int) -> str:
    return f'student:{student_id}'


def _cohort_class_label(class_obj_id: int, session_class_id: Optional[int]) -> str:
    try:
        cls = SchoolClass.objects.get(pk=class_obj_id)
        base = cls.name
    except SchoolClass.DoesNotExist:
        base = f'Class #{class_obj_id}'
    if not session_class_id:
        return base
    sc = SessionClass.objects.filter(pk=session_class_id).select_related(
        'academic_year'
    ).first()
    if sc:
        return sc.label
    return base


def _active_enrollment_student_ids(
    school_id: int,
    academic_year_id: int,
    class_obj_id: int,
    session_class_id: Optional[int],
) -> List[int]:
    qs = StudentEnrollment.objects.filter(
        school_id=school_id,
        academic_year_id=academic_year_id,
        class_obj_id=class_obj_id,
        is_active=True,
        status=StudentEnrollment.Status.ACTIVE,
    )
    if session_class_id:
        qs = qs.filter(session_class_id=session_class_id)
    else:
        qs = qs.filter(session_class__isnull=True)
    return list(qs.values_list('student_id', flat=True).distinct())


def _iter_cohort_keys(
    school_id: int, academic_year_id: int
) -> Iterable[Tuple[int, Optional[int]]]:
    rows = (
        StudentEnrollment.objects.filter(
            school_id=school_id,
            academic_year_id=academic_year_id,
            is_active=True,
            status=StudentEnrollment.Status.ACTIVE,
        )
        .values_list('class_obj_id', 'session_class_id')
        .distinct()
    )
    return list(rows)


def _records_for_students(
    school_id: int, target_date, student_ids: List[int]
) -> Dict[int, AttendanceRecord]:
    if not student_ids:
        return {}
    rows = AttendanceRecord.objects.filter(
        school_id=school_id,
        date=target_date,
        student_id__in=student_ids,
    ).select_related('student', 'student__class_obj')
    return {r.student_id: r for r in rows}


def _teachers_for_cohort(
    school_id: int,
    academic_year_id: int,
    class_obj_id: int,
    session_class_id: Optional[int],
) -> List:
    qs = ClassTeacherAssignment.objects.filter(
        school_id=school_id,
        class_obj_id=class_obj_id,
        is_active=True,
    ).filter(
        Q(academic_year_id=academic_year_id) | Q(academic_year__isnull=True)
    )
    if session_class_id:
        qs = qs.filter(
            Q(session_class_id=session_class_id) | Q(session_class__isnull=True)
        )
    else:
        qs = qs.filter(session_class__isnull=True)
    users = []
    seen = set()
    for a in qs.select_related('teacher', 'teacher__user'):
        u = getattr(getattr(a.teacher, 'user', None), 'id', None)
        if u and u not in seen:
            seen.add(u)
            users.append(a.teacher.user)
    return users


def _staff_marker_exists(
    school_id: int, target_date, scope_key: str
) -> bool:
    return AttendanceAbsenceInAppDigestMarker.objects.filter(
        school_id=school_id,
        date=target_date,
        digest_type=AttendanceAbsenceInAppDigestMarker.DigestType.STAFF_CLASS,
        scope_key=scope_key,
    ).exists()


def _parent_marker_exists(school_id: int, target_date, student_id: int) -> bool:
    return AttendanceAbsenceInAppDigestMarker.objects.filter(
        school_id=school_id,
        date=target_date,
        digest_type=AttendanceAbsenceInAppDigestMarker.DigestType.PARENT_STUDENT,
        scope_key=_parent_scope_key(student_id),
    ).exists()


def _create_marker(
    school_id: int,
    target_date,
    digest_type: str,
    scope_key: str,
) -> bool:
    try:
        AttendanceAbsenceInAppDigestMarker.objects.create(
            school_id=school_id,
            date=target_date,
            digest_type=digest_type,
            scope_key=scope_key,
        )
        return True
    except IntegrityError:
        return False


def process_absence_digest_for_school(school, target_date) -> Dict[str, int]:
    """
    Run one digest scan for a single school and calendar date.

    Returns counters for observability (not necessarily equal to notifications
    if channel/preference skips).
    """
    stats = {
        'cohorts_total': 0,
        'cohorts_incomplete': 0,
        'cohorts_staff_digest': 0,
        'parent_absence_sent': 0,
        'skipped_off_day': 0,
    }

    try:
        config = school.notification_config
    except SchoolNotificationConfig.DoesNotExist:
        config = None
    if config and not config.absence_notification_enabled:
        logger.info(
            'Absence digest skipped: disabled in config',
            extra={'school_id': school.id},
        )
        return stats

    academic_year = AcademicYear.objects.filter(
        school=school, is_current=True, is_active=True
    ).first()
    if not academic_year:
        return stats

    engine = NotificationEngine(school)
    admin_users = get_admin_users(school)
    cohort_keys = _iter_cohort_keys(school.id, academic_year.id)

    for class_obj_id, session_class_id in cohort_keys:
        stats['cohorts_total'] += 1
        student_ids = _active_enrollment_student_ids(
            school.id, academic_year.id, class_obj_id, session_class_id
        )
        if not student_ids:
            stats['cohorts_incomplete'] += 1
            continue

        if is_off_day_for_date(school.id, target_date, class_id=class_obj_id):
            stats['skipped_off_day'] += 1
            continue

        by_student = _records_for_students(school.id, target_date, student_ids)
        if len(by_student) < len(student_ids):
            stats['cohorts_incomplete'] += 1
            continue

        scope_key = _staff_scope_key(class_obj_id, session_class_id)
        teacher_users = _teachers_for_cohort(
            school.id, academic_year.id, class_obj_id, session_class_id
        )

        if not _staff_marker_exists(school.id, target_date, scope_key):
            absent_count = sum(
                1
                for sid in student_ids
                if by_student[sid].status
                == AttendanceRecord.AttendanceStatus.ABSENT
            )
            label = _cohort_class_label(class_obj_id, session_class_id)
            title = f'{label} — {absent_count} absent'
            body = (
                f'Attendance complete for {label} on '
                f'{target_date.strftime("%d %B %Y")}: {absent_count} student(s) absent.'
            )

            if _create_marker(
                school.id,
                target_date,
                AttendanceAbsenceInAppDigestMarker.DigestType.STAFF_CLASS,
                scope_key,
            ):
                stats['cohorts_staff_digest'] += 1

                admin_ids = {u.id for u in admin_users}
                staff_recipients: List[Tuple[object, str]] = []
                for user in admin_users:
                    staff_recipients.append((user, 'ADMIN'))
                for user in teacher_users:
                    if user.id not in admin_ids:
                        staff_recipients.append((user, 'STAFF'))

                for user, recipient_type in staff_recipients:
                    engine.send(
                        event_type='ABSENCE',
                        channel='IN_APP',
                        context={},
                        recipient_identifier=str(user.id),
                        recipient_type=recipient_type,
                        recipient_user=user,
                        student=None,
                        title=title,
                        body=body,
                    )

        # Parent in-app (own child only); one per absent student per day.
        date_h = target_date.strftime('%d %B %Y')
        cohort_label = _cohort_class_label(class_obj_id, session_class_id)
        for sid in student_ids:
            rec = by_student.get(sid)
            if (
                not rec
                or rec.status != AttendanceRecord.AttendanceStatus.ABSENT
            ):
                continue
            if _parent_marker_exists(school.id, target_date, sid):
                continue
            student = rec.student
            parents = get_parent_users_for_student(student)
            if not parents:
                continue

            delivered = 0
            for parent_user in parents:
                log = engine.send(
                    event_type='ABSENCE',
                    channel='IN_APP',
                    context={
                        'student_name': student.name,
                        'class_name': cohort_label,
                        'date': date_h,
                        'school_name': school.name,
                        'roll_number': student.roll_number,
                    },
                    recipient_identifier=str(parent_user.id),
                    recipient_type='PARENT',
                    recipient_user=parent_user,
                    student=student,
                    title=f'Absence: {student.name} ({cohort_label})',
                    body=f'{student.name} was marked absent on {date_h}.',
                )
                if log and log.status == 'SENT':
                    delivered += 1
                    stats['parent_absence_sent'] += 1

            if delivered:
                _create_marker(
                    school.id,
                    target_date,
                    AttendanceAbsenceInAppDigestMarker.DigestType.PARENT_STUDENT,
                    scope_key=_parent_scope_key(sid),
                )

    return stats


def process_absence_digest_all_schools(target_date) -> Dict[str, object]:
    """Run digest scan for every active school that has attendance enabled."""
    from schools.models import School

    summary = {'date': str(target_date), 'schools': []}
    for school in School.objects.filter(is_active=True):
        if not school.get_enabled_module('attendance'):
            continue
        try:
            stats = process_absence_digest_for_school(school, target_date)
            summary['schools'].append({'school_id': school.id, **stats})
        except Exception as exc:
            logger.exception(
                'Absence digest failed for school %s: %s', school.id, exc
            )
            summary['schools'].append(
                {'school_id': school.id, 'error': str(exc)}
            )
    return summary
