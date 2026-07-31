"""
Shared "resolve a match into an attendance write" helper.

Used by both the Tier C review/confirm flow (FaceAttendanceSessionViewSet.confirm)
and the Tier B live-match endpoint, so the per-day idempotency rule
(AttendanceRecord.unique_together = ('student', 'date')) lives in one place
instead of being duplicated across the batch and streaming paths.
"""

from attendance.models import AttendanceRecord


def upsert_attendance_record(*, student, date, school, academic_year, attendance_status,
                              source=AttendanceRecord.Source.FACE_CAMERA, face_session=None):
    """
    Idempotently create/update a student's AttendanceRecord for a date.

    Safe to call repeatedly for the same (student, date) — the unique
    constraint plus update_or_create means a later call updates the
    existing row rather than creating a duplicate.
    """
    return AttendanceRecord.objects.update_or_create(
        student=student,
        date=date,
        defaults={
            'school': school,
            'academic_year': academic_year,
            'status': attendance_status,
            'source': source,
            'face_session': face_session,
        },
    )
