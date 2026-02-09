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

# One-time password reset via env var (remove RESET_PASSWORD from Render after use)
if [ -n "$RESET_PASSWORD" ]; then
  echo "==> Resetting password for all users..."
  python manage.py shell -c "
from django.contrib.auth import get_user_model
User = get_user_model()
import os
new_pw = os.environ['RESET_PASSWORD']
for u in User.objects.all():
    u.set_password(new_pw)
    u.save()
    print(f'  Password reset for: {u.username}')
print('Done. REMOVE the RESET_PASSWORD env var now!')
"
fi

echo "==> Build complete!"
