# Frontend Pages Reference

Framework: React 18.3 + Vite 6 + React Router 7 (NOT Next.js)
All pages lazy-loaded via React.lazy() with Suspense fallback.

## Route Protection
- **ProtectedRoute** — Requires authentication
- **SchoolRoute** — Requires school context
- **ModuleRoute** — Requires module enabled in school
- **StudentRoute** — Student role only
- **ParentRoute** — Parent role only

## Root Redirect
`/` → RootRedirect: SUPER_ADMIN→/admin, PARENT→/parent/dashboard, STUDENT→/student/dashboard, others→/dashboard

---

## Authentication
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /login | LoginPage.jsx | Login form | POST /api/auth/login/ |
| /register | RegisterPage.jsx | User registration | POST /api/auth/register/ |

## Main Dashboard & Core

The `/dashboard` route uses **DashboardRouter.jsx** to render a role-specific dashboard:

| Role | Component | Description |
|------|-----------|-------------|
| SCHOOL_ADMIN | DashboardPage.jsx | Admin dashboard with attendance stats, finance overview, SchoolCompletionWidget, AIInsightsCard |
| PRINCIPAL | DashboardPage.jsx (variant="principal") | Same as admin but quick actions show Lesson Plans, Examinations, Class Management |
| TEACHER | TeacherDashboard.jsx | Daily command center: today's timetable, grading queue, assignments, quick actions |
| HR_MANAGER | HRManagerDashboard.jsx | HR KPIs (staff count, leave, attendance), quick links to /hr |
| ACCOUNTANT | AccountantDashboard.jsx | Finance KPIs (balances, fees, collection rate), quick links to /finance |
| STAFF | StaffDashboard.jsx | Minimal: notifications + conditional quick links (profile, library, inventory) |

| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /dashboard | DashboardRouter.jsx → role-specific | See above | Varies by role |
| /profile | ProfilePage.jsx | User profile edit | GET/PATCH /api/auth/me/ |
| /settings | SettingsPage.jsx | School settings | GET/PUT /api/schools/current/ |
| /notifications | NotificationsPage.jsx | Notification center. Settings include Smart Notification Scheduling toggle | GET /api/notifications/my/, GET/PUT /api/notifications/config/ |
| /admin | SuperAdminDashboard.jsx | Super admin only — all schools overview | GET /api/admin/schools/, platform_stats/ |

## Attendance
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /attendance | CaptureReviewPage.jsx | Upload images & review pending | POST upload-image/, GET/POST uploads/, POST confirm/ |
| /attendance/register | RegisterPage.jsx | Attendance records, analytics & manual entry | GET records/, daily_report/, my_classes/, POST bulk_entry/ |
| /attendance/review/:id | CaptureReviewPage.jsx | Review specific upload. Includes AI Threshold Config, Pipeline Config, and Drift Monitor cards in accuracy dashboard | GET uploads/{id}/, POST confirm/, GET threshold_status/, GET drift_history/ |
| /attendance/anomalies | AnomaliesPage.jsx | Attendance anomaly detection - bulk absence, student streaks, unusual days. Filterable, resolvable | GET anomalies/, POST anomalies/{id}/resolve/ |

Redirects: /attendance/upload, /attendance/review, /attendance/records → remapped to above routes

## Students & Classes
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /students | StudentsPage.jsx | Student list with search, filter, bulk ops | GET/POST /api/students/ |
| /students/:id | StudentProfilePage.jsx | Student detail (tabs: profile, attendance, fees, exams, docs) | GET students/{id}/, profile_summary/, attendance_history/ |
| /classes | ClassesGradesPage.jsx | Class management | GET/POST /api/classes/ |

