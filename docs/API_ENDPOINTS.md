# API Endpoints Reference

All endpoints require JWT auth (`Authorization: Bearer <token>`) and school context (`X-School-ID: <id>`) unless noted.

Pagination: All list endpoints return `{count, next, previous, results}`. Default page_size=20. Use `?page_size=N`.

## Auth
| Method | URL | Description |
|--------|-----|-------------|
| POST | /api/auth/login/ | Login. Body: {username, password}. Returns {access, refresh, user} |
| POST | /api/auth/refresh/ | Refresh token. Body: {refresh}. Returns {access, refresh} |
| GET | /api/auth/me/ | Current user profile with schools list |
| PATCH | /api/auth/me/ | Update profile. Body: {first_name, last_name, phone} |
| POST | /api/auth/change-password/ | Body: {old_password, new_password} |
| POST | /api/auth/switch-school/ | Body: {school_id}. Returns {school_id, school_name, role} |
| POST | /api/auth/register-push-token/ | Body: {token, platform} |
| DELETE | /api/auth/unregister-push-token/ | Deactivate push token |

## Users
| Method | URL | Description |
|--------|-----|-------------|
| GET | /api/users/ | List users. Params: search, role, is_active |
| POST | /api/users/ | Create user |
| GET/PUT/DELETE | /api/users/{id}/ | User detail |
| POST | /api/admin/users/create/ | Super admin user creation |

## Schools (Admin)
| Method | URL | Description |
|--------|-----|-------------|
| GET/POST | /api/admin/schools/ | List/create schools |
| GET/PUT/DELETE | /api/admin/schools/{id}/ | School detail |
| GET | /api/admin/schools/platform_stats/ | Platform-wide statistics |
| POST | /api/admin/schools/{id}/activate/ | Activate school |
| POST | /api/admin/schools/{id}/deactivate/ | Deactivate school |
| GET | /api/admin/schools/{id}/stats/ | School statistics |
| GET | /api/admin/modules/ | Module registry |
| GET/POST | /api/admin/organizations/ | Organizations CRUD |
| GET/POST | /api/admin/memberships/ | Memberships CRUD |

## Schools (Regular)
| Method | URL | Description |
|--------|-----|-------------|
| GET/POST | /api/schools/ | List/create schools |
| GET/PUT/PATCH | /api/schools/{id}/ | School detail |
| GET | /api/schools/current/ | Current school detail |
| GET/PUT | /api/schools/mark_mappings/ | Mark mappings config |
| GET/PUT | /api/schools/register_config/ | Register layout config |
| GET | /api/schools/completion/ | School setup completion timeline with per-module progress |

## Classes
| Method | URL | Params |
|--------|-----|--------|
| GET/POST | /api/classes/ | search, is_active |
| GET/PUT/DELETE | /api/classes/{id}/ | |

## Students
| Method | URL | Params |
|--------|-----|--------|
| GET/POST | /api/students/ | class_obj, search, status, is_active |
| GET/PUT/DELETE | /api/students/{id}/ | |
| POST | /api/students/bulk_create/ | Body: [{name, class_obj, roll_number}] |
| POST | /api/students/bulk-create-accounts/ | Create user accounts for students |
| GET | /api/students/by_class/ | class_id |
| GET | /api/students/{id}/profile_summary/ | |
| GET | /api/students/{id}/attendance_history/ | |
| GET | /api/students/{id}/fee_ledger/ | |
| GET | /api/students/{id}/exam_results/ | |
| GET | /api/students/{id}/enrollment_history/ | |
| GET | /api/students/{id}/ai-profile/ | |
| GET/POST | /api/students/{id}/documents/ | |
| DELETE | /api/students/{id}/documents/{doc_id}/ | |
| POST | /api/students/{id}/create-user-account/ | |

