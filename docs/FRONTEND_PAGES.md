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
| SCHOOL_ADMIN | DashboardPage.jsx | Module-aware command center: 4 KPI cards (Students, Attendance, Fees, Staff), AI Insights with module badges, Module Health Grid (10 modules), Attendance bar, Finance snapshot, Session Health, Attendance Risk, Quick Actions, NotificationsFeed. All sections module-gated |
| PRINCIPAL | DashboardPage.jsx (variant="principal") | Same as admin but quick actions show Lesson Plans, Examinations, Class Management |
| TEACHER | TeacherDashboard.jsx | 4 KPIs (Classes Today with "Now" indicator, Attendance to Mark, Pending Grading, Upcoming Exams), timetable with current period highlighting, Exams & Marks Entry, Lesson Plans progress bar, Quick Actions, NotificationsFeed |
| HR_MANAGER | HRManagerDashboard.jsx | 6 KPIs (2 rows), department breakdown bars, pending leave with inline approve/reject, top absentees, payroll overview, Quick Actions, NotificationsFeed |
| ACCOUNTANT | AccountantDashboard.jsx | 4 KPIs, fee collection by class (color-coded), recent transactions, overdue fees, income vs expense bars, per-account balances, Quick Actions, NotificationsFeed |
| STAFF | StaffDashboard.jsx | 4 KPIs (Attendance, Leave, Salary, Notifications), mini attendance calendar, leave balance breakdown, recent payslips, assigned inventory, NotificationsFeed |

| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /dashboard | DashboardRouter.jsx → role-specific | See above | Varies by role |
| /profile | ProfilePage.jsx | User profile edit | GET/PATCH /api/auth/me/ |
| /settings | SettingsPage.jsx | Tabs: School Profile (logo/letterhead upload, exam weighted average toggle), Users | GET /api/schools/current/, POST upload_asset/, DELETE delete_asset/, PUT /api/schools/exam_config/, GET/POST /api/users/ |
| /notifications | NotificationsPage.jsx | Notification center with 5 tabs (URL-persisted via `?tab=`): **Inbox** (paginated, mark-read, mark-all-read with confirmation, event_type filter, relative timestamps), **Templates** (CRUD with search, pagination, delete confirmation, all 9 event types + 5 channels including PUSH), **Send** (dual-mode: Broadcast to role group via `/broadcast/` or Single recipient via `/send/`, template picker, SMS/WhatsApp character counter), **Analytics** (date range filter: 7d/30d/90d/all, human-readable channel labels), **Settings** (module-gated toggles — hides toggles for disabled modules via `isModuleEnabled()`, 6 trigger toggles: absence, fee reminder, fee overdue, exam results, daily summary, transport notifications, unsaved changes warning with beforeunload) | GET /api/notifications/my/, POST /api/notifications/broadcast/, POST /api/notifications/send/, GET /api/notifications/analytics/, GET/PUT /api/notifications/config/ |
| /admin | SuperAdminDashboard.jsx | Super admin only — all schools overview | GET /api/admin/schools/, platform_stats/ |

## Attendance
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /attendance | CaptureReviewPage.jsx | Upload images & review pending. Class dropdown is role-aware (teachers see assigned classes only via my_classes/) | POST upload-image/, GET/POST uploads/, POST confirm/, GET my_classes/ |
| /attendance/register | RegisterPage.jsx | Attendance records, analytics & manual entry | GET records/, daily_report/, my_classes/, POST bulk_entry/ |
| /attendance/review/:id | CaptureReviewPage.jsx | Review specific upload. Includes AI Threshold Config, Pipeline Config, and Drift Monitor cards in accuracy dashboard | GET uploads/{id}/, POST confirm/, GET threshold_status/, GET drift_history/ |
| /attendance/anomalies | AnomaliesPage.jsx | Attendance anomaly detection - bulk absence, student streaks, unusual days. Filterable, resolvable | GET anomalies/, POST anomalies/{id}/resolve/ |

Redirects: /attendance/upload, /attendance/review, /attendance/records → remapped to above routes