## Academics
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /academics/subjects | SubjectsPage.jsx | Subject CRUD | GET/POST subjects/ |
| /academics/timetable | TimetablePage.jsx | Timetable grid editor. Auto-generate supports algorithm selector (Greedy/OR-Tools) | GET/POST timetable-entries/, POST auto_generate/ with {algorithm} |
| /academics/analytics | AcademicsAnalyticsPage.jsx | Academic analytics | GET analytics/ |
| /academics/exam-types | ExamTypesPage.jsx | Exam type config | GET/POST exam-types/ |
| /academics/exams | ExamsPage.jsx | Exam management | GET/POST exams/ |
| /academics/marks-entry | MarksEntryPage.jsx | Marks data entry | GET exams/, exam-subjects/, marks/, students/; POST marks/bulk_entry/ |
| /academics/results | ResultsPage.jsx | Results view with expandable AI report card comments. Generate/Regenerate AI Comments button | GET exams/{id}/results/, POST exams/{id}/generate-comments/ |
| /academics/report-cards | ReportCardPage.jsx | Report cards | GET report-card/ |
| /academics/grade-scale | GradeScalePage.jsx | Grade scale config | GET/POST grade-scales/ |
| /academics/lesson-plans | LessonPlansPage.jsx | Lesson plans | GET/POST lesson-plans/ |
| /academics/assignments | AssignmentsPage.jsx | Assignments | GET/POST assignments/ |
| /academics/assignments/:id/submissions | SubmissionReviewPage.jsx | Review submissions | GET submissions/ |
| /academics/sessions | AcademicYearsPage.jsx | Academic year/term management | GET/POST academic-years/, terms/ |
| /academics/promotion | PromotionPage.jsx | Student promotion | GET promotion-advisor/, POST bulk_promote/ |

## Finance
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /finance | FinanceDashboardPage.jsx | Finance overview | GET balances/, monthly_summary/ |
| /finance/fees | FeeCollectionPage.jsx | Fee collection (complex, sub-components). Client-side class/status filtering, client-side summary. Bulk "Pay Full" sets each student's paid = total payable. | GET fee-payments/ (single fetch), fee-structures/, resolve_amount/, preview_generation/, PATCH bulk_update/ (mode=pay_full) |
| /finance/expenses | ExpensesPage.jsx | Expense tracking | GET/POST expenses/ |
| /finance/discounts | DiscountsPage.jsx | Discounts & scholarships | GET/POST discounts/, scholarships/ |
| /finance/payment-gateways | PaymentGatewayPage.jsx | Payment gateway config | GET/POST gateway-config/ |
| /finance-ai | FinanceAIPage.jsx | Finance AI chat | POST ai-chat/ |
| /accounts | AccountsPage.jsx | Account management | GET/POST accounts/ |
| /reports | FinancialReportsPage.jsx | Report generation | POST /api/reports/generate/ |

## HR
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /hr | HRDashboardPage.jsx | HR overview | GET dashboard_stats/ |
| /hr/staff | StaffDirectoryPage.jsx | Staff list | GET staff/ |
| /hr/staff/new | StaffFormPage.jsx | Create staff | POST staff/ |
| /hr/staff/:id/edit | StaffFormPage.jsx | Edit staff | PUT staff/{id}/ |
| /hr/departments | DepartmentsPage.jsx | Departments & designations | GET/POST departments/, designations/ |
| /hr/salary | SalaryManagementPage.jsx | Salary structures | GET/POST salary-structures/ |
| /hr/payroll | PayrollPage.jsx | Payslip generation, PDF download, delete | GET/POST/DELETE payslips/, download-pdf/ |
| /hr/leave | LeaveManagementPage.jsx | Leave policies & applications | GET/POST leave-policies/, leave-applications/ |
| /hr/attendance | StaffAttendancePage.jsx | Staff attendance | GET/POST attendance/ |
| /hr/appraisals | PerformanceAppraisalPage.jsx | Performance reviews | GET/POST appraisals/ |
| /hr/documents | StaffDocumentsPage.jsx | Staff documents | GET/POST documents/ |