### Student Portal
| Method | URL | Description |
|--------|-----|-------------|
| POST | /api/students/portal/register/ | Self-registration |
| GET | /api/students/portal/dashboard/ | Student dashboard |
| GET | /api/students/portal/attendance/ | View attendance |
| GET | /api/students/portal/fees/ | View fees |
| GET | /api/students/portal/timetable/ | View timetable |
| GET | /api/students/portal/results/ | View results |
| GET | /api/students/portal/assignments/ | View assignments |
| POST | /api/students/portal/study-helper/ | AI study helper |
| POST | /api/students/admin/generate-invite/ | Generate invite link |

## Attendance
| Method | URL | Params |
|--------|-----|--------|
| POST | /api/attendance/upload-image/ | Multipart: image, class_id |
| GET | /api/attendance/ai-status/ | |
| GET/POST | /api/attendance/uploads/ | class_obj, status, date |
| GET | /api/attendance/uploads/{id}/ | |
| GET | /api/attendance/uploads/pending_review/ | |
| POST | /api/attendance/uploads/{id}/confirm/ | Body: {matched_students, date} |
| POST | /api/attendance/uploads/{id}/reprocess/ | |
| GET | /api/attendance/uploads/{id}/test_image/ | |
| GET | /api/attendance/records/ | class_obj, student, date, status, academic_year |
| GET | /api/attendance/records/{id}/ | |
| GET | /api/attendance/records/daily_report/ | date, class_obj |
| GET | /api/attendance/records/chronic_absentees/ | |
| GET | /api/attendance/records/accuracy_stats/ | |
| GET | /api/attendance/records/threshold_status/ | Current AI thresholds, auto_tune status, tune_history |
| POST | /api/attendance/records/tune_thresholds/ | Toggle auto_tune, manually update thresholds. Body: {auto_tune_enabled, thresholds} |
| GET | /api/attendance/records/drift_history/ | Params: days (default 30). Returns accuracy snapshots + current drift status |
| GET | /api/attendance/records/mapping_suggestions/ | |
| GET | /api/attendance/records/my_classes/ | Returns classes available for manual attendance (role-aware) |
| POST | /api/attendance/records/bulk_entry/ | Body: {class_id, date, entries: [{student_id, status}]} |

### Attendance Anomalies
| Method | URL | Params |
|--------|-----|--------|
| GET | /api/attendance/anomalies/ | is_resolved, anomaly_type, severity, page_size |
| GET | /api/attendance/anomalies/{id}/ | |
| POST | /api/attendance/anomalies/{id}/resolve/ | Body: {resolution_notes} |

**NOTE:** URLs use underscores (`pending_review`, `daily_report`), not hyphens.

## Finance
| Method | URL | Params |
|--------|-----|--------|
| GET/POST | /api/finance/accounts/ | |
| GET/PUT/DELETE | /api/finance/accounts/{id}/ | |
| GET | /api/finance/accounts/balances/ | |
| GET | /api/finance/accounts/balances_all/ | |
| POST | /api/finance/accounts/close_month/ | |
| GET | /api/finance/accounts/closings/ | |
| GET | /api/finance/accounts/recent_entries/ | |
| POST | /api/finance/accounts/{id}/reopen/ | |
| GET/POST | /api/finance/transfers/ | |
| GET/POST | /api/finance/fee-structures/ | class_obj, academic_year, fee_type |
| POST | /api/finance/fee-structures/bulk_set/ | Body: {items: [{class_id, amount, fee_type?}]}. fee_type per item (default MONTHLY) |
| GET/POST | /api/finance/fee-payments/ | student, class_obj, month, year, status, academic_year, fee_type |
| POST | /api/finance/fee-payments/generate_monthly/ | Scoped to MONTHLY fee_type only |
| POST | /api/finance/fee-payments/generate_onetime_fees/ | Body: {student_ids, fee_types, year, month}. Generates non-MONTHLY fee records |
| GET | /api/finance/fee-payments/monthly_summary/ | month, year, fee_type |
| GET | /api/finance/fee-payments/monthly_summary_all/ | |
| GET | /api/finance/fee-payments/student_ledger/ | student_id |
| POST | /api/finance/fee-payments/bulk_update/ | |
| POST | /api/finance/fee-payments/bulk_delete/ | |
| GET | /api/finance/fee-payments/resolve_amount/ | student_id, fee_type. Returns resolved fee amount from fee structure (student override > class default) |
| GET | /api/finance/fee-payments/preview_generation/ | fee_type, class_id, year, month. Dry-run preview of fee generation (counts, amounts, per-student details) |
| GET/POST | /api/finance/expenses/ | category, date range |
| GET | /api/finance/expenses/category_summary/ | |
| GET/POST | /api/finance/other-income/ | |
| GET/POST | /api/finance/discounts/ | |
| GET/POST | /api/finance/scholarships/ | |
| GET/POST | /api/finance/student-discounts/ | |
| POST | /api/finance/student-discounts/bulk_assign/ | |
| GET/POST | /api/finance/gateway-config/ | |
| GET/POST | /api/finance/online-payments/ | |
| POST | /api/finance/online-payments/initiate/ | |
| POST | /api/finance/online-payments/reconcile/ | |
| GET | /api/finance/reports/ | |
| POST | /api/finance/ai-chat/ | Finance AI assistant |
| POST | /api/finance/fee-predictor/ | Fee prediction |
| GET | /api/finance/fee-breakdown/{student_id}/ | |
| GET | /api/finance/siblings/{student_id}/ | Sibling detection |

