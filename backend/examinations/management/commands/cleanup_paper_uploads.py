from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from core.storage import SupabaseStorageService
from examinations.models import PaperUpload


class Command(BaseCommand):
    help = (
        "Delete paper-capture pages that were never saved into a paper (failed, abandoned "
        "or still waiting) and are older than --days. Dry-run unless --apply is given."
    )

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=30, help="Minimum age in days (default 30).")
        parser.add_argument("--school-id", type=int, default=None, help="Optional school id scope.")
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Delete the stored photo and the row. Without this flag nothing is changed.",
        )

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(days=options["days"])
        # Never touch a page linked to a saved paper, whatever its status says.
        stale = PaperUpload.objects.filter(exam_paper__isnull=True, created_at__lt=cutoff).exclude(
            status=PaperUpload.Status.CONFIRMED
        )
        if options["school_id"]:
            stale = stale.filter(school_id=options["school_id"])

        total = stale.count()
        by_status = {}
        for status_value in stale.values_list("status", flat=True):
            by_status[status_value] = by_status.get(status_value, 0) + 1
        self.stdout.write(f"{total} unsaved paper page(s) older than {options['days']} days: {by_status}")

        if not options["apply"]:
            self.stdout.write("Dry run: nothing deleted. Re-run with --apply to delete.")
            return

        storage = SupabaseStorageService()
        deleted = 0
        # list(), not iterator(): production Postgres is transaction-pooled (no server-side cursors).
        for upload in list(stale):
            path = storage._extract_storage_path(upload.image_url)
            # Keep the row when the photo could not be removed so a later run retries it.
            if path and not storage.delete_file(path):
                continue
            upload.delete()
            deleted += 1
        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} of {total}."))
