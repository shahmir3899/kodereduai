"""
Cache invalidation for the HR dashboard summary (see dashboard_stats in
hr/views.py).

HR has 20+ write endpoints that can change the numbers on that dashboard, so
instead of busting from each view action we bump a version on every
.save()/.delete() of the underlying models, however the write was triggered.
The gap: bulk_create()/bulk_update()/queryset.update() don't fire signals, so
those paths are only covered by the endpoint's TTL.
"""
from core.cache_utils import invalidate_group_on_change
from hr.models import (
    StaffMember,
    StaffDepartment,
    Payslip,
    LeaveApplication,
    StaffAttendance,
)

invalidate_group_on_change(
    'hr_dashboard',
    StaffMember, StaffDepartment, Payslip, LeaveApplication, StaffAttendance,
)
