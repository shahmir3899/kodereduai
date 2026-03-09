# Backend Django Apps Reference

## 19 Apps Overview

| App | Purpose | Key Models |
|-----|---------|------------|
| core | Multi-tenancy infrastructure | Middleware, Permissions, Storage |
| users | Auth & user management | User, DevicePushToken |
| schools | Tenant management | Organization, School, UserSchoolMembership |
| students | Student management | Class, Student, StudyHelperMessage |
| attendance | AI-powered attendance | AttendanceUpload, AttendanceRecord, AttendanceFeedback |
| academic_sessions | Academic periods | AcademicYear, Term, StudentEnrollment |
| academics | Subjects & timetable | Subject, ClassSubject, TimetableSlot, TimetableEntry |
| examinations | Exams & marks | ExamType, Exam, ExamSubject, StudentMark, GradeScale |
| finance | Fee management | Account, FeeStructure, FeePayment, Expense, Discount |
| hr | Staff management | StaffMember, SalaryStructure, Payslip, LeaveApplication |
| admissions | CRM workflow | AdmissionEnquiry, AdmissionNote |
| notifications | Communication | NotificationTemplate, NotificationLog, SchoolNotificationConfig |
| parents | Parent portal | ParentProfile, ParentChild, ParentLeaveRequest, ParentMessage |
| lms | Learning management | LessonPlan, Assignment, AssignmentSubmission |
| transport | Transport & GPS | TransportRoute, TransportVehicle, TransportAttendance |
| library | Library management | BookCategory, Book, BookIssue |
| hostel | Hostel management | Hostel, Room, HostelAllocation, GatePass |
| inventory | Inventory tracking | InventoryItem, Vendor, StockTransaction |
| face_attendance | Camera-based face attendance | FaceAttendanceSession, StudentFaceEmbedding, FaceDetectionResult |

---

## core — Multi-tenancy Infrastructure

**No models.** Provides cross-cutting concerns.

### TenantMiddleware (core/middleware.py)
Resolves school context for every request:
1. `X-School-ID` header (primary)
2. Subdomain detection
3. User's default school membership

Populates: `request.tenant_school`, `request.tenant_school_id`, `request.tenant_schools`

### Permissions (core/permissions.py)
- **IsSuperAdmin** — SUPER_ADMIN role only
- **IsSchoolAdmin** — SCHOOL_ADMIN, PRINCIPAL, or SUPER_ADMIN
- **HasSchoolAccess** — User has membership in the school
- **CanConfirmAttendance** — Admin only (confirms AI-processed attendance)
- **IsParent / IsStudent** — Role via UserSchoolMembership
- **ModuleAccessMixin** — Checks school's `enabled_modules`

### Role Hierarchy
```
SUPER_ADMIN → can create: SCHOOL_ADMIN, PRINCIPAL, HR_MANAGER, ACCOUNTANT, TEACHER, STAFF
SCHOOL_ADMIN → can create: PRINCIPAL, HR_MANAGER, ACCOUNTANT, TEACHER, STAFF
PRINCIPAL → can create: HR_MANAGER, ACCOUNTANT, TEACHER, STAFF
```

### Storage (core/storage.py)
**SupabaseStorageService** — Lazy-initialized Supabase client with 120s httpx timeout.
Path format: `attendance/{school_id}/{class_id}/{timestamp}_{uuid}.ext`

### Pagination: FlexiblePageNumberPagination — Default page_size=20, max=100
### Mixins: SchoolScopedMixin — Auto-filters querysets by school

---

## users — Auth & User Management

### User (extends AbstractUser)
| Field | Type | Notes |
|-------|------|-------|
| id | AutoField | PK |
| username | CharField | Unique |
| email | EmailField | |
| first_name, last_name | CharField | |
| role | CharField | SUPER_ADMIN, SCHOOL_ADMIN, PRINCIPAL, HR_MANAGER, ACCOUNTANT, TEACHER, STAFF |
| phone | CharField | Optional |
| profile_photo_url | URLField | Optional |
| school | FK → School | Legacy link (nullable) |
| organization | FK → Organization | Nullable |
| is_active | BooleanField | |
| created_at, updated_at | DateTimeField | Auto |

