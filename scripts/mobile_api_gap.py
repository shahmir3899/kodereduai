"""Regenerate docs/MOBILE_API_GAP_APPENDIX.md: which web API calls the mobile app also makes.

Run from the repo root:  python scripts/mobile_api_gap.py

It scans frontend/src and mobile/ for api.get/post/put/patch/delete calls with a literal URL, treats a
variable segment in a mobile URL as a wildcard, then writes:
  1. the totals,
  2. mobile-only calls (endpoints the web never uses; the goal is zero),
  3. a table grouped by feature in plain words,
  4. the full list of web endpoints the mobile app does not call.
A call built from a non-literal URL (a bare variable) is invisible to the scan; none exist today (checked 2026-11-02),
but re-check if a "missing" entry looks wrong.
"""
import collections
import datetime
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'MOBILE_API_GAP_APPENDIX.md')

CALL = re.compile(r"""\b(?:api|axios|client|http)\s*\.\s*(get|post|put|patch|delete)\s*(?:<[^>]*>)?\(\s*(`[^`]*`|'[^']*'|"[^"]*")""")
SKIP = ('mocks', 'node_modules', '__tests__', '.expo', 'dist', 'apps')


def norm(u):
    u = u[1:-1]
    u = re.sub(r"\$\{[^}]*\}", "{}", u)
    u = u.split('?')[0]
    u = re.sub(r"/\d+(?=/|$)", "/{}", u)
    u = re.sub(r"/:\w+(?=/|$)", "/{}", u)
    if not u.startswith('/'):
        u = '/' + u
    return u.rstrip('/') + '/'


def scan(root, exts):
    found = {}
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP]
        for f in files:
            if not f.endswith(exts) or '.test.' in f:
                continue
            p = os.path.join(d, f)
            txt = io.open(p, encoding='utf-8', errors='ignore').read()
            # `${q ? `?${q}` : ''}` nests a backtick, which cuts the URL short and made a bogus endpoint
            txt = re.sub(r"\$\{\s*\w+\s*\?\s*`\?\$\{\w+\}`\s*:\s*''\s*\}", '', txt)
            for m in CALL.finditer(txt):
                u = norm(m.group(2))
                if u.startswith('/api/'):
                    found.setdefault(f'{m.group(1).upper()} {u}', set()).add(os.path.relpath(p, root).replace(os.sep, '/'))
    return found


def rx(url):
    return re.compile('^' + re.escape(url).replace(re.escape('{}'), '[^/]+') + '$')


