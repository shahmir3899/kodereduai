"""
Read-only report of enrollments whose class placement disagrees with itself.

Written for the per-section cleanup: before this fix, student edits and the
section allocator changed ``StudentEnrollment.class_obj`` without touching
``session_class``, and older backfills left ``session_class`` empty. This lists
the rows affected in any environment so a repair can be scoped. It never writes.

    python manage.py report_enrollment_drift
    python manage.py report_enrollment_drift --school-id 42 --limit 50
"""
from django.core.management.base import BaseCommand
from django.db.models import F

from academic_sessions.models import StudentEnrollment


class Command(BaseCommand):
    help = 'Report (read-only) enrollments whose class_obj, session_class and Student snapshot disagree.'

    def add_arguments(self, parser):
        parser.add_argument('--school-id', type=int, help='Only report this school.')
        parser.add_argument('--academic-year-id', type=int, help='Only report this academic year.')
        parser.add_argument('--limit', type=int, default=20, help='Sample rows to print per check (default 20).')

    def handle(self, *args, **opts):
        base = StudentEnrollment.objects.filter(is_active=True)
        if opts['school_id']:
            base = base.filter(school_id=opts['school_id'])
        if opts['academic_year_id']:
            base = base.filter(academic_year_id=opts['academic_year_id'])
        base = base.select_related('student', 'class_obj', 'session_class', 'academic_year')

        checks = [
            (
                'class_obj disagrees with session_class master',
                base.filter(session_class__class_obj__isnull=False)
                .exclude(session_class__class_obj_id=F('class_obj_id')),
            ),
            (
                'no session_class (unassigned section)',
                base.filter(session_class__isnull=True),
            ),
            (
                'session_class not linked to a master class (orphan)',
                base.filter(session_class__isnull=False, session_class__class_obj__isnull=True),
            ),
            (
                'current-year Student snapshot disagrees with enrollment',
                base.filter(academic_year__is_current=True).exclude(
                    student__class_obj_id=F('class_obj_id'),
                    student__roll_number=F('roll_number'),
                ),
            ),
        ]

        limit = opts['limit']
        total = 0
        for title, qs in checks:
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