### DevicePushToken
| Field | Type | Notes |
|-------|------|-------|
| user | FK → User | |
| token | CharField | Expo push token |
| platform | CharField | ios, android, web |
| is_active | BooleanField | |

---

## schools — Multi-tenancy

### Organization
id, name, created_at

### School
| Field | Type | Notes |
|-------|------|-------|
| id | AutoField | |
| name | CharField | |
| subdomain | SlugField | Unique |
| logo | URLField | Nullable — uploaded via `/api/schools/upload_asset/` |
| letterhead_url | URLField | Nullable — uploaded via `/api/schools/upload_asset/` |
| address, contact_email, contact_phone | Various | |
| whatsapp_sender_id | CharField | |
| enabled_modules | JSONField | `{attendance: true, finance: true, ...}` — controls feature gating |
| mark_mappings | JSONField | `{PRESENT: ["P","✓"], ABSENT: ["A","X"], ...}` |
| register_config | JSONField | `{orientation, data_start_col, roll_number_col, ...}` |
| ai_config | JSONField | AI pipeline config: thresholds, providers, auto-tune settings |
| exam_config | JSONField | `{weighted_average_enabled: false}` — per-school exam calculation toggle |
| organization | FK → Organization | Nullable |
| is_active | BooleanField | |

### UserSchoolMembership
| Field | Type | Notes |
|-------|------|-------|
| user | FK → User | |
| school | FK → School | |
| role | CharField | Per-school role (can differ from User.role) |
| is_default | BooleanField | Default school for this user |

**Unique constraint:** (user, school)

---

## students — Student Management

### Class
| Field | Type | Notes |
|-------|------|-------|
| school | FK → School | |
| name | CharField | e.g., "Class 1A" |
| section | CharField | e.g., "A" |
| grade_level | IntegerField | Numeric level |
| is_active | BooleanField | |

### Student
| Field | Type | Notes |
|-------|------|-------|
| school | FK → School | |
| class_obj | FK → Class | Current class |
| roll_number | CharField | Display roll number |
| name | CharField | Full name |
| admission_number | CharField | |
| admission_date, date_of_birth | DateField | Nullable |
| gender, blood_group | CharField | |
| address | TextField | |
| parent_phone, parent_name | CharField | |
| guardian_name, guardian_relation, guardian_phone, guardian_email | Various | |
| is_active | BooleanField | |
| status | CharField | ACTIVE, INACTIVE, GRADUATED, TRANSFERRED, EXPELLED |
| user | FK → User | Nullable — linked portal account |

### StudyHelperMessage
student(FK), role (user/assistant), content, created_at — AI chat history

---

## attendance — AI-Powered Attendance

### AttendanceUpload
| Field | Type | Notes |
|-------|------|-------|
| school | FK → School | |
| class_obj | FK → Class | |
| date | DateField | Attendance date |
| academic_year | FK → AcademicYear | |
| image_url | URLField | Main image (Supabase) |
| status | CharField | PROCESSING → REVIEW_REQUIRED → CONFIRMED (or FAILED) |
| ai_output_json | JSONField | Raw AI output |
| ocr_raw_text | TextField | Raw OCR text |
| structured_table_json | JSONField | Table extraction result |
| confidence_score | FloatField | |
| matched_students | JSONField | `[{student_id, name, status, confidence}]` |
| unmatched_entries | JSONField | `[{raw_text, possible_matches}]` |
| error_message | TextField | |
| created_by, confirmed_by | FK → User | |

### AttendanceRecord
| Field | Type | Notes |
|-------|------|-------|
| school | FK → School | |
| student | FK → Student | |
| date | DateField | |
| status | CharField | PRESENT, ABSENT, LATE, LEAVE |
| source | CharField | AI, MANUAL |
| upload | FK → AttendanceUpload | Nullable |
| academic_year | FK → AcademicYear | |
| notification_sent | BooleanField | |

**Unique constraint:** (school, student, date)

### AttendanceFeedback
upload(FK), student(FK), original_status, corrected_status, correction_type (false_positive/false_negative/roll_mismatch/mark_misread/name_mismatch), notes, created_by(FK)

---

## academic_sessions — Academic Periods

