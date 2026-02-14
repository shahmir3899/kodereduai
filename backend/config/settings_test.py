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
CELERY_TASK_EAGER_PROPAGATES = True