# key = "<app>/<first path segment>" (or "<app>" alone) -> (area, feature in plain words)
FEATURES = {
    'academics/ai-chat': ('Academics', 'AI assistant'), 'academics/analytics': ('Academics', 'AI analytics'),
    'academics/class-subjects': ('Academics', 'Subjects of each class'), 'academics/class-teachers': ('Academics', 'Class teachers'),
    'academics/subjects': ('Academics', 'Subjects'), 'academics/timetable-entries': ('Academics', 'Timetable'),
    'academics/timetable-slots': ('Academics', 'Periods and breaks'),
    'admin/activity-log': ('Super admin', 'Activity log'), 'admin/brochure': ('Super admin', 'Brochure'),
    'admin/memberships': ('Super admin', 'Memberships'), 'admin/organizations': ('Super admin', 'Organizations'), 'admin/schools': ('Super admin', 'Schools'),
    'admissions/conversion-likelihood': ('Admissions', 'Conversion likelihood'), 'admissions/enquiries': ('Admissions', 'Enquiries'),
    'admissions/followups': ('Admissions', 'Follow-ups'),
    'attendance/ai-status': ('Attendance', 'Photo register (OCR, parked)'), 'attendance/anomalies': ('Attendance', 'Anomalies'),
    'attendance/records': ('Attendance', 'Daily attendance and register'), 'attendance/upload-image': ('Attendance', 'Photo register (OCR, parked)'),
    'attendance/uploads': ('Attendance', 'Photo register (OCR, parked)'),
    'auth/change-password': ('Sign in', 'Change password'), 'auth/login': ('Sign in', 'Login'), 'auth/me': ('Sign in', 'My profile'),
    'auth/password-reset': ('Sign in', 'Forgot password'), 'auth/switch-school': ('Sign in', 'Switch school'),
    'bootstrap/admin-dashboard': ('Dashboard', 'Admin dashboard'), 'bootstrap/leadership-academic-insights': ('Dashboard', 'Leadership insights'),
    'classes': ('Students', 'Classes'), 'classes/{}': ('Students', 'Classes'),
    'examinations/academic-risk': ('Exams', 'Academic risk'), 'examinations/exam-groups': ('Exams', 'Exam groups and date sheets'),
    'examinations/exam-papers': ('Exams', 'Question papers'), 'examinations/exam-subjects': ('Exams', 'Exam subjects'),
    'examinations/exam-types': ('Exams', 'Exam types'), 'examinations/exams': ('Exams', 'Exams'),
    'examinations/grade-scales': ('Exams', 'Grade scale'), 'examinations/marks': ('Exams', 'Marks entry'),
    'examinations/paper-feedback': ('Exams', 'Question papers'), 'examinations/paper-uploads': ('Exams', 'Paper photo scan'),
    'examinations/questions': ('Exams', 'Question bank'), 'examinations/report-card': ('Exams', 'Report cards'),
    'examinations/student-responses': ('Exams', 'Student responses'), 'examinations/student-term-assessment': ('Exams', 'Skills and behaviour assessment'),
    'examinations/worksheet-uploads': ('Exams', 'Worksheets'), 'examinations/worksheets': ('Exams', 'Worksheets'),
    'face-attendance/devices': ('Attendance', 'Face attendance'), 'face-attendance/enroll': ('Attendance', 'Face attendance'),
    'face-attendance/enrollments': ('Attendance', 'Face attendance'), 'face-attendance/live': ('Attendance', 'Face attendance'),
    'face-attendance/sessions': ('Attendance', 'Face attendance'), 'face-attendance/status': ('Attendance', 'Face attendance'),
    'face-attendance/upload-image': ('Attendance', 'Face attendance'),
    'finance/accounts': ('Finance', 'Accounts and ledger'), 'finance/ai-chat': ('Finance', 'AI assistant'),
    'finance/annual-categories': ('Finance', 'Fee categories'), 'finance/discounts': ('Finance', 'Discounts and scholarships'),
    'finance/expense-categories': ('Finance', 'Expense and income categories'), 'finance/expenses': ('Finance', 'Expenses'),
    'finance/fee-breakdown': ('Finance', 'Fees of one student'), 'finance/fee-payments': ('Finance', 'Fee collection'),
    'finance/fee-predictor': ('Finance', 'AI fee predictor'), 'finance/fee-structures': ('Finance', 'Fee setup'),
    'finance/income-categories': ('Finance', 'Expense and income categories'), 'finance/monthly-categories': ('Finance', 'Fee categories'),
    'finance/other-income': ('Finance', 'Other income'), 'finance/reports': ('Finance', 'Financial reports'),
    'finance/scholarships': ('Finance', 'Discounts and scholarships'), 'finance/siblings': ('Finance', 'Fees of one student'),
    'finance/student-discounts': ('Finance', 'Discounts and scholarships'), 'finance/transfers': ('Finance', 'Transfers between accounts'),
    'finance/payment-status': ('Finance', 'Online payment (discontinued)'),
    'guide/progress': ('Other', 'User guide progress'),
    'hostel/allocations': ('Hostel', 'Room allocations'), 'hostel/dashboard': ('Hostel', 'Hostel overview'),
    'hostel/gate-passes': ('Hostel', 'Gate passes'), 'hostel/hostels': ('Hostel', 'Hostels'), 'hostel/rooms': ('Hostel', 'Rooms'),
    'hr/appraisals': ('HR', 'Performance reviews'), 'hr/attendance': ('HR', 'Staff attendance'), 'hr/departments': ('HR', 'Departments'),
    'hr/designations': ('HR', 'Departments'), 'hr/documents': ('HR', 'Staff documents'), 'hr/leave-applications': ('HR', 'Staff leave'),
    'hr/leave-policies': ('HR', 'Leave policies'), 'hr/payslips': ('HR', 'Payroll and payslips'), 'hr/qualifications': ('HR', 'Staff documents'),
    'hr/salary-structures': ('HR', 'Salary'), 'hr/staff-risk': ('HR', 'Staff risk'), 'hr/staff': ('HR', 'Staff directory'),
    'inventory/ai-suggest': ('Inventory', 'AI suggestions'), 'inventory/assignments': ('Inventory', 'Items given to staff'),
    'inventory/categories': ('Inventory', 'Items, categories, vendors'), 'inventory/dashboard': ('Inventory', 'Inventory overview'),
    'inventory/items': ('Inventory', 'Items, categories, vendors'), 'inventory/reorder-prediction': ('Inventory', 'Reorder prediction'),
    'inventory/transactions': ('Inventory', 'Stock movements'), 'inventory/vendors': ('Inventory', 'Items, categories, vendors'),
    'library/books': ('Library', 'Book catalog'), 'library/categories': ('Library', 'Book catalog'), 'library/config': ('Library', 'Library settings'),
    'library/issues': ('Library', 'Issue and return'), 'library/stats': ('Library', 'Library overview'),
    'lms/assignments': ('Content', 'Assignments'), 'lms/books': ('Content', 'Curriculum'), 'lms/chapters': ('Content', 'Curriculum'),
    'lms/content-blocks': ('Content', 'Curriculum content blocks'), 'lms/generate-lesson-plan': ('Content', 'Lesson plans'),
    'lms/lesson-plans': ('Content', 'Lesson plans'), 'lms/submissions': ('Content', 'Assignments'), 'lms/subtopics': ('Content', 'Curriculum'),
    'lms/tags': ('Content', 'Curriculum content blocks'), 'lms/toc-jobs': ('Content', 'Curriculum'), 'lms/topics': ('Content', 'Curriculum'),
    'messaging/recipients': ('Messages', 'Staff messages'), 'messaging/threads': ('Messages', 'Staff messages'), 'messaging/unread-count': ('Messages', 'Staff messages'),
    'notifications/ai-chat': ('Notifications', 'AI assistant'), 'notifications/analytics': ('Notifications', 'Delivery analytics'),
    'notifications/broadcast': ('Notifications', 'Send to a group'), 'notifications/config': ('Notifications', 'Automatic notification settings'),
    'notifications/digest': ('Notifications', 'Digest'), 'notifications/logs': ('Notifications', 'History'),
    'notifications/mark-all-read': ('Notifications', 'My inbox'), 'notifications/mark-read-bulk': ('Notifications', 'My inbox'),
    'notifications/my': ('Notifications', 'My inbox'), 'notifications/preferences': ('Notifications', 'Preferences'),
    'notifications/run': ('Notifications', 'Automatic notification settings'), 'notifications/send': ('Notifications', 'Send to one person'),
    'notifications/templates': ('Notifications', 'Templates'), 'notifications/unread-count': ('Notifications', 'My inbox'),
    'notifications/{}': ('Notifications', 'My inbox'),
    'parents/admin': ('Parents', 'Parent admin tools'), 'parents/children': ('Parents', 'Parent: my children'),
    'parents/leave-requests': ('Parents', 'Parent: leave requests'), 'parents/messages': ('Parents', 'Parent: messages (old)'),
    'parents/my-children': ('Parents', 'Parent: my children'), 'parents/register': ('Parents', 'Parent sign-up'),
    'reports/custom-letters': ('Reports', 'Letters'), 'reports/generate-instant': ('Reports', 'Report PDFs'), 'reports/generate': ('Reports', 'Report PDFs'),
    'reports/list': ('Reports', 'Report PDFs'), 'reports/{}': ('Reports', 'Report PDFs'),
    'schools/attendance_config': ('School settings', 'Attendance settings'), 'schools/by-subdomain': ('School settings', 'School lookup'),
    'schools/completion': ('School settings', 'Setup completion'), 'schools/current': ('School settings', 'School profile'),
    'schools/delete_asset': ('School settings', 'School logo and letterhead'), 'schools/exam_config': ('School settings', 'Exam settings'),
    'schools/mark_mappings': ('School settings', 'Attendance settings'), 'schools/register_config': ('School settings', 'Attendance settings'),
    'schools/time_zone': ('School settings', 'School profile'), 'schools/upload_asset': ('School settings', 'School logo and letterhead'),
    'sessions/academic-years': ('Academic sessions', 'Academic years'), 'sessions/attendance-risk': ('Academic sessions', 'Risk scores'),
    'sessions/calendar-entries': ('Academic sessions', 'Academic calendar'), 'sessions/enrollments': ('Academic sessions', 'Enrollments and promotion'),
    'sessions/health': ('Academic sessions', 'Session health'), 'sessions/promotion-advisor': ('Academic sessions', 'Enrollments and promotion'),
    'sessions/section-allocator': ('Academic sessions', 'Enrollments and promotion'), 'sessions/session-classes': ('Academic sessions', 'Sections'),
    'sessions/setup-wizard': ('Academic sessions', 'Setup wizard'), 'sessions/student-risk-score': ('Academic sessions', 'Risk scores'),
    'sessions/terms': ('Academic sessions', 'Terms'),
    'student-exits': ('Students', 'Leaving and re-admission'), 'student-exits/destination-classes': ('Students', 'Leaving and re-admission'),
    'student-exits/destinations': ('Students', 'Leaving and re-admission'), 'student-exits/readmit': ('Students', 'Leaving and re-admission'),
    'student-exits/{}': ('Students', 'Leaving and re-admission'),
    'students': ('Students', 'Student list and form'), 'students/bulk-create-accounts': ('Students', 'Bulk import and accounts'),
    'students/bulk_create': ('Students', 'Bulk import and accounts'), 'students/by_class': ('Students', 'Student list and form'),
    'students/deleted': ('Students', 'Remove and restore'), 'students/portal': ('Students', 'Student portal (own view)'),
    'students/{}': ('Students', 'Student profile and actions'),
    'tasks/ai-insights': ('Other', 'Background tasks'), 'tasks/ai-jobs': ('Other', 'Background tasks'), 'tasks/tasks': ('Other', 'Background tasks'),
    'transport/assignments': ('Transport', 'Student transport'), 'transport/attendance': ('Transport', 'Boarding attendance'),
    'transport/dashboard': ('Transport', 'Transport overview'), 'transport/route-journey': ('Transport', 'Bus journey tracking'),
    'transport/routes': ('Transport', 'Routes and stops'), 'transport/stops': ('Transport', 'Routes and stops'),
    'transport/vehicles': ('Transport', 'Vehicles'), 'transport/journey': ('Transport', 'Bus journey tracking'),
    'transport/driver': ('Transport', 'Boarding attendance'),
    'users': ('Settings', 'Users and roles'), 'users/{}': ('Settings', 'Users and roles'),
}

