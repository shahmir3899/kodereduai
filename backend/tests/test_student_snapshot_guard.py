"""
Guard: no new reads of the Student.class_obj / Student.roll_number snapshot.

The student's own class_obj/roll_number is a copy of the current-year
StudentEnrollment. Code that decided things from the copy instead of the
enrollment caused the drift bugs fixed in phases 1-3 (past-year pages showing
students' current class, sections pooled together). Phase 4 moves the
remaining readers onto academic_sessions.roster / enrollment_service; this test
stops new ones appearing meanwhile.

ALLOWED is the per-file count of snapshot uses in app code when the guard was
added. A file may go down (lower its count here, or drop it); it may not go up,
and a file not listed may not start using the snapshot. For a new use, read the
student's placement through academic_sessions.roster (current_placement,
placements_for, enrollments_in_scope) instead.
"""
import os
import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent

PATTERNS = {
    'class': [
        r'student\.class_obj(?:_id)?\b',
        r'\bstudent__class_obj',
        r'\bstudents__class_obj',
        r'\.students\.(?:all|filter|count|exclude)\(',
        r'Student\.objects\.(?:filter|exclude|get)\([^)]*\bclass_obj',
    ],
    'roll': [
        r'student\.roll_number\b',
        r'\bstudent__roll_number',
    ],
}
COMPILED = {kind: [re.compile(p) for p in pats] for kind, pats in PATTERNS.items()}

ALLOWED = {
    # Drift checker: comparing the snapshot with the enrollment is its job.
    'academic_sessions/drift.py': {'class': 1, 'roll': 1},
    'academic_sessions/enrollment_service.py': {'class': 2, 'roll': 2},
    # The shared fallback for years with no enrollment rows lives here, so
    # other modules never read the snapshot themselves.
    'academic_sessions/roster.py': {'class': 10, 'roll': 1},
    # Attendance is migrated except: Meta.ordering; services.py (parked OCR,
    # deprecated WhatsApp); tasks.py anomaly detection (deferred until used);
    # views.py SQL fallbacks for schools without enrollment rows.
    'attendance/models.py': {'class': 1, 'roll': 1},
    'attendance/services.py': {'class': 1, 'roll': 1},
    'attendance/tasks.py': {'class': 3, 'roll': 1},
    'attendance/views.py': {'class': 10, 'roll': 1},
    # core/hostel/transport views: select_related feeding the roster fallback.
    'core/bootstrap_views.py': {'class': 1},
    'examinations/models.py': {'roll': 1},
    # Report card "current class" = latest placement, which the snapshot holds.
    'examinations/views.py': {'class': 1},
    'face_attendance/serializers.py': {'class': 1, 'roll': 1},
    'face_attendance/views.py': {'class': 7},
    # Finance is migrated; what remains is SQL-level fallback for schools
    # without enrollment rows, select_related feeding the roster fallback, and
    # FeePayment.Meta.ordering.
    'finance/ai_agent.py': {'class': 4},
    'finance/models.py': {'class': 1, 'roll': 1},
    'finance/views.py': {'class': 17},
    'hostel/views.py': {'class': 1},
    # Messaging/parents: select_related feeding the roster fallback only.
    'messaging/views.py': {'class': 3},
    # Notifications: select_related feeding the roster fallback, and the
    # reminder's class filter for schools without enrollment rows.
    'notifications/absence_digest.py': {'class': 1},
    'notifications/triggers.py': {'class': 3},
    'parents/views.py': {'class': 2},
    # Reports are migrated; what remains is select_related feeding the roster
    # fallback and base.py's class filter for schools without enrollment rows.
    'reports/generators/academic.py': {'class': 1},
    'reports/generators/attendance.py': {'class': 2},
    'reports/generators/base.py': {'class': 1},
    'reports/generators/fee.py': {'class': 2},
    # school.students.filter(is_active=True): whole-school count, not a class read.
    'schools/views.py': {'class': 1},
    # Students: create/update/validate write the enrollment from the form's
    # class and roll (the write path until stage 3); usernames use the latest
    # roll; by_class keeps the snapshot for schools without enrollment rows.
    'students/serializers.py': {'class': 1, 'roll': 1},
    'students/views.py': {'class': 6, 'roll': 6},
    'transport/views.py': {'class': 3},
}


def _excluded(rel):
    parts = rel.split('/')
    name = parts[-1]
    return (
        len(parts) == 1  # one-off ops scripts in backend/ root
        or 'migrations' in parts
        or 'tests' in parts
        or 'management' in parts
        or any(p.startswith('_deprecated') for p in parts)
        or name.startswith('test_')
        or name in ('tests.py', 'conftest.py')
    )


def _snapshot_uses():
    counts = {}
    for dirpath, _dirs, files in os.walk(BACKEND):
        for fn in files:
            if not fn.endswith('.py'):
                continue
            full = Path(dirpath) / fn
            rel = full.relative_to(BACKEND).as_posix()
            if _excluded(rel):
                continue
            for line in full.read_text(encoding='utf-8', errors='ignore').splitlines():
                if line.strip().startswith('#'):
                    continue
                for kind, regs in COMPILED.items():
                    n = sum(len(r.findall(line)) for r in regs)
                    if n:
                        counts.setdefault(rel, {}).setdefault(kind, 0)
                        counts[rel][kind] += n
    return counts


def test_no_new_student_snapshot_reads():
    grown = []
    for rel, kinds in _snapshot_uses().items():
        for kind, n in kinds.items():
            limit = ALLOWED.get(rel, {}).get(kind, 0)
            if n > limit:
                grown.append(f'{rel}: {n} {kind} snapshot use(s), allowed {limit}')
    assert not grown, (
        'New reads of the Student.class_obj/roll_number snapshot. Use the enrollment '
        '(academic_sessions.roster) instead:\n  ' + '\n  '.join(grown)
    )
