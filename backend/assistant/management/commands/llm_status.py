"""Show how the model gateway is set up and how many tokens each provider has used today.

    python manage.py llm_status

Token totals come from the shared cache (one counter per provider per UTC day), so they cover
every server process. Resting state is per process and so reads as 0 here.
"""
from django.core.management.base import BaseCommand

from assistant import llm


class Command(BaseCommand):
    help = 'Show the model gateway configuration and today\'s token use per provider.'

    def handle(self, *args, **opts):
        snap = llm.snapshot()
        self.stdout.write(f'primary: {snap["primary"]}    cerebras enabled: {snap["cerebras_enabled"]}')
        self.stdout.write(f'order for main calls: {" -> ".join(snap["order"]["main"]) or "(none)"}')
        self.stdout.write(f'order for fast calls: {" -> ".join(snap["order"]["fast"]) or "(none)"}')
        for name, info in snap['providers'].items():
            state = 'configured' if info['configured'] else 'NOT configured'
            percent = f' ({info["percent"]}% of {info["budget"]:,})' if info['percent'] is not None else ''
            self.stdout.write(f'\n{name}: {state}\n  model: {info["model"]}   fast model: {info["fast_model"]}\n'
                              f'  tokens today: {info["tokens_today"]:,}{percent}')