**NOTE:** Gateway config is at `/api/finance/gateway-config/` NOT `/api/finance/payment-gateways/`.

## HR
| Method | URL | Params |
|--------|-----|--------|
| GET/POST | /api/hr/departments/ | |
| GET/POST | /api/hr/designations/ | |
| GET/POST | /api/hr/staff/ | department, employment_status, search |
| GET | /api/hr/staff/dashboard_stats/ | |
| GET | /api/hr/staff/next-employee-id/ | |
| POST | /api/hr/staff/bulk-create-accounts/ | |
| POST | /api/hr/staff/{id}/create-user-account/ | |
| GET/POST | /api/hr/salary-structures/ | |
| GET | /api/hr/salary-structures/current/ | |
| GET/POST | /api/hr/payslips/ | month, year, status |
| DELETE | /api/hr/payslips/{id}/ | DRAFT only |
| POST | /api/hr/payslips/generate_payslips/ | Sync <50 staff, async 50+ |
| POST | /api/hr/payslips/bulk_delete/ | body: { ids: [...] }, DRAFT only |
| GET | /api/hr/payslips/payroll_summary/ | |
| GET | /api/hr/payslips/{id}/download-pdf/ | Returns PDF file |
| POST | /api/hr/payslips/{id}/approve/ | |
| POST | /api/hr/payslips/{id}/mark_paid/ | |
| GET/POST | /api/hr/leave-policies/ | |
| GET/POST | /api/hr/leave-applications/ | status, staff |
| GET | /api/hr/leave-applications/leave_balance/ | |
| POST | /api/hr/leave-applications/{id}/approve/ | |
| POST | /api/hr/leave-applications/{id}/reject/ | |
| POST | /api/hr/leave-applications/{id}/cancel/ | |
| GET/POST | /api/hr/attendance/ | date, staff |
| POST | /api/hr/attendance/bulk_mark/ | |
| GET | /api/hr/attendance/summary/ | |
| GET/POST | /api/hr/appraisals/ | |
| GET/POST | /api/hr/qualifications/ | |
| GET/POST | /api/hr/documents/ | |

