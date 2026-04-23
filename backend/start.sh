#!/usr/bin/env bash
# Start script for Render - runs Celery worker alongside Gunicorn
# in a single free-tier web service.

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

# Run the restart loop in background
restart_celery &
CELERY_LOOP_PID=$!

# Run Celery Beat in background
restart_celery_beat &
CELERY_BEAT_LOOP_PID=$!

# Start Gunicorn in foreground
echo "==> Starting Gunicorn..."
gunicorn config.wsgi:application

# If Gunicorn exits, also stop the Celery restart loop
kill $CELERY_LOOP_PID 2>/dev/null
kill $CELERY_BEAT_LOOP_PID 2>/dev/null
