# KoderEduAI.pk - AI-Powered Education Platform

## Project Overview

A **multi-tenant SaaS platform** (KoderEduAI.pk) for AI-powered school management. Current modules include attendance management from manual register images — schools upload photos of handwritten attendance registers, the system extracts absent students using OCR + LLM, and sends WhatsApp notifications to parents. Upcoming modules: fee management with online payments (JazzCash, Easypaisa).

**Project Location:** `D:\Personal\smart-attendance`

---

## Business Goals

- One hosted platform serving multiple schools (tenants)
- Each school gets its own "AI Attendance Agent"
- No separate hosting or DNS per school - single codebase
- Platform owner acts as **Super Admin**
- Strict data isolation via `school_id` filtering

---

## Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Backend Framework | Django | 6.0.1 |
| API | Django REST Framework | 3.16.1 |
| Authentication | JWT (SimpleJWT) | 5.5.1 |
| Database | SQLite (dev) / PostgreSQL (prod) | - |
| Task Queue | Celery | 5.6.2 |
| Message Broker | Redis | - |
| LLM | Groq API | 1.0.0 |
| OCR | Tesseract (pytesseract) | - |
| Fuzzy Matching | FuzzyWuzzy | 0.18.0 |
| Frontend Framework | React | 18.3.1 |
| Build Tool | Vite | 6.0.0 |
| Styling | Tailwind CSS | 3.4.17 |
| State Management | React Query | 5.60.0 |
| Routing | React Router | 7.1.0 |

---

## Project Structure

```
D:\Personal\smart-attendance\
├── backend/
│   ├── config/                  # Django project settings
│   │   ├── settings.py          # Main settings with JWT, Celery, CORS config
│   │   ├── urls.py              # URL routing
│   │   ├── celery.py            # Celery configuration
│   │   └── wsgi.py
│   ├── core/                    # Multi-tenancy core
│   │   ├── middleware.py        # TenantMiddleware - injects school_id
│   │   ├── mixins.py            # TenantQuerySetMixin for auto-filtering
│   │   └── permissions.py       # IsSuperAdmin, IsSchoolAdmin, HasSchoolAccess
│   ├── schools/                 # Tenant management
│   │   ├── models.py            # School model
│   │   ├── views.py             # SuperAdminSchoolViewSet, SchoolViewSet
│   │   ├── serializers.py
│   │   └── urls.py
│   ├── users/                   # User & authentication
│   │   ├── models.py            # Custom User with roles
│   │   ├── views.py             # JWT login, user management
│   │   ├── serializers.py       # Token serializers
│   │   └── urls.py
│   ├── students/                # Student & class management
│   │   ├── models.py            # Class, Student models
│   │   ├── views.py             # CRUD ViewSets
│   │   ├── serializers.py
│   │   └── urls.py
│   ├── attendance/              # AI attendance processing
│   │   ├── models.py            # AttendanceUpload, AttendanceRecord
│   │   ├── views.py             # Upload, Review, Confirm workflow
│   │   ├── serializers.py
│   │   ├── services.py          # AttendanceAIService, WhatsAppService
│   │   ├── tasks.py             # Celery tasks
│   │   └── urls.py
│   ├── notifications/           # WhatsApp (placeholder)
│   ├── venv/                    # Python virtual environment
│   ├── db.sqlite3               # SQLite database
│   ├── manage.py
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Layout.jsx       # Main layout with sidebar
│   │   │   └── LoadingSpinner.jsx
│   │   ├── contexts/
│   │   │   └── AuthContext.jsx  # Auth state management
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx
│   │   │   ├── DashboardPage.jsx
│   │   │   ├── AttendanceUploadPage.jsx
│   │   │   ├── AttendanceReviewPage.jsx
│   │   │   ├── StudentsPage.jsx
│   │   │   ├── ClassesPage.jsx
│   │   │   └── SuperAdminDashboard.jsx
│   │   ├── services/
│   │   │   └── api.js           # Axios instance + API functions
│   │   ├── hooks/
│   │   ├── App.jsx              # Routes configuration
│   │   ├── main.jsx             # Entry point
│   │   └── index.css            # Tailwind imports
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── postcss.config.js
│
└── PROJECT_SUMMARY.md           # This file
```

---

## Database Models

