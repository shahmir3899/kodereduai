from django.core.management.base import BaseCommand, CommandError

from seed_showcase_graphs import ensure_showcase_graph_data


class Command(BaseCommand):
    help = (
        "Seed rich hypothetical data (graphs, dashboards) for a school. "
        "Does not change student/class roster. Use --reset to remove prior "
        "showcase rows for this school first."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--school-id",
            type=int,
            required=True,
            help="Primary key of the target school (e.g. demo / seed school).",
        )
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete existing showcase-tagged data for this school before seeding.",
        )

    def handle(self, *args, **options):
        school_id = options["school_id"]
        reset = options["reset"]
        try:
            summary = ensure_showcase_graph_data(school_id, reset=reset)
        except ValueError as e:
            raise CommandError(str(e)) from e

        self.stdout.write(self.style.SUCCESS(f"Showcase graph seed complete: {summary}"))
