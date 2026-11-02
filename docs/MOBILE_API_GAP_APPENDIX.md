# Mobile app and web API coverage

Generated 2026-11-02 by `python scripts/mobile_api_gap.py` (rerun it after each batch).
The web calls **768** distinct endpoints. The mobile app calls **485** of them (**283 not called**). Mobile-only endpoints (the web never calls them): **2**.

A call whose URL is a bare variable is not seen (none exist today, checked 2026-11-02); nested template strings are handled. This file is a reference; the plan is `MOBILE_CHANGE_LIST.md`.

## 1. Endpoints only the mobile app uses (goal: zero)

These are calls the web never makes. For each, the aim is to replace it with an endpoint the web already uses, unless the phone truly needs something new (push token, driver tracking).

| Endpoint | What it is for | Mobile file | Replace with |
|---|---|---|---|
| `DELETE /api/auth/unregister-push-token/` | Phone push notifications | services/api.ts | Cannot: the web has no push. Keep (signed off 2026-11-01). |
| `POST /api/auth/register-push-token/` | Phone push notifications | services/api.ts | Cannot: the web has no push. Keep (signed off 2026-11-01). |

## 2. Coverage by feature (plain words)

Each row groups related endpoints. "Used" is how many of the web's endpoints for that feature the mobile app also calls.

