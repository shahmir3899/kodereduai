#!/usr/bin/env bash
# Start script for Render - runs Celery worker alongside Gunicorn
# in a single free-tier web service.

set -euo pipefail

ENABLE_CELERY="${ENABLE_CELERY:-false}"
ENABLE_CELERY_BEAT="${ENABLE_CELERY_BEAT:-false}"

CELERY_LOOP_PID=""
CELERY_BEAT_LOOP_PID=""

# Auto-restart Celery worker if it crashes
restart_celery() {
    while true; do
        echo "==> Starting Celery worker..."
        celery -A config worker -l info --concurrency=1
        EXIT_CODE=$?
        echo "==> Celery worker exited (code=$EXIT_CODE), restarting in 5s..."
        sleep 5
    done
}

# Auto-restart Celery Beat scheduler if it crashes
restart_celery_beat() {
    while true; do
        echo "==> Starting Celery Beat..."
        celery -A config beat -l info
        EXIT_CODE=$?
        echo "==> Celery Beat exited (code=$EXIT_CODE), restarting in 5s..."
        sleep 5
    done
}

if [ "$ENABLE_CELERY" = "true" ]; then
    echo "==> ENABLE_CELERY=true, starting Celery worker loop..."
    restart_celery &
    CELERY_LOOP_PID=$!
else
    echo "==> ENABLE_CELERY=false, skipping Celery worker in web service"
fi

if [ "$ENABLE_CELERY_BEAT" = "true" ]; then
    echo "==> ENABLE_CELERY_BEAT=true, starting Celery Beat loop..."
    restart_celery_beat &
    CELERY_BEAT_LOOP_PID=$!
else
    echo "==> ENABLE_CELERY_BEAT=false, skipping Celery Beat in web service"
fi

# Start Gunicorn in foreground
echo "==> Starting Gunicorn..."
gunicorn config.wsgi:application

# If Gunicorn exits, also stop the Celery restart loop
if [ -n "$CELERY_LOOP_PID" ]; then
    kill "$CELERY_LOOP_PID" 2>/dev/null || true
fi
if [ -n "$CELERY_BEAT_LOOP_PID" ]; then
    kill "$CELERY_BEAT_LOOP_PID" 2>/dev/null || true
fi
