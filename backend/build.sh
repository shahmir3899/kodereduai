#!/usr/bin/env bash
# Render build script for KoderEduAI backend
# This script runs during every deploy on Render.

set -o errexit

echo "==> Installing Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

echo "==> Collecting static files..."
python manage.py collectstatic --no-input

echo "==> Running database migrations..."
python manage.py migrate --no-input

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
