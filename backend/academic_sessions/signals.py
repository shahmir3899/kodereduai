"""
Cache invalidation for the AcademicYearViewSet list cache (see .list() override
in academic_sessions/views.py) — same pattern as hostel/signals.py.
"""
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.core.cache import cache

from academic_sessions.models import AcademicYear


@receiver([post_save, post_delete], sender=AcademicYear)
def _academic_year_changed(sender, instance, **kwargs):
    if instance.school_id:
        cache.delete(f'academic-years:list:{instance.school_id}')