## Academics
| Method | URL | Params |
|--------|-----|--------|
| GET/POST | /api/academics/subjects/ | search, is_active |
| POST | /api/academics/subjects/bulk_create/ | |
| GET | /api/academics/subjects/gap_analysis/ | |
| GET/POST | /api/academics/class-subjects/ | class_obj, subject, teacher |
| POST | /api/academics/class-subjects/bulk-assign/ | |
| GET | /api/academics/class-subjects/by_class/ | class_id |
| GET | /api/academics/class-subjects/workload_analysis/ | |
| GET/POST | /api/academics/timetable-slots/ | |
| POST | /api/academics/timetable-slots/bulk_create_slots/ | |
| POST | /api/academics/timetable-slots/suggest_slots/ | AI suggest |
| GET/POST | /api/academics/timetable-entries/ | class_obj, day_of_week |
| POST | /api/academics/timetable-entries/auto_generate/ | AI auto-generate. Body accepts {algorithm: 'greedy'|'or_tools'} |
| POST | /api/academics/timetable-entries/bulk_save/ | |
| GET | /api/academics/timetable-entries/by_class/ | class_id |
| GET | /api/academics/timetable-entries/quality_score/ | |
| GET | /api/academics/timetable-entries/teacher_conflicts/ | |
| GET | /api/academics/timetable-entries/my_timetable/ | Teacher's own entries. Params: day (MON/TUE/etc), academic_year |
| POST | /api/academics/ai-chat/ | Academics AI chat |
| GET | /api/academics/analytics/ | |

## Academic Sessions
| Method | URL | Params |
|--------|-----|--------|
| GET/POST | /api/sessions/academic-years/ | |
| GET | /api/sessions/academic-years/current/ | |
| POST | /api/sessions/academic-years/{id}/set_current/ | |
| GET | /api/sessions/academic-years/{id}/summary/ | |
| GET/POST | /api/sessions/terms/ | academic_year, is_active |
| GET/POST | /api/sessions/enrollments/ | academic_year, class_obj, student, status |
| GET | /api/sessions/enrollments/by_class/ | class_id, academic_year |
| POST | /api/sessions/enrollments/bulk_promote/ | |
| GET | /api/sessions/promotion-advisor/ | |
| POST | /api/sessions/setup-wizard/ | |
| GET | /api/sessions/health/ | |
| POST | /api/sessions/section-allocator/ | |
| GET | /api/sessions/attendance-risk/ | |

## Examinations
| Method | URL | Params |
|--------|-----|--------|
| GET/POST | /api/examinations/exam-types/ | |
| GET/POST | /api/examinations/exams/ | academic_year, exam_type | POST auto-creates ExamSubjects from class's assigned subjects |
| POST | /api/examinations/exams/{id}/publish/ | |
| POST | /api/examinations/exams/{id}/generate-comments/ | Generate AI report card comments. Body: {force: bool}. force=true regenerates all |
| GET | /api/examinations/exams/{id}/results/ | Now includes ai_comment per mark |
| GET | /api/examinations/exams/{id}/class_summary/ | |
| GET/POST | /api/examinations/exam-subjects/ | exam, class_obj |
| GET/POST | /api/examinations/marks/ | exam_subject, student |
| POST | /api/examinations/marks/bulk_entry/ | |
| GET | /api/examinations/marks/by_student/ | student_id |
| GET | /api/examinations/marks/download_template/ | exam_subject_id |
| GET/POST | /api/examinations/grade-scales/ | |
| GET | /api/examinations/report-card/ | student_id, academic_year_id. Now includes ai_comment per mark |

## Notifications
| Method | URL | Description |
|--------|-----|-------------|
| GET/POST | /api/notifications/templates/ | Notification templates |
| GET | /api/notifications/logs/ | Logs. Params: channel, status, event_type |
| GET/POST | /api/notifications/preferences/ | User preferences |
| GET/PUT | /api/notifications/config/ | School config (single object, NOT paginated). Includes smart_scheduling_enabled field |
| GET | /api/notifications/my/ | My in-app notifications |
| GET | /api/notifications/unread-count/ | Unread count |
| POST | /api/notifications/{id}/mark-read/ | Mark as read |
| POST | /api/notifications/mark-all-read/ | Mark all read |
| POST | /api/notifications/send/ | Send notification |
| GET | /api/notifications/analytics/ | Analytics |
| POST | /api/notifications/ai-chat/ | Communication AI |

