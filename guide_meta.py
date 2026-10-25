"""
Role/module tags and "Show me" links for the in-app User Guide.

Imported by generate_user_guide.py. Kept separate so the audience of each
chapter and the sidebar-path -> route table can be reviewed without reading
the 2000-line guide text.

Roles are checked against Layout.jsx (sidebar visibility per role) on
2026-10-18. SUPER_ADMIN is not listed: the guide page treats it as "all".
A missing `roles` means "every role"; a missing `module` means "no module".
"""

ADM = ['SCHOOL_ADMIN', 'PRINCIPAL']
TCH = ['TEACHER']
MGR = ['MANAGER']
ACC = ['ACCOUNTANT']
STF = ['STAFF']
DRV = ['DRIVER']
# Everyone with a staff-level login except Manager (Layout.jsx hides
# Transport/Library/Hostel from Manager only).
NON_MANAGER_STAFF = ADM + TCH + ACC + STF + DRV

# chapter number -> {roles, module}
CHAPTER_TAGS = {
    2: {'roles': ADM},
    3: {'roles': ADM + TCH, 'module': 'attendance'},
    4: {'roles': ADM + TCH, 'module': 'attendance'},
    5: {'roles': ADM + MGR + TCH, 'module': 'academics'},
    6: {'roles': ADM + MGR + TCH, 'module': 'examinations'},
    7: {'roles': ADM + ACC, 'module': 'finance'},
    8: {'roles': ADM, 'module': 'hr'},
    9: {'roles': ADM, 'module': 'admissions'},
    10: {'roles': NON_MANAGER_STAFF, 'module': 'transport'},
    11: {'roles': ADM, 'module': 'library'},  # every Library write is admin/principal only; other staff roles can only browse
    12: {'roles': ADM + MGR + TCH, 'module': 'lms'},
    13: {'module': 'notifications'},
    15: {'roles': ['PARENT']},
    16: {'roles': ['STUDENT']},
    17: {'roles': ADM, 'module': 'hostel'},  # Hostel lists students and gate-pass reasons: admin/principal only (API refuses the rest)
    18: {'roles': ADM},
    19: {'roles': ADM},
    20: {'roles': ADM},
    21: {'roles': ADM + ACC, 'module': 'inventory'},
}

# The short "Start here" path each role sees first on the guide page: section ids in the order a new
# user should do them. Sections the user cannot see (role or disabled module) are skipped by the page.
START_HERE = {
    'SCHOOL_ADMIN': ['1.3', '2.7', '2.1', '2.2', '2.3', '2.4', '2.5', '3.1'],
    'PRINCIPAL': ['1.3', '2.7', '2.1', '2.2', '2.3', '2.4', '2.5', '3.1'],
    'TEACHER': ['1.3', '3.1', '3.2', '3.3', '6.4', '12.2'],
    'MANAGER': ['1.3', '5.1', '5.5'],
    'ACCOUNTANT': ['1.3', '7.1', '7.3', '7.6', '7.9'],
    'STAFF': ['1.3', '13.1'],
    'DRIVER': ['1.3', '10.4'],
    'PARENT': ['1.3', '15.2', '15.3'],
    'STUDENT': ['1.3', '16.4', '16.6', '16.8'],
}

# section id -> overrides of its chapter's tags
SECTION_TAGS = {
    '5.3': {'roles': ADM},
    '5.5': {'roles': ADM + MGR},
    '6.1': {'roles': ADM},
    '6.7': {'roles': ADM},
    '6.12': {'roles': ADM + TCH},          # Curriculum Coverage: hidden from Manager/Staff
    '7.5': {'roles': ADM + ACC + TCH},     # Collect Payments is visible to Teacher
    '7.6': {'roles': ADM + ACC + TCH},
    '8.12': {'roles': TCH + MGR + ACC + STF + DRV},  # Self Service / My Leave
    '13.2': {'roles': ADM},
    '13.3': {'roles': ADM},
    '13.4': {'roles': ADM},
    '13.5': {'roles': ADM},
    '20.1': {'roles': ADM + TCH + ACC},    # AI dashboard insights
    '20.3': {'roles': ADM + TCH},          # AI report card comments
    '3.1': {'video': 'mark-attendance'},
    '3.2': {'video': 'attendance-already-marked'},
    '21.4': {'roles': ADM + ACC + TCH + STF},  # Assignments (Teacher/Staff only if assigned items)
}

