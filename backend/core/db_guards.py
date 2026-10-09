"""
Database-level guard against hard-deleting students.

Student.delete() is a soft delete, but anything that bypasses the model (a shell
one-liner, a repair script, a raw queryset on _base_manager, a cascade from a
parent row) would still erase a student and everything they own. A Postgres
trigger on students_student refuses every DELETE unless the surrounding
transaction has opted in with allow_student_hard_delete(); see
students/migrations/0017_student_hard_delete_guard.py.
"""

from contextlib import contextmanager

from django.db import connection, transaction

SETTING = 'app.allow_student_hard_delete'


@contextmanager
def allow_student_hard_delete():
    """Permit student rows to be deleted for real inside this block.

    The flag is transaction-local (set_config(..., true)), so it can never leak
    to another request sharing a pooled connection. Use it only where erasing
    students is the point: Student.hard_delete() and deleting a whole school or
    organization. A no-op on SQLite, which has no trigger.
    """
    with transaction.atomic():
        if connection.vendor == 'postgresql':
            with connection.cursor() as cursor:
                cursor.execute('SELECT set_config(%s, %s, true)', [SETTING, 'on'])
        yield
