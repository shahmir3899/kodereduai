"""Dated placement history behind StudentEnrollment.

The enrollment is the student's CURRENT placement for a year; EnrollmentPlacement
rows are where they sat on which days. A correction (wrong section entered) rewrites
the open placement in place; a real move (effective date) closes it the day before
and opens a new one, so dates before the move still belong to the old class, the same
way a branch transfer splits a student between two schools.
"""
from django.db import transaction
from django.db.models import Exists, OuterRef, Q

from .models import EnrollmentPlacement


def open_initial_placement(enrollment):
    """First placement of a new enrollment: the whole year, in the enrollment's class."""
    if enrollment.placements.exists():
        return None
    return EnrollmentPlacement.objects.create(
        school_id=enrollment.school_id, enrollment=enrollment, student_id=enrollment.student_id,
        academic_year_id=enrollment.academic_year_id, session_class_id=enrollment.session_class_id,
        class_obj_id=enrollment.class_obj_id, roll_number=enrollment.roll_number,
        start_date=enrollment.academic_year.start_date,
    )


def _open_placement(enrollment):
    return enrollment.placements.filter(end_date__isnull=True).order_by('-start_date').first()


def sync_open_placement(enrollment):
    """Correction, not a move: make the current placement mirror the enrollment."""
    placement = _open_placement(enrollment)
    if placement is None:
        return open_initial_placement(enrollment)
    wanted = (enrollment.session_class_id, enrollment.class_obj_id, enrollment.roll_number)
    if (placement.session_class_id, placement.class_obj_id, placement.roll_number) != wanted:
        placement.session_class_id, placement.class_obj_id, placement.roll_number = wanted
        placement.save(update_fields=['session_class', 'class_obj', 'roll_number'])
    return placement


def moves_class(enrollment, placement):
    return (placement.session_class_id, placement.class_obj_id) != (enrollment.session_class_id, enrollment.class_obj_id)


@transaction.atomic
def split_placement(enrollment, effective_date, reason='', user=None):
    """Close the placement in effect on ``effective_date`` the day before and open the
    enrollment's new class from that date. A backdated move replaces any later
    placements (their class is superseded by the correction)."""
    year = enrollment.academic_year
    effective_date = max(effective_date, year.start_date)

    later = enrollment.placements.filter(start_date__gte=effective_date)
    later.delete()
    covering = enrollment.placements.filter(start_date__lt=effective_date).order_by('-start_date').first()
    if covering is not None:
        covering.end_date = effective_date
        covering.save(update_fields=['end_date'])
    return EnrollmentPlacement.objects.create(
        school_id=enrollment.school_id, enrollment=enrollment, student_id=enrollment.student_id,
        academic_year_id=enrollment.academic_year_id, session_class_id=enrollment.session_class_id,
        class_obj_id=enrollment.class_obj_id, roll_number=enrollment.roll_number,
        start_date=effective_date, reason=reason or '',
        created_by=user if getattr(user, 'is_authenticated', False) else None,
    )


def placement_on(student_id, day, academic_year_id=None):
    """The placement a student had on ``day`` (None = no placement rows cover it)."""
    qs = EnrollmentPlacement.objects.filter(student_id=student_id, start_date__lte=day).filter(
        Q(end_date__isnull=True) | Q(end_date__gt=day),
    )
    if academic_year_id:
        qs = qs.filter(academic_year_id=academic_year_id)
    return qs.select_related('session_class', 'class_obj').order_by('-start_date').first()


def placed_in_q(*, session_class_id=None, class_obj_id=None, date_field='date', student_field='student_id'):
    """Q for rows dated ``date_field`` of a student who sat in the section (or master
    class) ON THAT DATE. A student with no placement rows at all (legacy data) is not
    constrained here, so callers keep their existing enrollment-based scoping for them."""
    covering = EnrollmentPlacement.objects.filter(
        student_id=OuterRef(student_field), start_date__lte=OuterRef(date_field),
    ).filter(Q(end_date__isnull=True) | Q(end_date__gt=OuterRef(date_field)))
    if session_class_id:
        covering = covering.filter(session_class_id=session_class_id)
    elif class_obj_id:
        covering = covering.filter(class_obj_id=class_obj_id)
    anything = EnrollmentPlacement.objects.filter(
        student_id=OuterRef(student_field),
        academic_year__start_date__lte=OuterRef(date_field), academic_year__end_date__gte=OuterRef(date_field),
    )
    return Q(Exists(covering)) | ~Q(Exists(anything))


def placement_changes_in(student_id, academic_year_id):
    """The dated placements of one student in one year, oldest first (for the History tab)."""
    return list(
        EnrollmentPlacement.objects.filter(student_id=student_id, academic_year_id=academic_year_id)
        .select_related('session_class', 'class_obj').order_by('start_date')
    )