# Sidebar paths that were wrong in the old guide -> the real label.
PATH_FIXES = {
    'Sidebar > Academics > Sessions': 'Sidebar > Management > Sessions',
    'Sidebar > Academics > Promotion': 'Sidebar > Management > Promotion',
    'Sidebar > Academics > AI Analytics': 'Sidebar > AI Analytics',
    'Sidebar > Attendance > Face Attendance': 'Sidebar > Attendance > 2. Face Attendance',
    'Sidebar > Academics > Examinations > ': 'Sidebar > Academics > ',
    'Sidebar > Finance > Fee Collection': 'Sidebar > Finance > Collect Payments',
    'Sidebar > HR & Staff > Salary Management': 'Sidebar > HR & Staff > Salary',
    'Sidebar > HR & Staff > Leave Management': 'Sidebar > HR & Staff > Leave',
    'Sidebar > HR & Staff > Staff Attendance': 'Sidebar > HR & Staff > Attendance',
    'Sidebar > HR & Staff > Performance Appraisals': 'Sidebar > HR & Staff > Performance',
    'Sidebar > Library > Overdue Books': 'Sidebar > Library > Overdue',
    'Sidebar > Academics > LMS > Lesson Plans': 'Sidebar > Planning & Delivery > Lesson Plans',
    'Sidebar > Academics > LMS > Assignments': 'Sidebar > Academics > Assignments',
    'Sidebar > Academics > Curriculum': 'Sidebar > Content Creation > Curriculum',
    'Sidebar > Settings > Accounts Tab > Close Month': 'Sidebar > Finance > Accounts > Close Month',
    'Sidebar > Settings > Accounts Tab': 'Sidebar > Finance > Accounts',
    'Attendance > At-Risk Students': 'Dashboard > AI Insights > At-Risk Students',
}

