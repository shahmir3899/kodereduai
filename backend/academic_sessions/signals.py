"""
Cache invalidation for the AcademicYearViewSet list cache (see .list() in
academic_sessions/views.py). The list annotates term and enrollment counts, so
those models bump the group too.
"""
from core.cache_utils import invalidate_group_on_change
from academic_sessions.models import AcademicYear, Term, StudentEnrollment

invalidate_group_on_change('academic_years', AcademicYear, Term, StudentEnrollment)