## Students & Classes
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /students | StudentsPage.jsx | Student list with search, multi-select class chip filter (chips show live counts, sourced from classFilterOptions with session awareness), summary stats (shown/gender) in same card as filters, bulk ops. When `academic_year` is selected, class chips and class labels use enrollment-scoped class data for that year. Repeat is treated as a promotion/enrollment history concept, not a standalone record-state filter on this page. | GET/POST /api/students/ |
| /students/:id | StudentProfilePage.jsx | Student detail (tabs: overview, attendance, fees, academics, history, documents) with AI risk summary, profile metadata, and promotion correction action | GET students/{id}/, profile_summary/, ai-profile/, attendance_history/, fee_ledger/, exam_results/, enrollment_history/, documents/ |
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
| /academics/report-cards | ReportCardPage.jsx | Report cards with class filter (ClassSelector), student search, Download PDF button (school logo + marks table + grade scale). Uses reportCardExport.js | GET report-card/, GET /api/schools/current/, GET /api/classes/ |
| /academics/grade-scale | GradeScalePage.jsx | Grade scale config | GET/POST grade-scales/ |
| /academics/curriculum | CurriculumPage.jsx | Curriculum management (Book → Chapter → Topic). Class + Subject filters, book list, chapter accordion with topics, syllabus progress bar. Import TOC via paste or OCR photo upload. RTL language support (Urdu, Arabic, Sindhi, Pashto) | GET/POST books/, books/{id}/tree/, books/{id}/bulk_toc/, books/{id}/ocr_toc/, chapters/, topics/, books/syllabus_progress/ |
| /academics/lesson-plans | LessonPlansPage.jsx | Lesson plans with SubjectSelector filter | GET/POST lesson-plans/ |
| /academics/assignments | AssignmentsPage.jsx | Assignments with SubjectSelector filter | GET/POST assignments/ |
| /academics/assignments/:id/submissions | SubmissionReviewPage.jsx | Review submissions | GET submissions/ |
| /academics/sessions | AcademicYearsPage.jsx | Academic year/term management, including Import Terms from a previous academic year with preview and conflict handling | GET/POST academic-years/, terms/, POST terms/import-preview/, POST terms/import-apply/ |
| /academics/promotion | PromotionPage.jsx | Student promotion + history/corrections. History tab reads `promotion-history`; correction actions call single/bulk correction endpoints. Backfilled history rows are supported for legacy transitions. Repeat actions update enrollment/history context; student snapshot status remains operational (active/terminal lifecycle). | GET promotion-advisor/, POST bulk_promote/, GET enrollments/promotion-history/, POST enrollments/correct-single/, POST enrollments/correct-bulk/ |

## Finance
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /finance | FinanceDashboardPage.jsx | Finance overview. Account names are clickable → opens ledger preview modal (last 10 entries, reverse chronological, Cr/Dr/Balance columns). | GET balances/, monthly_summary/, GET accounts/ledger/?ordering=desc&limit=10 |
| /finance/fees | FeeCollectionPage.jsx | Fee overview with stat cards and class breakdown. Summary from backend `fee_summary/` endpoint (session-class-aware ordering). Individual payments still fetched for ClassBreakdown student expansion. | GET fee-payments/fee_summary/, GET fee-payments/ (for drill-down), fee-structures/, resolve_amount/, preview_generation/, PATCH bulk_update/ (mode=pay_full) |
| /finance/fees/collect | FeeCollectPage.jsx | Payment recording with inline editing, bulk actions, and shared fee-generation modal. Stat cards from backend `fee_summary/` endpoint (same source as overview for consistent ordering). | GET fee-payments/fee_summary/, GET fee-payments/, PATCH bulk_update/, preview_generation/, POST generate_monthly/, POST generate_annual_fees/ |
| /finance/fees/setup | FeeSetupPage.jsx | 3-tab page: Fee Structures (by class/student), shared Generate Records surface, Student Discounts (assign discounts/scholarships to students with base fee + effective fee view, per-student assign/remove, bulk assign to class) | GET/POST fee-structures/, bulk_set/, students/, discounts/, scholarships/, student-discounts/, bulk_assign/, preview_generation/, POST generate_monthly/, POST generate_annual_fees/ |
| /finance/expenses | ExpensesPage.jsx | Expense tracking | GET/POST expenses/ |
| /finance/discounts | DiscountsPage.jsx | Discounts & scholarships management (3 tabs: Discount rules, Scholarship programs, Student assignments). For assigning discounts to students, prefer Fee Setup > Student Discounts tab. | GET/POST discounts/, scholarships/, student-discounts/, bulk_assign/ |
| /finance/payment-gateways | PaymentGatewayPage.jsx | Payment gateway config | GET/POST gateway-config/ |
| /finance-ai | FinanceAIPage.jsx | Finance AI chat | POST ai-chat/ |
| /finance/accounts | AccountsPage.jsx | Account management (Balance Summary, Manage, Transfers, Ledger tabs). Ledger displays entries in reverse chronological order. | GET/POST accounts/, GET accounts/ledger/?ordering=desc, GET/POST transfers/ |
| /reports | FinancialReportsPage.jsx | Report generation | POST /api/reports/generate/ |

