"""Shared set-up for branch-transfer tests: a destination year, class and roll at
School Beta (the shared seed school in the same organization as School Alpha)."""
from datetime import date

from academic_sessions.models import AcademicYear, SessionClass
from students.models import Class


def destination_placement(ctx, roll='7', section='A'):
    """Beta's academic year covering the exit tests' leaving date (2026-03-01), one
    class in it, and the roll the transferring student will take there."""
    school_b = ctx['school_b']
    year, _ = AcademicYear.objects.get_or_create(
        school=school_b, name='PYTEST_Beta_2025-2026',
        defaults={'start_date': date(2025, 4, 1), 'end_date': date(2026, 3, 31),
                  'is_current': True, 'is_active': True},
    )
    master, _ = Class.objects.get_or_create(
        school=school_b, name='PYTEST_Beta_Class_1', section=section, defaults={'grade_level': 1},
    )
    session_class, _ = SessionClass.objects.get_or_create(
        school=school_b, academic_year=year, class_obj=master, section=section,
        defaults={'display_name': master.name, 'grade_level': master.grade_level},
    )
    return {'year': year, 'master': master, 'session_class': session_class, 'roll': roll}


def placement_body(placement):
    return {
        'destination_session_class': placement['session_class'].id,
        'destination_roll_number': placement['roll'],
    }