# Longest-prefix match: sidebar path prefix -> route.
NAV_LINKS = {
    'Sidebar > Dashboard': '/dashboard',
    'Sidebar > Attendance > 1. Manual Entry': '/attendance/manual-entry',
    'Sidebar > Attendance > 2. Face Attendance': '/face-attendance',
    'Sidebar > Attendance > Attendance Record': '/attendance/register',
    'Dashboard > AI Insights > At-Risk Students': '/attendance/at-risk',
    'Sidebar > Finance > Dashboard': '/finance',
    'Sidebar > Finance > Accounts': '/finance/accounts',
    'Sidebar > Finance > Fee Overview': '/finance/fees',
    'Sidebar > Finance > Collect Payments': '/finance/fees/collect',
    'Sidebar > Finance > Fee Setup': '/finance/fees/setup',
    'Sidebar > Finance > Other Income': '/finance/income',
    'Sidebar > Finance > Expenses': '/finance/expenses',
    'Sidebar > Finance > Discounts': '/finance/discounts',
    'Sidebar > Academics > Subjects': '/academics/subjects',
    'Sidebar > Academics > Timetable': '/academics/timetable',
    'Sidebar > Academics > Exam Types': '/academics/exam-types',
    'Sidebar > Academics > Exams': '/academics/exams',
    'Sidebar > Academics > Assessments': '/assessments',
    'Sidebar > Academics > Marks Entry': '/academics/marks-entry',
    'Sidebar > Academics > Grade Scale': '/academics/grade-scale',
    'Sidebar > Academics > Results': '/academics/results',
    'Sidebar > Academics > Report Cards': '/academics/report-cards',
    'Sidebar > Academics > Assignments': '/academics/assignments',
    'Sidebar > Content Creation > Question Bank': '/academics/questions',
    'Sidebar > Content Creation > Paper Builder': '/academics/paper-builder',
    'Sidebar > Content Creation > Question Papers': '/academics/papers',
    'Sidebar > Content Creation > Worksheets': '/academics/worksheets',
    'Sidebar > Content Creation > Curriculum': '/academics/curriculum',
    'Sidebar > Planning & Delivery > Curriculum Coverage': '/academics/curriculum-coverage',
    'Sidebar > Planning & Delivery > Lesson Plans': '/academics/lesson-plans',
    'Sidebar > AI Analytics': '/academics/analytics',
    'Sidebar > Academic Risk': '/academics/academic-risk',
    'Sidebar > HR & Staff > Staff Directory': '/hr/staff',
    'Sidebar > HR & Staff > Departments': '/hr/departments',
    'Sidebar > HR & Staff > Salary': '/hr/salary',
    'Sidebar > HR & Staff > Payroll': '/hr/payroll',
    'Sidebar > HR & Staff > Leave': '/hr/leave',
    'Sidebar > HR & Staff > Attendance': '/hr/attendance',
    'Sidebar > HR & Staff > Performance': '/hr/appraisals',
    'Sidebar > HR & Staff > Documents': '/hr/documents',
    'Sidebar > HR & Staff > Letter Composer': '/hr/letters',
    'Sidebar > HR & Staff > Staff Risk': '/hr/risk',
    'Sidebar > Self Service': '/hr/self-service',
    'Sidebar > Management > Classes': '/classes',
    'Sidebar > Management > Students': '/students',
    'Sidebar > Management > Student Risk Score': '/students/risk-score',
    'Sidebar > Management > Academic Calendar': '/academics/calendar',
    'Sidebar > Management > Sessions': '/academics/sessions',
    'Sidebar > Management > Promotion': '/academics/promotion',
    'Sidebar > Notifications': '/notifications',
    'Sidebar > Messages': '/messages',
    'Sidebar > Admissions > Enquiries': '/admissions',
    'Sidebar > Transport > Dashboard': '/transport',
    'Sidebar > Transport > Routes': '/transport/routes',
    'Sidebar > Transport > Vehicles': '/transport/vehicles',
    'Sidebar > Transport > Assignments': '/transport/assignments',
    'Sidebar > Transport > Attendance': '/transport/attendance',
    'Sidebar > Library > Dashboard': '/library',
    'Sidebar > Library > Catalog': '/library/catalog',
    'Sidebar > Library > Issue / Return': '/library/issues',
    'Sidebar > Library > Overdue': '/library/overdue',
    'Sidebar > Hostel > Dashboard': '/hostel',
    'Sidebar > Hostel > Rooms': '/hostel/rooms',
    'Sidebar > Hostel > Allocations': '/hostel/allocations',
    'Sidebar > Hostel > Gate Passes': '/hostel/gate-passes',
    'Sidebar > Inventory > Dashboard': '/inventory',
    'Sidebar > Inventory > Items': '/inventory/items',
    'Sidebar > Inventory > Transactions': '/inventory/transactions',
    'Sidebar > Inventory > Assignments': '/inventory/assignments',
    'Sidebar > Inventory > Reorder Prediction': '/inventory/reorder-prediction',
    'Sidebar > School Setup': '/school-setup',
    'Sidebar > Settings': '/settings',
    'Login as Parent > Dashboard': '/parent/dashboard',
    'Parent Portal > Leave Application': '/parent/leave',
    'Login as Student > Dashboard': '/student/dashboard',
    'Student Portal > Attendance': '/student/attendance',
    'Student Portal > Timetable': '/student/timetable',
    'Student Portal > Assignments': '/student/assignments',
    'Student Portal > Fees': '/student/fees',
    'Student Portal > Results': '/student/results',
    'Student Portal > My Profile': '/student/profile',
    'Student Portal > AI Study Helper': '/student/study-helper',
}


