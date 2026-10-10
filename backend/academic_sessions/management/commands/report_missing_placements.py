"""Dry run for migration 0018: how many enrollments have no placement row yet."""
from django.core.management.base import BaseCommand
from django.db import connection

from academic_sessions.models import StudentEnrollment


class Command(BaseCommand):
    help = 'Count enrollments without an EnrollmentPlacement (what the 0018 backfill would create).'

    def handle(self, *args, **options):
        total = StudentEnrollment.objects.count()
        if 'academic_sessions_enrollmentplacement' not in connection.introspection.table_names():
            self.stdout.write(f'Placement table not created yet: the backfill would create {total} placement(s).')
            for row in StudentEnrollment.objects.values('school_id').order_by('school_id').distinct():
                n = StudentEnrollment.objects.filter(school_id=row['school_id']).count()
                self.stdout.write(f"  school {row['school_id']}: {n}")
            return
        missing = StudentEnrollment.objects.filter(placements__isnull=True)
        self.stdout.write(f'{missing.count()} of {total} enrollments have no placement.')
        for row in missing.values('school_id').order_by('school_id').distinct():
            n = missing.filter(school_id=row['school_id']).count()
            self.stdout.write(f"  school {row['school_id']}: {n}")
