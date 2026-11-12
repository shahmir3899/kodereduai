# Mobile app vs web (mobile view): gap report, admin first

Date: 2026-11-01. Scope: admin / principal / super-admin pages. Method: compared `frontend/src/navigation/navigationConfig.js` and the web page files against `mobile/navigation/routes.ts`, `mobile/app/(admin)` and `mobile/components`. Screens were compared by reading code (feature words, modals, line counts), not by running both side by side, so the "look and feel" findings are code-based and should be confirmed with screenshots. Nothing was changed.

## 1. Headline findings

1. **Students are almost read-only on mobile.** Web can add, edit (full form), reclassify, renumber, exit, readmit, soft-delete, restore, bulk import, export and invite parents. Mobile can list, search, view a profile, and open an admin-only **Edit** form (`app/(admin)/students/[id]/edit.tsx`, 135 lines, seven fields: name, email, phone, guardian name and phone, date of birth as plain text, address). That form predates the API rework and omits fields the profile shows (parent phone, emergency contact, class, roll number, gender, admission date, photo). There is no Add student. `studentsApi.createStudent`/`deleteStudent` exist in `services/api.ts` but no screen calls them. This is the biggest functional gap, because Students is the centre of the product. (Corrected 2026-11-01 after the browser walkthrough; the first version of this report wrongly said there was no edit at all.)
2. **Whole web modules have no admin screen**: Transport management, Library catalog and overdue, Hostel rooms and allocations (decided as version 2 on 2026-10-30), plus Academic Calendar, Curriculum Coverage, AI Analytics, Staff Attendance management, Recently Deleted students, Messages (admin has no Messages tab, only manager, finance manager, staff, driver do), User Guide.
3. **Visual design lags the web.** The web mobile view uses a shared card system (`RecordCard`, `CardGrid`, `StatusPill`, `Avatar`, `ViewToggle`, see `docs/CARD_SYSTEM.md`), stat cards with icons and trend, charts, and a sticky filter toolbar. On mobile `RecordCard` is used on one screen only (Assessments); the admin dashboard quick actions use emoji as icons, and most lists are plain rows. Details in section 4.
4. **Web-only notices** (Sessions, Promotion, School Setup) are stubs by design. Keep, but the dashboard's "No academic session set" banner sends the admin to the web with no link.
5. **Mobile screens are far smaller than their web pages.** Example line counts, web page vs mobile screen: Exams 2289 vs 172, Staff Directory 1739 vs about the staff list and form, Timetable 1594 vs the day editor, Accounts 1418 vs 112, Notifications 1382 vs three small screens, Subjects 1333 vs the subjects screen, Classes 1031 vs 72 (plus class setup). Size alone is not a gap (web has a lot of layout code), but it points at where to check first.

## 2. Page by page (admin nav order)

Legend: BUILT = full parity as far as the code shows, PARTIAL = screen exists, features missing, MISSING = no admin screen, WEB = intentional "open on web" stub.

### Dashboard
| Web | Mobile | Status |
|---|---|---|
| 4 stat cards (students, attendance, monthly fees, staff present), "Today at a glance", AI Insights card, quick actions, recent notifications, school completion and session health widgets | Day hero, attendance breakdown, fee card, stat tiles, needs-attention list, absent list, quick actions, recent notifications, leadership insights | PARTIAL: no AI Insights card on home (it is under `insights`), no School completion or Session health widget, quick action icons are emoji, no trend strips (the API sends no history), no AI chat widgets (Academics, Finance, Communication) other than one `ai-assistant` screen |

### Attendance
| Web | Mobile | Status |
|---|---|---|
| Manual Entry | `attendance/manual` | BUILT (verify bulk "mark all present", leave status, edit past days) |
| Face Attendance (capture, enrollment, review, audit) | `face-attendance/*` | BUILT per notes, check live capture works on a phone |
| Attendance Record (monthly register, **Download Register PDF**) | `attendance/register` | PARTIAL: no register PDF download or share |
| Anomalies page, At-risk students page | none | MISSING |
| Photo register / OCR capture and review | screens exist, unlinked | Parked (OCR is off), fine |