### AcademicYear
school(FK), name, start_date, end_date, is_current (only one per school), is_active

### Term
school(FK), academic_year(FK), name, term_type (TERM/SEMESTER/QUARTER), order, start_date, end_date, is_current

### StudentEnrollment
| Field | Type | Notes |
|-------|------|-------|
| school | FK → School | |
| student | FK → Student | |
| academic_year | FK → AcademicYear | |
| class_obj | FK → Class | |
| roll_number | CharField | **Session-scoped** roll number |
| status | CharField | ACTIVE, PROMOTED, RETAINED, TRANSFERRED |

**Key concept:** Roll numbers are session-scoped via enrollment, not on Student directly.

---

## academics — Subjects & Timetable

### Subject
school(FK), name, code, description, is_active

### ClassSubject
school(FK), class_obj(FK), subject(FK), teacher(FK → StaffMember, nullable), periods_per_week

### TimetableSlot
school(FK), name, start_time, end_time, slot_type (PERIOD/BREAK/ASSEMBLY), order

### TimetableEntry
school(FK), class_obj(FK), slot(FK), day_of_week (0=Mon..6=Sun), subject(FK, nullable), teacher(FK, nullable)

---

## examinations — Exams & Marks

### ExamType
school(FK), name, description, is_active

### Exam
school(FK), exam_type(FK), academic_year(FK), term(FK nullable), name, start_date, end_date, is_published

### ExamSubject
exam(FK), subject(FK), class_obj(FK), max_marks, passing_marks, exam_date, teacher(FK nullable)

### StudentMark
school(FK), exam_subject(FK), student(FK), marks_obtained, is_absent, remarks

### GradeScale
school(FK), name, min_percentage, max_percentage, grade_point

### Question (NEW M2M: tested_topics)
school(FK), subject(FK), exam_type(FK nullable), question_text, question_image_url(nullable), question_type (MCQ/SHORT/ESSAY/TRUE_FALSE), difficulty_level (EASY/MEDIUM/HARD), marks, option_a, option_b, option_c, option_d, correct_answer, **tested_topics(M2M → lms.Topic)**, created_by(FK), is_active, created_at, updated_at

**NEW:** `tested_topics` links each question to the curriculum topics it tests. Supports AI question generation by lesson plan topics.

### ExamPaper (NEW M2M: lesson_plans)
school(FK), exam(FK nullable), exam_subject(FK nullable), class_obj(FK), subject(FK), paper_title, instructions, total_marks, duration_minutes, questions(M2M through PaperQuestion), **lesson_plans(M2M → lms.LessonPlan)**, status (DRAFT/READY/PUBLISHED), generated_by(FK), is_active, created_at, updated_at

**NEW:** `lesson_plans` links papers to lesson plans they assess. Computed properties:
- `covered_topics` — Topics tested via questions in this paper
- `question_topics_summary` — Question count per topic

### PaperQuestion
exam_paper(FK), question(FK), question_order, marks_override(nullable), created_at

**Unique constraint:** (exam_paper, question)

---

## finance — Fee Management & Accounting

### FeeType Choices
`MONTHLY`, `ANNUAL`, `ADMISSION`, `BOOKS`, `FINE`

### Account
school(FK), name, account_type (CASH/BANK/MOBILE), description, is_default, is_active

### FeeStructure
school(FK), name, class_obj(FK nullable), student(FK SET_NULL nullable), amount, fee_type (FeeType, default=MONTHLY), academic_year(FK), frequency (MONTHLY/QUARTERLY/ANNUAL/ONE_TIME)

### FeePayment
school(FK), student(FK SET_NULL nullable), fee_structure(FK nullable), amount, paid_amount, discount_amount, balance, fee_type (FeeType, default=MONTHLY), month, year, status (PENDING/PARTIAL/PAID/OVERDUE), payment_date, payment_method, receipt_number, account(FK nullable), academic_year(FK)

**Unique constraint:** (school, student, month, year, fee_type)

**Note:** `resolve_fee_amount(student, fee_type='MONTHLY')` accepts a fee_type parameter. `FeePayment.save()/delete()` skip MonthlyClosing lock for month=0 records (used by non-MONTHLY fee types).