## Parents
| Method | URL | Description |
|--------|-----|-------------|
| POST | /api/parents/register/ | Parent self-registration |
| GET | /api/parents/my-children/ | My children |
| GET | /api/parents/children/{student_id}/overview/ | Child overview |
| GET | /api/parents/children/{student_id}/attendance/ | Child attendance |
| GET | /api/parents/children/{student_id}/fees/ | Child fees |
| POST | /api/parents/children/{student_id}/pay-fee/ | Pay fee |
| GET | /api/parents/children/{student_id}/timetable/ | Child timetable |
| GET | /api/parents/children/{student_id}/exam-results/ | Child results |
| GET/POST | /api/parents/leave-requests/ | Leave requests |
| GET | /api/parents/messages/threads/ | Message threads |
| POST | /api/parents/messages/ | Send message (**POST only**) |
| POST | /api/parents/messages/{id}/read/ | Mark read |

### Parent Admin
| Method | URL | Description |
|--------|-----|-------------|
| GET | /api/parents/admin/parents/ | List parents |
| POST | /api/parents/admin/link-child/ | Link parent-child |
| DELETE | /api/parents/admin/unlink-child/{id}/ | Unlink |
| POST | /api/parents/admin/generate-invite/ | Generate invite |
| GET | /api/parents/admin/leave-requests/ | All leave requests |
| POST | /api/parents/admin/leave-requests/{id}/review/ | Review leave |

## Admissions
| Method | URL | Params |
|--------|-----|--------|
| GET/POST | /api/admissions/enquiries/ | status, search, class_applied |
| GET/PUT/DELETE | /api/admissions/enquiries/{id}/ | |
| POST | /api/admissions/enquiries/{id}/update-status/ | Body: {status} |
| POST | /api/admissions/enquiries/batch-convert/ | Body includes optional generate_fees (bool), fee_types (list of FeeType choices). When generate_fees=true, creates FeePayment records during conversion |
| GET/POST | /api/admissions/enquiries/{id}/notes/ | |
| GET | /api/admissions/followups/today/ | |
| GET | /api/admissions/followups/overdue/ | |

## LMS
| Method | URL | Description |
|--------|-----|-------------|
| GET/POST | /api/lms/lesson-plans/ | Lesson plans |
| GET | /api/lms/lesson-plans/by_class/ | Params: class_id |
| GET/POST | /api/lms/assignments/ | Assignments |
| POST | /api/lms/assignments/{id}/publish/ | Publish |
| POST | /api/lms/assignments/{id}/close/ | Close |
| GET | /api/lms/assignments/{id}/submissions/ | Submissions for assignment |
| GET/POST | /api/lms/submissions/ | All submissions |
| POST | /api/lms/submissions/{id}/grade/ | Grade submission |

## Transport
| Method | URL | Description |
|--------|-----|-------------|
| GET | /api/transport/dashboard/ | Dashboard stats (total_routes, total_vehicles, students_assigned, today_attendance) |
| GET/POST | /api/transport/routes/ | Routes |
| GET | /api/transport/routes/{id}/students/ | Route students |
| GET/POST | /api/transport/stops/ | Stops. Params: route (or route_id) |
| GET/POST | /api/transport/vehicles/ | Vehicles |
| GET/POST | /api/transport/assignments/ | Assignments |
| POST | /api/transport/assignments/bulk_assign/ | Bulk assign |
| GET/POST | /api/transport/attendance/ | Params: date, route |
| POST | /api/transport/attendance/bulk_mark/ | Bulk mark |
| POST | /api/transport/journey/start/ | Start journey |
| POST | /api/transport/journey/end/ | End journey |
| POST | /api/transport/journey/update/ | Location update |
| GET | /api/transport/journey/track/{student_id}/ | Track student |
| GET | /api/transport/journey/history/{student_id}/ | Journey history |
| GET | /api/transport/journey/active/ | Active journeys |

## Library
| Method | URL | Description |
|--------|-----|-------------|
| GET/PUT | /api/library/config/ | Library configuration |
| GET | /api/library/stats/ | Library statistics |
| GET/POST | /api/library/categories/ | Book categories |
| GET/POST | /api/library/books/ | Books. Params: category, search |
| GET | /api/library/books/search/ | Search books |
| POST | /api/library/books/{id}/issue/ | Issue book |
| GET/POST | /api/library/issues/ | Book issues |
| GET | /api/library/issues/overdue/ | Overdue books |
| POST | /api/library/issues/{id}/return_book/ | Return book |

