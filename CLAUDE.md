# KoderEduAI - Smart Attendance & School ERP

## Quick Reference (Auto-loaded each session)

### What This Is
Multi-tenant school management SaaS with AI-powered attendance from handwritten registers. Built with Django REST + React (Vite) + React Native (Expo).

### Tech Stack
| Layer | Tech |
|-------|------|
| Backend | Django 5.2, DRF 3.16, SimpleJWT, Celery 5.6, Redis |
| Frontend | React 18.3, Vite 6, Tailwind 3.4, React Query 5, Axios |
| Mobile | React Native 0.81, Expo 54, TypeScript |
| Database | PostgreSQL (Supabase pooler) / SQLite (dev) |
| File Storage | Supabase Storage (bucket: `atten-reg`) |
| AI/Vision | Google Cloud Vision, Groq LLM (llama-3.3-70b), Tesseract (legacy) |
| Deploy | Render.com (backend + static frontend) |

### Directory Structure
```
smart-attendance/
├── backend/                    # Django project
│   ├── config/                 # settings.py, urls.py, celery.py
│   ├── core/                   # middleware, permissions, mixins, storage
│   ├── users/                  # Auth, JWT, user management
│   ├── schools/                # Multi-tenancy (Organization, School, Membership)
│   ├── students/               # Students, Classes, Documents, Student portal
│   ├── attendance/             # AI OCR pipeline, uploads, records, feedback
│   ├── academic_sessions/      # Academic years, terms, enrollments, promotions
│   ├── academics/              # Subjects, timetable, AI chat
│   ├── examinations/           # Exams, marks, grade scales, report cards
│   ├── finance/                # Accounts, fees, expenses, discounts, payments
│   ├── hr/                     # Staff, departments, salary, leave, appraisals
│   ├── admissions/             # Enquiries, notes, batch conversion
│   ├── notifications/          # Templates, logs, preferences, AI chat
│   ├── parents/                # Parent portal, messages, leave requests
│   ├── lms/                    # Lesson plans, assignments, submissions
│   ├── transport/              # Routes, vehicles, GPS tracking
│   ├── library/                # Books, categories, issues
│   ├── hostel/                 # Hostels, rooms, allocations, gate passes
│   ├── inventory/              # Items, vendors, stock transactions
│   └── reports/                # PDF/Excel report generation
├── frontend/                   # React (Vite) app
│   └── src/
│       ├── components/         # Layout, SchoolSwitcher, Toast, etc.
│       ├── contexts/           # AuthContext, AcademicYearContext, BackgroundTaskContext
│       ├── hooks/              # useBackgroundTask, useDebounce, useWorkflowTransition
│       ├── pages/              # ~88 page components
│       └── services/api.js     # Centralized API layer (876 lines)
├── mobile/                     # React Native (Expo) app
├── docs/                       # Detailed documentation (see below)
└── render.yaml                 # Deployment blueprint
```

### Running Locally
```bash
# Backend (from backend/)
python manage.py runserver 8000

# Frontend (from frontend/)
npm run dev          # Runs on port 3000, proxies /api to :8000

# Both use .env files for configuration
```

### Key Architectural Patterns

**Multi-tenancy:** Every request includes `X-School-ID` header. `TenantMiddleware` resolves school from header → subdomain → user default. All querysets filtered by `school_id`.

**Auth:** JWT (SimpleJWT). Login returns `{access, refresh, user}`. Token has `user_id`, `role`, `school_id`. Roles: SUPER_ADMIN, SCHOOL_ADMIN, PRINCIPAL, HR_MANAGER, ACCOUNTANT, TEACHER, STAFF, PARENT, STUDENT.

**Frontend data fetching:** React Query everywhere. Pattern:
```js
const { data } = useQuery({ queryKey: ['key', deps], queryFn: () => api.getEndpoint(params) })
const mutation = useMutation({ mutationFn: (d) => api.post(d), onSuccess: () => queryClient.invalidateQueries(['key']) })
```

**API pagination:** All list endpoints return `{count, next, previous, results}`. Default page_size=20. Use `?page_size=N`.

**Module gating:** Schools have `enabled_modules` object. Frontend checks `isModuleEnabled('finance')` before rendering routes. Backend uses `ModuleAccessMixin`.

### Attendance AI Pipeline (Core Feature)
1. Upload image → Supabase storage
2. Google Vision OCR → raw text + bounding boxes
3. TableExtractor → structured grid (rows/cols)
4. LLM Reasoning (Groq) → match students to marks
5. Admin review → confirm/edit matches
6. AttendanceFeedback → learning loop for accuracy improvement

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

### Detailed Documentation
For deeper reference, read these files from `docs/`:
- `docs/BACKEND_APPS.md` — All 18 Django apps with models and fields
- `docs/API_ENDPOINTS.md` — Every registered endpoint with methods and params
- `docs/API_RESPONSES.md` — Sample JSON responses for all endpoints
- `docs/FRONTEND_PAGES.md` — All 88 routes with components and API calls
- `docs/FRONTEND_COMPONENTS.md` — Components, contexts, hooks, state management
- `docs/ATTENDANCE_PIPELINE.md` — Complete AI OCR flow with code references
- `docs/ENV_AND_DEPLOYMENT.md` — Environment variables, Render config, Celery

### Test Accounts (Dev)
| Username | Role | Password |
|----------|------|----------|
| P19SCH_superadmin | SUPER_ADMIN | Abcd1234 |
| focus3899 | SCHOOL_ADMIN (Branch 1) | Abcd1234 |
| SEED_TEST_admin | SCHOOL_ADMIN (School Alpha, id=37) | Abcd1234 |

### Test School (All Modules Enabled)
School ID: **37** (SEED_TEST_School_Alpha) — has all modules enabled, seed data for students, staff, attendance, inventory.

### Important Notes
- Frontend is Vite + React (NOT Next.js) — no SSR, client-side routing only
- Attendance URLs use underscores in Django (e.g., `pending_review`, `daily_report`) not hyphens
- Finance gateway config endpoint is `gateway-config/` not `payment-gateways/`
- Reports endpoint is `reports/list/` and `reports/generate/` not just `reports/`
- Parent messages only support POST (send), thread listing is at `messages/threads/`
- Tasks endpoint is `tasks/tasks/` (nested router)
