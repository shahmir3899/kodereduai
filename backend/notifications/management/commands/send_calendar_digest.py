from django.core.management.base import BaseCommand

from academic_sessions.calendar_digest import send_weekly_calendar_digest
from schools.models import School


class Command(BaseCommand):
    help = (
        "Send the weekly calendar summary to school admins. Normally generated when an admin opens the "
        "dashboard after it falls due; this command is for running it by hand or from an external cron."
    )

    def add_arguments(self, parser):
        parser.add_argument('--school-id', type=int, help='Only this school.')
        parser.add_argument('--all', action='store_true', help='Every active school.')
        parser.add_argument('--force', action='store_true', help="Send this week's digest now, even if not due or already sent.")

    def handle(self, *args, **options):
        if not options['school_id'] and not options['all']:
            self.stderr.write('Pass --school-id N or --all.')
            return
        schools = School.objects.filter(is_active=True)
        if options['school_id']:
            schools = schools.filter(id=options['school_id'])
        total = 0
        for school in schools:
            try:
                sent = send_weekly_calendar_digest(school, force=options['force'])
            except Exception as exc:  # noqa: BLE001 - one school failing must not stop the rest
                self.stderr.write(f'{school.name}: failed ({exc})')
                continue
            total += sent
            self.stdout.write(f'{school.name}: {sent} admin(s) notified')
        self.stdout.write(self.style.SUCCESS(f'Done: {total} notification(s) sent'))
