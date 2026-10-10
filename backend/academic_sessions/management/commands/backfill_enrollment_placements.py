"""Give every enrollment without one an initial EnrollmentPlacement (idempotent).

Migration 0018 does this once. Rerun it after deploying if enrollments were created by
code that predates placements in the meantime (registers fall back to the enrollment's
own section for them, so nothing is hidden, but a later class move needs the row)."""
from django.core.management.base import BaseCommand

from academic_sessions.models import StudentEnrollment
from academic_sessions.placement_service import open_initial_placement


class Command(BaseCommand):
    help = 'Create the initial placement for enrollments that have none.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        missing = StudentEnrollment.objects.filter(placements__isnull=True).select_related('academic_year')
        count = 0
        for enrollment in missing.iterator():
            count += 1
            if not options['dry_run']:
                open_initial_placement(enrollment)
        verb = 'would create' if options['dry_run'] else 'created'
        self.stdout.write(f'{verb} {count} placement(s).')
