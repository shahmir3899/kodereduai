"""Shared helpers for resolving session-year-specific class display names.

Several models (TimetableEntry, Exam, LessonPlan, and the attendance
`my_classes` action) reference a master `students.Class` row via `class_obj`
but have no direct FK to `SessionClass`. Schools can rename/re-section a
class for a given academic year via `SessionClass` without touching the
underlying master `Class` row, so any UI surfacing a class name for a
specific academic year should prefer the `SessionClass.display_name` for
that year over the master `Class.name`.
"""

from django.db.models import OuterRef, Subquery


def annotate_session_class_display(queryset, class_field='class_obj_id', academic_year_field='academic_year_id'):
    """Annotate a queryset with `session_display_name`/`session_display_section`
    sourced from the SessionClass matching each row's (class_obj, academic_year).

    Falls back to null when no active SessionClass exists for that pair —
    callers should fall back to the master Class name/section in that case.
    """
    from .models import SessionClass

    session_qs = SessionClass.objects.filter(
        class_obj_id=OuterRef(class_field),
        academic_year_id=OuterRef(academic_year_field),
        is_active=True,
    ).order_by('id')

    return queryset.annotate(
        session_display_name=Subquery(session_qs.values('display_name')[:1]),
        session_display_section=Subquery(session_qs.values('section')[:1]),
    )


def get_session_class_label_map(school_id, academic_year_id, class_obj_ids):
    """Return {class_obj_id: {'name': display_name, 'section': section}} for the
    given academic year's active SessionClass rows. Empty dict when there's no
    academic year to resolve against.
    """
    if not academic_year_id or not class_obj_ids:
        return {}

    from .models import SessionClass

    rows = SessionClass.objects.filter(
        school_id=school_id,
        academic_year_id=academic_year_id,
        class_obj_id__in=list(class_obj_ids),
        is_active=True,
    ).values('class_obj_id', 'display_name', 'section')

    result = {}
    for row in rows:
        result.setdefault(row['class_obj_id'], {'name': row['display_name'], 'section': row['section']})
    return result


def resolve_class_display_name(school_id, academic_year_id, class_obj):
    """Single-object session-aware display label for a master Class, given an
    academic year. Falls back to the master Class name/section when no active
    SessionClass exists for that pair, or when `class_obj` is None.
    """
    if class_obj is None:
        return None

    if academic_year_id:
        from .models import SessionClass

        session_class = SessionClass.objects.filter(
            school_id=school_id,
            academic_year_id=academic_year_id,
            class_obj_id=class_obj.id,
            is_active=True,
        ).only('display_name', 'section').first()
        if session_class:
            return (
                f"{session_class.display_name} - {session_class.section}"
                if session_class.section else session_class.display_name
            )

    return f"{class_obj.name} - {class_obj.section}" if class_obj.section else class_obj.name


def resolve_current_academic_year_id(school_id):
    """Return the id of the school's current+active academic year, or None."""
    from .models import AcademicYear

    academic_year = AcademicYear.objects.filter(
        school_id=school_id, is_current=True, is_active=True,
    ).only('id').first()
    return academic_year.id if academic_year else None