| Area | Feature | Used | Status | Note |
|---|---|---|---|---|
| Academic sessions | Academic calendar | 6 of 9 | Mostly used |  |
| Academic sessions | Academic years | 6 of 8 | Mostly used | Web only |
| Academic sessions | Enrollments and promotion | 1 of 15 | Partly used | Web only (promotion) |
| Academic sessions | Risk scores | 2 of 2 | Fully used |  |
| Academic sessions | Sections | 5 of 7 | Mostly used |  |
| Academic sessions | Session health | 0 of 2 | Not used | Version 2 |
| Academic sessions | Setup wizard | 0 of 1 | Not used | Web only |
| Academic sessions | Terms | 6 of 7 | Mostly used | Web only |
| Academics | AI analytics | 0 of 2 | Not used | Version 2 |
| Academics | AI assistant | 3 of 3 | Fully used |  |
| Academics | Class teachers | 5 of 6 | Mostly used |  |
| Academics | Periods and breaks | 4 of 6 | Mostly used |  |
| Academics | Subjects | 5 of 7 | Mostly used |  |
| Academics | Subjects of each class | 5 of 8 | Mostly used |  |
| Academics | Timetable | 10 of 12 | Mostly used |  |
| Admissions | Conversion likelihood | 1 of 1 | Fully used |  |
| Admissions | Enquiries | 9 of 10 | Mostly used |  |
| Admissions | Follow-ups | 2 of 2 | Fully used |  |
| Attendance | Anomalies | 2 of 3 | Mostly used |  |
| Attendance | Daily attendance and register | 7 of 13 | Partly used |  |
| Attendance | Face attendance | 11 of 16 | Mostly used | Capture and review built; devices and live feed are version 2 |
| Attendance | Photo register (OCR, parked) | 9 of 10 | Mostly used | Parked (OCR switched off) |
| Content | Assignments | 10 of 11 | Mostly used |  |
| Content | Curriculum | 22 of 30 | Mostly used |  |
| Content | Curriculum content blocks | 10 of 11 | Mostly used | Version 2 |
| Content | Lesson plans | 6 of 12 | Partly used |  |
| Dashboard | Admin dashboard | 1 of 1 | Fully used |  |
| Dashboard | Leadership insights | 1 of 1 | Fully used |  |
| Exams | Academic risk | 1 of 1 | Fully used |  |
| Exams | Exam groups and date sheets | 10 of 14 | Mostly used |  |
| Exams | Exam subjects | 1 of 4 | Partly used |  |
| Exams | Exam types | 4 of 4 | Fully used |  |
| Exams | Exams | 16 of 20 | Mostly used |  |
| Exams | Grade scale | 4 of 4 | Fully used |  |
| Exams | Marks entry | 2 of 6 | Partly used |  |
| Exams | Paper photo scan | 3 of 4 | Mostly used | Version 2 |
| Exams | Question bank | 8 of 11 | Mostly used |  |
| Exams | Question papers | 12 of 15 | Mostly used | Partly built; AI and Word export on the web |
| Exams | Report cards | 1 of 4 | Partly used |  |
| Exams | Skills and behaviour assessment | 3 of 5 | Mostly used |  |
| Exams | Student responses | 0 of 2 | Not used | Version 2 |
| Exams | Worksheets | 10 of 13 | Mostly used | Version 2 |
| Finance | AI assistant | 3 of 3 | Fully used |  |
| Finance | AI fee predictor | 0 of 1 | Not used | Web only |
| Finance | Accounts and ledger | 11 of 13 | Mostly used |  |
| Finance | Discounts and scholarships | 12 of 12 | Fully used |  |
| Finance | Expense and income categories | 8 of 8 | Fully used |  |
| Finance | Expenses | 5 of 5 | Fully used |  |
| Finance | Fee categories | 10 of 10 | Fully used |  |
| Finance | Fee collection | 11 of 16 | Mostly used |  |
| Finance | Fee setup | 3 of 6 | Partly used |  |
| Finance | Fees of one student | 0 of 2 | Not used |  |
| Finance | Financial reports | 1 of 1 | Fully used |  |
| Finance | Other income | 2 of 4 | Partly used |  |
| Finance | Transfers between accounts | 4 of 4 | Fully used |  |
| HR | Departments | 8 of 8 | Fully used |  |
| HR | Leave policies | 4 of 4 | Fully used |  |
| HR | Payroll and payslips | 8 of 10 | Mostly used |  |
| HR | Performance reviews | 4 of 5 | Mostly used |  |
| HR | Salary | 4 of 6 | Mostly used |  |
| HR | Staff attendance | 3 of 5 | Mostly used | Built (batch 1) |
| HR | Staff directory | 10 of 15 | Mostly used |  |
| HR | Staff documents | 8 of 8 | Fully used |  |
| HR | Staff leave | 6 of 6 | Fully used |  |
| HR | Staff risk | 1 of 1 | Fully used |  |
| Hostel | Gate passes | 5 of 6 | Mostly used |  |
| Hostel | Hostel overview | 1 of 1 | Fully used |  |
| Hostel | Hostels | 0 of 5 | Not used | Version 2 |
| Hostel | Room allocations | 0 of 3 | Not used | Version 2 |
| Hostel | Rooms | 0 of 5 | Not used | Version 2 |
| Inventory | AI suggestions | 0 of 1 | Not used |  |
| Inventory | Inventory overview | 1 of 1 | Fully used |  |
| Inventory | Items given to staff | 3 of 4 | Mostly used |  |
| Inventory | Items, categories, vendors | 7 of 15 | Partly used |  |
| Inventory | Reorder prediction | 1 of 1 | Fully used |  |
| Inventory | Stock movements | 2 of 2 | Fully used |  |
| Library | Book catalog | 1 of 9 | Partly used | Version 2 |
| Library | Issue and return | 1 of 4 | Partly used |  |
| Library | Library overview | 1 of 1 | Fully used |  |
| Library | Library settings | 0 of 2 | Not used | Version 2 |
| Messages | Staff messages | 6 of 7 | Mostly used |  |
| Notifications | AI assistant | 1 of 1 | Fully used |  |
| Notifications | Automatic notification settings | 0 of 3 | Not used | Web only |
| Notifications | Delivery analytics | 0 of 1 | Not used | Version 2 |
| Notifications | Digest | 0 of 1 | Not used | Version 2 |
| Notifications | History | 1 of 1 | Fully used |  |
| Notifications | My inbox | 4 of 5 | Mostly used |  |
| Notifications | Preferences | 0 of 3 | Not used | No web screen either |
| Notifications | Send to a group | 2 of 2 | Fully used |  |
| Notifications | Send to one person | 1 of 1 | Fully used |  |
| Notifications | Templates | 1 of 5 | Partly used | Web only (management) |
| Other | Background tasks | 1 of 6 | Partly used | Internal |
| Other | User guide progress | 0 of 7 | Not used | Web only |
| Parents | Parent admin tools | 3 of 6 | Partly used | Web only |
| Parents | Parent sign-up | 1 of 1 | Fully used |  |
| Parents | Parent: leave requests | 3 of 3 | Fully used |  |
| Parents | Parent: messages (old) | 0 of 4 | Not used | Replaced by staff messages |
| Parents | Parent: my children | 9 of 11 | Mostly used |  |
| Reports | Letters | 7 of 9 | Mostly used | Built (letter composer) |
| Reports | Report PDFs | 1 of 4 | Partly used | Partly: finance and student reports built |
| School settings | Attendance settings | 1 of 6 | Partly used | Web only |
| School settings | Exam settings | 1 of 2 | Partly used |  |
| School settings | School logo and letterhead | 2 of 2 | Fully used |  |
| School settings | School lookup | 1 of 1 | Fully used |  |
| School settings | School profile | 2 of 2 | Fully used |  |
| School settings | Setup completion | 0 of 1 | Not used | Version 2 |
| Settings | Users and roles | 4 of 8 | Partly used |  |
| Sign in | Change password | 1 of 1 | Fully used |  |
| Sign in | Forgot password | 1 of 3 | Partly used |  |
| Sign in | Login | 1 of 1 | Fully used |  |
| Sign in | My profile | 4 of 4 | Fully used |  |
| Sign in | Switch school | 1 of 1 | Fully used |  |
| Students | Bulk import and accounts | 0 of 2 | Not used | Web only |
| Students | Classes | 5 of 5 | Fully used |  |
| Students | Leaving and re-admission | 0 of 13 | Not used | Web only (checklist) |
| Students | Remove and restore | 1 of 1 | Fully used |  |
| Students | Student list and form | 3 of 3 | Fully used |  |
| Students | Student portal (own view) | 15 of 15 | Fully used |  |
| Students | Student profile and actions | 17 of 22 | Mostly used |  |
| Super admin | Activity log | 0 of 1 | Not used | Not for mobile |
| Super admin | Brochure | 0 of 6 | Not used | Not for mobile |
| Super admin | Memberships | 0 of 4 | Not used | Not for mobile |
| Super admin | Organizations | 0 of 4 | Not used | Not for mobile |
| Super admin | Schools | 0 of 12 | Not used | Not for mobile (super admin) |
| Transport | Boarding attendance | 0 of 3 | Not used |  |
| Transport | Bus journey tracking | 6 of 6 | Fully used |  |
| Transport | Routes and stops | 2 of 10 | Partly used | Version 2 |
| Transport | Student transport | 0 of 5 | Not used | Version 2 |
| Transport | Transport overview | 1 of 1 | Fully used |  |
| Transport | Vehicles | 2 of 6 | Partly used | Version 2 |