### School (Tenant)
```python
class School(models.Model):
    name = models.CharField(max_length=200)
    subdomain = models.CharField(max_length=50, unique=True)  # e.g., "focus"
    logo = models.URLField(blank=True)
    address = models.TextField(blank=True)
    contact_email = models.EmailField(blank=True)
    contact_phone = models.CharField(max_length=20, blank=True)
    whatsapp_sender_id = models.CharField(max_length=100, blank=True)
    enabled_modules = models.JSONField(default=dict)  # {"attendance_ai": true, "whatsapp": false}
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
```

### User
```python
class User(AbstractUser):
    class Role(models.TextChoices):
        SUPER_ADMIN = 'SUPER_ADMIN', 'Super Admin'
        SCHOOL_ADMIN = 'SCHOOL_ADMIN', 'School Admin'
        STAFF = 'STAFF', 'Staff'

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.STAFF)
    school = models.ForeignKey('schools.School', null=True, on_delete=models.CASCADE)
    phone = models.CharField(max_length=20, blank=True)
    profile_photo_url = models.URLField(blank=True)
```

### Class
```python
class Class(models.Model):
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE)
    name = models.CharField(max_length=50)  # "5-A"
    grade_level = models.IntegerField(null=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = ('school', 'name')
```

### Student
```python
class Student(models.Model):
    school = models.ForeignKey('schools.School', on_delete=models.CASCADE)
    class_obj = models.ForeignKey('Class', on_delete=models.CASCADE)
    roll_number = models.CharField(max_length=20)
    name = models.CharField(max_length=200)
    parent_phone = models.CharField(max_length=20)
    parent_name = models.CharField(max_length=200, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = ('school', 'class_obj', 'roll_number')
```

### AttendanceUpload
```python
class AttendanceUpload(models.Model):
    class Status(models.TextChoices):
        PROCESSING = 'PROCESSING', 'Processing'
        REVIEW_REQUIRED = 'REVIEW_REQUIRED', 'Review Required'
        CONFIRMED = 'CONFIRMED', 'Confirmed'
        FAILED = 'FAILED', 'Failed'

    school = models.ForeignKey('schools.School', on_delete=models.CASCADE)
    class_obj = models.ForeignKey('students.Class', on_delete=models.CASCADE)
    date = models.DateField()
    image_url = models.URLField(max_length=500)
    ai_output_json = models.JSONField(null=True)  # {matched: [], unmatched: [], confidence: 0.92}
    ocr_raw_text = models.TextField(blank=True)
    confidence_score = models.DecimalField(max_digits=4, decimal_places=2, null=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PROCESSING)
    error_message = models.TextField(blank=True)
    created_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True)
    confirmed_by = models.ForeignKey('users.User', null=True, related_name='uploads_confirmed')
    confirmed_at = models.DateTimeField(null=True)

    class Meta:
        unique_together = ('school', 'class_obj', 'date')
```

### AttendanceRecord
```python
class AttendanceRecord(models.Model):
    class AttendanceStatus(models.TextChoices):
        PRESENT = 'PRESENT', 'Present'
        ABSENT = 'ABSENT', 'Absent'

    class Source(models.TextChoices):
        IMAGE_AI = 'IMAGE_AI', 'Image AI'
        MANUAL = 'MANUAL', 'Manual'

    school = models.ForeignKey('schools.School', on_delete=models.CASCADE)
    student = models.ForeignKey('students.Student', on_delete=models.CASCADE)
    date = models.DateField()
    status = models.CharField(max_length=10, choices=AttendanceStatus.choices)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.IMAGE_AI)
    upload = models.ForeignKey('AttendanceUpload', null=True, on_delete=models.SET_NULL)
    notification_sent = models.BooleanField(default=False)
    notification_sent_at = models.DateTimeField(null=True)

    class Meta:
        unique_together = ('student', 'date')
```

---

## API Endpoints

### Authentication
```
POST /api/auth/login/              - JWT login (returns access, refresh, user info)
POST /api/auth/refresh/            - Refresh access token
GET  /api/auth/me/                 - Get current user
POST /api/auth/change-password/    - Change password
```

