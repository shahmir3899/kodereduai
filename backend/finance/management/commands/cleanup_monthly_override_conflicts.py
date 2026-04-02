from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Count, Q

from finance.models import FeeStructure
from schools.models import School


class Command(BaseCommand):
    help = (
        "Detect and optionally cleanup conflicting active MONTHLY student overrides "
        "(students having both monthly_category=NULL and monthly_category!=NULL rows)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--school-id",
            type=int,
            default=None,
            help="Limit to one school id (default: all active schools).",
        )
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Apply cleanup by deactivating category-specific active rows for conflicting students.",
        )

    def _conflict_queryset(self, school_id):
        return (
            FeeStructure.objects.filter(
                school_id=school_id,
                fee_type="MONTHLY",
                student__isnull=False,
                is_active=True,
            )
            .values("student_id")
            .annotate(
                null_count=Count("id", filter=Q(monthly_category__isnull=True)),
                cat_count=Count("id", filter=Q(monthly_category__isnull=False)),
                total=Count("id"),
            )
            .filter(null_count__gt=0, cat_count__gt=0)
        )

    def handle(self, *args, **options):
        school_id = options.get("school_id")
        apply_changes = options.get("apply", False)

        schools = School.objects.filter(is_active=True)
        if school_id:
            schools = schools.filter(id=school_id)

        if not schools.exists():
            self.stdout.write(self.style.WARNING("No matching schools found."))
            return

        self.stdout.write("=== Monthly Override Conflict Cleanup ===")
        self.stdout.write(f"Mode: {'APPLY' if apply_changes else 'DRY-RUN'}")

        total_conflicting_students = 0
        total_rows_to_deactivate = 0
        total_rows_deactivated = 0

        for school in schools.order_by("id"):
            conflicts = self._conflict_queryset(school.id)
            conflict_student_ids = [row["student_id"] for row in conflicts]
            conflict_count = len(conflict_student_ids)

            rows_to_deactivate = FeeStructure.objects.filter(
                school_id=school.id,
                fee_type="MONTHLY",
                student_id__in=conflict_student_ids,
                is_active=True,
                monthly_category__isnull=False,
            ).count()

            if conflict_count == 0:
                continue

            total_conflicting_students += conflict_count
            total_rows_to_deactivate += rows_to_deactivate

            self.stdout.write(
                f"\nSchool {school.id} - {school.name}: "
                f"conflicting_students={conflict_count}, rows_to_deactivate={rows_to_deactivate}"
            )

            if apply_changes and rows_to_deactivate > 0:
                with transaction.atomic():
                    updated = FeeStructure.objects.filter(
                        school_id=school.id,
                        fee_type="MONTHLY",
                        student_id__in=conflict_student_ids,
                        is_active=True,
                        monthly_category__isnull=False,
                    ).update(is_active=False)

                total_rows_deactivated += updated
                self.stdout.write(
                    self.style.SUCCESS(
                        f"  Applied: deactivated_rows={updated}"
                    )
                )

        self.stdout.write("\n=== Summary ===")
        self.stdout.write(f"conflicting_students={total_conflicting_students}")
        self.stdout.write(f"rows_to_deactivate={total_rows_to_deactivate}")
        if apply_changes:
            self.stdout.write(self.style.SUCCESS(f"rows_deactivated={total_rows_deactivated}"))