## 3. Web endpoints the mobile app does not call

### Academic sessions: Academic calendar (3)

- `GET /api/sessions/calendar-entries/coverage/`
- `GET /api/sessions/calendar-entries/holiday-suggestions/`
- `GET /api/sessions/calendar-entries/planning/`

### Academic sessions: Academic years (2)

- `GET /api/sessions/academic-years/current/`
- `GET /api/sessions/academic-years/{}/`

### Academic sessions: Enrollments and promotion (14)

- `DELETE /api/sessions/enrollments/{}/`
- `GET /api/sessions/enrollments/by_class/`
- `GET /api/sessions/enrollments/promotion-history-pairs/`
- `GET /api/sessions/enrollments/promotion-history/`
- `PATCH /api/sessions/enrollments/{}/`
- `POST /api/sessions/enrollments/`
- `POST /api/sessions/enrollments/bulk_promote/`
- `POST /api/sessions/enrollments/bulk_reverse_promote/`
- `POST /api/sessions/enrollments/correct-bulk/`
- `POST /api/sessions/enrollments/correct-single/`
- `POST /api/sessions/enrollments/promotion-targets-apply/`
- `POST /api/sessions/enrollments/promotion-targets-preview/`
- `POST /api/sessions/promotion-advisor/`
- `POST /api/sessions/section-allocator/`

### Academic sessions: Sections (2)

