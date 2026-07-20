# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Multi-tenant school management SaaS (ERP) for K-12 schools, covering attendance, academics, examinations, finance/fees, HR/payroll, admissions, LMS, transport, library, hostel, and inventory. Built with Django REST + React (Vite) + React Native (Expo). The repo also includes a separate standalone marketing/landing site for the KoderKids brand — a fully independent app with its own build/deploy.

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Django 5.2.11, DRF 3.16, SimpleJWT, Celery 5.6 + django-celery-beat, Redis (Upstash) |
| Frontend | React 18.3, Vite 6, Tailwind 3.4, React Query 5, React Router 7, Axios |
| Landing site | Astro, `frontend/apps/koderkids-landing-astro` — separate build/deploy from the main frontend |
| Mobile | React Native 0.81, Expo 54, TypeScript, expo-router |
| Database | PostgreSQL (Supabase pooler) in production / SQLite in dev (auto-selected when `DATABASE_URL` is unset) |
| File Storage | Supabase Storage (bucket: `atten-reg`) |
| AI/Vision | Google Cloud Vision + Groq LLM (`llama-3.3-70b-versatile`) for OCR reasoning (currently disabled by default, see Gotchas); `face_recognition`/dlib for face-attendance |
| Deploy | Render.com — **backend only** (see Deployment) |

## Directory Structure

```
EducationAI/
├── backend/                    # Django project
│   ├── config/                 # settings.py, urls.py, celery.py
│   ├── core/                   # middleware, permissions, mixins, storage, background-task infra
│   ├── users/                  # Auth, JWT, user management
│   ├── schools/                # Multi-tenancy (Organization, School, Membership)
│   ├── students/               # Students, Classes, Documents, Student portal
│   ├── attendance/             # AI OCR pipeline (parked), uploads, records, feedback
│   ├── academic_sessions/      # Academic years, terms, enrollments, promotions
│   ├── academics/              # Subjects, timetable, AI chat
│   ├── examinations/           # Exams, marks, grade scales, report cards
│   ├── finance/                # Accounts, fees, expenses, discounts, payments
│   ├── hr/                     # Staff, departments, salary, leave, appraisals
│   ├── admissions/             # Enquiries, notes, batch conversion
│   ├── notifications/          # Templates, logs, preferences, AI chat
│   ├── parents/                # Parent portal, messages, leave requests
│   ├── lms/                    # Lesson plans, curriculum TOC, assignments, submissions
│   ├── transport/               # Routes, vehicles, GPS tracking
│   ├── library/                # Books, categories, issues
│   ├── hostel/                 # Hostels, rooms, allocations, gate passes
│   ├── inventory/              # Items, vendors, stock transactions
│   ├── face_attendance/        # Face-recognition attendance
│   ├── messaging/               # Internal messaging
│   ├── brochure/               # Careers/landing form delivery
│   └── reports/                # PDF/Excel report generation
├── frontend/
│   ├── src/
│   │   ├── components/         # Layout, SchoolSwitcher, Toast, etc.
│   │   ├── contexts/           # AuthContext, AcademicYearContext, BackgroundTaskContext
│   │   ├── hooks/               # useBackgroundTask, useDebounce, useWorkflowTransition
│   │   ├── pages/               # Page components, one per route
│   │   └── services/api.js     # Centralized Axios API layer
│   └── apps/
│       └── koderkids-landing-astro/  # Standalone Astro marketing site
├── mobile/                     # React Native (Expo) app
├── infra/waha/                 # Local WhatsApp (WAHA) Docker stack — integration currently deprecated, see Gotchas
├── scripts/                    # One-off operational/verification scripts
├── docs/                       # Detailed reference documentation (read on demand, not preloaded)
└── render.yaml                 # Render Blueprint (backend web service only)
```

## Running Locally

```bash
# Backend (from backend/)
cp .env.example .env   # fill in secrets
python manage.py runserver 8000

# Main frontend (from frontend/)
npm install
npm run dev             # port 3000, proxies /api to :8000

# Landing site (from frontend/apps/koderkids-landing-astro/)
npm install
npm run dev

# Mobile (from mobile/)
npm install
npm start                # expo start
```

