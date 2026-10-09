"""The cache must only be Redis when REDIS_URL is set on purpose, never because the Celery
broker happens to be Redis (that made a remote Upstash the cache and slowed every read)."""
import json
import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent


def cache_backend(**env):
    # Fresh interpreter: settings.py reads the environment at import time.
    base = {k: v for k, v in os.environ.items() if k not in ('REDIS_URL', 'CELERY_BROKER_URL')}
    base.update({'DJANGO_SETTINGS_MODULE': 'config.settings', 'ENVIRONMENT': 'local'})
    base.update(env)
    out = subprocess.run(
        [sys.executable, '-c',
         'import json; from django.conf import settings; print(json.dumps(settings.CACHES["default"]["BACKEND"]))'],
        cwd=BACKEND, env=base, capture_output=True, text=True, timeout=120,
    )
    assert out.returncode == 0, out.stderr[-800:]
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_redis_broker_alone_does_not_become_the_cache():
    assert cache_backend(CELERY_BROKER_URL='rediss://u:p@example.invalid:6379').endswith('LocMemCache')


def test_explicit_redis_url_is_used_as_the_cache():
    assert cache_backend(REDIS_URL='redis://example.invalid:6379').endswith('RedisCache')
