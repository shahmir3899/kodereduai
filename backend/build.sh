#!/usr/bin/env bash
# Render build script for EducationAI backend
# This script runs during every deploy on Render.

set -o errexit

echo "==> Installing Python dependencies..."
pip install --upgrade pip

# Limit dlib compilation parallelism to avoid OOM on Render (face_recognition dependency)
export CMAKE_BUILD_PARALLEL_LEVEL=1
export MAKEFLAGS="-j1"

pip install -r requirements.txt

# face_recognition is deliberately absent from requirements.txt (see comment there):
# a normal `pip install face_recognition` would still resolve its own dlib>=19.7
# dependency and rebuild it from source, re-introducing the OOM that dlib-bin exists
# to avoid. --no-deps installs it against the dlib-bin already present above.
pip install face_recognition==1.3.0 --no-deps

echo "==> Collecting static files..."
python manage.py collectstatic --no-input

echo "==> Running database migrations..."
python manage.py migrate --no-input

echo "==> Syncing notification scheduler (django_celery_beat DB rows)..."
# Beat uses DatabaseScheduler — it seeds new periodic tasks from
# settings.CELERY_BEAT_SCHEDULE on startup but does NOT update existing rows
# when cron changes. This sync ensures DB matches settings for managed tasks.
python manage.py sync_notification_scheduler || echo "WARN: sync_notification_scheduler failed (non-fatal)"

echo "==> Checking database..."
python manage.py shell -c "
from django.contrib.auth import get_user_model
User = get_user_model()
users = User.objects.all()
print(f'Total users in database: {users.count()}')
for u in users:
    print(f'  - {u.username} | active={u.is_active} | role={u.role} | school_id={u.school_id}')
if users.count() == 0:
    print('WARNING: No users found! You need to create one.')
"

echo "==> Build complete!"
