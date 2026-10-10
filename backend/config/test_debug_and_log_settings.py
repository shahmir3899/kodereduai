"""Debug must be switchable off on its own (the live service runs ENVIRONMENT=local), and
startup logs must never carry a connection password."""
import json
import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent


def settings_value(expr, **env):
    # Fresh interpreter: settings.py reads the environment at import time.
    base = {k: v for k, v in os.environ.items() if k not in ('APP_DEBUG', 'ENVIRONMENT', 'REDIS_URL', 'CELERY_BROKER_URL')}
    base.update({'DJANGO_SETTINGS_MODULE': 'config.settings', 'ENVIRONMENT': 'local', 'EDU_DJANGO_SECRET_KEY': 'x'})
    base.update(env)
    out = subprocess.run(
        [sys.executable, '-c', f'import json; from django.conf import settings; print(json.dumps({expr}))'],
        cwd=BACKEND, env=base, capture_output=True, text=True, timeout=120,
    )
    assert out.returncode == 0, out.stderr[-800:]
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_local_defaults_to_debug_on():
    assert settings_value('settings.DEBUG') is True


def test_app_debug_false_turns_debug_off_without_changing_environment():
    assert settings_value('[settings.DEBUG, settings.ENVIRONMENT]', APP_DEBUG='false') == [False, 'local']


def test_production_is_debug_off_by_default():
    assert settings_value('settings.DEBUG', ENVIRONMENT='production') is False


def test_mask_url_hides_the_password_and_keeps_the_host():
    masked = settings_value(
        '[__import__("config.settings", fromlist=["x"]).mask_url(u) for u in '
        '["rediss://default:s3cret@host.upstash.io:6379/1", "memory://", "", "redis://localhost:6379/0"]]'
    )

    assert masked == ['rediss://***@host.upstash.io:6379/1', 'memory://', '', 'redis://localhost:6379/0']
    assert 's3cret' not in ''.join(masked)
