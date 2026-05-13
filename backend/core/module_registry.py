"""
Canonical module registry for the platform.
Defines all toggleable modules with metadata.
"""

MODULE_REGISTRY = {
    'attendance': {
        'key': 'attendance',
        'label': 'Attendance',
        'description': 'Student attendance capture, review, register & analytics',
        'icon': 'clipboard',
        'dependencies': ['students'],
    },
    'finance': {
        'key': 'finance',
        'label': 'Finance',
        'description': 'Fee collection, expenses, accounts & financial reports',
        'icon': 'currency',
        'dependencies': ['students'],
    },
    'hr': {
        'key': 'hr',
        'label': 'HR & Payroll',
        'description': 'Staff management, payroll, leave, attendance & appraisals',
        'icon': 'briefcase',
        'dependencies': [],
    },
    'academics': {
        'key': 'academics',
        'label': 'Academics',
        'description': 'Subjects, timetable, academic sessions & promotion',
        'icon': 'book',
        'dependencies': ['students'],
    },
    'examinations': {
        'key': 'examinations',
        'label': 'Examinations',
        'description': 'Exam types, scheduling, marks entry, results & report cards',
        'icon': 'document',
        'dependencies': ['students', 'academics'],
    },
    'students': {
        'key': 'students',
        'label': 'Students & Classes',
        'description': 'Grades, classes & student management',
        'icon': 'users',
        'dependencies': [],
    },
    'notifications': {
        'key': 'notifications',
        'label': 'Notifications',
        'description': 'WhatsApp notifications for absences & announcements',
        'icon': 'bell',
        'dependencies': ['attendance'],
    },
    'parents': {
        'key': 'parents',
        'label': 'Parent Portal',
        'description': 'Parent access to child info, fees, attendance, messaging',
        'icon': 'users',
        'dependencies': ['students'],
    },
    'admissions': {
        'key': 'admissions',
        'label': 'Admission CRM',
        'description': 'Lead tracking, admission pipeline, enquiry management',
        'icon': 'user-plus',
        'dependencies': ['students'],
    },
    'lms': {
        'key': 'lms',
        'label': 'LMS',
        'description': 'Lesson plans, homework, assignments & submissions',
        'icon': 'book-open',
        'dependencies': ['students', 'academics'],
    },
    'transport': {
        'key': 'transport',
        'label': 'Transportation',
        'description': 'Routes, vehicles, student transport assignments & attendance',
        'icon': 'truck',
        'dependencies': ['students'],
    },
    'library': {
        'key': 'library',
        'label': 'Library',
        'description': 'Book catalog, issue/return tracking, fines & overdue management',
        'icon': 'library',
        'dependencies': ['students'],
    },
    'hostel': {
        'key': 'hostel',
        'label': 'Hostel Management',
        'description': 'Hostels, rooms, student allocations, gate passes & leave tracking',
        'icon': 'building',
        'dependencies': ['students'],
    },
    'inventory': {
        'key': 'inventory',
        'label': 'Inventory & Store',
        'description': 'Item tracking, stock levels, assignments to users & procurement',
        'icon': 'package',
        'dependencies': [],
    },
}

ALL_MODULE_KEYS = list(MODULE_REGISTRY.keys())

# ---------------------------------------------------------------------------
# DEPRECATED: Capability registry and Bundle presets (2026-05-13)
# Moved to a flat pricing model — all modules available on a single plan.
# CAPABILITY_REGISTRY and BUNDLE_PRESETS have been removed.
# Module on/off toggles (per school, in MODULE_REGISTRY) are still used
# for operational control but are no longer commercial gates.
#
# If you need to restore the entitlements system:
# git show HEAD:backend/core/module_registry.py | grep -A200 CAPABILITY_REGISTRY
# ---------------------------------------------------------------------------


def get_default_modules():
    """Returns a dict with all modules enabled (used as JSONField default)."""
    return {key: True for key in ALL_MODULE_KEYS}


def get_default_entitlements():
    """
    DEPRECATED (2026-05-13): Entitlements system removed (flat pricing model).
    Kept as a stub so historical migrations (0015_add_module_entitlements) continue to resolve.
    Returns empty dict — no capability gating is applied.
    """
    return {}


def validate_module_keys(modules_dict):
    """Validate that all keys in a modules dict are recognized module keys."""
    invalid = set(modules_dict.keys()) - set(ALL_MODULE_KEYS)
    if invalid:
        raise ValueError(f"Unknown module keys: {', '.join(invalid)}")
