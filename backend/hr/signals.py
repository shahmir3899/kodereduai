"""
Cache invalidation for the HR dashboard summary (see dashboard_stats in
hr/views.py).

HR has 20+ write endpoints that can change the numbers on that dashboard
(staff CRUD, reactivate, department/payslip CRUD, leave approve/reject/
cancel, bulk attendance marking...). Hooking cache-busting into each view
action individually is exactly how the accounts-balance caching bug earlier
this session happened — easy to miss one path and end up with a number that
silently doesn't update. Signals catch every .save()/.delete() call on the
underlying models uniformly, regardless of which view or action triggered
it (the one gap: Django's bulk_update()/bulk_create() don't fire these
signals — none of the current HR write paths use them, but keep that in
mind if one is added later).
"""
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.core.cache import cache

from hr.models import (
    StaffMember,
    StaffDepartment,
    Payslip,
    LeaveApplication,
    StaffAttendance,
)


def bust_hr_dashboard_cache(school_id):
    if school_id:
        cache.delete(f'hr:dashboard_stats:{school_id}')


@receiver([post_save, post_delete], sender=StaffMember)
def _staff_member_changed(sender, instance, **kwargs):
    bust_hr_dashboard_cache(instance.school_id)


@receiver([post_save, post_delete], sender=StaffDepartment)
def _staff_department_changed(sender, instance, **kwargs):
    bust_hr_dashboard_cache(instance.school_id)


@receiver([post_save, post_delete], sender=Payslip)
def _payslip_changed(sender, instance, **kwargs):
    bust_hr_dashboard_cache(instance.school_id)


@receiver([post_save, post_delete], sender=LeaveApplication)
def _leave_application_changed(sender, instance, **kwargs):
    bust_hr_dashboard_cache(instance.school_id)


@receiver([post_save, post_delete], sender=StaffAttendance)
def _staff_attendance_changed(sender, instance, **kwargs):
    bust_hr_dashboard_cache(instance.school_id)
