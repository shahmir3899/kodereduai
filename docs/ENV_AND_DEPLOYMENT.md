# Environment Variables, Deployment Configuration & Infrastructure

## Environment Variables

### Backend (.env)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| ENVIRONMENT | Yes | local | `local` or `production` — controls security settings, JWT lifetimes, logging |
| DJANGO_SECRET_KEY | Yes | - | Django secret key (auto-generated on Render) |
| ALLOWED_HOSTS | Yes | localhost,127.0.0.1 | Comma-separated allowed hosts |
| DATABASE_URL | Prod only | - | PostgreSQL connection URL (uses SQLite if not set) |
| CORS_ALLOWED_ORIGINS | Yes | http://localhost:3000 | Comma-separated frontend URLs |
| CELERY_BROKER_URL | Optional | redis://localhost:6379/0 | Redis URL for Celery broker |
| CELERY_RESULT_BACKEND | Optional | redis://localhost:6379/0 | Redis URL for Celery results |
| GROQ_API_KEY | Yes | - | Groq API key (console.groq.com) |
| GROQ_MODEL | No | llama-3.3-70b-versatile | Groq LLM model ID |
| GROQ_VISION_MODEL | No | llama-3.2-11b-vision-preview | Groq vision model ID |
| USE_VISION_PIPELINE | No | True | Enable AI vision processing |
| VISION_PROVIDER | No | google | Vision provider: google, groq, tesseract |
| GOOGLE_VISION_API_KEY | Conditional | - | Required if VISION_PROVIDER=google |
| GOOGLE_APPLICATION_CREDENTIALS | Conditional | - | Alternative: path to service account JSON |
| TESSERACT_CMD | Conditional | - | Path to tesseract.exe (if provider=tesseract) |
| SUPABASE_URL | Yes | - | Supabase project URL |
| SUPABASE_KEY | Yes | - | Supabase anon key |
| SUPABASE_BUCKET | No | atten-reg | Supabase storage bucket name |
| RESET_PASSWORD | No | Abcd1234 | Default password for user creation |

### Frontend (.env)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| VITE_API_URL | Prod only | - | Backend API URL. Dev uses proxy to localhost:8000 |

## Deployment Architecture (Render.com)

### Services (render.yaml blueprint)

**1. kodereduai-api (Backend)**

- Runtime: Python 3.12.0
- Region: Oregon
- Plan: Free tier
- Root: backend/
- Build: `./build.sh` — pip install, collectstatic, migrate
- Start: `bash start.sh` — Celery worker + Gunicorn (single process on free tier)
- Health check: /api/ endpoint

**2. kodereduai (Frontend)**