### Finance
| Web | Mobile | Status |
|---|---|---|
| Finance dashboard | `finance/index` + `reports` | PARTIAL (check charts; web has FeeCharts and category breakdowns) |
| Accounts (1418 lines: ledger, transfers, categories) | `accounts` 112 lines, `transactions`, `transfers` | PARTIAL: account and category management stays on web (per MOBILE.md) |
| Fee Overview | `finance/index` / reports | PARTIAL, confirm there is an overview with filters and charts |
| Collect Payments | `fee-collection` | PARTIAL: no **bulk update or bulk delete** (BulkActionsBar), no **Export PDF** of the list, no fee-receipt print or share (grep found no receipt/share/export in `FeeCollectScreen.tsx`) |
| Fee Setup (784 lines: monthly, annual, categories, grid and card views) | `fee-setup`, `fee-generate`, `student-fees`, `close-month` | PARTIAL: category managers and annual-charges grid are web only |
| Other Income, Expenses | `income`, `expense` | BUILT, expense category manager is web only |
| Discounts (1775 lines) | `discounts` 324 lines | PARTIAL (scholarships and assignments built, confirm bulk apply and expiry) |
| Payment Gateway, Finance AI chat, fee predictor | none | MISSING (gateway is deprecated, AI chat and predictor are web only) |

### Academics, Assessment, Content, Planning
| Web | Mobile | Status |
|---|---|---|
| Subjects (1333) | `subjects` | PARTIAL: bulk subject assignment, workload and gap analysis are web only |
| Timetable (1594) | `timetable`, `timetable-periods` | PARTIAL: no auto-generation, AI suggestions, substitutes, section split |
| Exam Types, Grade Scale | built | BUILT |
| Exams (2289) | `exams-manage`, `exam-wizard`, `exam-groups`, `date-sheet` | PARTIAL: no standalone exam-group create/delete flow beyond wizard (exam-groups exists, confirm), no existing-exam date-sheet edit parity |
| Assessments (660) | `assessments` | BUILT (uses RecordCard) |
| Marks Entry (687) | `marks-entry` 316 | BUILT, verify bulk entry speed and absent/exempt flags |
| Results (599) | `results` | BUILT, includes AI comments |
| Report Cards (719) | `report-cards` 430 | PARTIAL: PDF is a server copy, not pixel-identical, Urdu text not drawn; bulk report-card download (BulkReportCardModal) missing |
| Assignments, submissions review | `assignments/*` | BUILT |
| Question Bank, Papers, Paper Builder | built | PARTIAL: AI question generation, picture extraction, inline questions, render options, Word export are web only |
| Worksheets | none for admin | MISSING (manager has a route) |
| Curriculum | `curriculum` | PARTIAL: sub-topics, content blocks, planned dates web only |
| Curriculum Coverage, Timeline | none | MISSING |
| Lesson Plans | `lesson-plans` | PARTIAL: revisions and attachments web only |
| AI Analytics | none | MISSING |
| Academic Risk | `insights` | BUILT |

### HR and Staff
| Web | Mobile | Status |
|---|---|---|
| HR dashboard, staff directory, form, departments | built | PARTIAL: staff photo upload, linking sign-in account, bulk account creation web only |
| Salary, Payroll, Leave, Performance, Documents, Letters | built | BUILT |
| Staff Attendance (732 lines, admin mark and report) | `hr/*` has no staff-attendance screen | MISSING (only "my attendance" for self roles) |
| Staff Risk | `insights` | BUILT |

### Management and students
| Web | Mobile | Status |
|---|---|---|
| Classes (1031) | `classes` (72) + `class-setup` | PARTIAL |
| Students list: filters, stats, grid and list view, selection bar, Excel export, bulk upload, add and edit form with photo crop, convert to portal account, bulk convert, reclassify, renumber section, download reports | search + class filter, view only | **MISSING writes** (see headline) |
| Student profile: Overview, Attendance, Fees, Academics, History, Assessment, Documents tabs, header actions (status update, exit wizard, readmit, parent invite, ledger link, photo) | Info, Attendance, Results, Fees tabs, read only | **PARTIAL**: no History, Assessment, Documents tabs, none of the lifecycle actions |
| Student Risk Score | `insights` | BUILT |
| Recently Deleted (restore) | none | MISSING |
| Academic Calendar | none (manager has `calendar`) | MISSING for admin |
| Sessions, Promotion, School Setup | stubs | WEB (intentional) |

