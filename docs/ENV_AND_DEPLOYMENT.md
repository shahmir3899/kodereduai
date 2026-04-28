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

### Standalone Landing App (`frontend/apps/koderkids-landing/.env`)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| VITE_MAIN_APP_API_BASE_URL | No | http://localhost:8000 | Base URL for optional public metrics API |
| VITE_LANDING_METRICS_PATH | No | /api/public/landing-metrics/ | Endpoint path returning landing metrics JSON |
| VITE_PUBLIC_SCHOOL_ID | No | 37 | Optional `X-School-ID` header for multi-tenant public metrics requests |

### Mobile Build Environment (EAS)

| Variable | Used In | Purpose |
|----------|---------|---------|
| EXPO_PUBLIC_API_URL | development/preview/production | Mobile backend API base URL |
| EXPO_PUBLIC_APP_ENV | development/internal/production | Runtime profile guard |
| EXPO_PUBLIC_ALLOW_INSECURE_HTTP | development/internal | Allow HTTP API URL when explicitly needed |

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

**3. koderkids-landing (Optional standalone marketing site)**

- Runtime: Static site
- Root: `frontend/apps/koderkids-landing/`
- Build: `npm install && npm run build`
- Publish: `dist/`
- Notes: deploy separately from the authenticated ERP SPA when you want an isolated marketing surface or different domain/subdomain

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
- Web login persistence: Remember me controls storage mode
- Browser-close logout: works when Remember me is unchecked (session-scoped storage)

### Logging

- Console handler
- INFO level (local), WARNING level (production)
- Module loggers: attendance, finance, schools, users

### CORS

- Production: HTTPS-only allowed origins and regex patterns
- Local: localhost HTTP origins allowed for development
- Credentials: allowed
- Custom headers: x-school-id, x-csrftoken

## Apache Build Hosting Hardening (.htaccess)

If you deploy frontend by uploading build files to Apache/cPanel:

1. Keep `.htaccess` in site root (same folder as `index.html`).
2. Force HTTP to HTTPS redirect.
3. Keep SPA fallback rewrite to `/index.html`.
4. Add baseline security headers: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy.
5. Re-upload `.htaccess` whenever frontend build files are refreshed.

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

# 2b. Standalone landing app
cd frontend/apps/koderkids-landing
npm install
cp .env.example .env
npm run dev

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
5. If deploying the standalone landing app, set its `VITE_MAIN_APP_API_BASE_URL`, `VITE_LANDING_METRICS_PATH`, and optional `VITE_PUBLIC_SCHOOL_ID`
6. Set `CORS_ALLOWED_ORIGINS` to explicit HTTPS frontend URLs, including the landing app domain if it fetches public metrics from the backend
7. If hosting frontend on Apache/cPanel, verify HTTP requests redirect to HTTPS
8. Confirm web login behavior:
	- Remember me unchecked: login ends on browser close
	- Remember me checked: login persists until token expiry
9. Confirm inactivity logout still triggers after 30 minutes idle
10. For mobile EAS builds, set profile env vars for API URL and HTTP policy
11. Verify Celery worker is running (check Render logs)
12. Test login at frontend URL
13. Test landing app metrics/cards if the standalone marketing site is deployed