- `POST /api/sessions/session-classes/{}/assign-unassigned/`
- `POST /api/sessions/session-classes/{}/renumber/`

### Academic sessions: Session health (2)

- `GET /api/sessions/health/`
- `GET /api/sessions/health/ai-summary/`

### Academic sessions: Setup wizard (1)

- `POST /api/sessions/setup-wizard/`

### Academic sessions: Terms (1)

- `GET /api/sessions/terms/{}/`

### Academics: AI analytics (2)

- `GET /api/academics/analytics/`
- `PATCH /api/academics/analytics/`

### Academics: Class teachers (1)

- `PATCH /api/academics/class-teachers/{}/`

### Academics: Periods and breaks (2)

- `POST /api/academics/timetable-slots/bulk_create_slots/`
- `POST /api/academics/timetable-slots/suggest_slots/`

### Academics: Subjects (2)

- `GET /api/academics/subjects/gap_analysis/`
- `GET /api/academics/subjects/{}/`

### Academics: Subjects of each class (3)

- `GET /api/academics/class-subjects/by_class/`
- `GET /api/academics/class-subjects/workload_analysis/`
- `POST /api/academics/class-subjects/bulk-assign/`

### Academics: Timetable (2)

- `GET /api/academics/timetable-entries/`
- `POST /api/academics/timetable-entries/auto_generate/`

### Admissions: Enquiries (1)

- `GET /api/admissions/enquiries/{}/notes/`

### Attendance: Anomalies (1)

- `GET /api/attendance/anomalies/{}/`

### Attendance: Daily attendance and register (6)

- `GET /api/attendance/records/accuracy_stats/`
- `GET /api/attendance/records/drift_history/`
- `GET /api/attendance/records/mapping_suggestions/`
- `GET /api/attendance/records/monthly_bulk/`
- `GET /api/attendance/records/threshold_status/`
- `POST /api/attendance/records/tune_thresholds/`

### Attendance: Face attendance (5)

- `GET /api/face-attendance/devices/`
- `GET /api/face-attendance/live/events/`
- `PATCH /api/face-attendance/devices/{}/`
- `POST /api/face-attendance/live/events/{}/feedback/`
- `POST /api/face-attendance/live/match/`

### Attendance: Photo register (OCR, parked) (1)

- `GET /api/attendance/uploads/{}/test_image/`

### Content: Assignments (1)

- `GET /api/lms/submissions/{}/`

### Content: Curriculum (8)

- `DELETE /api/lms/subtopics/{}/`
- `GET /api/lms/books/{}/`
- `GET /api/lms/chapters/`
- `GET /api/lms/subtopics/`
- `GET /api/lms/topics/{}/objectives/`
- `GET /api/lms/topics/{}/standards/`
- `POST /api/lms/books/{}/bulk_toc/`
- `POST /api/lms/subtopics/`

### Content: Curriculum content blocks (1)

- `GET /api/lms/content-blocks/{}/`

### Content: Lesson plans (6)

- `GET /api/lms/lesson-plans/my_classes/`
- `GET /api/lms/lesson-plans/{}/`
- `POST /api/lms/lesson-plans/bulk_delete/`
- `POST /api/lms/lesson-plans/bulk_publish/`
- `POST /api/lms/lesson-plans/{}/link_objectives/`
- `POST /api/lms/lesson-plans/{}/publish/`

### Exams: Exam groups and date sheets (4)

- `DELETE /api/examinations/exam-groups/{}/`
- `GET /api/examinations/exam-groups/{}/download-date-sheet/`
- `PATCH /api/examinations/exam-groups/{}/`
- `POST /api/examinations/exam-groups/bulk_delete/`

### Exams: Exam subjects (3)

- `DELETE /api/examinations/exam-subjects/{}/`
- `PATCH /api/examinations/exam-subjects/{}/`
- `POST /api/examinations/exam-subjects/`

### Exams: Exams (4)

- `GET /api/examinations/exams/{}/`
- `POST /api/examinations/exams/bulk-test-apply/`
- `POST /api/examinations/exams/bulk-test-preview/`
- `POST /api/examinations/exams/bulk_delete/`

### Exams: Marks entry (4)