**Financial Record Safety:** FeePayment, FeeStructure, OnlinePayment, and StudentDiscount use `on_delete=SET_NULL` on student ForeignKeys. Deleting a student preserves all financial records (student field becomes NULL, displayed as "Deleted Student" in the UI).

### Expense
school(FK), category(FK nullable), amount, date, description, recorded_by(FK nullable), account(FK nullable), is_sensitive, created_at, updated_at

**Audit Trail:** `recorded_by` (WHO recorded it), `created_at` (WHEN created), `updated_at` (WHEN last modified), `date` (business date)

**Safeguards:** 
- Period lock: Cannot modify/delete expenses in closed months
- Audit compliance (v2.1+): `recorded_by` REQUIRED — validated in model.save(). Error if NULL: "recorded_by user is required for all expenses"
- Legacy data: 18 records from seed data (Feb 11, 2026) have NULL recorded_by; documented as test-only limitation

**Note:** Automatically set `recorded_by=request.user` via API. Only use direct ORM for test/seed data that will be cleaned during production refresh.

### OtherIncome
school(FK), category(FK nullable), amount, date, description, recorded_by(FK nullable), account(FK nullable), is_sensitive, created_at, updated_at

**Audit Trail:** Same as Expense. `recorded_by` REQUIRED on all new records (v2.1+).

**Legacy data:** 1 record from seed data (Feb 11, 2026) has NULL recorded_by; documented as test-only limitation.

### Transfer
school(FK), from_account(FK), to_account(FK), amount, date, description, recorded_by(FK nullable), is_sensitive, created_at, updated_at

**Audit Trail:** Same as Expense/OtherIncome. `recorded_by` REQUIRED on all new records (v2.1+).

**Safeguards:**
- Period lock: Cannot modify/delete transfers in closed months
- Audit compliance: `recorded_by` REQUIRED — validated in model.save()
- Data quality: 100% compliant (0 NULL recorded_by) — API enforcement worked from day 1


school(FK), academic_year(FK nullable), name, discount_type (PERCENTAGE/FIXED), value, applies_to (ALL/GRADE_LEVEL/CLASS/STUDENT/SIBLING), target_grade_level(nullable), target_class(FK nullable), start_date, end_date, is_active, max_uses, stackable

### Scholarship
school(FK), academic_year(FK nullable), name, description, scholarship_type (MERIT/NEED/SPORTS/STAFF_CHILD/OTHER), coverage (FULL/PERCENTAGE/FIXED), value, max_recipients, is_active

### StudentDiscount
school(FK), student(FK SET_NULL nullable), discount(FK nullable), scholarship(FK nullable), academic_year(FK), approved_by(FK nullable), approved_at, is_active, notes

### PaymentGatewayConfig
school(FK), provider (JAZZCASH/EASYPAISA), config(JSON), is_active, is_default

### OnlinePayment
school(FK), student(FK SET_NULL nullable), fee_payment(FK), amount, order_id, provider, status, gateway_response(JSON)

---

## hr — Staff Management

### StaffDepartment
school(FK), name, description, is_active

### StaffDesignation
school(FK), name, department(FK), is_active

### StaffMember
school(FK), user(FK), first_name, last_name, email, phone, gender, date_of_birth, photo_url, employee_id, department(FK), designation(FK), employment_type (FULL_TIME/PART_TIME/CONTRACT), employment_status (ACTIVE/ON_LEAVE/TERMINATED/RESIGNED), date_of_joining, date_of_leaving, is_active

### SalaryStructure
staff(FK), basic_salary, allowances(JSON), deductions(JSON), effective_from, is_current

### Payslip
school(FK), staff(FK), salary_structure(FK), month, year, basic_amount, allowances(JSON), deductions(JSON), net_amount, status (DRAFT/APPROVED/PAID), approved_by(FK), paid_date

### LeavePolicy
school(FK), name, leave_type, days_per_year, carry_forward, is_active

### LeaveApplication
school(FK), staff(FK), leave_policy(FK), start_date, end_date, reason, status (PENDING/APPROVED/REJECTED/CANCELLED), reviewed_by(FK)

