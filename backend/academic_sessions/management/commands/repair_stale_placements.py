"""Close placements left open (end_date NULL) after their academic year ended.

Migration 0018 backfilled every enrollment with an open-ended placement and nothing closed
them at year rollover, so a promoted student has last year's placement overlapping this
year's (readers that took the first covering row then picked the wrong section).

Dry-run unless --apply. A student with no enrollment in a later year (held back, not yet
promoted) is skipped and listed: their old placement is still the current one."""
from collections import Counter
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from academic_sessions.models import EnrollmentPlacement, StudentEnrollment


class Command(BaseCommand):
    help = 'Close open placements of ended academic years for students enrolled in a later year.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Write the changes (default is a dry run).')
        parser.add_argument('--school-id', type=int, default=None)

    def handle(self, *args, **options):
        today = timezone.localdate()
        stale = EnrollmentPlacement.objects.filter(
            end_date__isnull=True, academic_year__end_date__lt=today,
        ).select_related('academic_year')
        if options['school_id']:
            stale = stale.filter(school_id=options['school_id'])

        to_close, skipped = [], []
        for placement in stale:
            year = placement.academic_year
            has_later = StudentEnrollment.objects.filter(
                student_id=placement.student_id, academic_year__start_date__gt=year.end_date,
            ).exists()
            if has_later:
                to_close.append((placement, year.end_date + timedelta(days=1)))
            else:
                skipped.append(placement)

        by_group = Counter((p.school_id, p.academic_year.name) for p, _ in to_close)
        self.stdout.write(f'{len(to_close)} placement(s) to close, {len(skipped)} skipped (no later enrollment).')
        for (school_id, year_name), n in sorted(by_group.items()):
            self.stdout.write(f'  school {school_id} / {year_name}: {n}')
        for placement, end in to_close[:5]:
            self.stdout.write(f'  e.g. placement {placement.id} student {placement.student_id} -> end_date {end}')
        for placement in skipped[:10]:
            self.stdout.write(f'  skipped placement {placement.id} student {placement.student_id} ({placement.academic_year.name})')

        if not options['apply']:
            self.stdout.write('Dry run: nothing written. Re-run with --apply to close them.')
            return

        before = EnrollmentPlacement.objects.filter(end_date__isnull=True).count()
        with transaction.atomic():
            for placement, end in to_close:
                EnrollmentPlacement.objects.filter(pk=placement.pk, end_date__isnull=True).update(end_date=end)
        after = EnrollmentPlacement.objects.filter(end_date__isnull=True).count()
        self.stdout.write(f'Applied. Open placements: {before} -> {after}.')