- `GET /api/examinations/marks/by_student/`
- `GET /api/examinations/marks/download_template/`
- `PATCH /api/examinations/marks/{}/`
- `POST /api/examinations/marks/`

### Exams: Paper photo scan (1)

- `GET /api/examinations/paper-uploads/`

### Exams: Question bank (3)

- `GET /api/examinations/questions/by_lesson_plan/`
- `GET /api/examinations/questions/{}/`
- `POST /api/examinations/questions/generate_from_lesson/`

### Exams: Question papers (3)

- `GET /api/examinations/paper-feedback/`
- `POST /api/examinations/exam-papers/create_from_lessons/`
- `POST /api/examinations/exam-papers/review-questions/`

### Exams: Report cards (3)

- `GET /api/examinations/report-card/meta/bulk/`
- `POST /api/examinations/report-card/meta/`
- `POST /api/examinations/report-card/meta/bulk/`

### Exams: Skills and behaviour assessment (2)

- `GET /api/examinations/student-term-assessment/`
- `POST /api/examinations/student-term-assessment/`

### Exams: Student responses (2)

- `GET /api/examinations/student-responses/`
- `POST /api/examinations/student-responses/`

### Exams: Worksheets (3)

- `GET /api/examinations/worksheet-uploads/`
- `PATCH /api/examinations/worksheets/{}/`
- `POST /api/examinations/worksheet-uploads/{}/confirm/`

### Finance: AI fee predictor (1)

- `GET /api/finance/fee-predictor/`

### Finance: Accounts and ledger (2)

- `DELETE /api/finance/accounts/{}/reopen/`
- `GET /api/finance/accounts/balances_all/`

### Finance: Fee collection (5)

- `GET /api/finance/fee-payments/monthly_summary_all/`
- `GET /api/finance/fee-payments/resolve_amount/`
- `POST /api/finance/fee-payments/bulk_delete/`
- `POST /api/finance/fee-payments/bulk_update/`
- `POST /api/finance/fee-payments/generate_onetime_fees/`

### Finance: Fee setup (3)

- `DELETE /api/finance/fee-structures/{}/`
- `PATCH /api/finance/fee-structures/{}/`
- `POST /api/finance/fee-structures/`

### Finance: Fees of one student (2)

- `GET /api/finance/fee-breakdown/{}/`
- `GET /api/finance/siblings/{}/`

### Finance: Other income (2)

- `DELETE /api/finance/other-income/{}/`
- `PATCH /api/finance/other-income/{}/`

### HR: Payroll and payslips (2)

- `GET /api/hr/payslips/{}/`
- `POST /api/hr/payslips/bulk_delete/`

### HR: Performance reviews (1)

- `GET /api/hr/appraisals/{}/`

### HR: Salary (2)

- `GET /api/hr/salary-structures/current/`
- `GET /api/hr/salary-structures/{}/`

### HR: Staff attendance (2)

- `PATCH /api/hr/attendance/{}/`
- `POST /api/hr/attendance/`

### HR: Staff directory (5)

- `POST /api/hr/staff/bulk-create-accounts/`
- `POST /api/hr/staff/{}/create-user-account/`
- `POST /api/hr/staff/{}/link-user-account/`
- `POST /api/hr/staff/{}/unlink-user-account/`
- `POST /api/hr/staff/{}/update-user-role/`

### Hostel: Gate passes (1)

- `POST /api/hostel/gate-passes/`

### Hostel: Hostels (5)

- `DELETE /api/hostel/hostels/{}/`
- `GET /api/hostel/hostels/`
- `GET /api/hostel/hostels/{}/`
- `PATCH /api/hostel/hostels/{}/`
- `POST /api/hostel/hostels/`

### Hostel: Room allocations (3)

- `GET /api/hostel/allocations/`
- `PATCH /api/hostel/allocations/{}/vacate/`
- `POST /api/hostel/allocations/`

### Hostel: Rooms (5)

- `DELETE /api/hostel/rooms/{}/`
- `GET /api/hostel/rooms/`
- `GET /api/hostel/rooms/{}/`
- `PATCH /api/hostel/rooms/{}/`
- `POST /api/hostel/rooms/`

