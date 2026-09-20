"""
Cache invalidation for the hostel dashboard summary (HostelDashboardView in
hostel/views.py) — same pattern and caveats as hr/signals.py.
"""
from core.cache_utils import invalidate_group_on_change
from hostel.models import Hostel, Room, HostelAllocation, GatePass

invalidate_group_on_change('hostel_dashboard', Hostel, Room, HostelAllocation, GatePass)