def link_for(path):
    """Route for the longest NAV_LINKS prefix of a guide path, or None."""
    best = None
    for prefix, href in NAV_LINKS.items():
        if (path == prefix or path.startswith(prefix + ' > ')) and (best is None or len(prefix) > len(best[0])):
            best = (prefix, href)
    return best[1] if best else None


# --- Video slots -----------------------------------------------------------
# Every section with at least VIDEO_MIN_STEPS steps gets a video slot in the
# guide; its tutorial is "ready" once files exist in frontend/public/videos and
# the entry in guideVideos.json says so, otherwise "planned" (shown to admins
# as a placeholder). VIDEO_EXCLUDE lists sections that should never get a slot.
VIDEO_MIN_STEPS = 3
VIDEO_EXCLUDE = {'7.10'}  # online payments are not enabled yet


def _video_id(chapter, section):
    return section.get('video') or 'ch%s-%s' % (chapter['id'], section['slug'])


def _plain_title(title):
    """'Step 3: Add Students' -> 'Add Students'."""
    return title.split(': ', 1)[1] if title.startswith('Step ') and ': ' in title else title


def sync_video_catalog(chapters, catalog_path):
    """Tag video-worthy sections and keep guideVideos.json in step with them.

    Entries without status "planned" are hand-maintained (ready videos) and are
    kept as they are; planned entries are rebuilt from the guide every run.
    """
    import json
    import os

    existing = {}
    if os.path.exists(catalog_path):
        with open(catalog_path, encoding='utf-8') as f:
            existing = json.load(f)
    ready = [v for v in existing.get('videos', []) if v.get('status') != 'planned']
    ready_ids = {v['id'] for v in ready}

    planned = []
    for chapter in chapters:
        for section in chapter['sections']:
            # A finished video always stays linked, however short the written steps become.
            ready_vid = _video_id(chapter, section)
            if ready_vid in ready_ids:
                section['video'] = ready_vid
                continue
            steps = sum(1 for item in section['content'] if item['type'] == 'step')
            if section['id'] in VIDEO_EXCLUDE or (steps < VIDEO_MIN_STEPS and not section.get('video')):
                continue
            vid = _video_id(chapter, section)
            section['video'] = vid
            if vid in ready_ids:
                continue
            entry = {
                'id': vid,
                'status': 'planned',
                'title': {'en': _plain_title(section['title']), 'ur': ''},
                'section': section['id'],
                'chapter': chapter['id'],
            }
            roles = section.get('roles') or chapter.get('roles')
            module = section.get('module') or chapter.get('module')
            if roles:
                entry['roles'] = roles
            if module:
                entry['module'] = module
            planned.append(entry)

    with open(catalog_path, 'w', encoding='utf-8') as f:
        json.dump({'videos': ready + planned}, f, indent=2, ensure_ascii=False)
        f.write('\n')
    return chapters


def apply_meta(chapters):
    """Add roles/module tags to chapters and sections, and href to nav_path items."""
    for ch_index, chapter in enumerate(chapters, start=1):
        tags = CHAPTER_TAGS.get(ch_index, {})
        if 'roles' in tags:
            chapter['roles'] = tags['roles']
        if 'module' in tags:
            chapter['module'] = tags['module']
        for section in chapter['sections']:
            sec_tags = SECTION_TAGS.get(section['id'], {})
            if 'roles' in sec_tags:
                section['roles'] = sec_tags['roles']
            if 'module' in sec_tags:
                section['module'] = sec_tags['module']
            if 'video' in sec_tags:
                section['video'] = sec_tags['video']
            for item in section['content']:
                if item['type'] == 'nav_path':
                    href = link_for(item['path'])
                    if href:
                        item['href'] = href
    return chapters