### Communication, admissions, other modules
| Web | Mobile | Status |
|---|---|---|
| Notifications (1382: templates, send, history, schedule, preferences, AI chat) | `notifications/send`, `history`, `template-send`, `inbox` | PARTIAL: template management, scheduling, preferences |
| Messages | none for admin | MISSING |
| Admissions (enquiries, conversion likelihood) | built | BUILT |
| Transport (dashboard, routes, vehicles, assignments, attendance) | `transport/index` only | v2 (decided) |
| Library (dashboard, catalog, issue/return, overdue) | `library/issue` + `book` | v2 for catalog and overdue |
| Hostel (dashboard, rooms, allocations, gate passes) | gate passes only | v2 for the rest |
| Inventory (5 pages) | built | BUILT (barcode scan owed) |
| Settings (users, roles, modules, school profile) | `settings`, `users`, `school-profile` | PARTIAL: module enablement is web only |
| User Guide, Brochure, Accuracy dashboard, Super admin dashboard | none | Skipped by earlier decision / low priority |

## 3. Suggested fix order (admin)

1. **Students write path** (add, edit with photo, status update, reclassify, soft delete and restore, parent invite). Then the profile's History, Assessment and Documents tabs. Exit wizard, readmit, bulk import and renumber could stay web with a notice, but need your call.
2. **Look and feel pass** on the admin shell and the five most used screens (Dashboard, Students, Attendance, Fee Collect, Results): adopt `RecordCard`/`StatusPill` and the web's stat card, replace emoji icons with vector icons, add the list/card toggle where the web has it, sticky filters. Needs side-by-side screenshots first so we copy what is actually better.
3. **Small, high-value additions**: admin Messages tab, register PDF download, fee list bulk update and export, bulk report cards, Staff Attendance (admin), Academic Calendar (read at least), Recently Deleted.
4. **Remaining v1 candidates**: Curriculum Coverage, AI Analytics, Anomalies and At-risk students, notification templates and scheduling.
5. **Version 2**: Transport, Library catalog, Hostel rooms (already decided).

## 4. Look and feel: what the code shows (confirm with screenshots)

- Web dashboard uses `StatCard`, `MonthlyFeeCollectionCard`, `AIInsightsCard`, `SchoolCompletionWidget`, `SessionHealthWidget`; mobile has equivalents for the first two only.
- Web lists share `components/cards` with a view toggle that remembers the choice; mobile has `components/ui/RecordCard` used on one screen (`StudentCard`/`StaffCard` exist but no screen uses them yet, per `MOBILE_UI_POLISH_PLAN.md`).
- `Select` search box is on for long lists (done). Header has year chip, bell and photo (done).
- Quick-action tiles use emoji (`app/(admin)/dashboard.tsx`), which look different per phone.
- Trend strips were planned and not built.

## 4b. Seen in the browser walkthrough (2026-11-01, demo school 42, 375px wide)

- **Students list:** plain white rows with name and "Roll 1 · Grade 1 - A". The avatar slot is empty (blank space on the left, no initials). No count cards, no status chips or filter, no add button, no card/list toggle.
- **Student profile:** has a stat strip (attendance %, latest test %, fees pending) and four tabs (Info, Attendance, Results, Fees), clean, but the Info tab is a flat label/value list with long values wrapping.
- **Attendance hub:** three text cards, no icons or today's numbers.
- **Finance hub:** good: three stat cards and coloured-bar action rows. This is the closest to the web's look.
- **Dashboard:** hero, needs-attention, stat tiles, fee card and quick actions render; the quick-action icons are emoji; "School insights" is collapsed behind "Show".
- Bottom tab labels are clipped at the screen edge on a 375px width ("Dashboard", "Attendance", "Finance" cut off); check on a phone.
- Not yet compared against the web screens visually. The web app was not run during this walkthrough.

## 5. Not yet checked (needs another pass)

Teacher, Manager, Student, Parent, Driver, Finance manager and Staff pages have not been compared with the web in this report. Exact field-level parity inside each "BUILT" admin screen (for example which filters the web has that mobile lacks) was not checked; I only compared at feature level. A screenshot comparison on a phone is needed before any look-and-feel work.