### StaffAttendance
school(FK), staff(FK), date, status (PRESENT/ABSENT/LATE/LEAVE), check_in, check_out

### PerformanceAppraisal
school(FK), staff(FK), academic_year(FK), review_period, scores(JSON), comments, overall_rating, reviewed_by(FK), status

---

## admissions — CRM Workflow

### AdmissionEnquiry
school(FK), student_name, parent_name, contact_phone, email, class_applied(FK nullable), status (ENQUIRY/FOLLOWUP/VISIT/ADMITTED/REJECTED/WITHDRAWN), source, notes, academic_year(FK), created_by(FK)

### AdmissionNote
enquiry(FK), note, created_by(FK), created_at

**Key:** `batch-convert` action converts enquiries directly into Student records. Accepts optional `generate_fees` (bool) and `fee_types` (list of FeeType choices, e.g. `["MONTHLY", "ADMISSION"]`) parameters to auto-create FeePayment records during conversion.

---

## notifications — Communication System

### NotificationTemplate
school(FK), name, event_type (FEE_DUE/ABSENCE/EXAM/GENERAL), channel (IN_APP/SMS/EMAIL/WHATSAPP/PUSH), subject_template, body_template (supports `{{amount}}`, `{{month}}`), is_active

### NotificationLog
school(FK), template(FK nullable), channel, event_type, recipient_type, recipient_identifier, title, body, status (PENDING/SENT/DELIVERED/FAILED/READ), metadata(JSON), sent_at

### SchoolNotificationConfig
school(OneToOne), whatsapp_enabled, sms_enabled, in_app_enabled, email_enabled, push_enabled, quiet_hours_start/end, fee_reminder_day, daily_absence_summary_time, smart_scheduling_enabled, absence_notification_enabled, fee_reminder_enabled, fee_overdue_enabled, exam_result_enabled, daily_absence_summary_enabled, transport_notification_enabled

### NotificationPreference
school(FK), user(FK nullable), student(FK nullable), channel, event_type, is_enabled

---

## messaging — Internal Messaging

### MessageThread
id(UUID PK), school(FK), message_type (ADMIN_STAFF/TEACHER_PARENT/TEACHER_STUDENT/GENERAL), student(FK nullable), subject, created_by(FK), is_active, created_at, updated_at

### ThreadParticipant
thread(FK), user(FK), last_read_at, joined_at. Unique: (thread, user)

### Message
thread(FK), sender(FK), body, created_at

**Key:** Thread-based messaging system. Admins can message any staff. Teachers can message parents/students of classes they teach (validated via ClassSubject). Recipients endpoint returns role-filtered available contacts. Thread reuse: if a thread already exists between same two users + same student context, messages are appended.

---

## parents — Parent Portal

### ParentProfile
user(OneToOne), phone, address

### ParentChild
parent(FK → ParentProfile), student(FK), relationship

### ParentLeaveRequest
school(FK), parent(FK), student(FK), start_date, end_date, reason, status (PENDING/APPROVED/REJECTED), reviewed_by(FK)

### ParentMessage
school(FK), thread_id(UUID), sender(FK), recipient(FK), content, is_read, read_at

---

## lms — Learning Management

### Book
school(FK), class_obj(FK), subject(FK), title, author, publisher, edition, language (en/ur/ar/sd/ps/pa/other), description, is_active, created_at, updated_at

### Chapter
book(FK), title, chapter_number, description, is_active, created_at, updated_at
Unique: (book, chapter_number)

### Topic
chapter(FK), title, topic_number, description, estimated_periods (default 1), is_active, created_at, updated_at
Unique: (chapter, topic_number)

**NEW Properties:**
- `is_covered` — Has active lesson plans teaching this topic
- `is_tested` — Has active questions testing this topic
- `test_question_count` — Count of active test questions
- `lesson_plan_count` — Count of active lesson plans

**NEW Reverse Relations:**
- `test_questions` (from examinations.Question.tested_topics)
- `exam_papers` (via test_questions → PaperQuestion → ExamPaper)

### LessonPlan
school(FK), academic_year(FK), class_obj(FK), subject(FK), teacher(FK), title, description, objectives, lesson_date, duration_minutes (default 40), materials_needed, teaching_methods, planned_topics (M2M → Topic), display_text (computed), content_mode (TOPICS/FREEFORM), ai_generated (bool), status (DRAFT/PUBLISHED), is_active

