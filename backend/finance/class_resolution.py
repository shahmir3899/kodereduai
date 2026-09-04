"""Shared fallback for resolving a student's SessionClass when no StudentEnrollment
row links them to one for the academic year in question.

Used by both FeePaymentSerializer (backend/finance/serializers.py) and fee_summary's
by_class breakdown (backend/finance/views.py) so a student with no enrollment record
at all for the current academic year — not just an *inactive* one — still resolves to
the correct class-wise breakdown row instead of falling into a separate "master class"
bucket that visually duplicates the class (see CLASS_SYSTEM_GUIDE.md Known Issue 6 for
the underlying orphan-link pattern this works around).

Deliberately conservative: only resolves when the master class maps to exactly one
active SessionClass for the year. If a master class has genuinely split into two or
more sections, there is no safe way to guess which one an unlinked student belongs to,
so the caller falls back to its existing master-class-only grouping instead — this
mirrors the "only link when exactly one unambiguous match exists" rule already used by
academic_sessions/migrations/0007_studentenrollment_session_class.py's backfill,
rather than the riskier "use the first match" heuristic used elsewhere.
"""
from academic_sessions.models import SessionClass


def resolve_unambiguous_session_class(class_obj_id, academic_year_id, school_id):
    """Return the single active SessionClass for (school, academic_year, class_obj),
    or None if there isn't exactly one (no match, or an ambiguous multi-section match)."""
    if not class_obj_id or not academic_year_id or not school_id:
        return None

    matches = list(
        SessionClass.objects.filter(
            school_id=school_id,
            academic_year_id=academic_year_id,
            class_obj_id=class_obj_id,
            is_active=True,
        )[:2]
    )
    if len(matches) == 1:
        return matches[0]
    return None