Helper script: `run_both_servers.bat` starts backend + main frontend in separate terminals.

## Frontend/Backend Communication

- **Multi-tenancy:** every request includes an `X-School-ID` header. `core.middleware.TenantMiddleware` resolves the active school from header → subdomain → user default. All querysets are filtered by `school_id`.
- **Auth:** JWT (SimpleJWT). Login returns `{access, refresh, user}`. Access token has `user_id`, `role`, `school_id`. Roles: `SUPER_ADMIN`, `SCHOOL_ADMIN`, `PRINCIPAL`, `HR_MANAGER`, `ACCOUNTANT`, `TEACHER`, `STAFF`, `PARENT`, `STUDENT`. Lifetimes: 1 day access / 7 day refresh locally, 1 hour / 1 day in production.
- `frontend/src/services/api.js` is a single Axios instance with request/response interceptors: attaches `Authorization`/`X-School-ID`, strips `Content-Type` on GET/HEAD, auto-refreshes the access token on 401 and retries once, dispatches a global `api-error` window event on 5xx/network errors. API calls are grouped into per-domain objects (e.g. `attendanceApi`), not one flat client.
- **Pagination:** all list endpoints return `{count, next, previous, results}` via `core.pagination.FlexiblePageNumberPagination`, default `page_size=20`, override with `?page_size=N`.
- **Errors:** DRF `EXCEPTION_HANDLER` is `core.views.custom_exception_handler` — don't bypass with ad hoc try/except in views.
- **Module gating:** schools have an `enabled_modules` object. Frontend checks `isModuleEnabled('finance')` before rendering routes; backend enforces via `ModuleAccessMixin`.
- **CORS:** production trusts only explicit HTTPS origins plus regexes for `*.kodereduai.pk` and `*.onrender.com`; local dev allows `localhost`/`127.0.0.1` on ports 3000/8000/4321.

### URL/param quirks
- Attendance URLs use underscores (`pending_review`, `daily_report`), not hyphens.
- Finance gateway config is `gateway-config/`, not `payment-gateways/`.
- Reports live at `reports/list/` and `reports/generate/`, not just `reports/`.
- Parent messages only support `POST` (send); thread listing is at `messages/threads/`.
- Tasks endpoint is nested: `tasks/tasks/`.

### Common Query Params
| Param | Used In | Purpose |
|-------|---------|---------|
| `class_obj` | students, attendance, enrollments | Filter by class ID |
| `academic_year` | enrollments, attendance, exams | Filter by academic year ID |
| `date` | attendance records | Filter by date (YYYY-MM-DD) |
| `status` | most models | Filter by status field |
| `page_size` | all list endpoints | Items per page (default 20) |
| `search` | students, staff | Search by name |
| `month`, `year` | fee-payments | Filter by billing period |

## Coding Conventions (observed in this codebase)

- **Backend views** are DRF `ViewSet`/`GenericViewSet` + mixins, not raw `APIView` for CRUD. Permission classes combine `IsAuthenticated` with custom classes like `core.permissions.HasSchoolAccess`; tenant scoping in `get_queryset` goes through `core.mixins.ensure_tenant_school_id(self.request)` rather than reading headers directly.
- Custom `@action` methods wrap external side effects (Celery revoke, queued-job cancel) in narrow `try/except Exception: pass` with a comment explaining why the failure is non-fatal — not blanket exception suppression.
- Settings are environment-driven via `os.getenv(...)` with inline defaults in `config/settings.py`, gated by a single `ENVIRONMENT` var (`local`/`production`) rather than scattered booleans — `DEBUG`, security headers, JWT lifetimes, CORS, and email backend all derive from it.
- **Frontend data fetching** uses React Query everywhere:
  ```js
  const { data } = useQuery({ queryKey: ['key', deps], queryFn: () => api.getEndpoint(params) })
  const mutation = useMutation({ mutationFn: (d) => api.post(d), onSuccess: () => queryClient.invalidateQueries(['key']) })
  ```