## Sessions
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /sessions/academic-years | AcademicYearsPage.jsx | Same as /academics/sessions | |
| /sessions/promotion | PromotionPage.jsx | Same as /academics/promotion | |
| /sessions/section-allocator | SectionAllocator.jsx | Auto-allocate sections | POST section-allocator/ |
| /sessions/setup-wizard | SessionSetupWizard.jsx | New session setup | POST setup-wizard/ |

## Admissions
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /admissions | EnquiriesPage.jsx | Enquiry list with status pipeline | GET enquiries/ |
| /admissions/new | EnquiryForm.jsx | New enquiry | POST enquiries/ |
| /admissions/:id/edit | EnquiryForm.jsx | Edit enquiry | PUT enquiries/{id}/ |

## Hostel
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /hostel | HostelDashboard.jsx | Hostel overview | GET dashboard/ |
| /hostel/rooms | HostelRoomsPage.jsx | Room management | GET/POST rooms/ |
| /hostel/allocations | HostelAllocationsPage.jsx | Student allocation | GET/POST allocations/ |
| /hostel/gate-passes | GatePassesPage.jsx | Gate pass workflow | GET/POST gate-passes/ |

## Transport
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /transport | TransportDashboard.jsx | Transport overview | GET routes/ |
| /transport/routes | RoutesPage.jsx | Route management | GET/POST routes/ |
| /transport/vehicles | VehiclesPage.jsx | Vehicle management | GET/POST vehicles/ |
| /transport/assignments | TransportAssignmentsPage.jsx | Student-route assignment | GET/POST assignments/ |
| /transport/attendance | TransportAttendancePage.jsx | Transport attendance | GET/POST attendance/ |

## Library
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /library | LibraryDashboard.jsx | Library overview | GET stats/ |
| /library/catalog | BookCatalogPage.jsx | Book management | GET/POST books/ |
| /library/issues | BookIssuePage.jsx | Issue/return books | GET/POST issues/ |
| /library/overdue | OverdueBooksPage.jsx | Overdue books | GET issues/overdue/ |

## Inventory
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /inventory | InventoryDashboard.jsx | Stock overview | GET dashboard/ |
| /inventory/items | InventoryItemsPage.jsx | Item management | GET/POST items/ |
| /inventory/transactions | StockTransactionsPage.jsx | Stock transactions | GET/POST transactions/ |
| /inventory/assignments | ItemAssignmentsPage.jsx | Item assignments | GET/POST assignments/ |

## Parent Portal
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /parent/dashboard | ParentDashboard.jsx | Parent home | GET my-children/ |
| /parent/children/:studentId | ChildOverview.jsx | Child detail | GET children/{id}/overview/ |
| /parent/children/:studentId/attendance | ChildAttendance.jsx | | GET children/{id}/attendance/ |
| /parent/children/:studentId/fees | ChildFees.jsx | | GET children/{id}/fees/ |
| /parent/children/:studentId/timetable | ChildTimetable.jsx | | GET children/{id}/timetable/ |
| /parent/children/:studentId/results | ChildExamResults.jsx | | GET children/{id}/exam-results/ |
| /parent/leave | LeaveApplication.jsx | Submit leave | POST leave-requests/ |
| /parent/messages | ParentMessages.jsx | Message teacher | GET messages/threads/ |
| /parent/payment-result | PaymentResultPage.jsx | Payment confirmation | |

## Student Portal
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /student/dashboard | StudentDashboard.jsx | Student home | GET portal/dashboard/ |
| /student/attendance | StudentAttendance.jsx | View attendance | GET portal/attendance/ |
| /student/fees | StudentFees.jsx | View fees | GET portal/fees/ |
| /student/timetable | StudentTimetable.jsx | View timetable | GET portal/timetable/ |
| /student/results | StudentResults.jsx | View results | GET portal/results/ |
| /student/assignments | StudentAssignments.jsx | View assignments | GET portal/assignments/ |
| /student/profile | StudentProfileView.jsx | View profile | |
| /student/study-helper | StudentStudyHelper.jsx | AI study assistant | POST portal/study-helper/ |