**NEW (Phase 1.4 - Curriculum Integration):**
- **Reverse relation:** `exam_papers` (from examinations.ExamPaper.lesson_plans) — Papers that assess this lesson

### Assignment
school(FK), academic_year(FK), class_obj(FK), subject(FK), teacher(FK), title, description, instructions, assignment_type (HOMEWORK/PROJECT/CLASSWORK/LAB), due_date, total_marks, attachments_allowed, status (DRAFT/PUBLISHED/CLOSED), is_active

### AssignmentSubmission
assignment(FK), student(FK), school(FK), submission_text, file_url, file_name, submitted_at, status (PENDING/SUBMITTED/LATE/GRADED/RETURNED), marks_obtained, feedback, graded_by(FK), graded_at
Unique: (assignment, student)

---

## transport — Transport & GPS

### TransportRoute
school(FK), name, description, is_active

### TransportStop
route(FK), name, latitude, longitude, order, pickup_time, drop_time

### TransportVehicle
school(FK), registration_number, vehicle_type, capacity, driver_name, driver_phone, is_active

### TransportAssignment
school(FK), student(FK), route(FK), stop(FK), vehicle(FK nullable), academic_year(FK)

### TransportAttendance
school(FK), student(FK), route(FK), date, boarding_status (BOARDED/NOT_BOARDED/ABSENT), direction (PICKUP/DROP)

---

## library — Library Management

### BookCategory
school(FK), name, description, is_active

### Book
school(FK), category(FK), title, author, isbn, publisher, total_copies, available_copies, location, is_active

### BookIssue
school(FK), book(FK), student(FK nullable), staff(FK nullable), issue_date, due_date, return_date, fine_amount, status (ISSUED/RETURNED/OVERDUE/LOST)

### LibraryConfiguration
school(OneToOne), max_books_per_student, loan_period_days, fine_per_day

---

## hostel — Hostel Management

### Hostel
school(FK), name, hostel_type (BOYS/GIRLS/MIXED), warden(FK → StaffMember nullable), capacity, is_active

### Room
hostel(FK), room_number, floor, capacity, current_occupancy, room_type, is_active

### HostelAllocation
school(FK), student(FK), room(FK), start_date, end_date, status (ACTIVE/VACATED)

### GatePass
school(FK), student(FK), reason, out_date, expected_return, actual_return, status (PENDING/APPROVED/REJECTED/OUT/RETURNED), approved_by(FK)

---

## inventory — Inventory Tracking

### InventoryCategory
school(FK), name, description, is_active

### Vendor
school(FK), name, contact_person, phone, email, address, is_active

### InventoryItem
school(FK), category(FK), name, sku, unit, current_stock, minimum_stock, unit_price, location, is_active

### ItemAssignment
school(FK), item(FK), assigned_to(FK → User), quantity, assigned_date, return_date, status (ASSIGNED/RETURNED)

### StockTransaction
school(FK), item(FK), transaction_type (PURCHASE/ISSUE/RETURN/ADJUSTMENT), quantity, unit_price, total_amount, vendor(FK nullable), reference_number, remarks, date, recorded_by(FK)

---

## reports — Report Generation & Letter Composer

### GeneratedReport
school(FK), report_type (ATTENDANCE_DAILY/ATTENDANCE_MONTHLY/ATTENDANCE_TERM/FEE_COLLECTION/FEE_DEFAULTERS/FEE_RECEIPT/STUDENT_PROGRESS/CLASS_RESULT/STUDENT_COMPREHENSIVE), title, parameters(JSON), file_url, file_content(Binary nullable), format (PDF/XLSX), generated_by(FK nullable), created_at

**Key:** PDF reports generated async via Celery (BackgroundTask). XLSX reports generated synchronously. Report generators in `reports/generators/` — attendance, fee, academic, student modules.

### CustomLetter
school(FK), recipient(TextField max 500), subject(CharField max 200), body_text(TextField), line_spacing (single/1.5/double), template_type (custom/experience/termination/warning/appreciation/leave_approval/salary_increment/transfer), created_by(FK nullable), created_at, updated_at