- Frontend pages live under `src/pages/` (one file per route), shared UI in `src/components/`, cross-cutting state in `src/contexts/`, reusable logic in `src/hooks/`.
- Comments in both backend and frontend explain *why* (a specific incident, a cost tradeoff, a non-obvious ordering requirement), not what the code does — follow that pattern rather than narrating logic.

## Tests

```bash
# Backend (from backend/) — pytest + pytest-django, settings module is config.settings_test
pytest
pytest backend/lms/tests/test_embeddings.py::TestClassName::test_method   # single test
pytest -m phase12          # phase-tagged subset, see pytest.ini markers

# Frontend (from frontend/)
npm run test        # vitest, watch mode
npm run test:run     # vitest, single run
npx vitest run src/pages/some/File.test.jsx   # single file
```

Some backend apps keep tests in a `tests/` package (e.g. `lms/tests/`), others in a single `tests.py` — both patterns are in active use; follow whichever the app already uses.

## Build

```bash
npm run build        # frontend/ -> frontend/dist
npm run build         # frontend/apps/koderkids-landing-astro/ -> its own dist
./build.sh             # backend/ — installs deps, collectstatic, migrate (used by Render)
```

## Attendance AI Pipeline (parked feature — see Gotchas)

1. Upload image → Supabase storage
2. Google Vision OCR → raw text + bounding boxes
3. TableExtractor → structured grid (rows/cols)
4. LLM reasoning (Groq) → match students to marks
5. Admin review → confirm/edit matches
6. AttendanceFeedback → learning loop for accuracy improvement

## Non-obvious Architecture / Gotchas

- **Attendance OCR is parked.** `OCR_ENABLED` defaults to `False` in settings — the handwritten-register pipeline above is not active by default; the code lives in `backend/attendance/_deprecated_ocr/`. Don't assume it's live without checking this flag.
- **WhatsApp integration is deprecated.** The `WHATSAPP_*` settings block is commented out in `config/settings.py` (see `backend/core/_deprecated_whatsapp/README.md`); in-app/push notifications are the primary channel now. `infra/waha/` still exists for local dev if it's ever re-enabled, but treat it as inactive.
- **Three different background-execution paths coexist, on purpose — don't unify them:**
  1. *Notification scheduling* (`daily-absence-summary`, `scheduled-absence-in-app-digest`, `fee-pending-in-app-5th/8th`, `class-teacher-attendance-reminder-11am`, `process-notification-queue`, `dispatch-scheduled-notifications`, `mark-stale-toc-jobs-timed-out`, etc.) lives entirely on **Celery Beat**. Production needs `ENABLE_CELERY=true` and `ENABLE_CELERY_BEAT=true` (`render.yaml`) so `start.sh` launches the worker + scheduler. Local dev uses `CELERY_TASK_ALWAYS_EAGER` (set automatically when `ENVIRONMENT=local`).
  2. *Curriculum TOC OCR* (`POST /api/lms/books/{id}/ocr_toc/?async=1`) does **not** use Celery — it spawns an in-process daemon thread (`lms.views._process_toc_job_in_background`), returning 202 + `poll_url`. Intentional: keeps OCR working regardless of Celery worker health on the Starter plan and avoids competing with notification scheduling for the single worker slot. Do **not** re-couple it to `ENABLE_CELERY`. `LMS_TOC_OCR_FORCE_SYNC=true` is debug-only.
  3. *Heavy user-triggered jobs* (payslip generation, timetable generation, bulk promotion, monthly fee generation, PDF reports) go through `core/task_utils.py::dispatch_background_task`, which pings Celery and falls back to sync execution if no worker responds.
