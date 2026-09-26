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

    Returns None when there's no enrollment data to scope by -- no year at all,
    or a year with no enrollment rows in the school (legacy data, e.g. a year
    before enrollments were tracked) -- so the caller can fall back to the
    Student.class_obj snapshot instead of silently matching nobody.
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
        if not qs.exists():
            return None
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


def placement_for_year(student, academic_year_id=None):
    """The student's enrollment for `academic_year_id` (default: the current
    year), active row preferred, or None when there is none."""
    if not academic_year_id:
        return current_placement(student)
    return (
        StudentEnrollment.objects
        .filter(student_id=student.id, academic_year_id=academic_year_id)
        .select_related('class_obj', 'session_class', 'academic_year')
        .order_by('-is_active', '-updated_at', '-id')
        .first()
    )


def class_id_for_year(student, academic_year_id=None):
    """Master class of the student in that year (default: current year).
    Falls back to the Student.class_obj snapshot only when the student has no
    enrollment for that year (legacy data)."""
    placement = placement_for_year(student, academic_year_id)
    return placement.class_obj_id if placement else student.class_obj_id


def current_student_ids_in_classes(school_id, class_ids):
    """Subquery of student ids whose current-year enrollment is in `class_ids`
    (master classes), or None when the current year has no enrollment rows
    (legacy data), so the caller can fall back to the snapshot."""
    year_id = resolve_current_academic_year_id(school_id)
    if not year_id:
        return None
    enrollments = StudentEnrollment.objects.filter(school_id=school_id, academic_year_id=year_id)
    if not enrollments.exists():
        return None
    return enrollments.filter(class_obj_id__in=class_ids, is_active=True).values('student_id')


def class_student_count_expr():
    """Expression for a Class queryset: active students in the class for the
    school's current academic year, from enrollments.

    The Student snapshot is the latest placement, so after promotion it
    counted next year's cohort under this year's class. Schools whose current
    year has no enrollment rows (legacy data) keep the snapshot count.
    """
    from django.db.models import Case, Count, Exists, IntegerField, OuterRef, Subquery, When
    from django.db.models.functions import Coalesce
    from students.models import Student

    current = StudentEnrollment.objects.filter(
        school_id=OuterRef('school_id'), academic_year__is_current=True, academic_year__is_active=True,
    )
    enrolled = (
        current.filter(class_obj_id=OuterRef('pk'), is_active=True, student__is_active=True)
        .order_by().values('class_obj_id').annotate(n=Count('student_id', distinct=True)).values('n')
    )
    snapshot = (
        Student.objects.filter(class_obj_id=OuterRef('pk'), is_active=True)
        .order_by().values('class_obj_id').annotate(n=Count('id')).values('n')
    )
    return Case(
        When(Exists(current), then=Coalesce(Subquery(enrolled, output_field=IntegerField()), 0)),
        default=Coalesce(Subquery(snapshot, output_field=IntegerField()), 0),
        output_field=IntegerField(),
    )


def class_student_count(class_obj):
    """Active students in one class this year (see class_student_count_expr)."""
    from students.models import Class

    return Class.objects.filter(pk=class_obj.pk).annotate(n=class_student_count_expr()).values_list('n', flat=True).first() or 0


def current_students_by_class(school_id):
    """{class_obj_id: [Student, ...]} of active students by their current-year
    enrollment, ordered by enrollment roll; None when the current year has no
    enrollment rows (legacy data), so the caller can use the snapshot."""
    enrollments = enrollments_in_scope(school_id)
    if enrollments is None:
        return None
    grouped = {}
    for e in enrollments.filter(student__is_active=True).select_related('student').order_by('roll_number', 'student__name'):
        grouped.setdefault(e.class_obj_id, []).append(e.student)
    return grouped


