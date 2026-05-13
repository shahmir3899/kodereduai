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
| ENABLE_CELERY | Prod | false (settings) / true (start.sh) | Whether `start.sh` spawns a Celery **worker** in the web container. Required for retries (`process_notification_queue`), scheduled in-app dispatch, deferred sends, and stale-OCR cleanup. **Must be `true` in `render.yaml` for notifications to function.** |
| ENABLE_CELERY_BEAT | Prod | false (settings) / true (start.sh) | Whether `start.sh` spawns Celery **Beat** (the cron-style scheduler) in the web container. Required for all timed tasks listed in `CELERY_BEAT_SCHEDULE` (absence digests, fee reminders, etc.). |
| LMS_TOC_OCR_FORCE_SYNC | No | false | If true, `POST /api/lms/books/{id}/ocr_toc/?async=1` runs OCR inline instead of returning `202 + poll_url`. Debug-only escape hatch. The async path always uses an in-process daemon thread (independent of `ENABLE_CELERY`). |
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

### Public demo visitor email (backend)

When `DEMO_ACCESS_EMAIL_ENABLED` is true, a successful `POST /api/public/forms/demo-request/` also emails **the submitter** demo login instructions (in addition to the internal team notification). Values must be set in the deployment environment — never commit real passwords. Example: `DEMO_ACCESS_LOGIN_URL=https://demo.kodereduai.pk/login` with username/password matching the **`demo`** tenant admin (`qaisar` / shared demo password you set via `seed_demo_portal`).

| Variable | Required when enabled | Default | Purpose |
|----------|----------------------|---------|---------|
| DEMO_ACCESS_EMAIL_ENABLED | — | false | Enable second email to the visitor |
| DEMO_ACCESS_LOGIN_URL | Yes | — | Full URL to the demo login page |
| DEMO_ACCESS_USERNAME | Yes | — | Demo account username |
| DEMO_ACCESS_PASSWORD | Yes | — | Demo account password |
| DEMO_ACCESS_EMAIL_SUBJECT | No | Your Education AI demo access | Subject line for visitor email |
| DEMO_ACCESS_EMAIL_SENDER | No | same as `LANDING_FORMS_EMAIL_SENDER` | From address for visitor email |

### Frontend (.env)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| VITE_API_URL | Prod only | - | Backend API URL. Dev uses proxy to localhost:8000 |

### Standalone Landing App (`frontend/apps/koderkids-landing-astro/.env`)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| SITE_URL | No | — | Canonical site URL (build-time SEO, sitemap) |
| PUBLIC_MAIN_APP_API_BASE_URL | No | empty in dev (Astro proxy); prod API URL in build | Base URL for public form POSTs and metrics |
| PUBLIC_LANDING_METRICS_PATH | No | `/api/public/landing-metrics/` | Landing metrics JSON path |
| PUBLIC_SCHOOL_ID | No | — | Optional `X-School-ID` for public metrics (use **42** when metrics should reflect the `demo` subdomain school) |
| PUBLIC_DEMO_FORM_ENDPOINT | No | `{API}/api/public/forms/demo-request/` | Demo request JSON endpoint |
| PUBLIC_CONTACT_FORM_ENDPOINT | No | `{API}/api/public/forms/contact-enquiry/` | Contact form endpoint |
| PUBLIC_CAREERS_FORM_ENDPOINT | No | `{API}/api/public/careers/apply/` | Careers form endpoint |

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
- Plan: Starter
- Root: backend/
- Build: `./build.sh` — pip install, collectstatic, migrate
- Start: `bash start.sh` — runs Gunicorn (foreground) plus Celery worker + Beat in auto-restart loops, all gated by `ENABLE_CELERY` / `ENABLE_CELERY_BEAT` (both set to `"true"` in `render.yaml`)
- Health check: /api/ endpoint

**2. kodereduai (Frontend)**