### Super Admin (requires SUPER_ADMIN role)
```
GET    /api/admin/schools/         - List all schools
POST   /api/admin/schools/         - Create school
PATCH  /api/admin/schools/{id}/    - Update school
GET    /api/admin/schools/{id}/stats/  - Get school statistics
POST   /api/admin/schools/{id}/activate/    - Activate school
POST   /api/admin/schools/{id}/deactivate/  - Deactivate school
```

### Schools
```
GET  /api/schools/                 - List accessible schools
GET  /api/schools/current/         - Get current user's school
```

### Classes
```
GET    /api/classes/               - List classes (filtered by school)
POST   /api/classes/               - Create class
GET    /api/classes/{id}/          - Get class details
PATCH  /api/classes/{id}/          - Update class
DELETE /api/classes/{id}/          - Delete class
```

### Students
```
GET    /api/students/              - List students (filtered by school/class)
POST   /api/students/              - Create student
GET    /api/students/{id}/         - Get student details
PATCH  /api/students/{id}/         - Update student
DELETE /api/students/{id}/         - Delete student
POST   /api/students/bulk_create/  - Bulk create students
GET    /api/students/by_class/     - Get students grouped by class
```

### Attendance
```
GET    /api/attendance/uploads/              - List uploads
POST   /api/attendance/uploads/              - Create upload (triggers AI processing)
GET    /api/attendance/uploads/{id}/         - Get upload details with AI results
POST   /api/attendance/uploads/{id}/confirm/ - Confirm attendance
GET    /api/attendance/uploads/pending_review/  - Get pending reviews

GET    /api/attendance/records/              - List attendance records
GET    /api/attendance/records/daily_report/ - Get daily absent report
GET    /api/attendance/records/chronic_absentees/  - Get chronic absentees
```

---

## AI Attendance Workflow

### Step 1: Image Upload
- School Admin uploads register image
- `AttendanceUpload` created with status = `PROCESSING`
- Celery task `process_attendance_upload` triggered

### Step 2: OCR Extraction
- Tesseract extracts text from image
- Text stored in `ocr_raw_text`

### Step 3: LLM Interpretation
- Groq API with this prompt:
```
You are analyzing a handwritten attendance register.
Extract ONLY ABSENT students. Output JSON:
{
  "class": "5-A",
  "date": "YYYY-MM-DD",
  "absent_students": [{"roll": 3, "name": "Ali Hassan"}],
  "confidence": 0.92,
  "notes": "any unclear entries"
}
```

### Step 4: Student Matching
1. Try exact roll number match (school + class + roll)
2. Fallback: fuzzy name match (threshold: 70%)
3. Unmatched entries flagged for review

### Step 5: Human Review (MANDATORY)
- Status = `REVIEW_REQUIRED`
- Admin sees:
  - Original image (zoomable)
  - AI-detected absent students
  - Match status (matched/unmatched)
- Admin can:
  - Toggle students absent/present
  - Remove incorrect entries
  - Confirm final list

### Step 6: Confirmation
- Creates `AttendanceRecord` for all students
- Status = `CONFIRMED`
- Triggers WhatsApp notifications (if enabled)

### Step 7: WhatsApp Notification
- Only sent AFTER confirmation
- Template: "Dear Parent, your child {name} (Class {class}) was absent on {date}..."

---

## Multi-Tenancy Implementation

### Middleware (`core/middleware.py`)
```python
class TenantMiddleware:
    def __call__(self, request):
        # 1. Extract subdomain from host
        # 2. Look up school by subdomain
        # 3. Set request.tenant_school_id
        # 4. For authenticated users, set request.tenant_schools list
```

### QuerySet Mixin (`core/mixins.py`)
```python
class TenantQuerySetMixin:
    tenant_field = 'school_id'

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.is_super_admin:
            return queryset
        return queryset.filter(school_id__in=self.request.tenant_schools)
```

### Permission Classes (`core/permissions.py`)
- `IsSuperAdmin` - Only Super Admins
- `IsSchoolAdmin` - School Admins + Super Admins
- `HasSchoolAccess` - Check user can access specific school
- `CanConfirmAttendance` - Only School Admins can confirm

---

## How to Run

### Prerequisites
1. Python 3.10+
2. Node.js 18+
3. Redis (for Celery)
4. Tesseract OCR installed

### Backend
```bash
cd D:\Personal\smart-attendance\backend

# Activate virtual environment
venv\Scripts\activate

# Run migrations (already done)
python manage.py migrate

# Create superuser (already created: admin/admin123)
python manage.py createsuperuser

# Run development server
python manage.py runserver
```

