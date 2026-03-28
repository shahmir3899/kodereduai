from django.core.management.base import BaseCommand  # pyright: ignore[reportMissingModuleSource]

from academic_sessions.models import StudentEnrollment
from examinations.models import StudentMark


class Command(BaseCommand):
    help = "Backfill StudentMark.enrollment using exam academic year + class enrollment matching."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Apply updates. Without this flag, runs in dry-run mode.",
        )
        parser.add_argument(
            "--school-id",
            type=int,
            default=None,
            help="Optional school id scope.",
        )

    def handle(self, *args, **options):
        apply_changes = options["apply"]
        school_id = options["school_id"]

        marks_qs = StudentMark.objects.filter(enrollment__isnull=True).select_related(
            "exam_subject__exam", "student"
        )
        if school_id:
            marks_qs = marks_qs.filter(school_id=school_id)

        total = marks_qs.count()
        linked = 0
        unresolved = 0

        self.stdout.write(self.style.NOTICE(f"Found {total} marks without enrollment linkage."))

        for mark in marks_qs.iterator():
            exam = mark.exam_subject.exam
            enrollment = StudentEnrollment.objects.filter(
                school_id=mark.school_id,
                student_id=mark.student_id,
                academic_year_id=exam.academic_year_id,
                class_obj_id=exam.class_obj_id,
            ).order_by("-is_active", "-created_at").first()

            if enrollment is None:
                unresolved += 1
                continue

            linked += 1
            if apply_changes:
                mark.enrollment = enrollment
                mark.save(update_fields=["enrollment", "updated_at"])

        mode = "APPLY" if apply_changes else "DRY-RUN"
        self.stdout.write(self.style.SUCCESS(f"Mode: {mode}"))
        self.stdout.write(self.style.SUCCESS(f"Linkable marks: {linked}"))
        self.stdout.write(self.style.WARNING(f"Unresolved marks: {unresolved}"))