**Key:** Letter Composer feature for HR. 7 built-in templates with `{placeholder}` support (employee_name, employee_id, department, designation, date_of_joining, school_name). PDF generation uses school `letterhead_url` as full-page background via reportlab canvas. AI draft endpoint uses Groq LLM to generate letter content from natural language prompts.

---

## face_attendance — Camera-Based Face Attendance

Uses `face_recognition` (dlib) for face detection, embedding generation, and class-scoped matching. Runs parallel to the existing OCR attendance pipeline. See `docs/FACE_ATTENDANCE.md` for full architecture.

### FaceAttendanceSession
id(UUID PK), school(FK), class_obj(FK), academic_year(FK nullable), date, status (UPLOADING/PROCESSING/NEEDS_REVIEW/CONFIRMED/FAILED), error_message, image_url, total_faces_detected, faces_matched, faces_flagged, faces_ignored, thresholds_used(JSON), celery_task_id, created_by(FK), confirmed_by(FK nullable), confirmed_at(nullable), created_at, updated_at

### StudentFaceEmbedding
student(FK), school(FK), embedding(Binary — 128-d numpy float64), embedding_version, source_image_url, quality_score, is_active, created_at

### FaceDetectionResult
session(FK), face_index, bounding_box(JSON), face_crop_url, quality_score, embedding(Binary nullable), matched_student(FK nullable), confidence, match_status (AUTO_MATCHED/FLAGGED/IGNORED/MANUALLY_MATCHED/REMOVED), match_distance(nullable), alternative_matches(JSON), created_at

---

## AI Chatbot Agents

Four LLM-powered chatbot agents provide natural language interfaces across the platform. All use **Groq LLM (llama-3.3-70b-versatile)** with multi-round tool calling (up to 3 rounds per query) and conversation history (last 10 messages).

### Architecture: Multi-Round Tool Calling
```
User message → Build [system prompt + last 10 history messages + user message]
  → LLM responds
    → JSON tool call? → Execute tool → Append result → LLM again (up to 3 rounds)
    → Plain text? → Return as final answer
```
All agents use dict-based dispatch for tool execution. When an entity is not found, agents suggest similar names ("Did you mean: ...?").

---

### 1. Finance AI Chat
**File:** `backend/finance/ai_agent.py` — **Class:** `FinanceAIAgent`
**Endpoint:** `POST /api/finance/ai-chat/`
**History model:** `FinanceAIChatMessage`

**18 Tools:**
| # | Tool | Purpose |
|---|------|---------|
| 1 | `get_fee_collection_summary` | Collection stats for a month/year |
| 2 | `get_pending_fees` | Students with unpaid fees (by class) |
| 3 | `get_expense_summary` | Expenses grouped by category |
| 4 | `get_account_balances` | All account balances |
| 5 | `get_class_fee_comparison` | Fee collection compared across classes |
| 6 | `get_student_fee_history` | Individual student fee records |
| 7 | `get_daily_transactions` | Payments + expenses for a date |
| 8 | `get_income_vs_expense` | Revenue vs expense breakdown for a period |
| 9 | `get_fee_structure` | Fee amounts per class/type |
| 10 | `get_payment_method_analysis` | CASH vs BANK vs ONLINE breakdown |
| 11 | `get_scholarships_summary` | Active scholarships + recipient counts |
| 12 | `get_discounts_impact` | Total discounts by type + beneficiaries |
| 13 | `get_online_payment_status` | Online payment success/failure rates |
| 14 | `get_monthly_closing_status` | Which months are closed/open |
| 15 | `get_fee_defaulters` | Chronic defaulters (2+ months unpaid) |
| 16 | `get_collection_trend` | Month-over-month collection trend |
| 17 | `get_transfer_history` | Inter-account transfers |
| 18 | `get_top_expenses` | Largest expenses by amount |

---

### 2. Parent Communication AI Chat
**File:** `backend/notifications/ai_agent.py` — **Class:** `ParentCommunicationAgent`
**Endpoint:** `POST /api/notifications/ai-chat/`
**History model:** `NotificationAIChatMessage`

