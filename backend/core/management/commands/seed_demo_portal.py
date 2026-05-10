from django.core.management.base import BaseCommand, CommandError

from seed_demo_portal import ensure_demo_portal_baseline, resolve_demo_school
from seed_showcase_graphs import ensure_showcase_graph_data


class Command(BaseCommand):
    help = (
        "Seed the public demo tenant (subdomain `demo`, demo.kodereduai.pk): "
        "minimal classes/students/terms if missing, then showcase graph data. "
        "Resets admin `qaisar` password to the documented demo password."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--school-id",
            type=int,
            default=None,
            help="Override school id (default: school with subdomain 'demo').",
        )
        parser.add_argument(
            "--skip-showcase",
            action="store_true",
            help="Only run baseline roster/HR setup, not showcase graphs.",
        )
        parser.add_argument(
            "--reset-showcase",
            action="store_true",
            help="Pass --reset to showcase graph seed (cleans SHOWCASE_ rows first).",
        )

    def handle(self, *args, **options):
        school_id = options["school_id"]
        try:
            if school_id is not None:
                school = resolve_demo_school(school_id=school_id)
            else:
                school = resolve_demo_school()
        except Exception as e:
            raise CommandError(str(e)) from e

        b = ensure_demo_portal_baseline(school_id=school.id)
        self.stdout.write(self.style.SUCCESS(f"Demo portal baseline: {b}"))

        if not options["skip_showcase"]:
            g = ensure_showcase_graph_data(school.id, reset=options["reset_showcase"])
            self.stdout.write(self.style.SUCCESS(f"Showcase graphs: {g}"))

        self.stdout.write(
            self.style.WARNING(
                "Login: https://demo.kodereduai.pk  |  User: qaisar  |  Password: Abcd1234  |  X-School-ID: "
                f"{school.id}"
            )
        )
