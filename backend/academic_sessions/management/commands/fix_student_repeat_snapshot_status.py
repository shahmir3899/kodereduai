from django.core.management.base import BaseCommand
from django.utils import timezone

from students.models import Student


class Command(BaseCommand):
    help = (
        'Fix student snapshot status for repeat records by setting Student.status=ACTIVE '
        'for targeted active students. Enrollment/promotion history remains unchanged.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--school-id',
            type=int,
            required=True,
            help='School ID to target (required).',
        )
        parser.add_argument(
            '--student-ids',
            type=int,
            nargs='+',
            default=[41, 186],
            help='Student IDs to fix (default: 41 186)',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Preview updates without writing changes.',
        )

    def handle(self, *args, **options):
        school_id = options['school_id']
        student_ids = options['student_ids']
        dry_run = options['dry_run']

        queryset = Student.objects.filter(
            school_id=school_id,
            id__in=student_ids,
            is_active=True,
            status=Student.Status.REPEAT,
        ).order_by('id')

        rows = list(queryset.values('id', 'name', 'status', 'is_active', 'class_obj_id', 'roll_number'))

        self.stdout.write(f'School ID: {school_id}')
        self.stdout.write(f'Target IDs: {student_ids}')
        self.stdout.write(f'Matching active REPEAT records: {len(rows)}')

        if not rows:
            self.stdout.write(self.style.WARNING('No matching records found. Nothing to update.'))
            return

        self.stdout.write('\nBefore:')
        for row in rows:
            self.stdout.write(
                f"  id={row['id']} name={row['name']} status={row['status']} "
                f"class_obj_id={row['class_obj_id']} roll={row['roll_number']}"
            )

        if dry_run:
            self.stdout.write(self.style.NOTICE('\n[DRY RUN] No database writes performed.'))
            return

        updated = queryset.update(
            status=Student.Status.ACTIVE,
            status_date=timezone.now().date(),
            status_reason='Normalized: repeat tracked in enrollment/history; snapshot status set to ACTIVE.',
        )

        self.stdout.write(self.style.SUCCESS(f'\nUpdated records: {updated}'))

        after_rows = list(
            Student.objects.filter(school_id=school_id, id__in=[r['id'] for r in rows])
            .order_by('id')
            .values('id', 'name', 'status', 'status_date')
        )

        self.stdout.write('After:')
        for row in after_rows:
            self.stdout.write(
                f"  id={row['id']} name={row['name']} status={row['status']} status_date={row['status_date']}"
            )
