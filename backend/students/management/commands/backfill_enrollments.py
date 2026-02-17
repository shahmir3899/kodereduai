from django.core.management.base import BaseCommand
from django.db import transaction

from academic_sessions.models import AcademicYear, StudentEnrollment
from students.models import Student


class Command(BaseCommand):
    help = 'Create StudentEnrollment records for existing students who lack them.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--school-id',
            type=int,
            help='Only backfill for a specific school (default: all schools)',
        )
        parser.add_argument(
            '--academic-year-id',
            type=int,
            help='Target a specific academic year (default: current year per school)',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Preview what would be created without writing to DB',
        )

    def handle(self, *args, **options):
        school_id = options.get('school_id')
        year_id = options.get('academic_year_id')
        dry_run = options.get('dry_run', False)

        students_qs = Student.objects.filter(is_active=True).select_related('school', 'class_obj')
        if school_id:
            students_qs = students_qs.filter(school_id=school_id)

        # Group students by school
        schools = {}
        for s in students_qs:
            schools.setdefault(s.school_id, []).append(s)

        total_created = 0
        total_skipped = 0

        for sid, students in schools.items():
            # Resolve academic year for this school
            if year_id:
                try:
                    academic_year = AcademicYear.objects.get(id=year_id, school_id=sid)
                except AcademicYear.DoesNotExist:
                    self.stdout.write(self.style.WARNING(
                        f'  School {sid}: academic year {year_id} not found, skipping'
                    ))
                    continue
            else:
                academic_year = AcademicYear.objects.filter(
                    school_id=sid, is_current=True,
                ).first()
                if not academic_year:
                    self.stdout.write(self.style.WARNING(
                        f'  School {sid}: no current academic year, skipping'
                    ))
                    continue

            self.stdout.write(f'School {sid} -> {academic_year.name} ({len(students)} active students)')

            # Find students already enrolled for this year
            existing = set(
                StudentEnrollment.objects.filter(
                    school_id=sid,
                    academic_year=academic_year,
                ).values_list('student_id', flat=True)
            )

            to_create = []
            for student in students:
                if student.id in existing:
                    total_skipped += 1
                    continue
                if not student.class_obj_id:
                    self.stdout.write(self.style.WARNING(
                        f'  Skipping {student.name} (no class assigned)'
                    ))
                    total_skipped += 1
                    continue

                to_create.append(StudentEnrollment(
                    school_id=sid,
                    student=student,
                    academic_year=academic_year,
                    class_obj_id=student.class_obj_id,
                    roll_number=student.roll_number or '',
                    status=StudentEnrollment.Status.ACTIVE,
                    is_active=True,
                ))

            if dry_run:
                self.stdout.write(self.style.NOTICE(
                    f'  [DRY RUN] Would create {len(to_create)} enrollments, skip {total_skipped}'
                ))
            else:
                with transaction.atomic():
                    StudentEnrollment.objects.bulk_create(to_create, ignore_conflicts=True)
                self.stdout.write(self.style.SUCCESS(
                    f'  Created {len(to_create)} enrollments'
                ))

            total_created += len(to_create)

        self.stdout.write(self.style.SUCCESS(
            f'\nDone. Created: {total_created}, Skipped: {total_skipped}'
        ))