### Inventory: AI suggestions (1)

- `POST /api/inventory/ai-suggest/`

### Inventory: Items given to staff (1)

- `GET /api/inventory/assignments/{}/`

### Inventory: Items, categories, vendors (8)

- `DELETE /api/inventory/categories/{}/`
- `DELETE /api/inventory/items/{}/`
- `DELETE /api/inventory/vendors/{}/`
- `GET /api/inventory/items/low_stock/`
- `GET /api/inventory/items/{}/`
- `GET /api/inventory/vendors/{}/`
- `PATCH /api/inventory/categories/{}/`
- `PATCH /api/inventory/vendors/{}/`

### Library: Book catalog (8)

- `DELETE /api/library/books/{}/`
- `DELETE /api/library/categories/{}/`
- `GET /api/library/books/{}/`
- `GET /api/library/categories/`
- `PATCH /api/library/books/{}/`
- `PATCH /api/library/categories/{}/`
- `POST /api/library/books/`
- `POST /api/library/categories/`

### Library: Issue and return (3)

- `GET /api/library/issues/`
- `GET /api/library/issues/overdue/`
- `POST /api/library/issues/{}/return_book/`

### Library: Library settings (2)

- `GET /api/library/config/`
- `PATCH /api/library/config/`

### Messages: Staff messages (1)

- `PATCH /api/messaging/threads/{}/read/`

### Notifications: Automatic notification settings (3)

- `GET /api/notifications/config/`
- `POST /api/notifications/run/`
- `PUT /api/notifications/config/`

### Notifications: Delivery analytics (1)

- `GET /api/notifications/analytics/`

### Notifications: Digest (1)

- `GET /api/notifications/digest/`

### Notifications: My inbox (1)

- `POST /api/notifications/mark-read-bulk/`

### Notifications: Preferences (3)

- `GET /api/notifications/preferences/`
- `PATCH /api/notifications/preferences/{}/`
- `POST /api/notifications/preferences/`

### Notifications: Templates (4)

- `DELETE /api/notifications/templates/{}/`
- `GET /api/notifications/templates/{}/`
- `PATCH /api/notifications/templates/{}/`
- `POST /api/notifications/templates/`

### Other: Background tasks (5)

- `GET /api/tasks/ai-jobs/`
- `GET /api/tasks/tasks/`
- `GET /api/tasks/tasks/{}/`
- `PATCH /api/tasks/ai-jobs/{}/`
- `POST /api/tasks/tasks/{}/cancel/`

### Other: User guide progress (7)

- `GET /api/guide/progress/mine/`
- `GET /api/guide/progress/overview/`
- `GET /api/guide/progress/overview/export/`
- `GET /api/guide/progress/user/{}/`
- `POST /api/guide/progress/step/`
- `POST /api/guide/progress/sync/`
- `POST /api/guide/progress/video/`

### Parents: Parent admin tools (3)

- `DELETE /api/parents/admin/unlink-child/{}/`
- `GET /api/parents/admin/parents/`
- `POST /api/parents/admin/link-child/`

### Parents: Parent: messages (old) (4)

- `GET /api/parents/messages/threads/`
- `GET /api/parents/messages/threads/{}/`
- `PATCH /api/parents/messages/{}/read/`
- `POST /api/parents/messages/`

### Parents: Parent: my children (2)

- `GET /api/parents/children/{}/pay-fee/`
- `POST /api/parents/children/{}/pay-fee/`

### Reports: Letters (2)

- `GET /api/reports/custom-letters/{}/`
- `POST /api/reports/custom-letters/ai-draft/`

### Reports: Report PDFs (3)

- `GET /api/reports/list/`
- `GET /api/reports/{}/download/`
- `POST /api/reports/generate/`

### School settings: Attendance settings (5)

- `GET /api/schools/attendance_config/`
- `GET /api/schools/mark_mappings/`
- `GET /api/schools/register_config/`
- `PUT /api/schools/mark_mappings/`
- `PUT /api/schools/register_config/`

### School settings: Exam settings (1)

- `GET /api/schools/exam_config/`

### School settings: Setup completion (1)

- `GET /api/schools/completion/`

