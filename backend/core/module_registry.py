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
# Capability registry
# Each module can expose fine-grained capabilities controlled per entitlement.
# ---------------------------------------------------------------------------
CAPABILITY_REGISTRY = {
    'attendance': [
        'manual_entry',        # Staff can mark attendance by ticking names
        'register_upload',     # Upload photo of handwritten register
        'ocr_review',          # Review AI-extracted marks before confirming
        'face_recognition',    # Face-recognition based auto-attendance
        'basic_analytics',     # Class-level summary charts
        'advanced_analytics',  # Cross-class, trend, and export reports
        'auto_tune',           # AI pipeline auto-tuning from feedback
    ],
    'finance': [
        'fee_collection',      # Record fee payments
        'expenses',            # Track school expenses
        'accounts',            # General ledger / accounts
        'discounts',           # Student fee discounts
        'payment_gateway',     # Online payment gateway integration
        'financial_reports',   # P&L, balance sheet exports
    ],
    'hr': [
        'staff_profiles',      # Manage staff records
        'payroll',             # Salary and payslip generation
        'leave_management',    # Leave requests and approval
        'appraisals',          # Staff performance appraisals
    ],
    'academics': [
        'subjects',            # Subject master and assignment to classes
        'timetable',           # Weekly timetable builder
        'academic_sessions',   # Academic year and term management
        'promotions',          # Bulk student promotion between years
    ],
    'examinations': [
        'exam_scheduling',     # Create exam types and schedules
        'marks_entry',         # Enter marks per student
        'report_cards',        # Generate and download report cards
        'paper_builder',       # AI curriculum paper / question paper builder
        'grade_scales',        # Custom grade scale configuration
    ],
    'students': [
        'student_profiles',    # Basic student records
        'document_store',      # Attach documents to student profiles
        'bulk_import',         # Bulk CSV import of students
    ],
    'notifications': [
        'broadcast',           # Send broadcast messages to parents/staff
        'absence_alerts',      # Automatic WhatsApp alerts on absence
        'ai_compose',          # AI-assisted message drafting
    ],
    'parents': [
        'parent_portal',       # Parents can log in and view child info
        'messaging',           # Parent ↔ school messaging
        'leave_requests',      # Parents can submit leave requests
    ],
    'admissions': [
        'enquiry_tracking',    # Log and track admission enquiries
        'pipeline',            # Kanban pipeline for admission stages
        'batch_conversion',    # Bulk convert enquiries to students
        'analytics',           # Admissions funnel analytics
    ],
    'lms': [
        'lesson_plans',        # Lesson plan builder
        'assignments',         # Create and assign homework
        'submissions',         # Student assignment submissions
    ],
    'transport': [
        'routes',              # Route and stop management
        'gps_tracking',        # Real-time GPS vehicle tracking
    ],
    'library': [
        'catalog',             # Book catalog management
        'issue_return',        # Issue and return tracking
        'overdue_fines',       # Overdue fine calculation
    ],
    'hostel': [
        'room_management',     # Hostel and room setup
        'allocations',         # Student room allocations
        'gate_passes',         # Gate pass and leave tracking
    ],
    'inventory': [
        'item_tracking',       # Item master and stock levels
        'procurement',         # Purchase orders
        'assignments',         # Assign items to staff/students
    ],
}

# ---------------------------------------------------------------------------
# Commercial bundle presets
# Each preset defines which modules are enabled and which capabilities are on.
# ---------------------------------------------------------------------------
BUNDLE_PRESETS = {
    'STARTER': {
        'label': 'Starter',
        'description': 'Core student + manual attendance for small schools',
        'modules': {
            'students': True,
            'attendance': True,
            'academics': True,
            'notifications': True,
            # all others OFF
        },
        'entitlements': {
            'students':      ['student_profiles'],
            'attendance':    ['manual_entry', 'basic_analytics'],
            'academics':     ['subjects', 'timetable'],
            'notifications': ['broadcast'],
        },
    },
    'GROWTH': {
        'label': 'Growth',
        'description': 'Starter + finance, exams, parents, admissions, LMS and OCR upload',
        'modules': {
            'students': True,
            'attendance': True,
            'academics': True,
            'notifications': True,
            'finance': True,
            'examinations': True,
            'parents': True,
            'admissions': True,
            'lms': True,
        },
        'entitlements': {
            'students':      ['student_profiles', 'document_store', 'bulk_import'],
            'attendance':    ['manual_entry', 'register_upload', 'ocr_review', 'basic_analytics'],
            'academics':     ['subjects', 'timetable', 'academic_sessions', 'promotions'],
            'notifications': ['broadcast', 'absence_alerts'],
            'finance':       ['fee_collection', 'expenses', 'discounts', 'financial_reports'],
            'examinations':  ['exam_scheduling', 'marks_entry', 'report_cards', 'grade_scales'],
            'parents':       ['parent_portal', 'messaging', 'leave_requests'],
            'admissions':    ['enquiry_tracking', 'pipeline', 'batch_conversion'],
            'lms':           ['lesson_plans', 'assignments', 'submissions'],
        },
    },
    'ENTERPRISE': {
        'label': 'Enterprise',
        'description': 'All modules with premium AI capabilities',
        'modules': {key: True for key in MODULE_REGISTRY},
        'entitlements': {key: list(caps) for key, caps in CAPABILITY_REGISTRY.items()},
    },
}


def get_default_modules():
    """Returns a dict with all modules enabled (used as JSONField default)."""
    return {key: True for key in ALL_MODULE_KEYS}


def get_default_entitlements():
    """Returns a dict with all capabilities enabled (used as JSONField default for new schools)."""
    return {key: list(caps) for key, caps in CAPABILITY_REGISTRY.items()}


def validate_module_keys(modules_dict):
    """Validate that all keys in a modules dict are recognized module keys."""
    invalid = set(modules_dict.keys()) - set(ALL_MODULE_KEYS)
    if invalid:
        raise ValueError(f"Unknown module keys: {', '.join(invalid)}")


def validate_entitlements(entitlements_dict):
    """Validate that all module and capability keys in entitlements are recognized."""
    for mod_key, caps in entitlements_dict.items():
        if mod_key not in CAPABILITY_REGISTRY:
            raise ValueError(f"Unknown module key in entitlements: '{mod_key}'")
        valid_caps = set(CAPABILITY_REGISTRY[mod_key])
        unknown_caps = set(caps) - valid_caps
        if unknown_caps:
            raise ValueError(
                f"Unknown capabilities for module '{mod_key}': {', '.join(unknown_caps)}"
            )