### Frontend
```bash
cd D:\Personal\smart-attendance\frontend

# Install dependencies (already done)
npm install

# Run development server
npm run dev
```

### Celery (for AI processing)
```bash
cd D:\Personal\smart-attendance\backend
venv\Scripts\activate

# Start Celery worker
celery -A config worker --loglevel=info
```

### Access
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000/api/
- Admin: http://localhost:8000/admin/
- Login: `admin` / `admin123`

---

## Environment Variables

Create `.env` in `backend/`:
```env
# Django
DJANGO_SECRET_KEY=your-secret-key
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1

# Database (leave empty for SQLite)
DATABASE_URL=

# CORS
CORS_ALLOWED_ORIGINS=http://localhost:3000

# Celery
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0

# Groq LLM
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=llama-3.3-70b-versatile

# Tesseract
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe

# Supabase (for file storage)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
SUPABASE_BUCKET=attendance-uploads

# WhatsApp
WHATSAPP_API_URL=
WHATSAPP_API_KEY=
```

---

## What's Implemented ✅

- [x] Django project with 6 apps
- [x] Custom User model with roles (SUPER_ADMIN, SCHOOL_ADMIN, STAFF)
- [x] School (tenant) model
- [x] Class and Student models
- [x] AttendanceUpload and AttendanceRecord models
- [x] JWT authentication
- [x] Multi-tenancy middleware and permissions
- [x] All REST API endpoints
- [x] Celery configuration
- [x] AI service (OCR + LLM + matching)
- [x] WhatsApp service (placeholder)
- [x] React frontend with Vite + Tailwind
- [x] Login page
- [x] Dashboard
- [x] Attendance upload page with dropzone
- [x] Attendance review page with zoom viewer
- [x] Students management page
- [x] Classes management page
- [x] Super Admin dashboard
- [x] Database migrations applied
- [x] Superuser created (admin/admin123)

---

## What's Pending ⏳

1. **Redis Setup** - Install Redis for Celery to work
2. **Tesseract Installation** - Install Tesseract OCR on Windows
3. **Supabase Configuration** - Set up bucket for image uploads
4. **Groq API Key** - Get API key from console.groq.com
5. **WhatsApp Integration** - Configure actual WhatsApp Business API
6. **File Upload to Supabase** - Frontend currently uses local preview URL
7. **Production Deployment** - Gunicorn, PostgreSQL, etc.
8. **Error Handling UI** - Better error messages in frontend
9. **Reports** - More detailed attendance reports
10. **Email Notifications** - Alternative to WhatsApp

---

## Key Files to Know

| File | Purpose |
|------|---------|
| `backend/config/settings.py` | All Django settings |
| `backend/users/models.py` | Custom User with roles |
| `backend/core/middleware.py` | Multi-tenancy middleware |
| `backend/core/permissions.py` | Permission classes |
| `backend/attendance/services.py` | AI + WhatsApp services |
| `backend/attendance/tasks.py` | Celery tasks |
| `frontend/src/services/api.js` | All API calls |
| `frontend/src/contexts/AuthContext.jsx` | Auth state |
| `frontend/src/pages/AttendanceReviewPage.jsx` | Main review UI |

---

## Testing Credentials

| Role | Username | Password |
|------|----------|----------|
| Super Admin | admin | admin123 |

---

## Original Requirements Reference

This project was built based on the multi-tenant SaaS platform specification:
- Single codebase, single database with `school_id` filtering
- Roles: SUPER_ADMIN, SCHOOL_ADMIN, STAFF
- Smart hybrid model: AI + human confirmation (MANDATORY)
- WhatsApp notifications only AFTER confirmation
- Strict error handling (blur detection, duplicate prevention, etc.)

---

## Contact / Continue From Here

To continue development:
1. Open this folder in your IDE: `D:\Personal\smart-attendance`
2. Reference this document for architecture decisions
3. Check the plan file: `C:\Users\hp\.claude\plans\partitioned-zooming-wombat.md`

Key commands:
```bash
# Backend
cd D:\Personal\smart-attendance\backend
venv\Scripts\activate
python manage.py runserver

# Frontend
cd D:\Personal\smart-attendance\frontend
npm run dev
```