- Runtime: Static site
- Root: frontend/
- Build: `npm install && npm run build`
- Publish: dist/
- SPA Rewrite: /* → /index.html
- Headers: X-Frame-Options: DENY, X-Content-Type-Options: nosniff

**3. koderkids-landing-astro (Optional standalone marketing site)**

- Runtime: Static site
- Root: `frontend/apps/koderkids-landing-astro/`
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

Single-container deployment: Gunicorn + Celery worker + Celery Beat all run inside the same Render service, gated by `ENABLE_CELERY` / `ENABLE_CELERY_BEAT`. Worker and Beat each run in an auto-restart loop so a crash (OOM, transient broker error) does not stop scheduled tasks.

```bash
# Conditional: worker only starts when ENABLE_CELERY=true
restart_celery() {
  while true; do
    celery -A config worker -l info --concurrency=1
    sleep 5
  done
}
[ "$ENABLE_CELERY" = "true" ] && restart_celery &

# Conditional: beat only starts when ENABLE_CELERY_BEAT=true
restart_celery_beat() {
  while true; do
    celery -A config beat -l info
    sleep 5
  done
}
[ "$ENABLE_CELERY_BEAT" = "true" ] && restart_celery_beat &

# Gunicorn runs in foreground (gthread, 1 worker × 4 threads by default)
gunicorn --worker-class gthread --workers 1 --threads 4 config.wsgi:application
```

## Celery Configuration

### Task Queue

- Broker: Redis (Upstash on production; `rediss://` triggers SSL with `CERT_NONE`)
- Serializer: JSON
- Timezone: `Asia/Karachi` (Beat cron entries use local time)
- Time limit: 30 minutes per task
- Concurrency: 1 worker × 1 process (Starter plan); the single gthread Gunicorn worker is what serves HTTP

### Curriculum OCR is NOT routed through Celery

`POST /api/lms/books/{id}/ocr_toc/?async=1` spawns an in-process daemon thread (`lms.views._process_toc_job_in_background`) and returns `202` + `poll_url`. The view does **not** call `process_toc_import_job.delay()` anymore, so flipping `ENABLE_CELERY` cannot break TOC OCR. The `lms.tasks.process_toc_import_job` task remains in the codebase only as a fallback used by the periodic `mark-stale-toc-jobs-timed-out` cleanup. Set `LMS_TOC_OCR_FORCE_SYNC=true` to skip the async path entirely (debug only).

### Smart Sync/Async Dispatch

On-demand background tasks use a smart sync/async pattern via `run_task_sync()` and `dispatch_background_task()` in `core/task_utils.py`. Small workloads run synchronously for instant results; large workloads dispatch to Celery. When no worker responds to `ping()` within 2s, `dispatch_background_task` falls back to synchronous execution so the request still completes.

| Task | Sync Threshold | Async Trigger |
|------|---------------|---------------|
| Payslip generation | <50 active staff | 50+ staff |
| Timetable generation | <15 class subjects | 15+ subjects |
| Bulk student promotion | <50 students | 50+ students |
| Promotion advisor | <30 enrolled students | 30+ students |
| Monthly fee generation | <100 students | 100+ students |
| Report generation | XLSX format | PDF format |

### Scheduled Tasks (Celery Beat)

All entries below live in `CELERY_BEAT_SCHEDULE` in `backend/config/settings.py` and are reconciled into `django_celery_beat`'s `DatabaseScheduler` (so manual edits via Django admin persist across redeploys). Times below are Asia/Karachi.

| Task | Schedule | Purpose |
|------|----------|---------|
| `fee-pending-in-app-5th` | Day 5, 09:00 | In-app fee pending alerts (admins/principal per class, class teachers, parent/student self) |
| `fee-pending-in-app-8th` | Day 8, 09:00 | Second-pass in-app fee pending alerts |
| `daily-absence-summary` | Every minute (gated per school) | Daily school report (attendance, lesson plans, pending fees, staff leave) at each school's configured `daily_absence_summary_time` |
| `scheduled-absence-in-app-digest` | 08:00, 09:00, 10:00 | Consolidated absence digest per class once that class's register is complete |
| `process-notification-queue` | Every 5 minutes | Retry `PENDING` / retriable `FAILED` `NotificationLog` rows |
| `cleanup-old-uploads` | Sundays, 02:00 | Delete attendance uploads older than 90 days |
| `retry-failed-uploads` | Every 6 hours | Re-run failed AI attendance processing in the last 24h |
| `cleanup-location-data` | Sundays, 03:00 | Purge transport GPS pings older than 7 days |
| `auto-end-stale-journeys` | Every hour | Auto-close transport journeys idle > 2h |
| `weekly-auto-tune-thresholds` | Sundays, 03:00 | Recompute per-school accuracy/anomaly thresholds |
| `dispatch-scheduled-notifications` | Every 5 minutes | Send deferred `SCHEDULED` `NotificationLog` rows whose `scheduled_for` time has arrived |
| `mark-stale-toc-jobs-timed-out` | Every 5 minutes | Mark TOC OCR jobs stuck in QUEUED/PROCESSING > 5 min as `TIMED_OUT` (safety net for in-process thread death) |
| `class-teacher-attendance-reminder-11am` | Daily, 11:00 | Nudge class teachers who haven't marked attendance (skips off-days and teachers who are themselves absent) |
| `nightly-sibling-detection` | Daily, 02:30 | Scan students and surface potential sibling links for finance discount workflows |

`send_fee_reminders` and `send_fee_overdue_alerts` exist in `notifications/tasks.py` but are intentionally **not** in `CELERY_BEAT_SCHEDULE` — fee pending fans out via the in-app tasks above instead.

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

# 2b. Standalone landing app (Astro)
cd frontend/apps/koderkids-landing-astro
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
5. If deploying the standalone Astro landing app, set `PUBLIC_MAIN_APP_API_BASE_URL`, optional `PUBLIC_LANDING_METRICS_PATH` / `PUBLIC_SCHOOL_ID`, and form endpoint overrides if needed
6. If enabling automated demo login emails, set `DEMO_ACCESS_EMAIL_ENABLED` and related `DEMO_ACCESS_*` variables on the backend (never commit passwords)
7. Set `CORS_ALLOWED_ORIGINS` to explicit HTTPS frontend URLs, including the landing app domain if it calls the backend
8. If hosting frontend on Apache/cPanel, verify HTTP requests redirect to HTTPS
9. Confirm web login behavior:
	- Remember me unchecked: login ends on browser close
	- Remember me checked: login persists until token expiry
10. Confirm inactivity logout still triggers after 30 minutes idle
11. For mobile EAS builds, set profile env vars for API URL and HTTP policy
12. Verify Celery worker is running (check Render logs)
13. Test login at frontend URL
14. Test landing app metrics/cards if the standalone marketing site is deployed
