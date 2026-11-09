"""Turn the assistant on or off for one school (or show where it stands).

    python manage.py assistant_switch --school-id 42 on
    python manage.py assistant_switch --school-id 42 off
    python manage.py assistant_switch list
"""
from django.core.management.base import BaseCommand, CommandError

from assistant import usage
from schools.models import School


class Command(BaseCommand):
    help = 'Per-school switch for the assistant (stored in School.ai_config, no schema change).'

    def add_arguments(self, parser):
        parser.add_argument('action', choices=['on', 'off', 'list'])
        parser.add_argument('--school-id', type=int)

    def handle(self, *args, **opts):
        if opts['action'] == 'list':
            for school in School.objects.order_by('id'):
                state = 'ON' if usage.assistant_enabled(school.pk) else 'off'
                self.stdout.write(f'{school.pk:>5}  {state:<4} {school.name}')
            return
        if not opts['school_id']:
            raise CommandError('--school-id is required')
        school = School.objects.filter(pk=opts['school_id']).first()
        if not school:
            raise CommandError('no such school')
        usage.set_assistant_enabled(school, opts['action'] == 'on')
        self.stdout.write(f'{school.name}: assistant {opts["action"].upper()}')