### Settings: Users and roles (4)

- `DELETE /api/users/{}/`
- `GET /api/users/{}/`
- `POST /api/users/{}/remove_photo/`
- `POST /api/users/{}/upload_photo/`

### Sign in: Forgot password (2)

- `POST /api/auth/password-reset/confirm/`
- `POST /api/auth/password-reset/validate-token/`

### Students: Bulk import and accounts (2)

- `POST /api/students/bulk-create-accounts/`
- `POST /api/students/bulk_create/`

### Students: Leaving and re-admission (13)

- `GET /api/student-exits/`
- `GET /api/student-exits/destination-classes/`
- `GET /api/student-exits/destinations/`
- `GET /api/student-exits/{}/`
- `PATCH /api/student-exits/{}/`
- `POST /api/student-exits/`
- `POST /api/student-exits/readmit/`
- `POST /api/student-exits/{}/cancel/`
- `POST /api/student-exits/{}/finalize/`
- `POST /api/student-exits/{}/items/{}/carry/`
- `POST /api/student-exits/{}/items/{}/unwaive/`
- `POST /api/student-exits/{}/items/{}/waive/`
- `POST /api/student-exits/{}/refresh/`

### Students: Student profile and actions (5)

- `GET /api/students/{}/ai-profile/`
- `GET /api/students/{}/earlier_assessments/`
- `POST /api/students/{}/create-user-account/`
- `POST /api/students/{}/documents/`
- `POST /api/students/{}/purge/`

### Super admin: Activity log (1)

- `GET /api/admin/activity-log/`

### Super admin: Brochure (6)

- `GET /api/admin/brochure/download-pdf/`
- `GET /api/admin/brochure/preview/`
- `GET /api/admin/brochure/sections/`
- `GET /api/admin/brochure/sections/{}/`
- `PATCH /api/admin/brochure/sections/{}/`
- `POST /api/admin/brochure/sections/reorder/`

### Super admin: Memberships (4)

- `DELETE /api/admin/memberships/{}/`
- `GET /api/admin/memberships/`
- `PATCH /api/admin/memberships/{}/`
- `POST /api/admin/memberships/`

### Super admin: Organizations (4)

- `DELETE /api/admin/organizations/{}/`
- `GET /api/admin/organizations/`
- `PATCH /api/admin/organizations/{}/`
- `POST /api/admin/organizations/`

### Super admin: Schools (12)

- `GET /api/admin/schools/`
- `GET /api/admin/schools/bundles/`
- `GET /api/admin/schools/demo_insights/`
- `GET /api/admin/schools/platform_stats/`
- `GET /api/admin/schools/{}/stats/`
- `PATCH /api/admin/schools/{}/`
- `POST /api/admin/schools/`
- `POST /api/admin/schools/bulk_reassign_org/`
- `POST /api/admin/schools/bulk_toggle/`
- `POST /api/admin/schools/{}/activate/`
- `POST /api/admin/schools/{}/apply_bundle/`
- `POST /api/admin/schools/{}/deactivate/`

### Transport: Boarding attendance (3)

- `GET /api/transport/attendance/`
- `POST /api/transport/attendance/`
- `POST /api/transport/attendance/bulk_mark/`

### Transport: Routes and stops (8)

- `DELETE /api/transport/routes/{}/`
- `DELETE /api/transport/stops/{}/`
- `GET /api/transport/routes/{}/`
- `PATCH /api/transport/routes/{}/`
- `PATCH /api/transport/stops/{}/`
- `POST /api/transport/routes/`
- `POST /api/transport/routes/{}/duplicate/`
- `POST /api/transport/stops/`

### Transport: Student transport (5)

- `DELETE /api/transport/assignments/{}/`
- `GET /api/transport/assignments/`
- `PATCH /api/transport/assignments/{}/`
- `POST /api/transport/assignments/`
- `POST /api/transport/assignments/bulk_assign/`

### Transport: Vehicles (4)

- `DELETE /api/transport/vehicles/{}/`
- `GET /api/transport/vehicles/{}/`
- `PATCH /api/transport/vehicles/{}/`
- `POST /api/transport/vehicles/`
