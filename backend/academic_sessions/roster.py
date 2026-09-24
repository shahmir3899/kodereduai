"""
Single read path for "which students are in this class/section in this year".

Placement is per section and lives on StudentEnrollment; the
``Student.class_obj`` snapshot only reflects the current year. Modules used to
hand-roll this lookup with chained ``.filter(enrollments__...)`` calls, and
Django applies each chained filter on a multi-valued relation to *any* related
row: "active enrollment in 2026-27" + "an enrollment in Class 1" matched
students who were in Class 1 the year before, so fee generation for Class 1
reached the whole promoted cohort. Scoping through one enrollment subquery
keeps every condition on the same enrollment row.
"""
from django.db.models import Q

from .models import StudentEnrollment
from .utils import enrollment_covers_month, resolve_current_academic_year_id


def enrollments_in_scope(school_id, *, academic_year_id=None, session_class_id=None,
                         class_obj_id=None, year=None, month=None, include_inactive=False):
    """StudentEnrollment rows for a section, or a master class in a year.

    - ``session_class_id`` wins; it already pins the year.
    - Otherwise ``class_obj_id``/``academic_year_id`` scope by master class and
      year; with no year given, the current academic year is used.
    - ``year``/``month`` apply the month-precision cutoff for students who left
      mid-year (see ``enrollment_covers_month``); without them only active
      enrollments count.
    - ``include_inactive`` keeps every enrollment of that year regardless of
      status: for listing records already created (a withdrawn student's fee
      rows from before they left), not for choosing whom to bill.

    Returns None when there's no year to scope by (school without academic
    years), so the caller can fall back to the legacy snapshot.
    """
    qs = StudentEnrollment.objects.filter(school_id=school_id)
    if session_class_id:
        qs = qs.filter(session_class_id=session_class_id)
        if academic_year_id:
            qs = qs.filter(academic_year_id=academic_year_id)
    else:
        academic_year_id = academic_year_id or resolve_current_academic_year_id(school_id)
        if not academic_year_id:
            return None
        qs = qs.filter(academic_year_id=academic_year_id)
        if class_obj_id:
            qs = qs.filter(class_obj_id=class_obj_id)

    if include_inactive:
        return qs
    if year and month:
        return qs.filter(enrollment_covers_month(int(year), int(month)))
    return qs.filter(is_active=True)


def current_placement(student):
    """The student's enrollment for the school's current academic year, or None.

    Use this for "where is this student now" (portals, messaging) instead of
    the ``Student.class_obj`` snapshot. Callers fall back to the snapshot when
    it returns None (school without academic years, or not enrolled this year).
    """
    year_id = resolve_current_academic_year_id(student.school_id)
    if not year_id:
        return None
    return (
        StudentEnrollment.objects
        .filter(student_id=student.id, academic_year_id=year_id)
        .select_related('class_obj', 'session_class', 'academic_year')
        .order_by('-is_active', '-updated_at', '-id')
        .first()
    )


def placement_scope(student):
    """(class_obj_id, academic_year_id) for portal content lookups.

    Timetables, exams and assignments are still keyed by master class, so the
    section can't narrow them yet; the year keeps last year's exams and
    assignments for the same master class (a previous cohort's) out of view.
    academic_year_id is None when there's no current placement.
    """
    placement = current_placement(student)
    if placement is None:
        return student.class_obj_id, None
    return placement.class_obj_id, placement.academic_year_id


def placements_for(school_id, student_year_pairs):
    """{(student_id, academic_year_id): StudentEnrollment} in one query.

    For grouping records (fees, attendance) by the section a student was in
    for *that record's* year, rather than by the Student.class_obj snapshot,
    which is the current class. Active enrollments win when a student has more
    than one row for a year.
    """
    pairs = {(s, y) for s, y in student_year_pairs if s and y}
    if not pairs:
        return {}
    rows = (
        StudentEnrollment.objects
        .filter(
            school_id=school_id,
            student_id__in={s for s, _ in pairs},
            academic_year_id__in={y for _, y in pairs},
        )
        .select_related('session_class', 'class_obj')
        .order_by('is_active', 'updated_at', 'id')
    )
    # Ascending order: the last row written per key is the preferred one.
    return {(e.student_id, e.academic_year_id): e for e in rows if (e.student_id, e.academic_year_id) in pairs}


def placement_group(enrollment, student):
    """(group_key, label, master class_obj_id) for grouping a student's record.

    Section when the enrollment has one, else its master class, else the
    student's snapshot class (no enrollment for that year).
    """
    if enrollment is not None and enrollment.session_class_id:
        return ('section', enrollment.session_class_id), enrollment.session_class.label, enrollment.class_obj_id
    if enrollment is not None:
        return ('class', enrollment.class_obj_id), enrollment.class_obj.name, enrollment.class_obj_id
    class_obj = student.class_obj
    return ('class', student.class_obj_id), (class_obj.name if class_obj else ''), student.class_obj_id


def current_year_q(year_id, field='academic_year'):
    """Q limiting class content to ``year_id``, keeping rows with no year.

    Rows without a year predate per-year tracking; hiding them would make
    legacy content vanish. No year_id means no filter.
    """
    if not year_id:
        return Q()
    return Q(**{f'{field}_id': year_id}) | Q(**{f'{field}__isnull': True})


def filter_students_in_scope(student_qs, school_id, *, academic_year_id=None, session_class_id=None,
                             class_obj_id=None, year=None, month=None):
    """Narrow a Student queryset to those enrolled in the given scope.

    With no class, section or year at all the queryset is returned unchanged
    ("whole school"). Schools without academic years fall back to the
    ``Student.class_obj`` snapshot, the only placement they have.
    """
    if not (session_class_id or class_obj_id or academic_year_id):
        return student_qs

    enrollments = enrollments_in_scope(
        school_id,
        academic_year_id=academic_year_id,
        session_class_id=session_class_id,
        class_obj_id=class_obj_id,
        year=year,
        month=month,
    )
    if enrollments is None:
        return student_qs.filter(class_obj_id=class_obj_id) if class_obj_id else student_qs
    return student_qs.filter(id__in=enrollments.values('student_id'))