def placement_scope(student):
    """(class_obj_id, academic_year_id) for portal content lookups.

    Pair with own_section_q for the section; the year keeps last year's exams
    and assignments for the same master class (a previous cohort's) out of
    view. academic_year_id is None when there's no current placement.
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


def current_placements_for(school_id, student_ids):
    """{student_id: this year's enrollment} for many students in one query
    (the list-view counterpart of current_placement)."""
    year_id = resolve_current_academic_year_id(school_id)
    if not year_id:
        return {}
    by_pair = placements_for(school_id, ((sid, year_id) for sid in student_ids))
    return {sid: enrollment for (sid, _year), enrollment in by_pair.items()}


def serializer_placement(serializer, obj, year_of=None):
    """The enrollment of ``obj.student`` for the year ``year_of(obj)`` returns
    (the school's current year when it returns None), looked up once for the
    whole list a DRF serializer is rendering. Records with a student use this
    for class/roll columns instead of the Student snapshot, which is the latest
    class and roll (next year's right after promotion)."""
    if not hasattr(serializer, '_roster_placements'):
        parent = getattr(serializer, 'parent', None)
        listing = parent is not None and hasattr(parent, 'child') and parent.instance is not None
        items = list(parent.instance) if listing else [obj]
        current_years = {}

        def year_for(item):
            year_id = year_of(item) if year_of else None
            if year_id:
                return year_id
            if item.school_id not in current_years:
                current_years[item.school_id] = resolve_current_academic_year_id(item.school_id)
            return current_years[item.school_id]

        serializer._roster_year_for = year_for
        serializer._roster_placements = placements_for(
            obj.school_id, ((item.student_id, year_for(item)) for item in items),
        )
    return serializer._roster_placements.get((obj.student_id, serializer._roster_year_for(obj)))


def placement_class_id(enrollment, student):
    """Master class id from an enrollment, or the student's snapshot when there
    is no enrollment (legacy data). The one place that falls back to the
    snapshot for this, so callers never read Student.class_obj themselves."""
    if enrollment is not None and enrollment.class_obj_id:
        return enrollment.class_obj_id
    return student.class_obj_id if student is not None else None


def placement_label(enrollment, student):
    """Section label or master class name from an enrollment; snapshot class
    name when there is no enrollment."""
    if enrollment is not None:
        if enrollment.session_class_id:
            return enrollment.session_class.label
        if enrollment.class_obj_id:
            return enrollment.class_obj.name
    if student is not None and student.class_obj_id:
        cls = student.class_obj
        # Legacy master classes may still carry their own section letter.
        return f"{cls.name} - {cls.section}" if cls.section else cls.name
    return ''


def placement_roll(enrollment, student):
    """Roll number from an enrollment; snapshot roll when there is no enrollment."""
    if enrollment is not None and enrollment.roll_number:
        return enrollment.roll_number
    return student.roll_number if student is not None else None


def annotate_record_placement(queryset):
    """Annotate a per-student, per-year record queryset (attendance, ...) with
    ``pl_class_id`` / ``pl_section_id``: the master class and section of the
    student's enrollment for the record's own academic year.

    For grouping records by class in SQL. The Student snapshot is the latest
    class, so grouping by it moved last year's records under the class a
    student was promoted into. Records with no matching enrollment fall back
    to the snapshot class (no section).
    """
    from django.db.models import F, IntegerField, OuterRef, Subquery
    from django.db.models.functions import Coalesce

    placement = StudentEnrollment.objects.filter(
        student_id=OuterRef('student_id'), academic_year_id=OuterRef('academic_year_id'),
    ).order_by('-is_active', '-updated_at', '-id')
    return queryset.annotate(
        pl_class_id=Coalesce(
            Subquery(placement.values('class_obj_id')[:1]), F('student__class_obj_id'),
            output_field=IntegerField(),
        ),
        pl_section_id=Subquery(placement.values('session_class_id')[:1], output_field=IntegerField()),
    )


def placement_group_labels(class_ids, section_ids):
    """({class_id: name}, {section_id: label}) for labelling grouped rows."""
    from students.models import Class
    from .models import SessionClass

    class_names = dict(Class.objects.filter(id__in={c for c in class_ids if c}).values_list('id', 'name'))
    section_labels = {s.id: s.label for s in SessionClass.objects.filter(id__in={s for s in section_ids if s})}
    return class_names, section_labels


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


def own_section_q(student, field='session_class'):
    """Q for class content (exams, ...) a student should see: whole-class rows
    plus their current section's own rows, never a sibling section's."""
    placement = current_placement(student)
    section_id = placement.session_class_id if placement else None
    q = Q(**{f'{field}__isnull': True})
    if section_id:
        q |= Q(**{f'{field}_id': section_id})
    return q


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