## HR
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /hr | HRDashboardPage.jsx | HR overview | GET dashboard_stats/ |
| /hr/staff | StaffDirectoryPage.jsx | Staff list with Create Account, Link Account (existing user), Unlink, bulk convert | GET staff/, POST create-user-account/, link-user-account/, unlink-user-account/, bulk-create-accounts/, GET /api/users/ (for link search) |
| /hr/staff/new | StaffFormPage.jsx | Create staff | POST staff/ |
| /hr/staff/:id/edit | StaffFormPage.jsx | Edit staff | PUT staff/{id}/ |
| /hr/departments | DepartmentsPage.jsx | Departments & designations | GET/POST departments/, designations/ |
| /hr/salary | SalaryManagementPage.jsx | Salary structures | GET/POST salary-structures/ |
| /hr/payroll | PayrollPage.jsx | Payslip generation, PDF download, delete | GET/POST/DELETE payslips/, download-pdf/ |
| /hr/leave | LeaveManagementPage.jsx | Leave policies & applications | GET/POST leave-policies/, leave-applications/ |
| /hr/attendance | StaffAttendancePage.jsx | Staff attendance | GET/POST attendance/ |
| /hr/appraisals | PerformanceAppraisalPage.jsx | Performance reviews | GET/POST appraisals/ |
| /hr/documents | StaffDocumentsPage.jsx | Staff documents | GET/POST documents/ |
| /hr/letters | LetterComposerPage.jsx | Letter Composer with AI drafting | GET/POST custom-letters/, templates/, prefill/, generate-pdf/, ai-draft/ |

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

## Messaging
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /messages | MessagesPage.jsx | Unified messaging for all roles. Split-panel: thread list (left) + conversation (right). New message modal with role-based recipient picker. Auto-refresh 15s. Mobile-responsive. | GET /api/messaging/threads/, GET /api/messaging/threads/{uuid}/, POST /api/messaging/threads/, POST /api/messaging/threads/{uuid}/reply/, PATCH /api/messaging/threads/{uuid}/read/, GET /api/messaging/recipients/, GET /api/messaging/unread-count/ |

## Parent Portal
| Route | Component | Description | API Calls |
|-------|-----------|-------------|-----------|
| /parent/dashboard | ParentDashboard.jsx | Parent home with rich per-child cards (overview data: attendance, fees, exams, today's status), per-child action buttons, QuickActionGrid, NotificationsFeed | GET my-children/, GET children/{id}/overview/ per child |
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
| /student/dashboard | StudentDashboard.jsx | Student home: 4 stat cards (Attendance, Fees, Assignments, Last Exam), two-column layout with timetable (current period highlight), assignments (urgency indicators), recent exam results, quick links (6), NotificationsFeed | GET portal/dashboard/, GET portal/exam-results/ |
| /student/attendance | StudentAttendance.jsx | View attendance | GET portal/attendance/ |
| /student/fees | StudentFees.jsx | View fees | GET portal/fees/ |
| /student/timetable | StudentTimetable.jsx | View timetable | GET portal/timetable/ |
| /student/results | StudentResults.jsx | View results | GET portal/results/ |
| /student/assignments | StudentAssignments.jsx | View assignments | GET portal/assignments/ |
| /student/profile | StudentProfileView.jsx | View profile | |
| /student/study-helper | StudentStudyHelper.jsx | AI study assistant | POST portal/study-helper/ |
