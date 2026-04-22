"""
Shared attendance absence-notification helpers.

This module centralizes the "notify only on transition to ABSENT" rule so
all attendance write paths follow identical behavior.
"""

import logging

from attendance.models import AttendanceRecord

logger = logging.getLogger(__name__)


def is_transition_to_absent(record, previous_status):
    """Return True only when record moved into ABSENT from a non-ABSENT state."""
    return (
        record.status == AttendanceRecord.AttendanceStatus.ABSENT
        and previous_status != AttendanceRecord.AttendanceStatus.ABSENT
    )


def filter_transitioned_absent_records(records, previous_status_by_student_id):
    """
    Filter records to only those that transitioned into ABSENT.

    Args:
        records: Iterable of AttendanceRecord instances after write/update.
        previous_status_by_student_id: dict[student_id] -> previous status value.
    """
    transitioned = []
    for record in records:
        previous_status = previous_status_by_student_id.get(record.student_id)
        if is_transition_to_absent(record, previous_status):
            transitioned.append(record)
    return transitioned


def dispatch_in_app_absence_notifications(records):
    """
    Send in-app absence notifications for each record.

    Returns:
        int: number of per-record dispatch failures.
    """
    from notifications.triggers import trigger_absence_notification

    failures = 0
    for record in records:
        try:
            trigger_absence_notification(record)
        except Exception as exc:
            failures += 1
            logger.warning(
                "Could not send absence notification for student %s: %s",
                record.student_id,
                exc,
            )
    return failures