- Progress for long tasks is tracked in Postgres (`core.BackgroundTask`), not Celery's result backend — `CELERY_TASK_IGNORE_RESULT=True` by design to cut Redis ops; don't add `result.get()`/`.ready()` without opting a task in via `ignore_result=False`.
- Transaction-pooled Postgres (Supabase, port 6543) doesn't support server-side cursors — `DISABLE_SERVER_SIDE_CURSORS = True` is set for a reason; don't rely on queryset streaming/`iterator()` against the production DB.
- Frontend is Vite + React (NOT Next.js) — no SSR, client-side routing only.
- Backend root (`backend/`) contains many one-off historical data-repair/diagnostic scripts (`check_*.py`, `recovery_*.py`, `diagnose_*.py`, `rollback_*.py`, etc.) — ad hoc tools tied to specific past incidents, not application code or convention examples.

## Detailed Documentation

Read on demand from `docs/` (not preloaded — these are large):
- `docs/BACKEND_APPS.md` — Django apps with models and fields
- `docs/API_ENDPOINTS.md` — every registered endpoint with methods and params
- `docs/API_RESPONSES.md` — sample JSON responses for all endpoints
- `docs/FRONTEND_PAGES.md` — all routes with components and API calls
- `docs/FRONTEND_COMPONENTS.md` — components, contexts, hooks, state management
- `docs/ATTENDANCE_PIPELINE.md` — complete AI OCR flow with code references
- `docs/ENV_AND_DEPLOYMENT.md` — env/deploy detail beyond this file
- `docs/DEMO_SHOWCASE_DATA.md` — demo/showcase seed commands and cleanup rules

## Test Accounts (Dev)

| Username | Role | Password |
|----------|------|----------|
| P19SCH_superadmin | SUPER_ADMIN | Abcd1234 |
| focus3899 | SCHOOL_ADMIN (Branch 1) | Abcd1234 |
| SEED_TEST_admin | SCHOOL_ADMIN (School Alpha, id=37) | Abcd1234 |

### Public demo (`demo.kodereduai.pk`)
| Item | Value |
|------|--------|
| School | **Demo School** — ID **42**, subdomain **`demo`** |
| Admin login | **Username:** `qaisar` — **Password:** `Abcd1234` |
| API header | `X-School-ID: 42` |
| Demo teacher accounts (optional) | `demoportal42t1`, `demoportal42t2`, `demoportal42t3` — password **Abcd1234** |

From `backend/`, (re)create minimal classes/students/terms/HR if missing **and** apply showcase graph data:
`python manage.py seed_demo_portal` — add `--reset-showcase` to clear prior `SHOWCASE_` rows first. See `docs/DEMO_SHOWCASE_DATA.md`.

### Test School (dev seed — not the public demo host)
School ID **37** (SEED_TEST_School_Alpha). To add **only** showcase graph layers (expects existing roster from `seed_test_data.py`):
`python manage.py seed_showcase_graphs --school-id=37` (add `--reset` to remove prior showcase-tagged rows first). See `docs/DEMO_SHOWCASE_DATA.md`.

## Deployment

- `render.yaml` deploys **only the backend** to Render as a `web` service (`kodereduai-api`, Oregon, Starter plan, `rootDir: backend`, `buildCommand: ./build.sh`, `startCommand: bash start.sh`, gunicorn + whitenoise for static files). A push to the connected branch on the linked GitHub repo triggers a deploy.
- **The frontend is not on Render.** It's hosted externally (Hostinger, wildcard subdomains for per-school SPAs under `*.kodereduai.pk`); the Astro landing site builds/deploys separately too.
- Redis is Upstash (`CELERY_BROKER_URL`/`CELERY_RESULT_BACKEND`, `rediss://`); SSL cert verification is relaxed (`ssl_cert_reqs: CERT_NONE`) to work with Upstash's setup.
- Required Render env vars are listed in `render.yaml` (`sync: false` entries are set manually in the dashboard) and mirrored in `backend/.env.example`.
- `python manage.py run_scheduled_jobs --all` / `run_cleanup_jobs --all` exist as manual fallbacks if Celery Beat is ever disabled in production.

## Do not create virtual environments