**15 Tools:**
| # | Tool | Purpose |
|---|------|---------|
| 1 | `get_student_info` | Basic student details |
| 2 | `get_attendance_summary` | Attendance % and absent days |
| 3 | `get_fee_status` | Pending/paid fees |
| 4 | `draft_message` | Draft a parent notification |
| 5 | `get_class_list` | All classes in school |
| 6 | `get_exam_performance` | Marks, grades, pass/fail per exam |
| 7 | `get_assignment_status` | Pending/submitted/graded assignments |
| 8 | `get_detailed_attendance` | Day-by-day attendance with absence dates |
| 9 | `get_transport_status` | Route, stop, boarding history |
| 10 | `get_class_teacher_info` | Teacher names per subject for a class |
| 11 | `get_communication_preferences` | Channel opt-in/opt-out for a student |
| 12 | `get_leave_requests` | Parent leave requests for a student |
| 13 | `get_financial_aid_status` | Scholarships/discounts applied |
| 14 | `get_notification_history` | Past notifications sent to a student |
| 15 | `get_curriculum_progress` | Recent/upcoming lessons for a class |

**Cross-app imports:** examinations, lms, transport, academics, hr, parents, finance

---

### 3. Academics AI Chat
**File:** `backend/academics/ai_engine.py` — **Class:** `AcademicsAIAgent`
**Endpoint:** `POST /api/academics/ai-chat/`
**History model:** `AcademicsAIChatMessage`

**13 Tools:**
| # | Tool | Purpose |
|---|------|---------|
| 1 | `get_class_schedule` | Full timetable for a class |
| 2 | `get_teacher_schedule` | Teacher's weekly timetable |
| 3 | `get_subject_distribution` | Subjects and teachers per class |
| 4 | `get_free_periods` | Available slots for a class or teacher |
| 5 | `get_teacher_workload` | Periods per week per teacher |
| 6 | `get_class_overview` | All classes with student counts |
| 7 | `get_quality_score` | Timetable quality score (5 metrics) — wraps `TimetableQualityScorer` |
| 8 | `find_substitute` | Find cover for absent teacher — wraps `SubstituteTeacherFinder` |
| 9 | `get_curriculum_gaps` | Missing subjects/periods/teachers — wraps `CurriculumGapAnalyzer` |
| 10 | `resolve_conflict` | Alternative slots/teachers/swaps — wraps `ConflictResolver` |
| 11 | `get_workload_analysis` | Overloaded/underloaded teachers — wraps `WorkloadAnalyzer` |
| 12 | `get_room_usage` | Room occupancy + empty rooms |
| 13 | `compare_schedules` | Side-by-side class or teacher comparison |

Tools 7-11 wrap existing algorithm classes defined in the same file (`TimetableQualityScorer`, `SubstituteTeacherFinder`, `CurriculumGapAnalyzer`, `ConflictResolver`, `WorkloadAnalyzer`).

---

### 4. Study Helper AI Chat
**File:** `backend/students/study_helper_service.py` — **Class:** `StudyHelperService`
**Endpoint:** `POST /api/students/portal/study-helper/`
**History model:** `StudyHelperMessage`

**Hybrid architecture:** Combines free-form study help (explanations, quizzes, study tips) with data lookup tools. Content safety filters on input and output.

**8 Tools:**
| # | Tool | Purpose |
|---|------|---------|
| 1 | `get_my_marks` | Student's exam results (filterable by exam/subject) |
| 2 | `get_my_assignments` | Pending/submitted/graded assignments |
| 3 | `get_topic_details` | Book chapters and topics for a subject |
| 4 | `get_my_attendance` | Attendance record for last N days |
| 5 | `get_exam_schedule` | Upcoming exam dates and subjects |
| 6 | `get_lesson_materials` | Lesson plan attachments for a subject |
| 7 | `get_grade_targets` | Marks needed for each grade |
| 8 | `get_teacher_feedback` | Feedback from graded submissions |

**Context enrichment:** System prompt includes student's weak subjects (lowest marks), upcoming exams (next 14 days), and class/section info.

**Safety features:** Input regex filtering for unsafe content, output safety check, rate limiting (20 msgs/hour), max 500 char input.
