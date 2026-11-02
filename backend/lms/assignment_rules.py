"""Rules for assignments a MANAGER drafts.

A manager may prepare assignments but a teacher (or an admin) publishes them, and the
teacher recorded on the row is never chosen by the manager: it is the teacher the school
already assigned to that subject for that class or section (academics.ClassSubject).
Refusing when that is not exactly one person is deliberate; a guess would put the wrong
name in front of students.
"""
from academics.models import ClassSubject

NO_TEACHER = (
    'No teacher is assigned to this subject for this class. '
    'Ask the school admin to assign one, then try again.'
)
MANY_TEACHERS = (
    'More than one teacher is assigned to this subject for this class, so the assignment '
    'cannot pick one. Choose a single section, or ask a teacher or the school admin to create it.'
)


def resolve_subject_teacher(school_id, academic_year_id, class_obj_id, subject_id, session_class_id=None):
    """Return (teacher_id, error_message); exactly one of them is None.

    For a section, that section's own subject assignment is used; when the section has none,
    the class-wide one (no section) is. For a whole-class assignment every section's teacher
    counts, and they must all be the same person.
    """
    rows = ClassSubject.objects.filter(
        school_id=school_id, class_obj_id=class_obj_id, subject_id=subject_id,
        is_active=True, teacher__isnull=False,
    )
    if academic_year_id:
        rows = rows.filter(academic_year_id=academic_year_id)

    if session_class_id:
        own = rows.filter(session_class_id=session_class_id)
        rows = own if own.exists() else rows.filter(session_class__isnull=True)

    teachers = set(rows.values_list('teacher_id', flat=True))
    if not teachers:
        return None, NO_TEACHER
    if len(teachers) > 1:
        return None, MANY_TEACHERS
    return teachers.pop(), None
