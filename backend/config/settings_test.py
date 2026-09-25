"""
Test-specific settings override.

Uses SQLite for fast, isolated test runs without touching the
production/Supabase PostgreSQL database.
"""

from .settings import *  # noqa: F401, F403

# Override database to use in-memory SQLite for tests
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }
}

# Speed up password hashing in tests
PASSWORD_HASHERS = [
    'django.contrib.auth.hashers.MD5PasswordHasher',
]

# Disable throttling in tests
REST_FRAMEWORK['DEFAULT_THROTTLE_CLASSES'] = []
REST_FRAMEWORK['DEFAULT_THROTTLE_RATES'] = {}

# Disable Celery Beat scheduler for tests (avoid DB table dependency)
CELERY_BEAT_SCHEDULER = 'django.conf:settings'
CELERY_TASK_ALWAYS_EAGER = True

# Local cache for tests. Inheriting settings.CACHES pointed tests at the real
# Upstash Redis (same 'eduai' key prefix as the live app): every cache read and
# invalidation was a network round trip (~95s of seed setup per test) and test
# runs could evict or overwrite the live app's cache entries.
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'eduai-tests',
    }
}
CELERY_TASK_EAGER_PROPAGATES = True
