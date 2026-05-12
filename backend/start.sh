#!/usr/bin/env bash
# Start script for Render - runs Celery worker alongside Gunicorn
# in a single free-tier web service.

set -euo pipefail

ENABLE_CELERY="${ENABLE_CELERY:-true}"
ENABLE_CELERY_BEAT="${ENABLE_CELERY_BEAT:-true}"
GUNICORN_TIMEOUT="${GUNICORN_TIMEOUT:-120}"
GUNICORN_GRACEFUL_TIMEOUT="${GUNICORN_GRACEFUL_TIMEOUT:-30}"
# One sync worker serializes all HTTP on small instances — unrelated XHR queues behind slow views.
# gthread shares one process with multiple threads so I/O-bound DB/API work can overlap (Render-friendly).
GUNICORN_WORKERS="${GUNICORN_WORKERS:-1}"
GUNICORN_WORKER_CLASS="${GUNICORN_WORKER_CLASS:-gthread}"
GUNICORN_THREADS="${GUNICORN_THREADS:-4}"

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
GTHREAD_ARGS=()
if [ "$GUNICORN_WORKER_CLASS" = "gthread" ]; then
  GTHREAD_ARGS=(--threads "${GUNICORN_THREADS}")
fi
echo "==> Starting Gunicorn (workers=${GUNICORN_WORKERS} class=${GUNICORN_WORKER_CLASS} threads=${GUNICORN_THREADS}, timeout=${GUNICORN_TIMEOUT}s, bind=:${PORT:-8000})..."
gunicorn \
  --bind "0.0.0.0:${PORT:-8000}" \
  --timeout "$GUNICORN_TIMEOUT" \
  --graceful-timeout "$GUNICORN_GRACEFUL_TIMEOUT" \
  --workers "$GUNICORN_WORKERS" \
  --worker-class "$GUNICORN_WORKER_CLASS" \
  "${GTHREAD_ARGS[@]}" \
  config.wsgi:application

# If Gunicorn exits, also stop the Celery restart loop
if [ -n "$CELERY_LOOP_PID" ]; then
    kill "$CELERY_LOOP_PID" 2>/dev/null || true
fi
if [ -n "$CELERY_BEAT_LOOP_PID" ]; then
    kill "$CELERY_BEAT_LOOP_PID" 2>/dev/null || true
fi
