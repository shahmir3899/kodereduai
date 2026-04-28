# Main App vs Marketing App

Updated: 2026-04-24

This file is the quick comparison between the two frontend surfaces in this repo:

- Main ERP app: `frontend/`
- Standalone marketing app: `frontend/apps/koderkids-landing/`

Use this file as the starting point for a fresh session when the task is about deciding which app to change, how they connect, or what belongs where.

## Short Summary

The main app is the full authenticated school ERP used by admins, teachers, parents, students, and staff.

The marketing app is a separate public-facing landing site used for product presentation, brand messaging, screenshots, testimonials, and demo/contact CTAs.

They are related, but they are not the same app and they are not deployed from the same frontend folder.

## Locations

| Surface | Location | Type |
|---|---|---|
| Main app | `frontend/` | Main authenticated ERP SPA |
| Marketing app | `frontend/apps/koderkids-landing/` | Standalone public Vite app |

## Primary Purpose

| Area | Main app | Marketing app |
|---|---|---|
| Audience | Logged-in users: school admins, principals, teachers, accountants, HR, parents, students, staff | Public visitors, prospects, school decision-makers |
| Goal | Operate the school system | Explain and market the product |
| Core behavior | CRUD, workflows, dashboards, reports, modules, role-based routing | Storytelling, branding, screenshots, testimonials, demo/contact capture |
| Auth | Required for most real functionality | Public, no auth required |

## Technical Difference

| Area | Main app | Marketing app |
|---|---|---|
| Framework style | React + Vite SPA with large route tree | React + Vite standalone single-page marketing site |
| Language | Mostly JSX/JS | TypeScript + TSX |
| Router usage | React Router route tree in `frontend/src/App.jsx` | No dependency on the ERP route tree |
| State/data | React Query + app services + authenticated APIs | Mostly static content, optional public metrics fetch |
| Dependency level | Deeply integrated with backend modules | Light integration, mostly presentation-focused |

## What Lives in Each App

### Main app

- Attendance workflows
- Students and classes
- Academics and examinations
- Finance and fee collection
- HR, admissions, transport, library, inventory
- Parent and student portals
- Notifications, settings, admin dashboards

Key entry point:

- `frontend/src/App.jsx`

### Marketing app

- Hero section
- Product feature messaging
- Dashboard screenshots
- AI capabilities section
- Trust/security section
- Testimonials
- Contact/demo form UI
- Public headline metrics such as schools, students, teachers, countries

Key entry points:

- `frontend/apps/koderkids-landing/src/main.tsx`
- `frontend/apps/koderkids-landing/src/App.tsx`

## Data and Backend Relationship

The marketing app is mostly static, but it can optionally read public summary metrics from the backend.

Integration file:

- `frontend/apps/koderkids-landing/src/services/mainAppMetrics.ts`

Supported env vars for the marketing app:

- `VITE_MAIN_APP_API_BASE_URL`
- `VITE_LANDING_METRICS_PATH`
- `VITE_PUBLIC_SCHOOL_ID`

Expected metric payload can use keys such as:

- `schools` or `total_schools`
- `students` or `total_students`
- `teachers` or `total_teachers`
- `countries` or `countries_count`

If the request fails, the marketing app falls back to hardcoded display values.

## Run and Build Commands

### Main app

```bash
cd frontend
npm install
npm run dev
```

### Marketing app

```bash
cd frontend/apps/koderkids-landing
npm install
npm run dev
```

Build preview for marketing app:

```bash
cd frontend/apps/koderkids-landing
npm run build
npm run preview
```

Helper script already in repo:

- `run_landing_app.bat`

That script starts:

- backend server
- standalone marketing app server

## Deployment Model

| Area | Main app | Marketing app |
|---|---|---|
| Deploy shape | Main ERP frontend | Separate static marketing site |
| Typical domain role | Portal/app domain | Main marketing domain or separate subdomain |
| Backend coupling | Tight | Optional public metrics only |

The marketing app should be treated as separately deployable from the ERP frontend when needed.

## Design and Content Ownership

| Change type | Edit main app? | Edit marketing app? |
|---|---|---|
| ERP dashboard features | Yes | No |
| School operations workflow | Yes | No |
| Public headline copy | No | Yes |
| Demo CTA or testimonials | No | Yes |
| Dashboard screenshots used for promotion | No | Yes |
| Public metric cards | Usually marketing app, with optional backend support | Yes |

## Current Status Snapshot

As of 2026-04-24:

- Standalone marketing app exists in `frontend/apps/koderkids-landing`
- Marketing screenshots were synchronized from the provided build artifacts into the marketing app public assets
- Rendered visible text was checked against the provided build and no additional text differences were found
- Central docs were updated so the marketing app is now mentioned in project overview, frontend docs, and env/deployment docs
- Temporary build artifact folder used for comparison was removed after synchronization

## Best File To Start From In A Fresh Session

If the next session is about the marketing app, start from:

- `frontend/apps/koderkids-landing/src/App.tsx`
- `frontend/apps/koderkids-landing/README.md`
- this file: `MAIN_APP_VS_MARKETING_APP.md`

If the next session is about the main ERP frontend, start from:

- `frontend/src/App.jsx`
- `docs/FRONTEND_PAGES.md`
- `docs/FRONTEND_COMPONENTS.md`

## Recommended Fresh-Session Prompt

You can start a new session with something like:

```text
Read MAIN_APP_VS_MARKETING_APP.md first, then help me work on the marketing app in frontend/apps/koderkids-landing.
```

Or:

```text
Read MAIN_APP_VS_MARKETING_APP.md first, then help me work on the main ERP app in frontend/.
```

## File References

- Main comparison file: `MAIN_APP_VS_MARKETING_APP.md`
- Main app router: `frontend/src/App.jsx`
- Marketing app README: `frontend/apps/koderkids-landing/README.md`
- Marketing app UI: `frontend/apps/koderkids-landing/src/App.tsx`
- Marketing metrics integration: `frontend/apps/koderkids-landing/src/services/mainAppMetrics.ts`