# Plain-word note for features that are not fully used by mobile. "Web only" = decided to stay on the web.
NOTES = {
    'AI assistant': 'AI chat widgets stay on the web', 'AI analytics': 'Version 2', 'Photo register (OCR, parked)': 'Parked (OCR switched off)',
    'Brochure': 'Not for mobile', 'Activity log': 'Not for mobile', 'Memberships': 'Not for mobile', 'Organizations': 'Not for mobile', 'Schools': 'Not for mobile (super admin)',
    'Worksheets': 'Version 2', 'Paper photo scan': 'Version 2', 'Question papers': 'Partly built; AI and Word export on the web',
    'Student responses': 'Version 2', 'Face attendance': 'Capture and review built; devices and live feed are version 2',
    'Fee categories': 'Web only (setup)', 'Expense and income categories': 'Web only (setup)', 'AI fee predictor': 'Web only',
    'Online payment (discontinued)': 'Gateway switched off', 'User guide progress': 'Web only', 'Background tasks': 'Internal',
    'Hostel': 'Version 2 (gate passes built)', 'Hostels': 'Version 2', 'Rooms': 'Version 2', 'Room allocations': 'Version 2', 'Hostel overview': 'Version 2',
    'Library': 'Version 2', 'Book catalog': 'Version 2', 'Library settings': 'Version 2', 'Library overview': 'Version 2',
    'Routes and stops': 'Version 2', 'Vehicles': 'Version 2', 'Student transport': 'Version 2', 'Transport overview': 'Version 2',
    'Setup wizard': 'Web only', 'Enrollments and promotion': 'Web only (promotion)', 'Academic years': 'Web only', 'Terms': 'Web only', 'Session health': 'Version 2',
    'Risk scores': 'Partly built (insights)', 'Leaving and re-admission': 'Web only (checklist)', 'Bulk import and accounts': 'Web only',
    'Parent admin tools': 'Web only', 'Parent: messages (old)': 'Replaced by staff messages', 'Letters': 'Built (letter composer)',
    'Curriculum content blocks': 'Version 2', 'Delivery analytics': 'Version 2', 'Automatic notification settings': 'Web only', 'Templates': 'Web only (management)',
    'Digest': 'Version 2', 'Preferences': 'No web screen either', 'Report PDFs': 'Partly: finance and student reports built',
    'Attendance settings': 'Web only', 'School lookup': 'Mobile uses its own school finder', 'Setup completion': 'Version 2',
    'Staff attendance': 'Built (batch 1)', 'Student portal (own view)': 'Built in the student app',
}


