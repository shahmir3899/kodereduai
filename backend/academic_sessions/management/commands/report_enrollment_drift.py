"""
Read-only report of enrollments whose class placement disagrees with itself.

Written for the per-section cleanup: before this fix, student edits and the
section allocator changed ``StudentEnrollment.class_obj`` without touching
``session_class``, and older backfills left ``session_class`` empty. This lists
the rows affected in any environment so a repair can be scoped. It never writes.

    python manage.py report_enrollment_drift
    python manage.py report_enrollment_drift --school-id 42 --limit 50

The same checks run nightly (academic_sessions.tasks.check_enrollment_drift),
which notifies school admins when anything is flagged.
"""
from django.core.management.base import BaseCommand

from academic_sessions.drift import drift_checks


class Command(BaseCommand):
    help = 'Report (read-only) enrollments whose class_obj, session_class and Student snapshot disagree.'

    def add_arguments(self, parser):
        parser.add_argument('--school-id', type=int, help='Only report this school.')
        parser.add_argument('--academic-year-id', type=int, help='Only report this academic year.')
        parser.add_argument('--limit', type=int, default=20, help='Sample rows to print per check (default 20).')

    def handle(self, *args, **opts):
        checks = drift_checks(school_id=opts['school_id'], academic_year_id=opts['academic_year_id'])

        limit = opts['limit']
        total = 0
        for _key, title, qs in checks:
            count = qs.count()
            total += count
            style = self.style.WARNING if count else self.style.SUCCESS
            self.stdout.write(style(f'{title}: {count}'))
            for e in qs.order_by('school_id', 'academic_year_id', 'id')[:limit]:
                session_label = e.session_class.label if e.session_class_id else '-'
                session_master = e.session_class.class_obj_id if e.session_class_id else '-'
                self.stdout.write(
                    f'  enrollment={e.id} school={e.school_id} year={e.academic_year.name} '
                    f'student={e.student_id} "{e.student.name}" | '
                    f'class_obj={e.class_obj_id} ({e.class_obj.name}) roll={e.roll_number} | '
                    f'session_class={e.session_class_id or "-"} ({session_label}, master={session_master}) | '
                    f'snapshot class_obj={e.student.class_obj_id} roll={e.student.roll_number}'
                )
            if count > limit:
                self.stdout.write(f'  ... {count - limit} more')

        self.stdout.write('')
        self.stdout.write(f'Total flagged (a row can appear under more than one check): {total}')
        self.stdout.write('Read-only: nothing was changed.')
