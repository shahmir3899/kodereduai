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
| logo | URLField | Nullable |
| address, contact_email, contact_phone | Various | |
| whatsapp_sender_id | CharField | |
| enabled_modules | JSONField | `{attendance: true, finance: true, ...}` — controls feature gating |
| mark_mappings | JSONField | `{PRESENT: ["P","✓"], ABSENT: ["A","X"], ...}` |
| register_config | JSONField | `{orientation, data_start_col, roll_number_col, ...}` |
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

---

## finance — Fee Management & Accounting

### Account
school(FK), name, account_type (CASH/BANK/MOBILE), description, is_default, is_active

### FeeStructure
school(FK), name, class_obj(FK nullable), amount, fee_type, academic_year(FK), frequency (MONTHLY/QUARTERLY/ANNUAL/ONE_TIME)

### FeePayment
school(FK), student(FK), fee_structure(FK nullable), amount, paid_amount, discount_amount, balance, month, year, status (PENDING/PARTIAL/PAID/OVERDUE), payment_date, payment_method, receipt_number, account(FK nullable), academic_year(FK)

### Expense
school(FK), category, description, amount, date, account(FK), payment_method, receipt_number, created_by(FK), academic_year(FK)

### OtherIncome
school(FK), source, description, amount, date, account(FK), academic_year(FK)

### Discount
school(FK), name, discount_type (PERCENTAGE/FIXED), value, applies_to, is_active

### Scholarship
school(FK), name, amount, criteria, is_active

### StudentDiscount
student(FK), discount(FK nullable), scholarship(FK nullable), custom_amount

### PaymentGatewayConfig
school(FK), provider (JAZZCASH/EASYPAISA), config(JSON), is_active, is_default

### OnlinePayment
school(FK), student(FK), fee_payment(FK), amount, order_id, provider, status, gateway_response(JSON)

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

**Key:** `batch-convert` action converts enquiries directly into Student records.

---

## notifications — Communication System

### NotificationTemplate
school(FK), name, event_type (FEE_DUE/ABSENCE/EXAM/GENERAL), channel (IN_APP/SMS/EMAIL/WHATSAPP/PUSH), subject_template, body_template (supports `{{amount}}`, `{{month}}`), is_active

### NotificationLog
school(FK), template(FK nullable), channel, event_type, recipient_type, recipient_identifier, title, body, status (PENDING/SENT/DELIVERED/FAILED/READ), metadata(JSON), sent_at

### SchoolNotificationConfig
school(OneToOne), whatsapp_enabled, sms_enabled, in_app_enabled, email_enabled, quiet_hours_start/end, fee_reminder_day

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

### LessonPlan
school(FK), class_subject(FK), teacher(FK), title, content, date, status (DRAFT/PUBLISHED), academic_year(FK)

### Assignment
school(FK), class_obj(FK), subject(FK), teacher(FK), title, description, due_date, max_marks, status (DRAFT/PUBLISHED/CLOSED), academic_year(FK)

### AssignmentSubmission
assignment(FK), student(FK), content, file_url, submitted_at, marks, feedback, graded_by(FK), graded_at

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

## face_attendance — Camera-Based Face Attendance

Uses `face_recognition` (dlib) for face detection, embedding generation, and class-scoped matching. Runs parallel to the existing OCR attendance pipeline. See `docs/FACE_ATTENDANCE.md` for full architecture.

### FaceAttendanceSession
id(UUID PK), school(FK), class_obj(FK), academic_year(FK nullable), date, status (UPLOADING/PROCESSING/NEEDS_REVIEW/CONFIRMED/FAILED), error_message, image_url, total_faces_detected, faces_matched, faces_flagged, faces_ignored, thresholds_used(JSON), celery_task_id, created_by(FK), confirmed_by(FK nullable), confirmed_at(nullable), created_at, updated_at

### StudentFaceEmbedding
student(FK), school(FK), embedding(Binary — 128-d numpy float64), embedding_version, source_image_url, quality_score, is_active, created_at

### FaceDetectionResult
session(FK), face_index, bounding_box(JSON), face_crop_url, quality_score, embedding(Binary nullable), matched_student(FK nullable), confidence, match_status (AUTO_MATCHED/FLAGGED/IGNORED/MANUALLY_MATCHED/REMOVED), match_distance(nullable), alternative_matches(JSON), created_at
