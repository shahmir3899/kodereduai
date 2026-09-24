"""
Single write path for a student's class placement within an academic year.

Placement is per section: ``StudentEnrollment.session_class`` is the source of
truth, and ``class_obj`` (master class) is only the grade/name link derived from
it. Writers that updated ``class_obj`` alone left ``session_class`` pointing at
the old section, so section-scoped rosters (exam marks, finance selection)
showed the student in the wrong class. Every writer that moves a student
should go through ``move_student`` instead of assigning the FKs by hand.
"""
from django.db import IntegrityError, transaction

from .models import AcademicYear, SessionClass, StudentEnrollment


def resolve_session_class(*, school_id, academic_year_id, class_obj_id, prefer_id=None):
    """Return the SessionClass for a master class in a year, or None.

    Two sections can share one master class, so a master class alone doesn't
    always identify a section. We never guess between them (the 0007/0008
    backfills did, and mis-linked rows as a result): keep ``prefer_id`` if it
    already belongs to this master class, otherwise use the only match, and
    return None when there are zero or several.
    """
    if not (academic_year_id and class_obj_id):
        return None

    candidates = SessionClass.objects.filter(
        school_id=school_id,
        academic_year_id=academic_year_id,
        class_obj_id=class_obj_id,
        is_active=True,
    )
    if prefer_id:
        preferred = candidates.filter(id=prefer_id).first()
        if preferred:
            return preferred

    matches = list(candidates[:2])
    return matches[0] if len(matches) == 1 else None


def ensure_session_class(*, school_id, academic_year_id, class_obj):
    """Get or create the SessionClass that mirrors ``class_obj`` in a year.

    Mirrors ``SessionClassViewSet.initialize``. If a row with the same
    display name/section already exists but is unlinked, link it rather than
    fail on ``unique_session_class_name_per_year``; if it is linked to a
    different master class, raise ValueError so the caller can report it.
    """
    existing = resolve_session_class(
        school_id=school_id, academic_year_id=academic_year_id, class_obj_id=class_obj.id,
    )
    if existing:
        return existing

    section = class_obj.section or ''
    try:
        with transaction.atomic():
            return SessionClass.objects.create(
                school_id=school_id,
                academic_year_id=academic_year_id,
                class_obj=class_obj,
                display_name=class_obj.name,
                section=section,
                grade_level=class_obj.grade_level,
                is_active=True,
            )
    except IntegrityError:
        clash = SessionClass.objects.filter(
            school_id=school_id,
            academic_year_id=academic_year_id,
            display_name=class_obj.name,
            section=section,
        ).first()
        if clash is None:
            raise
        if clash.class_obj_id not in (None, class_obj.id):
            raise ValueError(
                f"Session class '{clash.label}' already exists for this year "
                f"and is linked to a different class."
            )
        clash.class_obj = class_obj
        clash.is_active = True
        clash.save(update_fields=['class_obj', 'is_active', 'updated_at'])
        return clash


def current_academic_year_id(school_id):
    return (
        AcademicYear.objects.filter(school_id=school_id, is_current=True)
        .values_list('id', flat=True)
        .first()
    )


def move_student(enrollment, *, session_class=None, class_obj=None, roll_number=None,
                 sync_student=True):
    """Move an enrollment to a new section (or master class) and/or roll number.

    Pass ``session_class`` whenever the caller knows the section. Passing only
    ``class_obj`` resolves the section via ``resolve_session_class`` (keeping
    the current one if it still fits) and clears it when ambiguous, so the row
    shows up as unassigned instead of silently sitting in the wrong section.

    ``sync_student`` keeps the ``Student.class_obj``/``roll_number`` snapshot in
    step when the enrollment is for the current academic year.
    """
    if session_class is not None:
        enrollment.session_class = session_class
        if session_class.class_obj_id:
            enrollment.class_obj_id = session_class.class_obj_id
        elif class_obj is not None:
            # Orphan session class (no master link): the caller's master class
            # is the only grade information we have.
            enrollment.class_obj = class_obj
    elif class_obj is not None:
        enrollment.class_obj = class_obj
        enrollment.session_class = resolve_session_class(
            school_id=enrollment.school_id,
            academic_year_id=enrollment.academic_year_id,
            class_obj_id=class_obj.id,
            prefer_id=enrollment.session_class_id,
        )

    if roll_number is not None:
        enrollment.roll_number = roll_number

    enrollment.save(update_fields=['class_obj', 'session_class', 'roll_number', 'updated_at'])

    if sync_student and enrollment.academic_year_id == current_academic_year_id(enrollment.school_id):
        student = enrollment.student
        if (student.class_obj_id, student.roll_number) != (enrollment.class_obj_id, enrollment.roll_number):
            student.class_obj_id = enrollment.class_obj_id
            student.roll_number = enrollment.roll_number
            student.save(update_fields=['class_obj', 'roll_number', 'updated_at'])

    return enrollment