- Runtime: Static site
- Root: frontend/
- Build: `npm install && npm run build`
- Publish: dist/
- SPA Rewrite: /* → /index.html
- Headers: X-Frame-Options: DENY, X-Content-Type-Options: nosniff

### External Services

- **PostgreSQL**: Supabase PostgreSQL with Session Pooler (port 5432)
- **Redis**: Upstash Redis (free tier) for Celery broker + result backend
- **File Storage**: Supabase Storage (bucket: atten-reg)
- **AI APIs**: Google Cloud Vision, Groq LLM

## Build Scripts

### build.sh (Backend)

```bash
pip install --upgrade pip
pip install -r requirements.txt
python manage.py collectstatic --no-input
python manage.py migrate --no-input
# Database integrity check
```

### start.sh (Backend)

```bash
# Start Celery worker in background (2 concurrency for free tier)
celery -A config worker -l info --concurrency=2 &
# Start Gunicorn
gunicorn config.wsgi:application
```

## Celery Configuration

### Task Queue

- Broker: Redis
- Serializer: JSON
- Timezone: Asia/Karachi
- Time limit: 30 minutes per task
- Concurrency: 2 workers (free tier)

### Smart Sync/Async Dispatch

On-demand background tasks use a smart sync/async pattern via `run_task_sync()` and `dispatch_background_task()` in `core/task_utils.py`. Small workloads run synchronously for instant results; large workloads dispatch to Celery.

| Task | Sync Threshold | Async Trigger |
|------|---------------|---------------|
| Payslip generation | <50 active staff | 50+ staff |
| Timetable generation | <15 class subjects | 15+ subjects |
| Bulk student promotion | <50 students | 50+ students |
| Promotion advisor | <30 enrolled students | 30+ students |
| Monthly fee generation | <100 students | 100+ students |
| Report generation | XLSX format | PDF format |

### Scheduled Tasks (Celery Beat)

| Task | Schedule | Purpose |
|------|----------|---------|
| monthly-fee-reminders | 5th of month, 9:00 AM | Send fee reminders |
| weekly-overdue-alerts | Mondays, 10:00 AM | Alert overdue payments |
| daily-absence-summary | Daily, 5:00 PM | Absence notification digest |
| process-notification-queue | Every 5 minutes | Send queued notifications |
| cleanup-old-uploads | Sundays, 2:00 AM | Delete uploads older than 90 days |
| retry-failed-uploads | Every 6 hours | Retry failed AI processing |
| cleanup-location-data | Sundays, 3:00 AM | Clean old GPS data |
| auto-end-stale-journeys | Every hour | Close stale transport journeys |

## Django Settings Summary

### JWT Configuration

| Setting | Local | Production |
|---------|-------|------------|
| ACCESS_TOKEN_LIFETIME | 1 day | 1 hour |
| REFRESH_TOKEN_LIFETIME | 7 days | 1 day |
| ROTATE_REFRESH_TOKENS | True | True |
| BLACKLIST_AFTER_ROTATION | True | True |

### REST Framework

- Auth: JWTAuthentication
- Permissions: IsAuthenticated (default)
- Pagination: FlexiblePageNumberPagination (page_size=20)
- Throttling: Disabled (no Redis on free tier)

### Cache

- Backend: django-redis (if Redis available), LocMemCache fallback
- Default timeout: 5 minutes
- Key prefix: 'eduai'

### Security (Production)

- SECURE_SSL_REDIRECT: False (Render handles SSL)
- SECURE_PROXY_SSL_HEADER: ('HTTP_X_FORWARDED_PROTO', 'https')
- HSTS: Enabled (1 year)
- SESSION_COOKIE_SECURE: True
- CSRF_COOKIE_SECURE: True
- X_FRAME_OPTIONS: DENY

### Logging

- Console handler
- INFO level (local), WARNING level (production)
- Module loggers: attendance, finance, schools, users

### CORS

- Allowed origins from env
- Credentials: allowed
- Custom headers: x-school-id, x-csrftoken

## Database

### Development

- Engine: SQLite (db.sqlite3)
- Location: backend/db.sqlite3

### Production

- Engine: PostgreSQL via dj-database-url
- Host: Supabase Session Pooler
- Connection: DATABASE_URL env var

### Custom User Model

- Model: users.User
- Extends AbstractUser with role, phone, school FK

## Local Development Setup

```bash
# 1. Backend
cd backend
python -m venv venv
source venv/Scripts/activate  # Windows
pip install -r requirements.txt
cp .env.example .env  # Edit with your keys
python manage.py migrate
python manage.py runserver 8000

# 2. Frontend
cd frontend
npm install
cp .env.example .env  # Usually empty for local
npm run dev  # Port 3000, proxies /api to :8000

# 3. Mobile (optional)
cd mobile
npm install
npx expo start
```

## Deployment Checklist

1. Push to GitHub (auto-triggers Render deploy)
2. Set all env vars in Render dashboard
3. Ensure Redis (Upstash) is configured
4. Set VITE_API_URL in frontend service
5. Add frontend URL to CORS_ALLOWED_ORIGINS
6. Verify Celery worker is running (check Render logs)
7. Test login at frontend URL
