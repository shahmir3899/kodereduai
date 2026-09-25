"""
Which timetable entries apply to a section.

TimetableEntry rows with no session_class are the class's shared timetable;
rows with a session_class are that section's overrides for a day/slot. A
section sees its overrides plus the shared entries at every day/slot it hasn't
overridden. Shared by the timetable API and the student/parent portals so both
show the same grid.
"""
from django.db.models import Exists, OuterRef, Q

from .models import TimetableEntry


def section_timetable(queryset, session_class_id):
    """Narrow a TimetableEntry queryset (already limited to the section's
    master class) to that section's effective timetable."""
    overrides = TimetableEntry.objects.filter(
        session_class_id=session_class_id, day=OuterRef('day'), slot_id=OuterRef('slot_id'),
    )
    return queryset.annotate(_overridden=Exists(overrides)).filter(
        Q(session_class_id=session_class_id) | Q(session_class__isnull=True, _overridden=False)
    )


def split_shared_timetable(school_id, class_obj_id, academic_year_id):
    """Give every section of a class its own copy of the shared timetable.

    Each shared entry is copied into each section that doesn't already
    override that day/slot, then the shared entries are removed, so sections
    are edited independently from then on. The shared timetable taught both
    sections at once, so the same teacher now sits in two sections at the same
    period; those clashes are counted for the caller to report.

    Returns {'sections', 'created', 'removed_shared', 'teacher_clashes'} or
    raises ValueError when the class has fewer than two sections this year.
    """
    from django.db import transaction
    from django.db.models import Count

    from academic_sessions.models import SessionClass

    sections = list(SessionClass.objects.filter(
        school_id=school_id, academic_year_id=academic_year_id, class_obj_id=class_obj_id, is_active=True,
    ))
    if len(sections) < 2:
        raise ValueError('This class has only one section this year; there is nothing to split.')

    with transaction.atomic():
        shared = list(TimetableEntry.objects.filter(
            school_id=school_id, class_obj_id=class_obj_id, session_class__isnull=True,
        ))
        overridden = set(TimetableEntry.objects.filter(
            school_id=school_id, session_class__in=sections,
        ).values_list('session_class_id', 'day', 'slot_id'))

        copies = [
            TimetableEntry(
                school_id=school_id, class_obj_id=class_obj_id, session_class=section,
                academic_year_id=entry.academic_year_id or academic_year_id,
                day=entry.day, slot_id=entry.slot_id, subject_id=entry.subject_id,
                teacher_id=entry.teacher_id, room=entry.room,
            )
            for section in sections
            for entry in shared
            if (section.id, entry.day, entry.slot_id) not in overridden
        ]
        TimetableEntry.objects.bulk_create(copies)
        TimetableEntry.objects.filter(id__in=[e.id for e in shared]).delete()

        clashes = (
            TimetableEntry.objects
            .filter(school_id=school_id, session_class__in=sections, teacher__isnull=False)
            .values('day', 'slot_id', 'teacher_id')
            .annotate(n=Count('id'))
            .filter(n__gt=1)
            .count()
        )

    return {
        'sections': [s.label for s in sections],
        'created': len(copies),
        'removed_shared': len(shared),
        'teacher_clashes': clashes,
    }


def student_timetable(student):
    """Effective timetable entries for a student's current placement."""
    from academic_sessions.roster import current_placement

    placement = current_placement(student)
    class_obj_id = placement.class_obj_id if placement else student.class_obj_id
    queryset = TimetableEntry.objects.filter(class_obj_id=class_obj_id, school_id=student.school_id)
    if placement and placement.session_class_id:
        return section_timetable(queryset, placement.session_class_id)
    return queryset.filter(session_class__isnull=True)
