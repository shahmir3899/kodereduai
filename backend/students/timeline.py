"""A student's history across branches: one timeline, read live through the transfer link.

A branch transfer creates a NEW student record at the destination (Student.transferred_from
points at the old one, and a FINALIZED transfer StudentExit connects them). Nothing is
copied: attendance, exams and fees stay in the rows the branch that created them owns.
Anything that wants "what actually happened to this student" asks for the timeline and
reads each branch's own rows, limited to that branch's dates:

    Branch 1 record (student 242)   start -> 2026-10-06 (exclusive)
    Branch 2 record (student 760)   2026-10-06 (inclusive) -> now

Rules that keep this safe:
  * The chain is found server-side from the record handed in, never from client input.
  * Only a FINALIZED transfer counts, both branches must be in the same organization, and
    the exit must really connect the two records. A cancelled or inconsistent link is
    ignored, so the timeline degrades to the single current segment.
  * Only the past is read. The old branch never sees the new branch's data.
  * An earlier segment ends at the leaving date, so nothing recorded after it (for
    example if the student is re-admitted at the old branch) leaks in, and no day is
    counted by two branches.
  * A student with no transfer link costs zero extra queries.

Old rows are read-only everywhere by construction (edit endpoints are scoped to the
branch being worked in); callers also tag them with `branch`/`read_only` for display.
"""
from dataclasses import dataclass
from datetime import date
from typing import Optional

from django.db.models import Q

MAX_HOPS = 10  # a student transferred this often has bigger problems; also a loop guard


@dataclass(frozen=True)
class Segment:
    """One branch's stretch of a student's history."""
    school_id: int
    student_id: int
    school_name: str
    start: Optional[date]      # first day (inclusive); None = from the beginning
    end: Optional[date]        # first day NOT in this segment (exclusive); None = still here
    is_current: bool

    def contains(self, day):
        return (self.start is None or day >= self.start) and (self.end is None or day < self.end)


def _inbound_transfer(student):
    """The finalized transfer that created ``student`` at their branch, or None when
    there is no valid one (never transferred, cancelled, other organization, or the exit
    does not connect these two records)."""
    from student_exits.models import StudentExit

    if not student.transferred_from_id:
        return None
    exit_case = (
        StudentExit.objects
        .filter(
            destination_student_id=student.id, status=StudentExit.Status.FINALIZED,
            exit_type=StudentExit.ExitType.TRANSFERRED,
        )
        .select_related('student__school', 'school')
        .first()
    )
    if exit_case is None or exit_case.student_id != student.transferred_from_id:
        return None
    source = exit_case.student
    if (
        not source.school.organization_id
        or source.school.organization_id != student.school.organization_id
        or exit_case.destination_school_id != student.school_id
    ):
        return None
    return exit_case


def student_timeline(student):
    """Segments oldest first; the last one is ``student`` themselves. Cached on the
    instance, so one request resolves the chain once however many readers ask."""
    cached = getattr(student, '_timeline', None)
    if cached is not None:
        return cached

    segments = []
    current, end, seen = student, None, set()
    for _ in range(MAX_HOPS):
        seen.add(current.id)
        inbound = _inbound_transfer(current)
        start = inbound.leaving_date if inbound else None
        # The branch name is only needed to tag earlier branches' rows; skip the lookup for
        # a student with no history so that case really costs nothing.
        needs_name = inbound is not None or current.id != student.id
        segments.append(Segment(
            school_id=current.school_id, student_id=current.id,
            school_name=current.school.name if needs_name else '', start=start, end=end,
            is_current=current.id == student.id,
        ))
        if inbound is None or inbound.student_id in seen:
            break
        current, end = inbound.student, inbound.leaving_date
    segments.reverse()
    student._timeline = segments
    return segments


def has_history(student):
    return len(student_timeline(student)) > 1


def earlier_segments(student):
    """The segments before the current one (empty for a student who never transferred)."""
    return [s for s in student_timeline(student) if not s.is_current]


def timelines_for(students):
    """{student_id: segments} for many students. Students with no transfer link are
    answered without touching the database."""
    return {s.id: student_timeline(s) for s in students}


# ── Filters: read each branch's own rows, limited to its dates ───────────────

def rows_q(segments, *, date_field=None, student_field='student_id', school_field='school_id'):
    """Q matching the rows of every segment: that branch's record, and only the dates
    inside that segment when ``date_field`` is given."""
    query = Q()
    for seg in segments:
        part = Q(**{student_field: seg.student_id, school_field: seg.school_id})
        if date_field:
            if seg.start is not None:
                part &= Q(**{f'{date_field}__gte': seg.start})
            if seg.end is not None:
                part &= Q(**{f'{date_field}__lt': seg.end})
        query |= part
    return query


def attendance_q(segments):
    return rows_q(segments, date_field='date')


def marks_q(segments):
    """StudentMark rows: dated by their exam's start date."""
    return rows_q(segments, date_field='exam_subject__exam__start_date')


def enrollments_q(segments):
    return rows_q(segments)


def documents_q(segments):
    return rows_q(segments)


def fees_q(segments):
    """FeePayment rows. Old rows are not cut by date (their billing simply stopped when
    the student left) except monthly rows after the leaving month, which would belong to
    nobody."""
    query = Q()
    for seg in segments:
        part = Q(student_id=seg.student_id, school_id=seg.school_id)
        if seg.end is not None:
            part &= (
                ~Q(fee_type='MONTHLY')
                | Q(year__lt=seg.end.year)
                | Q(year=seg.end.year, month__lte=seg.end.month)
            )
        query |= part
    return query


def student_ids(segments):
    return [s.student_id for s in segments]


def segment_for(segments, student_id, school_id):
    """The segment a row belongs to (to tag it with its branch), or None."""
    for seg in segments:
        if seg.student_id == student_id and seg.school_id == school_id:
            return seg
    return None


def branch_tag(segments, student_id, school_id):
    """What a row's branch tag should say: None for the current branch's own rows,
    the branch name for earlier ones."""
    seg = segment_for(segments, student_id, school_id)
    if seg is None or seg.is_current:
        return None
    return seg.school_name


def audit_cross_branch_read(request, student, what):
    """One audit line when a profile is opened with earlier-branch data (not per tab)."""
    segments = student_timeline(student)
    if len(segments) < 2 or request is None:
        return
    from core.audit import log_admin_action

    log_admin_action(request, 'cross_branch_read', student, metadata={
        'what': what,
        'from_schools': [s.school_id for s in segments if not s.is_current],
    })