def scope_records(records, enrollments, *, session_class_id=None, class_obj_id=None, date_field='date'):
    """Keep rows dated ``date_field`` whose student sat in the section (or master class)
    ON THAT DATE. Students with no placement rows (legacy data) fall back to the
    caller's enrollment-based scope, so nothing changes for them."""
    covering = EnrollmentPlacement.objects.filter(
        student_id=OuterRef('student_id'), start_date__lte=OuterRef(date_field),
    ).filter(Q(end_date__isnull=True) | Q(end_date__gt=OuterRef(date_field)))
    if session_class_id:
        covering = covering.filter(session_class_id=session_class_id)
    elif class_obj_id:
        covering = covering.filter(class_obj_id=class_obj_id)
    # "No placements" is judged for the year the record falls in, not for the student
    # overall: an enrollment made by code that predates placements must not hide its year.
    anything = EnrollmentPlacement.objects.filter(
        student_id=OuterRef('student_id'),
        academic_year__start_date__lte=OuterRef(date_field), academic_year__end_date__gte=OuterRef(date_field),
    )
    return records.filter(
        Q(Exists(covering)) | (~Q(Exists(anything)) & Q(student_id__in=enrollments.values('student_id')))
    )


def student_ids_placed_on(day, student_ids, *, school_id, session_class_id=None, class_obj_id=None):
    """(placed, has_placements): of ``student_ids``, who sat in the section on ``day``,
    and who has dated placements at all (the rest are legacy and use enrollments)."""
    ids = list(student_ids)
    rows = EnrollmentPlacement.objects.filter(school_id=school_id, student_id__in=ids)
    has_placements = set(
        rows.filter(academic_year__start_date__lte=day, academic_year__end_date__gte=day)
        .values_list('student_id', flat=True)
    )
    on_day = rows.filter(start_date__lte=day).filter(Q(end_date__isnull=True) | Q(end_date__gt=day))
    if session_class_id:
        on_day = on_day.filter(session_class_id=session_class_id)
    elif class_obj_id:
        on_day = on_day.filter(class_obj_id=class_obj_id)
    return set(on_day.values_list('student_id', flat=True)), has_placements


def section_by_student_date(school_id, student_ids, month_start, month_end):
    """{student_id: [(start, end, session_class_id)]} for placements touching the
    month, for bucketing a month of rows by the section each day belonged to."""
    out = {}
    rows = EnrollmentPlacement.objects.filter(
        school_id=school_id, student_id__in=list(student_ids), start_date__lte=month_end,
    ).filter(Q(end_date__isnull=True) | Q(end_date__gt=month_start)).values_list(
        'student_id', 'start_date', 'end_date', 'session_class_id',
    )
    for student_id, start, end, session_class_id in rows:
        out.setdefault(student_id, []).append((start, end, session_class_id))
    return out


class DatedPlacements:
    """One-query lookup of where each student sat on a given day, for readers that walk
    many (student, date) pairs: ``lookup.get(student_id, day)`` is the EnrollmentPlacement
    in effect then, or None when no placement row covers it (legacy data), in which case the
    caller keeps using the student's enrollment."""

    def __init__(self, school_id, student_ids, date_from, date_to):
        self._rows = {}
        ids = list(student_ids)
        if not ids or date_from is None or date_to is None:
            return
        rows = (
            EnrollmentPlacement.objects.filter(school_id=school_id, student_id__in=ids, start_date__lte=date_to)
            .filter(Q(end_date__isnull=True) | Q(end_date__gt=date_from))
            .select_related('session_class', 'class_obj')
        )
        for placement in rows:
            self._rows.setdefault(placement.student_id, []).append(placement)

    def get(self, student_id, day):
        for placement in self._rows.get(student_id, ()):
            if placement.start_date <= day and (placement.end_date is None or placement.end_date > day):
                return placement
        return None

    def class_id(self, student_id, day):
        placement = self.get(student_id, day)
        return placement.class_obj_id if placement else None


def section_month_roster_q(session_class, year, month):
    """Q on Student: on the roll of ``session_class`` for any day of that month.

    A student moved mid-month is on both sections' rosters for that month (the days they
    spent in each); one with no dated placements falls back to their enrollment's section.
    Month-precision departure rules still apply. Display roster only: fee generation keeps
    using one section per student (``filter_students_in_scope``) so nobody is billed twice."""
    from calendar import monthrange
    from datetime import date as date_cls

    from .utils import enrollment_covers_month

    month_start = date_cls(int(year), int(month), 1)
    month_end = date_cls(month_start.year, month_start.month, monthrange(month_start.year, month_start.month)[1])
    sat_here = EnrollmentPlacement.objects.filter(
        student_id=OuterRef('pk'), session_class_id=session_class.id, start_date__lte=month_end,
    ).filter(Q(end_date__isnull=True) | Q(end_date__gt=month_start))
    has_any = EnrollmentPlacement.objects.filter(
        student_id=OuterRef('pk'), academic_year_id=session_class.academic_year_id,
    )
    return (
        Q(enrollments__academic_year_id=session_class.academic_year_id)
        & enrollment_covers_month(int(year), int(month), prefix='enrollments')
        & (Q(Exists(sat_here)) | (~Q(Exists(has_any)) & Q(enrollments__session_class_id=session_class.id)))
    )
