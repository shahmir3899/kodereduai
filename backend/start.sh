#!/usr/bin/env bash
# Start script for Render - runs Celery worker alongside Gunicorn
# in a single free-tier web service.

# Start Celery worker in background
echo "==> Starting Celery worker..."
celery -A config worker -l info --concurrency=2 &
CELERY_PID=$!

# Start Gunicorn in foreground
echo "==> Starting Gunicorn..."
gunicorn config.wsgi:application

# If Gunicorn exits, also stop Celery
kill $CELERY_PID 2>/dev/null