## Hostel
| Method | URL | Description |
|--------|-----|-------------|
| GET | /api/hostel/dashboard/ | Occupancy dashboard |
| GET/POST | /api/hostel/hostels/ | Hostels |
| GET/POST | /api/hostel/rooms/ | Rooms. Params: hostel |
| GET/POST | /api/hostel/allocations/ | Allocations |
| POST | /api/hostel/allocations/{id}/vacate/ | Vacate room |
| GET/POST | /api/hostel/gate-passes/ | Gate passes. Params: status |
| POST | /api/hostel/gate-passes/{id}/approve/ | Approve |
| POST | /api/hostel/gate-passes/{id}/reject/ | Reject |
| POST | /api/hostel/gate-passes/{id}/checkout/ | Checkout |
| POST | /api/hostel/gate-passes/{id}/return/ | Return |

## Inventory
| Method | URL | Description |
|--------|-----|-------------|
| GET | /api/inventory/dashboard/ | Stock dashboard |
| GET/POST | /api/inventory/categories/ | Categories |
| GET/POST | /api/inventory/vendors/ | Vendors |
| GET/POST | /api/inventory/items/ | Items. Params: category |
| GET | /api/inventory/items/low_stock/ | Low stock items |
| GET/POST | /api/inventory/assignments/ | Assignments |
| GET | /api/inventory/assignments/by-user/{user_id}/ | By user |
| POST | /api/inventory/assignments/{id}/return/ | Return item |
| GET/POST | /api/inventory/transactions/ | Transactions. Params: item, transaction_type |

## Reports
| Method | URL | Description |
|--------|-----|-------------|
| POST | /api/reports/generate/ | Generate report |
| GET | /api/reports/list/ | Report list |
| GET | /api/reports/{report_id}/download/ | Download report |

**NOTE:** Reports endpoint is `/api/reports/list/` and `/api/reports/generate/`, NOT `/api/reports/`.

## Tasks
| Method | URL | Description |
|--------|-----|-------------|
| GET | /api/tasks/tasks/ | Background task list |
| GET | /api/tasks/tasks/{celery_task_id}/ | Task detail |
| GET | /api/tasks/ai-insights/ | Top 10 cross-module AI insights + generated_at timestamp |

**NOTE:** Tasks endpoint is nested: `/api/tasks/tasks/`, NOT `/api/tasks/`.

## Face Attendance
| Method | URL | Description |
|--------|-----|-------------|
| POST | /api/face-attendance/upload-image/ | Upload image to Supabase. Body: multipart/form-data with `image` field. Returns {url} |
| POST | /api/face-attendance/sessions/ | Create session. Body: {class_obj, date, image_url}. Dispatches Celery task, returns immediately |
| GET | /api/face-attendance/sessions/ | List sessions. Params: class_obj, date, status, page_size |
| GET | /api/face-attendance/sessions/{id}/ | Session detail with detections array and class_students |
| GET | /api/face-attendance/sessions/pending_review/ | Sessions with status=NEEDS_REVIEW (auto-recovers stuck PROCESSING sessions > 5 min) |
| POST | /api/face-attendance/sessions/{id}/confirm/ | Confirm attendance. Body: {present_student_ids, removed_detection_ids?, manual_additions?, corrections?}. Creates AttendanceRecords |
| POST | /api/face-attendance/sessions/{id}/reprocess/ | Re-run face pipeline on existing image |
| POST | /api/face-attendance/enroll/ | Enroll student face. Body: {student_id, image_url}. Dispatches async embedding generation |
| GET | /api/face-attendance/enrollments/ | List face embeddings. Params: class_id, student_id, page_size |
| DELETE | /api/face-attendance/enrollments/{id}/ | Soft-delete face embedding (sets is_active=False) |
| GET | /api/face-attendance/status/ | Face recognition availability, thresholds, enrollment count |

**NOTE:** Session IDs are UUIDs, not integers. Enrollment uses async Celery task — response returns task_id for tracking.