def feature_of(url):
    p = url.strip('/').split('/')
    app = p[1] if len(p) > 1 else ''
    seg = p[2] if len(p) > 2 else ''
    for key in (f'{app}/{seg}', app):
        if key in FEATURES:
            return FEATURES[key]
    return ('Other', f'{app} {seg}'.strip())


def main():
    web = scan(os.path.join(ROOT, 'frontend', 'src'), ('.js', '.jsx'))
    mob = scan(os.path.join(ROOT, 'mobile'), ('.ts', '.tsx'))
    mob_rx = [(k.split(' ', 1)[0], rx(k.split(' ', 1)[1]), k) for k in mob]
    web_rx = [(k.split(' ', 1)[0], rx(k.split(' ', 1)[1])) for k in web]

    covered = {k for k in web if any(m == k.split(' ', 1)[0] and r.match(k.split(' ', 1)[1]) for m, r, _ in mob_rx)}
    missing = sorted(set(web) - covered)
    mobile_only = sorted(k for m, r, k in mob_rx
                         if not any(wm == m and wr.match(k.split(' ', 1)[1]) for wm, wr in web_rx)
                         and not any(wm == m and rx(k.split(' ', 1)[1]).match(w.split(' ', 1)[1]) for wm, w in [(x.split(' ', 1)[0], x) for x in web]))

    groups = collections.OrderedDict()
    for k in sorted(web, key=lambda x: (feature_of(x.split(' ', 1)[1]), x)):
        area, feat = feature_of(k.split(' ', 1)[1])
        g = groups.setdefault((area, feat), {'total': 0, 'used': 0})
        g['total'] += 1
        g['used'] += k in covered

    def word(used, total):
        if used == total:
            return 'Fully used'
        if used == 0:
            return 'Not used'
        return 'Mostly used' if used / total >= 0.6 else 'Partly used'

    out = ['# Mobile app and web API coverage', '',
           f'Generated {datetime.date.today()} by `python scripts/mobile_api_gap.py` (rerun it after each batch).',
           f'The web calls **{len(web)}** distinct endpoints. The mobile app calls **{len(covered)}** of them (**{len(missing)} not called**). '
           f'Mobile-only endpoints (the web never calls them): **{len(mobile_only)}**.', '',
           'A call whose URL is a bare variable is not seen (none exist today, checked 2026-11-02); nested template strings are handled. This file is a reference; the plan is `MOBILE_CHANGE_LIST.md`.', '',
           '## 1. Endpoints only the mobile app uses (goal: zero)', '']
    if mobile_only:
        out += ['These are calls the web never makes. For each, the aim is to replace it with an endpoint the web already uses, unless the phone truly needs something new (push token, driver tracking).', '',
                '| Endpoint | What it is for | Mobile file | Replace with |', '|---|---|---|---|']
        notes = {
            'register-push-token': ('Phone push notifications', 'Cannot: the web has no push. Keep (signed off 2026-11-01).'),
            'unregister-push-token': ('Phone push notifications', 'Cannot: the web has no push. Keep (signed off 2026-11-01).'),
            'app-directory': ('School search on the sign-in front door', 'Replace with `schools/by-subdomain/` (web), or keep as a small public lookup.'),
            'app-info': ('School name and logo on the front door', 'Replace with `schools/by-subdomain/` (web).'),
            'app-listing': ('Switch a school on or off in the app search', 'New setting; no web equivalent. Decide: keep or drop.'),
            'journey/': ('Driver bus tracking (start, update, end, active, history)', 'The web already has `transport/route-journey/*` with the same purpose. Candidate to switch to it.'),
            'followups/': ('Admissions follow-ups', 'Likely a false positive: web calls `followups/today` and `followups/overdue` literally. Check.'),
        }
        for k in mobile_only:
            note = next((v for key, v in notes.items() if key in k), ('', ''))
            out.append(f"| `{k}` | {note[0]} | {', '.join(sorted(mob[k]))[:60]} | {note[1]} |")
    else:
        out.append('**None.** Every endpoint the mobile app calls is also called by the web app.')
    out += ['', '## 2. Coverage by feature (plain words)', '',
            'Each row groups related endpoints. "Used" is how many of the web\'s endpoints for that feature the mobile app also calls.', '',
            '| Area | Feature | Used | Status | Note |', '|---|---|---|---|---|']
    for (area, feat), g in sorted(groups.items(), key=lambda x: (x[0][0], x[0][1])):
        out.append(f"| {area} | {feat} | {g['used']} of {g['total']} | {word(g['used'], g['total'])} | {NOTES.get(feat, '') if g['used'] < g['total'] else ''} |")
    out += ['', '## 3. Web endpoints the mobile app does not call', '']
    by = collections.defaultdict(list)
    for k in missing:
        by[feature_of(k.split(' ', 1)[1])].append(k)
    for (area, feat), ks in sorted(by.items()):
        out += [f'### {area}: {feat} ({len(ks)})', '']
        out += [f'- `{k}`' for k in ks]
        out.append('')
    io.open(OUT, 'w', encoding='utf-8').write('\n'.join(out))
    print('web', len(web), 'covered', len(covered), 'missing', len(missing), 'mobile-only', len(mobile_only))


if __name__ == '__main__':
    main()
