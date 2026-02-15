# Implementation Plan: P0 - P3 (Phases 5–11)

> Created: 2026-02-14
> Updated: 2026-02-14
> Status: Phases 5-11 COMPLETED | Phases 12-13 PLANNED
> Replaces: Previous Phase 1-4 plan (all completed)
> Based on: MINDMAP_VS_APP_ANALYSIS.md + Deep Codebase Audit

---

## Table of Contents

1. [Phase 5: Celery Beat Configuration (P0) — COMPLETED](#phase-5-celery-beat-configuration-p0--completed)
2. [Phase 6: Payment Gateway Full Flow (P1) — COMPLETED](#phase-6-payment-gateway-full-flow-p1--completed)
3. [Phase 7: Proper Test Suite (P1) — COMPLETED](#phase-7-proper-test-suite-p1--completed)
4. [Phase 8: Mobile App — React Native + Expo (P2) — COMPLETED](#phase-8-mobile-app--react-native--expo-p2--completed)
5. [Phase 9: Student GPS Location Sharing (P2) — COMPLETED](#phase-9-student-gps-location-sharing-p2--completed)
6. [Phase 10: AI Study Helper (P3) — COMPLETED](#phase-10-ai-study-helper-p3--completed)
7. [Phase 11: Hostel Management (P3) — COMPLETED](#phase-11-hostel-management-p3--completed)
8. [Phase 12: Inventory & Store Management (P3)](#phase-12-inventory--store-management-p3)
9. [Phase 13: Drag-and-Drop Timetable (P3)](#phase-13-drag-and-drop-timetable-p3)
10. [Master Timeline & Dependencies](#master-timeline--dependencies)
11. [Post-Implementation Coverage](#post-implementation-coverage)

---

## Phase 5: Celery Beat Configuration (P0) — COMPLETED

### What is Celery?

Celery is a **background task runner** for Python. It runs jobs your web server shouldn't wait for — sending emails, generating reports, processing images. **Celery Beat** is its built-in scheduler (like cron). You define "run this task every Monday at 9 AM" and Beat triggers it automatically.

### Problem

The app has **9 background tasks already written** across `notifications/tasks.py` and `attendance/tasks.py`, but **none auto-run** because there is no `CELERY_BEAT_SCHEDULE` in `config/settings.py`.

### What Exists Already

| Task | File | Purpose |
|------|------|---------|
| `send_fee_reminders` | notifications/tasks.py | Monthly fee reminder to parents via WhatsApp/SMS |
| `send_fee_overdue_alerts` | notifications/tasks.py | Weekly overdue fee alerts |
| `send_daily_absence_summary` | notifications/tasks.py | Daily absence report to admins at 5 PM |
| `process_notification_queue` | notifications/tasks.py | Retry failed notifications |
| `process_attendance_upload` | attendance/tasks.py | AI OCR pipeline (on-demand, not scheduled) |
| `send_whatsapp_notifications` | attendance/tasks.py | WhatsApp absence alerts (triggered after confirmation) |
| `cleanup_old_uploads` | attendance/tasks.py | Delete old processed images |
| `retry_failed_uploads` | attendance/tasks.py | Retry failed OCR jobs |

### Implementation Steps

**Step 1: Add `CELERY_BEAT_SCHEDULE` to `config/settings.py`**

Add after the existing Celery config block (line ~212):

```python
from celery.schedules import crontab

CELERY_BEAT_SCHEDULE = {
    # ── Fee & Finance ────────────────────────────────────────────────
    'monthly-fee-reminders': {
        'task': 'notifications.tasks.send_fee_reminders',
        'schedule': crontab(day_of_month='5', hour='9', minute='0'),
        # 5th of every month at 9:00 AM PKT
    },
    'weekly-overdue-alerts': {
        'task': 'notifications.tasks.send_fee_overdue_alerts',
        'schedule': crontab(day_of_week='monday', hour='10', minute='0'),
        # Every Monday at 10:00 AM PKT
    },

    # ── Attendance ───────────────────────────────────────────────────
    'daily-absence-summary': {
        'task': 'notifications.tasks.send_daily_absence_summary',
        'schedule': crontab(hour='17', minute='0'),
        # Every day at 5:00 PM PKT
    },

    # ── Notification Queue ───────────────────────────────────────────
    'process-notification-queue': {
        'task': 'notifications.tasks.process_notification_queue',
        'schedule': crontab(minute='*/5'),
        # Every 5 minutes — retry failed notifications
    },

    # ── Cleanup ──────────────────────────────────────────────────────
    'cleanup-old-uploads': {
        'task': 'attendance.tasks.cleanup_old_uploads',
        'schedule': crontab(day_of_week='sunday', hour='2', minute='0'),
        # Every Sunday at 2:00 AM PKT
        'kwargs': {'days': 90},
    },
    'retry-failed-uploads': {
        'task': 'attendance.tasks.retry_failed_uploads',
        'schedule': crontab(hour='*/6'),
        # Every 6 hours — retry failed OCR jobs
        'kwargs': {'hours': 24},
    },
}
```

**Step 2: Install `django-celery-beat`** (database-backed scheduler)

```bash
pip install django-celery-beat
```

- Add `'django_celery_beat'` to `INSTALLED_APPS`
- Add `CELERY_BEAT_SCHEDULER = 'django_celery_beat.schedulers:DatabaseScheduler'`
- Run `python manage.py migrate django_celery_beat`

**Step 3: Update `requirements.txt`**

Add `django-celery-beat>=2.6.0`

**Step 4: Production Deployment (Render)**

Add worker process(es):
```
celery -A config worker --beat --loglevel=info --scheduler django_celery_beat.schedulers:DatabaseScheduler
```

### Schedule Summary

| Task | When | Purpose |
|------|------|---------|
| Fee reminders | 5th of month, 9 AM | Remind parents of upcoming fees |
| Overdue alerts | Monday, 10 AM | Alert for past-due fees |
| Absence summary | Daily, 5 PM | Admin summary of day's absences |
| Notification retry | Every 5 min | Retry failed notifications |
| Upload cleanup | Sunday, 2 AM | Delete uploads older than 90 days |
| Upload retry | Every 6 hours | Retry failed OCR jobs from last 24h |

### Files Modified

| File | Change |
|------|--------|
| `config/settings.py` | Add `CELERY_BEAT_SCHEDULE` dict + `django_celery_beat` to INSTALLED_APPS + scheduler setting |
| `requirements.txt` | Add `django-celery-beat>=2.6.0` |

### Effort: ~1 hour

### Implementation Status: COMPLETED

- Added `django_celery_beat` to INSTALLED_APPS
- Added `CELERY_BEAT_SCHEDULE` with 6 periodic tasks to `config/settings.py`
- Added `CELERY_BEAT_SCHEDULER = 'django_celery_beat.schedulers:DatabaseScheduler'`
- Added `django-celery-beat>=2.6.0` to `requirements.txt`
- Created `config/settings_test.py` with SQLite in-memory DB for tests (avoids Supabase test DB issues)

---

## Phase 6: Payment Gateway Full Flow (P1) — COMPLETED

### What We're Building

A **simulated full payment flow** focused on **JazzCash** and **Easypaisa** (primary Pakistani gateways). We build the complete user journey — gateway config with connectivity test, parent payment initiation, checkout redirect, callback handling, payment verification — so that when actual SDKs are wired later, only the HTTP call layer changes.

**Access:** School Admin only (gateway configuration)
**Settings page:** Existing `PaymentGatewayPage.jsx` at `/finance/payment-gateways`

### What Exists Already

| Component | Status | Location |
|-----------|--------|----------|
| `PaymentGatewayConfig` model | Complete | finance/models.py:778-810 |
| `OnlinePayment` model | Complete | finance/models.py:813-871 |
| `PaymentGatewayConfigViewSet` (CRUD) | Complete | finance/views.py:1676-1705 |
| `OnlinePaymentViewSet` (initiate/verify stubs) | Stub | finance/views.py:1708-1870 |
| `PaymentGatewayPage.jsx` (config UI) | Complete | frontend pages (5 gateway cards, modal forms) |
| `paymentApi` service | Complete | api.js:668-678 |
| Config fields per gateway | Complete | JAZZCASH: merchant_id, password, integrity_salt, environment; EASYPAISA: store_id, merchant_hash, environment |
| Sensitive data masking | Complete | Serializer masks config values on read (key[:4] + '****') |

### What We're Adding

#### Backend: Gateway Service Layer

**New file:** `finance/payment_gateway_service.py`

Abstract base + gateway-specific implementations:

```
PaymentGatewayService (abstract base)
├── JazzCashGateway
│   ├── initiate_payment(amount, order_id, student, description) → form_data + redirect_url
│   ├── verify_payment(gateway_response) → (success, transaction_id, details)
│   ├── test_connection(config) → (success, message)
│   └── calculate_hash(params, salt) → HMAC-SHA256 signature
├── EasypaisaGateway
│   ├── initiate_payment(...) → form_data + redirect_url
│   ├── verify_payment(...) → (success, transaction_id, details)
│   ├── test_connection(config) → (success, message)
│   └── calculate_hash(params, hash_key) → hash
├── StripeGateway (stub — returns "not implemented yet")
├── RazorpayGateway (stub — returns "not implemented yet")
└── ManualGateway
    └── get_bank_details() → bank info for display
```

**Simulation mode:** Since we're not wiring actual SDKs yet:
- `initiate_payment()` generates proper form data and returns a simulated checkout URL pointing to our own `/payment/simulate/` page
- `verify_payment()` validates the hash signature format and marks payment SUCCESS
- `test_connection()` validates config field formats (merchant_id length, salt format, etc.) and returns success/failure with message

**JazzCash Payment Flow:**
1. School admin configures: merchant_id, password, integrity_salt, environment (sandbox/production)
2. Parent clicks "Pay Now" on a fee → backend generates HMAC-SHA256 signed form data
3. Parent redirected to JazzCash checkout (simulated in our flow)
4. JazzCash posts back to `/api/finance/payment/callback/jazzcash/`
5. Backend verifies HMAC signature → marks OnlinePayment as SUCCESS/FAILED
6. Backend updates linked FeePayment (amount_paid, status)
7. Parent redirected to result page

**Easypaisa Payment Flow:**
1. School admin configures: store_id, merchant_hash, environment (sandbox/production)
2. Parent clicks "Pay Now" → backend generates hash + redirect URL
3. Parent redirected to Easypaisa payment page (simulated)
4. Easypaisa posts back to `/api/finance/payment/callback/easypaisa/`
5. Backend verifies hash → marks payment SUCCESS/FAILED
6. Backend updates linked FeePayment
7. Parent redirected to result page

#### Backend: New Endpoints

**On `PaymentGatewayConfigViewSet`:**
```python
@action(detail=True, methods=['post'])
def test_connection(self, request, pk=None):
    """
    Tests gateway configuration validity:
    - JazzCash: Validates merchant_id format, integrity_salt presence, generates test hash
    - Easypaisa: Validates store_id format, merchant_hash presence, generates test hash
    - Stripe: Validates API key format (sk_test_/sk_live_)
    - Razorpay: Validates key_id format (rzp_test_/rzp_live_)
    - Manual: Always returns success
    Returns: { success: bool, message: str, details: {} }
    """
```

**New callback views (public — no auth, gateway posts here):**
```python
# finance/urls.py
path('payment/callback/jazzcash/', JazzCashCallbackView.as_view()),
path('payment/callback/easypaisa/', EasypaisaCallbackView.as_view()),
```

**Parent payment initiation (in parents/views.py):**
```python
class ParentPayFeeView(APIView):
    """
    Parent initiates fee payment.
    POST /api/parents/pay-fee/
    Body: { fee_payment_id: int, gateway: "JAZZCASH"|"EASYPAISA" }
    Returns: { checkout_url: str, order_id: str, form_data: {} }
    """
    permission_classes = [IsAuthenticated, IsParent]
```

**Payment status check:**
```python
class PaymentStatusView(APIView):
    """
    GET /api/finance/payment-status/<order_id>/
    Returns: { status, amount, gateway, completed_at, failure_reason }
    """
```

#### Frontend Changes

**1. PaymentGatewayPage.jsx — Add "Test Connection" Button**

Per gateway config card:
- "Test Connection" button (outlined, with plug/connection icon)
- On click: `POST /api/finance/gateway-config/{id}/test_connection/`
- Loading state: spinner replaces button text
- Success: green checkmark + "Gateway configuration verified successfully"
- Failure: red X + specific error message ("Invalid merchant_id format", etc.)
- Toast notification on result

**2. PaymentGatewayPage.jsx — Add Payment History Tab**

Two tabs at page top:
- **Tab 1: Gateway Configuration** (existing UI — gateway cards with config modals)
- **Tab 2: Payment History** — table of OnlinePayment records:
  - Columns: Order ID, Student, Amount, Gateway, Status (badge), Date
  - Filters: gateway dropdown, status dropdown, date range
  - Status badges: INITIATED (yellow), PENDING (blue), SUCCESS (green), FAILED (red), REFUNDED (purple), EXPIRED (gray)
  - Reconciliation summary card at top (total by status)

**3. ChildFees.jsx (Parent Portal) — Add "Pay Now" Flow**

For each unpaid/partial fee row:
- "Pay Now" button (disabled if no active gateway configured for school)
- Opens modal:
  - Fee details: student name, month/year, amount due, outstanding balance
  - Available gateways: radio buttons showing only active gateways for this school
  - Gateway icons + names (JazzCash red, Easypaisa green)
  - Amount field (pre-filled with outstanding, editable for partial payment)
  - "Proceed to Payment" button
- On submit: `POST /api/parents/pay-fee/`
- Redirect to gateway checkout (simulated page or real gateway)
- On return: show PaymentResultPage

**4. PaymentResultPage.jsx (NEW)**

- Route: `/payment/result`
- Query params: `?order_id=ORD-XXXX&status=SUCCESS|FAILED`
- Shows:
  - Success: green checkmark, "Payment Successful!", amount, transaction ID, date
  - Failed: red X, "Payment Failed", reason, "Try Again" button
  - Pending: spinner, "Verifying payment...", auto-polls status every 3 seconds
- Buttons: "Back to Fees", "Download Receipt" (PDF)
- Auto-redirects to parent dashboard after 10 seconds on success

#### Config Fields Reference (What School Admin Fills In)

**JazzCash:**
| Field | Label | Type | Required | Help Text |
|-------|-------|------|----------|-----------|
| merchant_id | Merchant ID | text | Yes | Provided by JazzCash (e.g., MC12345) |
| password | Password | password | Yes | JazzCash merchant password |
| integrity_salt | Integrity Salt | password | Yes | Used for HMAC-SHA256 signing |
| return_url | Return URL | text | Auto-filled | Your app's payment result URL |
| environment | Environment | select | Yes | Sandbox (testing) / Production (live) |

**Easypaisa:**
| Field | Label | Type | Required | Help Text |
|-------|-------|------|----------|-----------|
| store_id | Store ID | text | Yes | Provided by Easypaisa (e.g., 12345) |
| merchant_hash | Merchant Hash Key | password | Yes | Used for hash verification |
| return_url | Return URL | text | Auto-filled | Your app's payment result URL |
| environment | Environment | select | Yes | Sandbox (testing) / Production (live) |

**Manual/Offline:**
| Field | Label | Type | Required |
|-------|-------|------|----------|
| bank_name | Bank Name | text | Yes |
| account_title | Account Title | text | Yes |
| account_number | Account Number | text | Yes |
| iban | IBAN | text | No |
| branch | Branch | text | No |
| instructions | Payment Instructions | textarea | No |

#### Files Modified/Created

| File | Action | Description |
|------|--------|-------------|
| `finance/payment_gateway_service.py` | CREATE | Gateway abstraction + JazzCash/Easypaisa implementations |
| `finance/views.py` | MODIFY | Add `test_connection` action, JazzCashCallbackView, EasypaisaCallbackView, PaymentStatusView |
| `finance/urls.py` | MODIFY | Add callback + status routes |
| `finance/serializers.py` | MODIFY | Add PaymentInitiateSerializer for parents |
| `parents/views.py` | MODIFY | Add `ParentPayFeeView` |
| `parents/urls.py` | MODIFY | Add pay-fee endpoint |
| `PaymentGatewayPage.jsx` | MODIFY | Add test connection button + payment history tab |
| `ChildFees.jsx` | MODIFY | Add "Pay Now" button + gateway selection modal |
| `PaymentResultPage.jsx` | CREATE | Payment result display page |
| `App.jsx` | MODIFY | Add `/payment/result` route |
| `api.js` | MODIFY | Add test_connection, pay-fee, payment-status methods |

### Effort: ~1-2 days

### Implementation Status: COMPLETED

**Backend:**
- Created `finance/payment_gateway_service.py` — Gateway abstraction layer with `BaseGateway`, `JazzCashGateway` (HMAC-SHA256), `EasypaisaGateway` (SHA-256), `ManualGateway`, factory function
- Added `test_connection`, `toggle_status`, `set_default` actions to `PaymentGatewayConfigViewSet`
- Created `JazzCashCallbackView`, `EasypaisaCallbackView` (public, no auth, signature-verified)
- Created `PaymentStatusView` (GET by order_id)
- Added `ParentPayFeeView` to `parents/views.py` (GET gateways, POST initiate payment)
- Added callback routes + payment status route to `finance/urls.py`
- Added pay-fee endpoint to `parents/urls.py`

**Frontend:**
- Updated `PaymentGatewayPage.jsx` — working Test Connection, toggle/set-default via POST
- Updated `ChildFees.jsx` — working Pay Now buttons, gateway selection modal, payment redirect
- Created `PaymentResultPage.jsx` — status polling, status-specific icons/colors
- Added `/parent/payment-result` route to `App.jsx`
- Added `testConnection`, `toggleGatewayStatus`, `setDefaultGateway`, `getPaymentStatus`, `getPaymentGateways`, `initiatePayment` to `api.js`

---

## Phase 7: Proper Test Suite (P1) — COMPLETED

### Framework: `pytest` + `pytest-django`

**Why pytest:**
- Simpler syntax — `assert x == y` instead of `self.assertEqual(x, y)`
- Better error output — shows exact values on failure
- Fixtures are composable and reusable
- Plugin ecosystem — `pytest-cov` for coverage, `pytest-xdist` for parallel execution
- Industry standard for Django projects
- Compatible with existing Django test `Client`

### What Exists Now

13 test files running via `python manage.py shell -c "exec(open('test_phaseN.py').read())"`:
- Load shared `seed_test_data.py` for setup
- Use Django's `Client()` for HTTP requests
- Print pass/fail with manual counters
- NOT compatible with pytest/unittest discovery

### Project Structure After Conversion

```
backend/
├── pytest.ini                         # Pytest configuration
├── conftest.py                        # Root fixtures (DB setup)
├── tests/
│   ├── __init__.py
│   ├── conftest.py                    # Shared fixtures (replaces seed_test_data.py)
│   ├── test_phase01_sessions.py       # Academic Year, Attendance wiring, Sections
│   ├── test_phase02_notifications.py  # Notification engine, Student profile, Reports
│   ├── test_phase04_academics.py      # Subjects, Timetable, ClassSubject, AI
│   ├── test_phase05_hr.py             # HR ViewSets (11 endpoints)
│   ├── test_phase06_examinations.py   # Exams, Marks, Grades, Report Cards
│   ├── test_phase09_parents.py        # Parent Portal (registration, children, leave, messages)
│   ├── test_phase10_notifications.py  # Notification CRUD + Analytics
│   ├── test_phase11_reports.py        # Report Generation (PDF/XLSX)
│   ├── test_phase12_lms.py            # LMS (Lessons, Assignments, Submissions)
│   ├── test_phase13_library.py        # Library (Books, Issues, Config)
│   ├── test_phase14_transport.py      # Transport (Routes, Vehicles, Attendance)
│   └── test_phase15_admissions.py     # Admissions CRM (Enquiries, Sessions, Pipeline)
```

### Implementation Steps

**Step 1: Install dependencies**

```bash
pip install pytest pytest-django pytest-cov
```

Add to `requirements.txt`:
```
pytest>=8.0
pytest-django>=4.8
pytest-cov>=5.0
```

**Step 2: Create `pytest.ini`** at `backend/pytest.ini`

```ini
[pytest]
DJANGO_SETTINGS_MODULE = config.settings
python_files = tests/test_*.py
python_classes = Test*
python_functions = test_*
addopts = -v --tb=short --strict-markers
markers =
    phase1: Phase 1 - Academic Sessions
    phase2: Phase 2 - Notifications & Reports
    phase4: Phase 4 - Academics
    phase5: Phase 5 - HR
    phase6: Phase 6 - Examinations
    phase9: Phase 9 - Parents
    phase10: Phase 10 - Notifications CRUD
    phase11: Phase 11 - Reports
    phase12: Phase 12 - LMS
    phase13: Phase 13 - Library
    phase14: Phase 14 - Transport
    phase15: Phase 15 - Admissions
```

**Step 3: Create `backend/conftest.py`** (root — DB configuration)

```python
import pytest

@pytest.fixture(scope='session')
def django_db_setup():
    """Use existing Supabase PostgreSQL. pytest-django auto-creates test_ prefixed DB."""
    pass  # Uses DATABASES from settings.py — pytest-django handles test DB creation
```

**Step 4: Create `backend/tests/conftest.py`** (shared fixtures)

Convert `seed_test_data.py` into composable pytest fixtures:

```python
import pytest
from django.test import Client

@pytest.fixture
def org(db):
    """Create test organization."""
    from schools.models import Organization
    return Organization.objects.create(name='Test Org', ...)

@pytest.fixture
def school(org):
    """Create test school with all modules enabled."""
    from schools.models import School
    return School.objects.create(organization=org, name='Test School', ...)

@pytest.fixture
def admin_user(school):
    """Create admin user with school membership + JWT token."""
    from users.models import User
    from schools.models import UserSchoolMembership
    user = User.objects.create_user(username='admin', password='testpass123', ...)
    UserSchoolMembership.objects.create(user=user, school=school, role='SCHOOL_ADMIN')
    return user

@pytest.fixture
def teacher_user(school):
    """Create teacher user with membership."""
    ...

@pytest.fixture
def student(school):
    """Create test student record."""
    ...

@pytest.fixture
def academic_year(school):
    """Create current academic year + term."""
    ...

@pytest.fixture
def api_client(admin_user):
    """Authenticated Django test client with JWT headers."""
    client = Client()
    response = client.post('/api/auth/login/', {
        'username': 'admin', 'password': 'testpass123'
    }, content_type='application/json')
    token = response.json()['access']
    client.defaults['HTTP_AUTHORIZATION'] = f'Bearer {token}'
    client.defaults['HTTP_X_SCHOOL_ID'] = str(admin_user.school_memberships.first().school_id)
    return client

@pytest.fixture
def parent_client(school):
    """Authenticated parent user client."""
    ...

@pytest.fixture
def student_client(school):
    """Authenticated student user client."""
    ...
```

**Step 5: Convert each test file**

Pattern conversion from old to new:

```python
# OLD (test_phase5_hr.py)
exec(open('seed_test_data.py').read())
seed = get_seed_data()
c = Client()
r = c.post('/api/auth/login/', json.dumps({...}), content_type='application/json')
token = r.json()['access']
headers = {'HTTP_AUTHORIZATION': f'Bearer {token}', 'HTTP_X_SCHOOL_ID': str(seed['school'].id)}
r = c.post('/api/hr/departments/', json.dumps({...}), content_type='application/json', **headers)
passed += 1 if r.status_code == 201 else 0

# NEW (tests/test_phase05_hr.py)
import pytest

@pytest.mark.phase5
class TestHRDepartments:
    def test_create_department(self, api_client):
        response = api_client.post('/api/hr/departments/',
            data={'name': 'Science', 'code': 'SCI'},
            content_type='application/json')
        assert response.status_code == 201
        assert response.json()['name'] == 'Science'

    def test_list_departments(self, api_client):
        response = api_client.get('/api/hr/departments/')
        assert response.status_code == 200
```

**Step 6: Database — use Supabase PostgreSQL**

pytest-django automatically creates a `test_<dbname>` database using your existing `DATABASES` config. Since you have Supabase PostgreSQL, it will create a test database there. No SQLite needed.

### Running Tests

```bash
# Run ALL tests
cd backend && pytest

# Run specific phase
pytest -m phase5

# Run specific file
pytest tests/test_phase05_hr.py

# Run specific test
pytest tests/test_phase05_hr.py::TestHRDepartments::test_create_department

# Run with coverage report
pytest --cov=. --cov-report=html

# Run with verbose output
pytest -v
```

### Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `backend/pytest.ini` | CREATE | Pytest configuration |
| `backend/conftest.py` | CREATE | Root DB configuration |
| `backend/tests/__init__.py` | CREATE | Package init |
| `backend/tests/conftest.py` | CREATE | Shared fixtures (converted from seed_test_data.py) |
| `backend/tests/test_phase01_sessions.py` | CREATE | Converted from test_phase1.py |
| `backend/tests/test_phase02_notifications.py` | CREATE | Converted from test_phase2.py |
| `backend/tests/test_phase04_academics.py` | CREATE | Converted |
| `backend/tests/test_phase05_hr.py` | CREATE | Converted |
| `backend/tests/test_phase06_examinations.py` | CREATE | Converted |
| `backend/tests/test_phase09_parents.py` | CREATE | Converted |
| `backend/tests/test_phase10_notifications.py` | CREATE | Converted |
| `backend/tests/test_phase11_reports.py` | CREATE | Converted |
| `backend/tests/test_phase12_lms.py` | CREATE | Converted |
| `backend/tests/test_phase13_library.py` | CREATE | Converted |
| `backend/tests/test_phase14_transport.py` | CREATE | Converted |
| `backend/tests/test_phase15_admissions.py` | CREATE | Converted |
| `requirements.txt` | MODIFY | Add pytest, pytest-django, pytest-cov |

### Effort: ~1-2 days

### Implementation Status: COMPLETED

**Infrastructure:**
- Created `backend/pytest.ini` with `config.settings_test` (SQLite in-memory)
- Created `backend/conftest.py` with `seed_data` fixture (org, 2 schools, 6 users, academic year, terms, classes, students, HR data, JWT tokens)
- Created `backend/config/settings_test.py` — SQLite in-memory DB, MD5 hasher, disabled throttling, eager Celery
- Created `backend/tests/__init__.py`

**Test Files (12 files, 659 tests):**
- `test_phase1_sessions.py` — Academic sessions, attendance wiring, sections
- `test_phase2_notifications.py` — Notification engine, student profiles, reports
- `test_phase4_academics.py` — Subjects, timetable, ClassSubject, AI
- `test_phase5_hr.py` — HR ViewSets (departments, staff, payroll, leave)
- `test_phase6_examinations.py` — Exams, marks, grades, report cards
- `test_phase9_parents.py` — Parent portal (registration, children, leave, messages, admin)
- `test_phase10_notifications.py` — Notification CRUD + analytics
- `test_phase11_reports.py` — Report generation (PDF/XLSX)
- `test_phase12_lms.py` — LMS (lessons, assignments, submissions)
- `test_phase13_library.py` — Library (books, issues, config)
- `test_phase14_transport.py` — Transport (routes, vehicles, attendance)
- `test_phase15_admissions.py` — Admissions CRM (enquiries, sessions, pipeline)

**Test Results: 659 passed, 0 failed, 0 errors**

**Bugs Fixed During Testing:**
1. `ClassSubject.objects.create()` → `get_or_create()` in `session_setup_service.py:243` (UNIQUE constraint)
2. Parent registration phone field overflow (UUID suffix made phone >20 chars)
3. Hardcoded parent username references in messaging tests → switched to user ID lookup

---

## Phase 8: Mobile App — React Native + Expo (P2) — COMPLETED

### Framework Decision: React Native with Expo

| Factor | React Native + Expo | Flutter | PWA |
|--------|-------------------|---------|-----|
| Code reuse with existing React frontend | **High** (same JS/TS, same API patterns) | None (Dart) | Highest |
| Push notifications | **Expo Notifications (built-in)** | Firebase + manual setup | No iOS support |
| Native feel | Full native components | Full native rendering | Web-wrapped |
| App Store deployment | Yes (EAS Build) | Yes | No |
| Learning curve | **Low** (team knows React) | High (Dart) | None |
| Camera/GPS access | Full native | Full native | Browser API |
| OTA Updates | **Expo OTA** (instant, no app store review) | Not available | Instant |

**Decision: React Native + Expo** — same React knowledge, built-in push notifications, OTA updates, works for ALL user roles.

### App Structure

```
mobile/
├── app/                              # Expo Router (file-based routing)
│   ├── _layout.tsx                   # Root layout — auth check + role routing
│   ├── (auth)/                       # Unauthenticated screens
│   │   ├── login.tsx
│   │   └── register.tsx
│   ├── (admin)/                      # Admin/Staff screens
│   │   ├── _layout.tsx               # Tab navigator
│   │   ├── dashboard.tsx
│   │   ├── attendance/
│   │   │   ├── capture.tsx           # Camera-based attendance
│   │   │   └── review.tsx
│   │   ├── students/
│   │   │   ├── index.tsx             # Student list
│   │   │   └── [id].tsx              # Student profile
│   │   ├── finance/
│   │   │   ├── dashboard.tsx
│   │   │   ├── fees.tsx
│   │   │   └── expenses.tsx
│   │   ├── hr/
│   │   │   ├── staff.tsx
│   │   │   └── attendance.tsx
│   │   ├── academics/
│   │   │   ├── timetable.tsx
│   │   │   ├── marks-entry.tsx
│   │   │   └── results.tsx
│   │   ├── transport/
│   │   │   ├── dashboard.tsx
│   │   │   └── attendance.tsx
│   │   ├── library/
│   │   │   ├── catalog.tsx
│   │   │   └── issues.tsx
│   │   ├── admissions/
│   │   │   ├── enquiries.tsx
│   │   │   └── detail.tsx
│   │   └── notifications.tsx
│   ├── (parent)/                     # Parent screens
│   │   ├── _layout.tsx               # Tab navigator
│   │   ├── dashboard.tsx
│   │   ├── children/[id]/
│   │   │   ├── overview.tsx
│   │   │   ├── attendance.tsx
│   │   │   ├── fees.tsx
│   │   │   ├── timetable.tsx
│   │   │   └── results.tsx
│   │   ├── leave.tsx
│   │   ├── messages.tsx
│   │   ├── pay-fee.tsx               # Payment flow (WebView for gateway)
│   │   └── track-child.tsx           # GPS tracking map
│   ├── (student)/                    # Student screens
│   │   ├── _layout.tsx               # Tab navigator
│   │   ├── dashboard.tsx
│   │   ├── attendance.tsx
│   │   ├── fees.tsx
│   │   ├── timetable.tsx
│   │   ├── results.tsx
│   │   ├── assignments.tsx
│   │   ├── ai-helper.tsx             # AI Study Helper chat
│   │   ├── profile.tsx
│   │   └── location-sharing.tsx      # GPS bus tracking
│   └── notifications.tsx             # Shared notification center
├── components/                       # Reusable components
│   ├── Header.tsx
│   ├── Card.tsx
│   ├── Badge.tsx
│   ├── Calendar.tsx                  # Attendance calendar
│   ├── ChatBubble.tsx                # AI helper messages
│   ├── MapView.tsx                   # GPS tracking map
│   └── PaymentWebView.tsx            # Gateway checkout
├── services/
│   ├── api.ts                        # Axios client (ported from web)
│   ├── auth.ts                       # Token storage (expo-secure-store)
│   ├── notifications.ts              # Expo push notification registration
│   └── location.ts                   # GPS location service
├── contexts/
│   ├── AuthContext.tsx                # Auth state (same pattern as web)
│   └── AcademicYearContext.tsx
├── hooks/
│   ├── useAuth.ts
│   └── useLocation.ts
├── app.json                          # Expo config
├── package.json
└── tsconfig.json
```

### User Screens Per Role

**All users:**
- Login / Register
- Push notification inbox
- Profile management
- School switching (multi-school users)

**Admin/Staff (tab navigation: Dashboard, Attendance, Finance, More):**
- Dashboard: key metrics cards, quick actions
- Attendance: camera capture + review list
- Students: list + profile view
- Finance: dashboard, fee collection, expenses
- HR: staff directory, staff attendance
- Academics: timetable view, marks entry, results
- Transport: dashboard, boarding attendance
- Library: catalog search, issue/return
- Admissions: enquiry list + detail
- Notifications: template management

**Parent (tab navigation: Home, Children, Messages, Profile):**
- Dashboard: cards per child with summary
- Child details: attendance calendar, fees, timetable, results
- Pay Now: gateway selection → WebView checkout
- Track Child: live map with child's GPS position
- Leave application
- Messages: threads with teachers
- Notifications: alerts feed

**Student (tab navigation: Home, Schedule, Assignments, AI Helper, Profile):**
- Dashboard: today's timetable, upcoming assignments, attendance rate
- Attendance history: calendar view
- Fee status: payment history
- Timetable: weekly grid
- Results: exam results by term
- Assignments: list + submit
- AI Study Helper: chat interface
- Location sharing: "Start/End Journey" for bus tracking
- Profile: personal info

### Push Notifications — Backend Integration

**New field on User model:**
```python
# users/models.py
expo_push_token = CharField(max_length=100, blank=True, default='')
```

**New notification channel:**
```python
# notifications/channels/expo.py
class ExpoChannel:
    """Send push notifications via Expo Push API."""

    def send(self, token, title, body, data=None):
        """POST to https://exp.host/--/api/v2/push/send"""
        ...
```

**Register in notification engine:**
```python
# notifications/engine.py
CHANNEL_HANDLERS = {
    'WHATSAPP': WhatsAppChannel,
    'SMS': SMSChannel,
    'EMAIL': EmailChannel,
    'IN_APP': InAppChannel,
    'PUSH': ExpoChannel,  # NEW
}
```

**Push token registration endpoint:**
```python
# users/views.py
class RegisterPushTokenView(APIView):
    """
    POST /api/auth/register-push-token/
    Body: { "expo_push_token": "ExponentPushToken[xxx]" }
    """
```

**Events that trigger push:**

| Event | Recipient | Push Content |
|-------|-----------|-------------|
| ABSENCE | Parent | "{child_name} was marked absent today" |
| FEE_DUE | Parent | "Fee reminder: PKR {amount} due for {month}" |
| FEE_OVERDUE | Parent | "Overdue: PKR {amount} for {child_name}" |
| EXAM_RESULT | Parent + Student | "Results published for {exam_name}" |
| ASSIGNMENT_DUE | Student | "Assignment due: {title} by {due_date}" |
| TRANSPORT_UPDATE | Parent | "Transport update: {route_name}" |
| JOURNEY_STARTED | Parent | "{child_name} started journey to school" |
| JOURNEY_COMPLETED | Parent | "{child_name} has arrived" |
| GATE_PASS_APPROVED | Parent + Student | "Gate pass approved for {date}" |
| GENERAL | All | Admin announcement text |

### Implementation Phases (Within Phase 8)

```
Week 1: Project setup + Auth + Parent screens (highest value)
Week 2: Student screens + AI helper chat + push notifications
Week 3: Admin/Staff screens (core subset) + GPS location
Week 4: Payment WebView + polish + testing + EAS Build config
```

### Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `mobile/` | CREATE | Entire Expo React Native project |
| `backend/users/models.py` | MODIFY | Add `expo_push_token` field |
| `backend/users/views.py` | MODIFY | Add `RegisterPushTokenView` |
| `backend/notifications/channels/expo.py` | CREATE | Expo push channel |
| `backend/notifications/engine.py` | MODIFY | Register PUSH channel |
| `requirements.txt` | MODIFY | Add `exponent-server-sdk` |
| New migration | CREATE | User expo_push_token field |

### Effort: ~3-4 weeks (MVP)

### Implementation Status: COMPLETED

**Project Setup & Infrastructure (67 files):**
- Created Expo SDK 54 project with TypeScript, Expo Router (file-based routing)
- `mobile/services/api.ts` — Full Axios client with Bearer token + X-School-ID interceptors, 401 auto-refresh with request queue, 15+ API namespaces (authApi, studentsApi, parentsApi, financeApi, attendanceApi, academicsApi, examinationsApi, notificationsApi, hrApi, libraryApi, transportApi, admissionsApi, hostelApi, studentPortalApi, paymentApi)
- `mobile/services/auth.ts` — expo-secure-store token CRUD (getToken, setTokens, clearTokens, getSchoolId, setSchoolId)
- `mobile/contexts/AuthContext.tsx` — Full port from web: user state, activeSchool, loading, login/logout/switchSchool/refreshUser, role computed (isParent, isStudent, isSchoolAdmin, isStaffLevel, isModuleEnabled)
- `mobile/contexts/NotificationContext.tsx` — Push notification state, auto-register on login, unread badge count
- `mobile/app/_layout.tsx` — Root layout with auth guard + role-based routing (parent → parent tabs, student → student tabs, admin → admin tabs)

**UI Component Library (12 components):**
- `Button.tsx`, `Card.tsx`, `Badge.tsx`, `Input.tsx`, `Select.tsx`, `Modal.tsx`, `Toast.tsx`, `Spinner.tsx`, `EmptyState.tsx`, `Avatar.tsx`, `TabBar.tsx`, `StatCard.tsx`

**Auth Screens (2 screens):**
- `mobile/app/(auth)/login.tsx` — Login with JWT + secure token storage
- `mobile/app/(auth)/register.tsx` — Parent/Student registration

**Parent Portal (10 screens):**
- Dashboard, Child Overview, Child Attendance (calendar heatmap), Child Fees (Pay Now), Child Timetable (weekly grid), Child Results (by term), Leave Application, Messages (threads), Payment WebView, GPS Track Child (Phase 9)
- Shared components: `AttendanceCalendar.tsx`, `FeeCard.tsx`, `TimetableGrid.tsx`, `PaymentWebView.tsx`

**Student Portal (10 screens):**
- Dashboard, Attendance Calendar, Fee Status, Timetable, Exam Results, Assignments (submit), AI Study Helper (chat), Profile, Location Sharing (GPS), Notification Inbox
- Shared components: `ChatInterface.tsx`, `NotificationItem.tsx`

**Admin/Staff Portal (23 screens):**
- Dashboard, Attendance Capture (camera), Attendance Review, Student Directory (card grid), Student Profile (tabs), Edit Student, Finance Dashboard, Fee Collection, Expense Entry, Income Entry, Transaction History, Quick Send Notification, Template Send, Notification History, HR Staff Directory, Leave Approvals, Gate Pass Approvals, Transport Dashboard, Timetable View, Exam Results, Library Quick Issue, Notification Inbox, AI Assistant (3 tabs: Finance AI, Academics AI, Communication AI)
- Shared components: `StudentCard.tsx`, `StaffCard.tsx`

**Push Notifications (Backend + Mobile):**
- `backend/users/models.py` — Added `DevicePushToken` model (user FK, token, device_type, is_active)
- `backend/users/views.py` — `RegisterPushTokenView` (POST, upsert) + `UnregisterPushTokenView` (DELETE)
- `backend/users/urls.py` — `/api/auth/register-push-token/`, `/api/auth/unregister-push-token/`
- `backend/notifications/channels/expo.py` — NEW `ExpoChannel` extending BaseChannel, sends via Expo Push API, handles DeviceNotRegistered token cleanup
- `backend/notifications/engine.py` — Registered PUSH channel in handlers + config check
- `backend/notifications/models.py` — Added `('PUSH', 'Push Notification')` to CHANNEL_CHOICES + `push_enabled` to SchoolNotificationConfig
- `mobile/services/notifications.ts` — Push token registration, Android notification channel, foreground/tap handlers
- Migrations: `users/0005_devicepushtoken.py`, `notifications/0003_add_push_channel.py`

**Total: 52 screens (2 auth + 10 parent + 10 student + 23 admin + 7 shared), 67 mobile files, 0 TypeScript errors**

---

## Phase 9: Student GPS Location Sharing (P2) — COMPLETED

### Concept

Instead of GPS hardware on buses, **students share their location** via the mobile app. Student taps "Start Journey" → phone sends GPS coordinates every 30 seconds → parents see live map.

### Privacy & Safety Design

| Concern | Solution |
|---------|----------|
| Battery drain | Updates every 30s only during active journey; low-power background mode |
| Privacy | Location shared ONLY during active journey; parents see ONLY their own children |
| Accuracy | GPS + cell tower triangulation via phone |
| Auto-stop | Journey auto-ends after 2 hours OR when within 200m of school (geofence) |
| Consent | Student must manually tap "Start Journey" each trip |
| Data retention | Location data deleted after 7 days automatically |
| Abuse prevention | Only students with TransportAssignment can start journeys |

### Backend Models

**New models in `transport/models.py`:**

```python
class StudentJourney(models.Model):
    """A single trip from home→school or school→home."""
    JOURNEY_TYPES = [('TO_SCHOOL', 'To School'), ('FROM_SCHOOL', 'From School')]
    STATUS_CHOICES = [('ACTIVE', 'Active'), ('COMPLETED', 'Completed'), ('CANCELLED', 'Cancelled')]

    school = ForeignKey(School, CASCADE)
    student = ForeignKey(Student, CASCADE, related_name='journeys')
    transport_assignment = ForeignKey(TransportAssignment, null=True, SET_NULL)
    journey_type = CharField(max_length=20, choices=JOURNEY_TYPES)
    status = CharField(max_length=20, choices=STATUS_CHOICES, default='ACTIVE')
    started_at = DateTimeField(auto_now_add=True)
    ended_at = DateTimeField(null=True, blank=True)
    start_latitude = DecimalField(max_digits=9, decimal_places=6)
    start_longitude = DecimalField(max_digits=9, decimal_places=6)
    end_latitude = DecimalField(max_digits=9, decimal_places=6, null=True)
    end_longitude = DecimalField(max_digits=9, decimal_places=6, null=True)

class LocationUpdate(models.Model):
    """GPS ping from student's phone during active journey."""
    journey = ForeignKey(StudentJourney, CASCADE, related_name='locations')
    latitude = DecimalField(max_digits=9, decimal_places=6)
    longitude = DecimalField(max_digits=9, decimal_places=6)
    accuracy = FloatField(help_text='GPS accuracy in meters')
    speed = FloatField(null=True, help_text='Speed in km/h')
    timestamp = DateTimeField(auto_now_add=True)
    battery_level = IntegerField(null=True, help_text='Phone battery percentage')

    class Meta:
        indexes = [
            models.Index(fields=['journey', '-timestamp']),
        ]
```

### Backend Endpoints

```python
# Student endpoints (IsStudent permission)
POST /api/transport/journey/start/
    Body: { journey_type: "TO_SCHOOL"|"FROM_SCHOOL", latitude, longitude }
    Returns: { journey_id, status: "ACTIVE" }

POST /api/transport/journey/end/
    Body: { journey_id, latitude, longitude }
    Returns: { journey_id, status: "COMPLETED", duration_minutes }

POST /api/transport/journey/update/
    Body: { journey_id, latitude, longitude, accuracy, speed, battery_level }
    Returns: { received: true }
    (Called every 30 seconds by mobile app)

# Parent endpoints (IsParent permission)
GET /api/transport/journey/track/<student_id>/
    Returns: { active_journey: { id, type, started_at, latest_location: {lat, lng, speed, updated_at} } | null }

GET /api/transport/journey/history/<student_id>/?days=7
    Returns: [ { id, type, started_at, ended_at, duration_minutes } ]

# Admin endpoints (IsSchoolAdmin permission)
GET /api/transport/journey/active/
    Returns: [ { student_name, journey_type, latest_location, route_name, started_at } ]
```

### Frontend — Mobile App Screens

**Student: `location-sharing.tsx`**
- Large "Start Journey" button (green, centered) with direction selector (To School / From School)
- Active journey view: elapsed time, map showing path traveled, "End Journey" button (red)
- Auto-detects transport assignment (shows route name, assigned stop)
- Battery indicator warning when below 20%
- Background location tracking (keeps running when app minimized)

**Parent: `track-child.tsx`**
- Map (`react-native-maps`) showing child's latest position as avatar marker
- Polyline of journey path (all LocationUpdate points)
- ETA estimate: based on speed + distance to next stop/school
- "Last updated: 30s ago" text
- "No active journey" state when child isn't traveling
- Push notification when journey starts/ends

**Admin: Transport Dashboard addition**
- Mini-map widget showing all active student journeys
- Student count currently in transit per route
- Table of active journeys with latest location + status

### Notification Triggers

| Event | When | Recipient | Message |
|-------|------|-----------|---------|
| JOURNEY_STARTED | Student taps Start | Parent (push) | "{child_name} started journey to school" |
| JOURNEY_COMPLETED | Student taps End or geofence | Parent (push) | "{child_name} has arrived at school" |
| JOURNEY_DELAYED | Duration exceeds 2x expected | Parent (push) | "{child_name}'s journey is taking longer than usual" |
| LOW_BATTERY | Battery < 15% during journey | Parent (push) | "{child_name}'s phone battery is low (12%)" |

### Cleanup Celery Task

```python
# transport/tasks.py
@shared_task
def cleanup_old_location_data(days=7):
    """Delete location data older than N days. Journey records kept."""
    LocationUpdate.objects.filter(timestamp__lt=now() - timedelta(days=days)).delete()

@shared_task
def auto_end_stale_journeys(hours=2):
    """Auto-end journeys that have been active for too long."""
    stale = StudentJourney.objects.filter(status='ACTIVE', started_at__lt=now() - timedelta(hours=hours))
    stale.update(status='COMPLETED', ended_at=now())
```

### Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `transport/models.py` | MODIFY | Add StudentJourney + LocationUpdate models |
| `transport/views.py` | MODIFY | Add journey start/end/update/track endpoints |
| `transport/serializers.py` | MODIFY | Add journey + location serializers |
| `transport/urls.py` | MODIFY | Add journey routes |
| `transport/tasks.py` | CREATE | Cleanup + auto-end tasks |
| `notifications/triggers.py` | MODIFY | Add journey event triggers |
| `config/settings.py` | MODIFY | Add journey cleanup to CELERY_BEAT_SCHEDULE |
| `mobile/app/(student)/location-sharing.tsx` | CREATE | Student GPS sharing screen |
| `mobile/app/(parent)/track-child.tsx` | CREATE | Parent tracking map |
| New migration | CREATE | StudentJourney + LocationUpdate tables |

### Effort: ~1 week

### Implementation Status: COMPLETED

**Backend:**
- `backend/transport/models.py` — Added `StudentJourney` model (school, student, transport_assignment, journey_type TO_SCHOOL/FROM_SCHOOL, status ACTIVE/COMPLETED/CANCELLED, start/end lat/lng, timestamps) + `LocationUpdate` model (journey FK, lat, lng, accuracy, speed, battery_level, timestamp with composite index)
- `backend/transport/serializers.py` — `LocationUpdateSerializer`, `StudentJourneyReadSerializer` (with `latest_location` SerializerMethodField), `JourneyStartSerializer`, `JourneyUpdateSerializer`
- `backend/transport/views.py` — 6 new APIViews:
  - `JourneyStartView` (POST) — Student starts journey, checks no active journey exists
  - `JourneyEndView` (POST) — Student ends journey, records end location
  - `JourneyUpdateView` (POST) — GPS ping every 30s, creates LocationUpdate
  - `JourneyTrackView` (GET) — Parent tracks child, returns active journey + last 50 locations
  - `JourneyHistoryView` (GET) — Parent views last 20 journeys
  - `ActiveJourneysView` (GET) — Admin views all active journeys for school
- `backend/transport/urls.py` — 6 journey routes under `/api/transport/journey/`
- `backend/transport/tasks.py` — NEW: `cleanup_old_location_data(days=7)` + `auto_end_stale_journeys(hours=2)` Celery tasks
- `backend/config/settings.py` — Added `cleanup-location-data` (weekly Sunday 3 AM) + `auto-end-stale-journeys` (every hour) to CELERY_BEAT_SCHEDULE
- Migration: `transport/0002_add_gps_journey_models.py`

**Mobile:**
- `mobile/services/location.ts` — Background GPS tracking using `expo-task-manager` + `expo-location`. Posts GPS updates to `transportApi.updateJourney` every 30s or 50m. Android foreground service notification.
- `mobile/services/api.ts` — Added 6 GPS endpoints to `transportApi`: `startJourney`, `endJourney`, `updateJourney`, `trackStudent`, `getJourneyHistory`, `getActiveJourneys`
- `mobile/app/(student)/location-sharing.tsx` — Start/End journey UI, direction selector (TO_SCHOOL/FROM_SCHOOL), elapsed time timer, background GPS activation, permission handling
- `mobile/app/(parent)/track-child.tsx` — Child selector chips, polls every 10s, latest position display (coordinates, speed, battery), location history list, "No Active Journey" empty state

**Verification: 0 TypeScript errors, Django system check 0 issues, all migrations applied**

---

## Phase 10: AI Study Helper (P3) — COMPLETED

### What We're Building

A conversational AI chatbot in the Student Portal where students ask academic questions and get AI-generated answers, with context from their class's lesson plans and assignments.

### Architecture

Reuses the proven AI chat pattern from Finance AI Chat and Academics AI Chat:

```
Student types question
  → Backend receives question + student context (class, subjects, lesson plans)
  → Groq LLM (llama-3.3-70b-versatile) generates response
  → Content safety filter checks response
  → Response returned to student
```

### Backend: New Model

```python
# students/models.py
class StudyHelperMessage(models.Model):
    """Chat history for AI Study Helper per student."""
    ROLE_CHOICES = [('user', 'User'), ('assistant', 'Assistant')]

    school = ForeignKey(School, CASCADE)
    student = ForeignKey(Student, CASCADE, related_name='study_messages')
    role = CharField(max_length=10, choices=ROLE_CHOICES)
    content = TextField()
    created_at = DateTimeField(auto_now_add=True)
    flagged = BooleanField(default=False)  # Content safety flag
```

### Backend: AI Service

**New file: `students/study_helper_service.py`**

```python
class StudyHelperService:
    """AI-powered study assistant for students."""

    def __init__(self, student, school):
        self.student = student
        self.school = school
        self.client = Groq(api_key=settings.GROQ_API_KEY)

    def get_student_context(self):
        """
        Gather context for the LLM:
        1. Student's class and enrolled subjects
        2. Recent lesson plans for their class (last 2 weeks)
        3. Active/upcoming assignments
        4. Current academic year and term
        """
        ...
        return context_string

    def check_content_safety(self, message):
        """
        Filter inappropriate content for minors.
        Block: violence, adult content, personal info requests, self-harm, illegal activities
        Allow: all academic topics, general knowledge, study tips
        Returns: (is_safe: bool, reason: str)
        """
        BLOCKED_PATTERNS = [
            r'(phone|address|email|password|credit.card)',  # Personal info
            r'(kill|suicide|self.harm|hurt)',                 # Self-harm
            r'(bomb|weapon|gun|drug)',                        # Violence/illegal
            r'(nude|sex|porn)',                                # Adult content
        ]
        ...

    def check_rate_limit(self):
        """Max 30 messages per student per day."""
        today_count = StudyHelperMessage.objects.filter(
            student=self.student, role='user',
            created_at__date=timezone.now().date()
        ).count()
        return today_count < 30

    def chat(self, user_message):
        """
        Process student question and return AI response.
        1. Check rate limit (30/day)
        2. Check content safety on input
        3. Build system prompt with student context
        4. Include last 10 messages for conversation continuity
        5. Call Groq LLM
        6. Check content safety on output
        7. Save messages to database
        8. Return response
        """
        ...
```

### System Prompt

```
You are a friendly, helpful study assistant for a school student.

STUDENT CONTEXT:
- Name: {student_name}
- Class: {class_name} (Grade {grade_level})
- Subjects: {subject_list}
- Current lesson topics: {recent_lesson_summaries}
- Active assignments: {assignment_list}

RULES:
1. Answer academic questions clearly and at the student's grade level
2. When relevant, reference their current lesson plans and assignments
3. Provide step-by-step explanations for math/science problems
4. Encourage learning — don't just give answers, explain the WHY
5. If a question is not academic, politely redirect to studies
6. Never share personal opinions on politics, religion, or controversial topics
7. Never generate harmful, violent, or inappropriate content
8. If you don't know something, say so honestly
9. Keep responses concise — 2-3 paragraphs max
10. Use simple language appropriate for the student's grade level
```

### Backend: API Endpoint

```python
# students/views.py
class StudyHelperView(APIView):
    """AI Study Helper chat for students."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        """Get chat history (last 50 messages)."""
        messages = StudyHelperMessage.objects.filter(
            student=student).order_by('-created_at')[:50]
        return Response(StudyHelperMessageSerializer(messages, many=True).data)

    def post(self, request):
        """Send a message and get AI response."""
        message = request.data.get('message', '').strip()
        service = StudyHelperService(student, school)

        if not service.check_rate_limit():
            return Response({'error': 'Daily limit reached (30 messages/day)'}, status=429)

        is_safe, reason = service.check_content_safety(message)
        if not is_safe:
            return Response({'error': reason}, status=400)

        response = service.chat(message)
        return Response({'response': response})

    def delete(self, request):
        """Clear chat history for student."""
        StudyHelperMessage.objects.filter(student=student).delete()
        return Response(status=204)
```

### Frontend: Web

**New page: `StudentStudyHelper.jsx`**
- Route: `/student/study-helper`
- Chat interface matching existing AI chat pattern (FinanceChatWidget style)
- Message bubbles: user (right, blue) / AI (left, gray)
- Input field with send button + character limit
- "Powered by AI — answers may not always be accurate" disclaimer
- Rate limit indicator: "15/30 questions used today"
- "Clear History" button
- Loading skeleton while AI responds
- Welcome message: "Hi {name}! I'm your study helper. Ask me anything about your subjects!"

**Sidebar addition in Layout.jsx:**
```
Student Navigation:
├── Dashboard
├── Attendance
├── Fees
├── Timetable
├── Results
├── Assignments
├── AI Study Helper    ← NEW (sparkle icon)
└── My Profile
```

### Frontend: Mobile

**Screen: `(student)/ai-helper.tsx`**
- Same chat UI adapted for mobile
- `KeyboardAvoidingView` for input handling
- `FlatList` for message history (inverted)
- Optional: voice input via `expo-speech` (speech-to-text)

### Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `students/models.py` | MODIFY | Add StudyHelperMessage model |
| `students/study_helper_service.py` | CREATE | AI service with Groq + safety filters |
| `students/views.py` | MODIFY | Add StudyHelperView |
| `students/urls.py` | MODIFY | Add study-helper routes |
| `students/serializers.py` | MODIFY | Add StudyHelperMessageSerializer |
| `StudentStudyHelper.jsx` | CREATE | Web chat page |
| `App.jsx` | MODIFY | Add `/student/study-helper` route |
| `Layout.jsx` | MODIFY | Add "AI Study Helper" to student sidebar |
| `api.js` | MODIFY | Add studyHelper API methods to studentPortalApi |
| `mobile/app/(student)/ai-helper.tsx` | CREATE | Mobile chat screen |
| New migration | CREATE | StudyHelperMessage table |

### Implementation Status: COMPLETED

**Implementation Notes:**
- `StudyHelperMessage` model added to `students/models.py` with school, student, role, content, flagged fields
- `students/study_helper_service.py` created with Groq LLM integration, 5 unsafe input patterns + 2 output patterns, 30 msg/day rolling rate limit, student context builder (class, subjects, recent lessons, active assignments)
- `StudyHelperView` added to `students/views.py` — GET (history), POST (chat), DELETE (clear)
- Route: `students/portal/study-helper/` added to `students/urls.py`
- Frontend: `StudentStudyHelper.jsx` chat page with auto-scroll, typing indicator, suggestion chips, character counter, error handling
- Sidebar: "AI Study Helper" added to student navigation in `Layout.jsx`
- Route: `/student/study-helper` added to `App.jsx`
- API: `getStudyHelperHistory`, `sendStudyHelperMessage`, `clearStudyHelperHistory` added to `studentPortalApi` in `api.js`
- Migration: `students/migrations/0003_studyhelpermessage.py`

### Effort: ~2-3 days

---

## Phase 11: Hostel Management (P3) — COMPLETED

### Scope

| Feature | Included |
|---------|----------|
| Hostel → Room hierarchy | Yes |
| Student room allocation | Yes |
| Meal management | No (out of scope) |
| Gate passes with approval | Yes |
| Fee integration | Yes (hostel fee type in FeeStructure) |

### New Django App: `hostel/`

### Backend Models

```python
# hostel/models.py

class Hostel(models.Model):
    """A hostel/dormitory building."""
    HOSTEL_TYPES = [('BOYS', 'Boys'), ('GIRLS', 'Girls'), ('MIXED', 'Mixed')]

    school = ForeignKey(School, CASCADE, related_name='hostels')
    name = CharField(max_length=100)              # e.g., "Boys Hostel Block A"
    hostel_type = CharField(max_length=10, choices=HOSTEL_TYPES)
    warden = ForeignKey('hr.StaffMember', null=True, blank=True, SET_NULL)
    capacity = PositiveIntegerField()
    address = TextField(blank=True)
    contact_number = CharField(max_length=20, blank=True)
    is_active = BooleanField(default=True)
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'name')


class Room(models.Model):
    """A room within a hostel."""
    ROOM_TYPES = [('SINGLE', 'Single'), ('DOUBLE', 'Double'), ('DORMITORY', 'Dormitory')]

    hostel = ForeignKey(Hostel, CASCADE, related_name='rooms')
    room_number = CharField(max_length=20)         # e.g., "A-101"
    floor = PositiveIntegerField(default=0)
    room_type = CharField(max_length=20, choices=ROOM_TYPES)
    capacity = PositiveIntegerField()              # Max occupants
    is_available = BooleanField(default=True)
    created_at = DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('hostel', 'room_number')

    @property
    def current_occupancy(self):
        return self.allocations.filter(is_active=True).count()

    @property
    def is_full(self):
        return self.current_occupancy >= self.capacity


class HostelAllocation(models.Model):
    """Student assigned to a room for an academic year."""
    school = ForeignKey(School, CASCADE)
    student = ForeignKey('students.Student', CASCADE, related_name='hostel_allocations')
    room = ForeignKey(Room, CASCADE, related_name='allocations')
    academic_year = ForeignKey('academic_sessions.AcademicYear', CASCADE)
    allocated_date = DateField(auto_now_add=True)
    vacated_date = DateField(null=True, blank=True)
    is_active = BooleanField(default=True)

    class Meta:
        unique_together = ('student', 'academic_year')
        # One room per student per academic year


class GatePass(models.Model):
    """Gate pass for student leaving hostel premises."""
    STATUS_CHOICES = [
        ('PENDING', 'Pending Approval'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
        ('USED', 'Checked Out'),
        ('RETURNED', 'Returned'),
        ('EXPIRED', 'Expired'),
    ]
    PASS_TYPES = [
        ('DAY', 'Day Pass'),
        ('OVERNIGHT', 'Overnight'),
        ('WEEKEND', 'Weekend'),
        ('VACATION', 'Vacation Leave'),
    ]

    school = ForeignKey(School, CASCADE, related_name='gate_passes')
    student = ForeignKey('students.Student', CASCADE, related_name='gate_passes')
    allocation = ForeignKey(HostelAllocation, CASCADE, related_name='gate_passes')
    pass_type = CharField(max_length=20, choices=PASS_TYPES)
    reason = TextField()
    going_to = CharField(max_length=200)           # Destination
    contact_at_destination = CharField(max_length=20)
    departure_date = DateTimeField()
    expected_return = DateTimeField()
    actual_return = DateTimeField(null=True, blank=True)
    status = CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    approved_by = ForeignKey('users.User', null=True, blank=True, SET_NULL)
    approved_at = DateTimeField(null=True, blank=True)
    remarks = TextField(blank=True)
    parent_notified = BooleanField(default=False)
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
```

### Fee Integration

Add `fee_type` to existing `FeeStructure` model:

```python
# finance/models.py — modify FeeStructure
FEE_TYPE_CHOICES = [
    ('TUITION', 'Tuition Fee'),
    ('HOSTEL', 'Hostel Fee'),
    ('TRANSPORT', 'Transport Fee'),
    ('OTHER', 'Other Fee'),
]
fee_type = CharField(max_length=20, choices=FEE_TYPE_CHOICES, default='TUITION')
```

School admins create separate fee structures for hostel students:
- Tuition: PKR 5,000/month for Class 5
- Hostel: PKR 3,000/month for Class 5 (only for allocated students)

The existing `FeeBreakdownView` sums all applicable fee structures per student.

### API Endpoints

```python
# hostel/urls.py

# Hostel & Room management (admin)
GET/POST    /api/hostel/hostels/                       # List/create hostels
GET/PATCH   /api/hostel/hostels/{id}/                  # Detail/update/delete
GET/POST    /api/hostel/rooms/                         # List/create rooms
GET/PATCH   /api/hostel/rooms/{id}/                    # Detail/update/delete
GET         /api/hostel/rooms/?hostel_id=X             # Filter by hostel

# Allocations (admin)
GET/POST    /api/hostel/allocations/                   # List/create allocations
POST        /api/hostel/allocations/bulk/              # Bulk allocate students
PATCH       /api/hostel/allocations/{id}/vacate/       # Vacate room

# Gate passes (admin + parent can request, warden/admin approves)
GET/POST    /api/hostel/gate-passes/                   # List/create
PATCH       /api/hostel/gate-passes/{id}/approve/      # Approve (warden/admin)
PATCH       /api/hostel/gate-passes/{id}/reject/       # Reject (warden/admin)
PATCH       /api/hostel/gate-passes/{id}/checkout/     # Mark departure (warden)
PATCH       /api/hostel/gate-passes/{id}/return/       # Mark return (warden)

# Dashboard (admin)
GET         /api/hostel/dashboard/                     # Occupancy stats, pending passes
```

### Frontend Pages (4 pages)

| Page | Route | Description |
|------|-------|-------------|
| `HostelDashboard.jsx` | `/hostel` | Total capacity, current occupancy, occupancy % chart, pending gate passes count, recent activity |
| `HostelRoomsPage.jsx` | `/hostel/rooms` | Room grid grouped by hostel, occupancy indicators (green/yellow/red), click room to see occupants, add/edit room modal |
| `HostelAllocationsPage.jsx` | `/hostel/allocations` | Student-room assignment table, search student, select room, bulk allocate modal, vacate button |
| `GatePassesPage.jsx` | `/hostel/gate-passes` | Gate pass list with status tabs (Pending/Approved/Active/Returned), approve/reject actions, checkout/return marking, filter by hostel/date |

### Sidebar Navigation

```
Hostel (module-gated)
├── Dashboard       → /hostel
├── Rooms           → /hostel/rooms
├── Allocations     → /hostel/allocations
└── Gate Passes     → /hostel/gate-passes
```

### Notification Integration

| Event | Trigger | Recipient | Channel |
|-------|---------|-----------|---------|
| `GATE_PASS_REQUESTED` | Student/parent creates pass | Warden + Admin | Push + In-App |
| `GATE_PASS_APPROVED` | Warden approves | Parent + Student | Push + WhatsApp |
| `GATE_PASS_REJECTED` | Warden rejects | Parent + Student | Push + WhatsApp |
| `STUDENT_CHECKOUT` | Warden marks departure | Parent | Push + WhatsApp |
| `STUDENT_RETURN` | Warden marks return | Parent | Push |
| `LATE_RETURN` | Expected return exceeded by 1 hour | Warden + Parent | Push + WhatsApp |
| `HOSTEL_FEE_DUE` | Monthly hostel fee reminder | Parent | Push + WhatsApp |

### Module Registration

```python
# core/module_registry.py
'hostel': {
    'name': 'Hostel Management',
    'description': 'Hostel rooms, student allocations, and gate passes',
    'dependencies': ['students'],
}
```

### Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `backend/hostel/__init__.py` | CREATE | App init |
| `backend/hostel/apps.py` | CREATE | App config |
| `backend/hostel/models.py` | CREATE | Hostel, Room, HostelAllocation, GatePass |
| `backend/hostel/views.py` | CREATE | 4 ViewSets + dashboard + gate pass actions |
| `backend/hostel/serializers.py` | CREATE | CRUD + allocation + gate pass serializers |
| `backend/hostel/urls.py` | CREATE | URL patterns |
| `backend/hostel/admin.py` | CREATE | Django admin registration |
| `backend/finance/models.py` | MODIFY | Add fee_type to FeeStructure |
| `backend/config/settings.py` | MODIFY | Add 'hostel' to INSTALLED_APPS |
| `backend/config/urls.py` | MODIFY | Add hostel URL include |
| `backend/core/module_registry.py` | MODIFY | Register hostel module |
| `backend/notifications/triggers.py` | MODIFY | Add gate pass event triggers |
| `frontend/src/pages/hostel/HostelDashboard.jsx` | CREATE | Dashboard page |
| `frontend/src/pages/hostel/HostelRoomsPage.jsx` | CREATE | Rooms management |
| `frontend/src/pages/hostel/HostelAllocationsPage.jsx` | CREATE | Student allocations |
| `frontend/src/pages/hostel/GatePassesPage.jsx` | CREATE | Gate pass management |
| `frontend/src/App.jsx` | MODIFY | Add 4 hostel routes |
| `frontend/src/components/Layout.jsx` | MODIFY | Add hostel nav group |
| `frontend/src/services/api.js` | MODIFY | Add hostelApi service |
| New migration(s) | CREATE | Hostel tables + FeeStructure fee_type |

### Implementation Status: COMPLETED

**Implementation Notes:**
- New Django app `hostel/` created with `__init__.py`, `apps.py`, `models.py`, `serializers.py`, `views.py`, `urls.py`, `admin.py`
- 4 models: `Hostel`, `Room`, `HostelAllocation`, `GatePass` — all with school-based multi-tenancy
- Read/Write serializer pairs for all 4 models with validation (room capacity, duplicate allocation, gate pass ownership)
- 4 ViewSets with `ModuleAccessMixin` + `TenantQuerySetMixin`: `HostelViewSet`, `RoomViewSet`, `HostelAllocationViewSet`, `GatePassViewSet`
- Custom actions: `vacate` (allocation), `approve`, `reject`, `checkout`, `return_pass` (gate pass)
- `HostelDashboardView` with aggregate stats (occupancy, capacity, pending passes, students on leave)
- Registered in `INSTALLED_APPS`, `config/urls.py` at `/api/hostel/`, and `module_registry.py` as 'hostel'
- Frontend: 4 pages — `HostelDashboard.jsx`, `HostelRoomsPage.jsx`, `HostelAllocationsPage.jsx`, `GatePassesPage.jsx`
- Sidebar: Hostel group with Dashboard, Rooms, Allocations, Gate Passes in `Layout.jsx`
- Routes: `/hostel`, `/hostel/rooms`, `/hostel/allocations`, `/hostel/gate-passes` in `App.jsx`
- API: Full `hostelApi` service added to `api.js` with all CRUD + action endpoints
- Migration: `hostel/migrations/0001_initial.py`

### Effort: ~3-5 days

---

## Phase 12: Inventory & Store Management (P3)

### What We're Building

A complete school inventory system for tracking supplies, equipment, and consumables. Schools buy stationery, lab equipment, sports goods, cleaning supplies, uniforms — all currently tracked only as a single "SUPPLIES" expense line. This module adds proper item-level tracking: what's in stock, what needs reordering, who requested it, and where the money went.

### What Exists Already

| Component | Status | Location |
|-----------|--------|----------|
| `Expense` model with `SUPPLIES` category | Exists | `finance/models.py:436-527` |
| `OtherIncome` with `SALE` category (Books/Copies/Uniform) | Exists | `finance/models.py:569-658` |
| `Account` model (payment sources) | Exists | `finance/models.py:6-76` |
| Module registry + `ModuleAccessMixin` | Ready | `core/module_registry.py` |
| Multi-tenancy middleware + `TenantQuerySetMixin` | Ready | Used by all apps |

### New Django App: `inventory/`

### Backend Models

```python
# inventory/models.py

class InventoryCategory(models.Model):
    """Categories for inventory items (e.g., Stationery, Lab Equipment, Sports)."""
    school = ForeignKey(School, CASCADE, related_name='inventory_categories')
    name = CharField(max_length=100)          # e.g., "Stationery", "Lab Equipment"
    description = TextField(blank=True)
    is_active = BooleanField(default=True)
    created_at = DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('school', 'name')
        ordering = ['name']


class Vendor(models.Model):
    """Supplier/vendor for inventory purchases."""
    school = ForeignKey(School, CASCADE, related_name='vendors')
    name = CharField(max_length=200)
    contact_person = CharField(max_length=100, blank=True)
    phone = CharField(max_length=20, blank=True)
    email = EmailField(blank=True)
    address = TextField(blank=True)
    is_active = BooleanField(default=True)
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'name')
        ordering = ['name']


class InventoryItem(models.Model):
    """An item tracked in inventory (e.g., Whiteboard Marker, Microscope)."""
    UNIT_CHOICES = [
        ('PCS', 'Pieces'), ('PKT', 'Packets'), ('BOX', 'Boxes'),
        ('KG', 'Kilograms'), ('LTR', 'Litres'), ('SET', 'Sets'),
        ('REAM', 'Reams'), ('DZN', 'Dozens'), ('MTR', 'Meters'),
    ]

    school = ForeignKey(School, CASCADE, related_name='inventory_items')
    category = ForeignKey(InventoryCategory, CASCADE, related_name='items')
    name = CharField(max_length=200)
    sku = CharField(max_length=50, blank=True)      # Optional stock code
    unit = CharField(max_length=10, choices=UNIT_CHOICES, default='PCS')
    current_stock = PositiveIntegerField(default=0)
    minimum_stock = PositiveIntegerField(default=5,
        help_text='Alert when stock falls below this level')
    unit_price = DecimalField(max_digits=10, decimal_places=2, default=0,
        help_text='Last known unit price')
    location = CharField(max_length=100, blank=True,
        help_text='Storage location e.g. "Store Room A", "Lab Cabinet 3"')
    is_active = BooleanField(default=True)
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'name', 'category')
        ordering = ['name']
        indexes = [
            models.Index(fields=['school', 'category']),
        ]

    @property
    def is_low_stock(self):
        return self.current_stock <= self.minimum_stock

    @property
    def stock_value(self):
        return self.current_stock * self.unit_price


class StockTransaction(models.Model):
    """Every stock movement: purchase, issue, return, adjustment, disposal."""
    TRANSACTION_TYPES = [
        ('PURCHASE', 'Purchase'),        # Stock In — bought from vendor
        ('ISSUE', 'Issue'),              # Stock Out — given to department/staff
        ('RETURN', 'Return'),            # Stock In — returned by department
        ('ADJUSTMENT', 'Adjustment'),    # Correction (+ or -)
        ('DISPOSAL', 'Disposal'),        # Written off (damaged/expired)
    ]

    school = ForeignKey(School, CASCADE, related_name='stock_transactions')
    item = ForeignKey(InventoryItem, CASCADE, related_name='transactions')
    transaction_type = CharField(max_length=20, choices=TRANSACTION_TYPES)
    quantity = IntegerField(help_text='Positive for in, negative for out')
    unit_price = DecimalField(max_digits=10, decimal_places=2, default=0)
    total_amount = DecimalField(max_digits=12, decimal_places=2, default=0)
    vendor = ForeignKey(Vendor, SET_NULL, null=True, blank=True,
        help_text='Only for PURCHASE transactions')
    issued_to = CharField(max_length=200, blank=True,
        help_text='Department or person name for ISSUE/RETURN')
    reference_number = CharField(max_length=100, blank=True,
        help_text='Invoice/PO/receipt number')
    remarks = TextField(blank=True)
    date = DateField()
    recorded_by = ForeignKey(User, SET_NULL, null=True)
    expense = ForeignKey('finance.Expense', SET_NULL, null=True, blank=True,
        help_text='Link to finance expense record')
    created_at = DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date', '-created_at']
        indexes = [
            models.Index(fields=['school', 'item', '-date']),
            models.Index(fields=['school', 'transaction_type']),
        ]


class PurchaseRequest(models.Model):
    """Staff requests to purchase items. Requires admin approval."""
    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
        ('ORDERED', 'Ordered'),
        ('RECEIVED', 'Received'),
    ]

    school = ForeignKey(School, CASCADE, related_name='purchase_requests')
    requested_by = ForeignKey(User, CASCADE, related_name='purchase_requests')
    item = ForeignKey(InventoryItem, CASCADE, related_name='purchase_requests')
    quantity = PositiveIntegerField()
    estimated_cost = DecimalField(max_digits=10, decimal_places=2, default=0)
    reason = TextField()
    status = CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    approved_by = ForeignKey(User, SET_NULL, null=True, blank=True,
        related_name='approved_purchase_requests')
    approved_at = DateTimeField(null=True, blank=True)
    remarks = TextField(blank=True)
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
```

### API Endpoints

```python
# inventory/urls.py

# Categories
GET/POST    /api/inventory/categories/                    # List/create
GET/PATCH   /api/inventory/categories/{id}/               # Detail/update

# Vendors
GET/POST    /api/inventory/vendors/                       # List/create
GET/PATCH   /api/inventory/vendors/{id}/                  # Detail/update

# Items
GET/POST    /api/inventory/items/                         # List/create (filterable by category)
GET/PATCH   /api/inventory/items/{id}/                    # Detail/update
GET         /api/inventory/items/low-stock/               # Items below minimum_stock

# Transactions
GET/POST    /api/inventory/transactions/                  # List/create
GET         /api/inventory/transactions/{id}/             # Detail (read-only once created)

# Purchase Requests
GET/POST    /api/inventory/purchase-requests/             # List/create
PATCH       /api/inventory/purchase-requests/{id}/approve/
PATCH       /api/inventory/purchase-requests/{id}/reject/
PATCH       /api/inventory/purchase-requests/{id}/mark-received/

# Dashboard
GET         /api/inventory/dashboard/                     # Summary stats
```

### Transaction Logic

```
PURCHASE:  quantity is POSITIVE  → current_stock += quantity
                                 → auto-create Expense with SUPPLIES category (optional)
ISSUE:     quantity is NEGATIVE  → current_stock -= abs(quantity)
RETURN:    quantity is POSITIVE  → current_stock += quantity
ADJUSTMENT: quantity is +/-     → current_stock += quantity (can be negative)
DISPOSAL:  quantity is NEGATIVE  → current_stock -= abs(quantity)
```

Each `StockTransaction.save()` updates `InventoryItem.current_stock` atomically using `F()` expressions.

### Finance Integration

- **Purchase → Expense**: When recording a PURCHASE transaction, optionally auto-create a linked `Expense` record with `category=SUPPLIES` and the same amount.
- **Sale → Income**: If the school sells items (Books/Copies/Uniform), create an ISSUE transaction + linked `OtherIncome` with `category=SALE`.
- **Dashboard**: Show total inventory value (sum of `current_stock * unit_price` across all items).

### Frontend Pages (4 pages)

| Page | Route | Description |
|------|-------|-------------|
| `InventoryDashboard.jsx` | `/inventory` | Total items, total value, low stock alerts, recent transactions chart |
| `InventoryItemsPage.jsx` | `/inventory/items` | Item grid with category filter, search, stock levels (green/yellow/red), add/edit modal |
| `StockTransactionsPage.jsx` | `/inventory/transactions` | Transaction log with type filters + date range, "Record Transaction" form modal (type, item, qty, vendor, reference) |
| `PurchaseRequestsPage.jsx` | `/inventory/requests` | Request list with status tabs (Pending/Approved/Ordered/Received), approve/reject actions, "New Request" form |

Additional modals/sections:
- Vendor management (modal in transactions page or settings)
- Category management (modal in items page)
- Low stock alert banner on dashboard

### Sidebar Navigation

```
Inventory (module-gated)
├── Dashboard       → /inventory
├── Items           → /inventory/items
├── Transactions    → /inventory/transactions
└── Purchase Requests → /inventory/requests
```

### Module Registration

```python
# core/module_registry.py
'inventory': {
    'name': 'Inventory & Store',
    'description': 'Track school supplies, equipment, and purchase requests',
    'dependencies': ['finance'],
}
```

### Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `backend/inventory/__init__.py` | CREATE | App init |
| `backend/inventory/apps.py` | CREATE | App config |
| `backend/inventory/models.py` | CREATE | 5 models: InventoryCategory, Vendor, InventoryItem, StockTransaction, PurchaseRequest |
| `backend/inventory/serializers.py` | CREATE | Read/Write serializer pairs for all models |
| `backend/inventory/views.py` | CREATE | 5 ViewSets + dashboard + purchase request actions |
| `backend/inventory/urls.py` | CREATE | URL patterns |
| `backend/inventory/admin.py` | CREATE | Django admin registration |
| `backend/config/settings.py` | MODIFY | Add 'inventory' to INSTALLED_APPS |
| `backend/config/urls.py` | MODIFY | Add inventory URL include |
| `backend/core/module_registry.py` | MODIFY | Register inventory module |
| `frontend/src/pages/inventory/InventoryDashboard.jsx` | CREATE | Dashboard page |
| `frontend/src/pages/inventory/InventoryItemsPage.jsx` | CREATE | Items management |
| `frontend/src/pages/inventory/StockTransactionsPage.jsx` | CREATE | Transaction log + entry |
| `frontend/src/pages/inventory/PurchaseRequestsPage.jsx` | CREATE | Purchase request workflow |
| `frontend/src/App.jsx` | MODIFY | Add 4 inventory routes |
| `frontend/src/components/Layout.jsx` | MODIFY | Add inventory nav group |
| `frontend/src/services/api.js` | MODIFY | Add inventoryApi service |
| New migration(s) | CREATE | Inventory tables |

### Effort: ~3-5 days

---

## Phase 13: Drag-and-Drop Timetable (P3)

### What We're Building

Replace the current cell-by-cell modal editing of the timetable grid with **drag-and-drop** interaction. Teachers drag subject blocks onto time slots, swap entries by dragging between cells, and get instant visual conflict feedback.

### What Exists Already

| Component | Status | Location |
|-----------|--------|----------|
| `TimetableSlot` model (periods/breaks) | Complete | `academics/models.py` |
| `TimetableEntry` model (class+day+slot→subject+teacher) | Complete | `academics/models.py` |
| `TimetableEntryViewSet` with `bulk_save`, `auto_generate`, `teacher_conflicts`, `quality_score` | Complete | `academics/views.py` |
| `TimetablePage.jsx` — grid table + cell edit modal | Complete | `frontend/src/pages/academics/TimetablePage.jsx` |
| AI-powered auto-generation with CSP algorithm | Complete | `academics/views.py` |
| Conflict detection + quality scoring | Complete | `academics/views.py` |

**Current UX flow:**
1. Admin selects a class
2. Grid shows days (columns) × time slots (rows)
3. Click a cell → modal opens → select subject + teacher → save
4. One cell at a time, modal-heavy

**Target UX flow:**
1. Admin selects a class
2. Grid shows days × time slots (same layout)
3. Sidebar shows available subject blocks (from `ClassSubject` assignments)
4. Drag subject block from sidebar → drop onto empty cell
5. Drag existing cell → drop onto another cell to swap
6. Real-time conflict highlighting (red border if teacher already booked)
7. Auto-save on drop (calls `bulk_save`)
8. Click cell to edit details (teacher override, room) via popover (not full modal)

### Frontend Library

**`@dnd-kit/core`** — lightweight, accessible drag-and-drop for React. Already dominant in the React ecosystem, works with tables/grids, supports: sortable, droppable, draggable, collision detection, keyboard accessible.

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

### Implementation Changes

#### Frontend: `TimetablePage.jsx` → Enhanced with DnD

**New/Modified Components:**

| Component | Description |
|-----------|-------------|
| `SubjectPalette.jsx` | Sidebar showing draggable subject blocks (from ClassSubject). Each block shows subject name + teacher + periods remaining/total |
| `TimetableGrid.jsx` | Enhanced grid — each cell is a `Droppable` zone. Existing entries are `Draggable`. Empty cells accept drops |
| `TimetableCell.jsx` | Individual cell — shows subject + teacher. Draggable handle. Click opens inline editor popover (not modal) |
| `ConflictOverlay.jsx` | Red border/shake on cells where teacher has a conflict. Real-time check via `teacher_conflicts` endpoint on drag hover |

**DnD Flow:**

```
1. DragStart: Pick up SubjectBlock from palette OR existing TimetableCell
2. DragOver:  Highlight valid drop targets (empty cells or swap targets)
              Call teacher_conflicts API → show red overlay on conflicting cells
3. DragEnd:
   a. Palette → Empty cell: Create new TimetableEntry
   b. Cell → Cell: Swap two entries
   c. Cell → Palette: Remove entry (unassign)
4. After drop: Call bulk_save for the affected day(s)
5. UI updates optimistically (revert on error)
```

**Period Counter in Palette:**

```
Math (Mr. Khan)  ████░░  4/6 periods assigned
English (Ms. Ali) ██████  6/6 periods assigned ← dimmed, can't add more
Science (Dr. Raza) ██░░░░ 2/6 periods assigned
```

Each subject block shows `assigned / periods_per_week` from `ClassSubject`.

#### Backend: No Model Changes

The backend already supports everything needed:
- `bulk_save` action handles batch creates/updates/deletes
- `teacher_conflicts` action checks for teacher double-booking
- `quality_score` gives real-time quality feedback
- `auto_generate` fills the entire grid

**One small addition to `TimetableEntryViewSet`:**

```python
@action(detail=False, methods=['post'])
def swap(self, request):
    """
    Swap two timetable entries atomically.
    Body: { entry_a_id: int, entry_b_id: int }
    Swaps subject+teacher between the two entries.
    """
```

This avoids the client needing to delete + recreate during swaps.

### Mobile App Impact

The mobile timetable is view-only (students and parents see their schedule). No drag-and-drop needed on mobile. No mobile changes required.

### Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/pages/academics/TimetablePage.jsx` | MODIFY | Add DnD context, palette sidebar, swap logic |
| `frontend/src/components/timetable/SubjectPalette.jsx` | CREATE | Draggable subject blocks with period counters |
| `frontend/src/components/timetable/TimetableCell.jsx` | CREATE | Draggable + droppable cell with conflict overlay |
| `frontend/src/components/timetable/ConflictOverlay.jsx` | CREATE | Visual conflict indicator |
| `frontend/src/services/api.js` | MODIFY | Add `swapEntries` method to academicsApi |
| `backend/academics/views.py` | MODIFY | Add `swap` action to TimetableEntryViewSet |
| `package.json` | MODIFY | Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` |

### Effort: ~2-3 days

---

## Master Timeline & Dependencies

### Execution Order

```
WEEK 1: ✅ COMPLETED
├── Phase 5: Celery Beat Config ────────────── ✅ DONE
├── Phase 6: Payment Gateway Full Flow ──────── ✅ DONE
└── Phase 7: Pytest Test Suite ──────────────── ✅ DONE (659 tests passing)

WEEK 2: ✅ COMPLETED
├── Phase 10: AI Study Helper ───────────────── ✅ DONE
└── Phase 11: Hostel Management ─────────────── ✅ DONE (659 tests still passing)

WEEKS 3-4: ✅ COMPLETED
├── Phase 8: React Native Mobile App ─────────── ✅ DONE (52 screens, 67 files, 0 TS errors)
└── Phase 9: GPS Location Sharing ────────────── ✅ DONE (backend + mobile, integrated into Phase 8)

WEEK 5: PLANNED
├── Phase 12: Inventory & Store Management ────── ⬜ ~3-5 days
└── Phase 13: Drag-and-Drop Timetable ─────────── ⬜ ~2-3 days
```

### Dependency Graph

```
Phase 5 (Celery) ──────────────────────────────── No dependencies ✅ DONE
Phase 6 (Payment) ─────────────────────────────── No dependencies ✅ DONE
Phase 7 (Tests) ───────────────────────────────── No dependencies ✅ DONE

Phase 10 (AI Helper) ──────────────────────────── No dependencies ✅ DONE
Phase 11 (Hostel) ──────────────────────────────── No dependencies ✅ DONE

Phase 8 (Mobile App) ──┬── Depends on Phase 6 ✅ DONE
                       ├── Depends on Phase 10 ✅ DONE
                       └── Depends on Phase 5  ✅ DONE

Phase 9 (GPS) ─────────── Depends on Phase 8   ✅ DONE

Phase 12 (Inventory) ─────────────────────────── Depends on Finance (Phase 6) ✅ ready
Phase 13 (DnD Timetable) ─────────────────────── No dependencies (enhances existing)
```

### What Can Run in Parallel

```
Parallel Group 1: Phase 5 + Phase 6 + Phase 7     ✅ ALL DONE
Parallel Group 2: Phase 10 + Phase 11              ✅ ALL DONE
Sequential:       Phase 8 (after Group 1+2)        ✅ DONE
Sequential:       Phase 9 (after Phase 8)          ✅ DONE

Parallel Group 3: Phase 12 + Phase 13             ⬜ CAN RUN IN PARALLEL
```

---

## Post-Implementation Coverage

### Mind Map Coverage — All Phases Complete

| Pillar | Before P5-P11 | After All Phases | Change |
|--------|---------------|-----------------|--------|
| Core Administration | 68% | **80%** | +12% (hostel) |
| Communication Hub | 60% | **75%** | +15% (push notifications, journey alerts) |
| Parent Interface | 78% | **90%** | +12% (mobile app, live tracking, payments) |
| Mobile Super App | 36% | **80%** | +44% (native app, GPS, AI helper) |
| Academics & Learning | 78% | **85%** | +7% (AI study helper) |
| Finance & Operations | 90% | **95%** | +5% (payment gateway flow, hostel fees) |
| AI Autonomous Layer | 58% | **70%** | +12% (study helper bot) |
| Growth & Marketing | 60% | **60%** | +0% (no changes this round) |
| Student Interface | 50% | **80%** | +30% (AI helper, GPS, mobile app) |
| **OVERALL** | **~68%** | **~80%** | **+12%** |

### Remaining Gaps (After All Planned Phases)

| Gap | Pillar | Priority |
|-----|--------|----------|
| ~~Inventory & Store management~~ | ~~Core Admin~~ | **Phase 12 — PLANNED** |
| ~~Drag-and-drop timetable~~ | ~~Core Admin~~ | **Phase 13 — PLANNED** |
| Digital Marketing Hub (social media posting) | Growth & Marketing | Low |
| Content Marketing Bot (AI social content) | AI Layer | Low |
| Admission Chatbot (24/7 WhatsApp lead bot) | AI Layer | Medium |
| Online Classes (Zoom/Teams/Meet integration) | Academics | Medium |
| Biometric hardware integration (staff) | Core Admin | Low |
| Security notifications system | Communication | Low |
| Self-healing timetable bot (auto-substitute) | AI Layer | Low |
| Social sharing / WhatsApp stories | Parent Interface | Low |

---

## Total New Files Summary

| Phase | New Files | Modified Files | New Models | Status |
|-------|-----------|----------------|------------|--------|
| Phase 5 (Celery) | 0 | 2 | 0 | ✅ DONE |
| Phase 6 (Payment) | 2 | 8 | 0 | ✅ DONE |
| Phase 7 (Tests) | 16 | 1 | 0 | ✅ DONE |
| Phase 8 (Mobile) | 67 | 6 | 1 (DevicePushToken) | ✅ DONE |
| Phase 9 (GPS) | 2 | 6 | 2 (StudentJourney, LocationUpdate) | ✅ DONE |
| Phase 10 (AI Helper) | 2 | 6 | 1 | ✅ DONE |
| Phase 11 (Hostel) | 8 | 7 | 4 | ✅ DONE |
| Phase 12 (Inventory) | 11 | 4 | 5 (Category, Vendor, Item, Transaction, Request) | ⬜ PLANNED |
| Phase 13 (DnD Timetable) | 3 | 4 | 0 | ⬜ PLANNED |
| **TOTAL** | **~111** | **~44** | **13 new models** | **7 DONE / 2 PLANNED** |
