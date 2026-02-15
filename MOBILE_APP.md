# Mobile App — Comprehensive Reference Document

> **Created:** 2026-02-14
> **Status:** Phase 8 (Mobile App) COMPLETED, Phase 9 (GPS) COMPLETED
> **TypeScript Errors:** 0 | **Django System Check:** 0 issues | **All Migrations Applied**

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Original Web App Context](#2-original-web-app-context)
3. [Mobile App Architecture](#3-mobile-app-architecture)
4. [Complete File Inventory](#4-complete-file-inventory)
5. [Screen-by-Screen Reference](#5-screen-by-screen-reference)
6. [Shared Components](#6-shared-components)
7. [Services & Infrastructure](#7-services--infrastructure)
8. [Complete API Endpoint Reference](#8-complete-api-endpoint-reference)
9. [Backend Changes for Mobile](#9-backend-changes-for-mobile)
10. [Navigation & Auth Flow](#10-navigation--auth-flow)
11. [What Is Done vs Pending](#11-what-is-done-vs-pending)
12. [How to Continue in Future Sessions](#12-how-to-continue-in-future-sessions)
13. [Environment & Build Setup](#13-environment--build-setup)
14. [Known Patterns & Conventions](#14-known-patterns--conventions)

---

## 1. Project Overview

**KoderEduAI** is a school management platform with:
- **Web App:** 88 pages, 18 Django apps, 250+ API endpoints (React + Django REST Framework)
- **Mobile App:** 52 screens across 3 roles (React Native + Expo, calling the SAME backend APIs)

The mobile app is NOT a rewrite. It's a **new React Native frontend** consuming the existing Django REST backend. ~95% of backend code was untouched. Only push notifications (Phase 8) and GPS tracking (Phase 9) required backend additions.

### Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | React Native + Expo | SDK 54 |
| Routing | Expo Router (file-based) | v6 |
| Language | TypeScript | 5.9 |
| HTTP Client | Axios | 1.13 |
| Auth Storage | expo-secure-store | 15.0 |
| Push Notifications | expo-notifications | 0.32 |
| Camera | expo-camera | 17.0 |
| GPS/Location | expo-location + expo-task-manager | 19.0 / 14.0 |
| Maps | react-native-maps | 1.20 |
| WebView | react-native-webview | 13.15 |
| Forms | react-hook-form | 7.71 |
| Date Utils | date-fns | 4.1 |

---

## 2. Original Web App Context

### Django Apps (18 total)

| App | Purpose | Mobile Uses |
|-----|---------|-------------|
| `users` | Auth, roles, profiles | Login, push tokens, school switching |
| `schools` | Multi-school/org management | School context (X-School-ID header) |
| `students` | Student records, AI study helper | Student portal, admin student CRUD |
| `attendance` | AI-powered attendance with camera | Admin capture + review |
| `finance` | Fees, expenses, income, payments | Admin finance, parent payments, AI chat |
| `hr` | Staff, leave, payroll | Admin HR views |
| `academics` | Subjects, timetable, AI chat | Timetable views, AI chat |
| `examinations` | Exams, marks, grades | Results views |
| `notifications` | Multi-channel notifications | Push, in-app, send UI |
| `parents` | Parent portal, leave, messaging | Parent portal (all screens) |
| `transport` | Routes, vehicles, GPS journeys | Transport dashboard, GPS tracking |
| `library` | Books, issues, returns | Library quick-issue |
| `hostel` | Hostels, rooms, gate passes | Gate pass approvals |
| `admissions` | Admission CRM pipeline | Not in mobile (admin-heavy) |
| `lms` | Lessons, assignments | Assignment submit (student) |
| `reports` | PDF/XLSX report generation | Not in mobile (download-heavy) |
| `academic_sessions` | Years, terms, sessions | Used indirectly via other APIs |
| `core` | Permissions, mixins, modules | Used by all API views |

### Role System

| Role | Mobile Group | Tab Layout |
|------|-------------|------------|
| SUPER_ADMIN | (admin) | Dashboard, Attendance, Finance, Students, More |
| SCHOOL_ADMIN | (admin) | Same |
| PRINCIPAL | (admin) | Same |
| HR_MANAGER | (admin) | Same |
| ACCOUNTANT | (admin) | Same |
| TEACHER | (admin) | Same |
| STAFF | (admin) | Same |
| PARENT (via parents app) | (parent) | Home, Children, Messages, Leave, Profile |
| STUDENT (via students app) | (student) | Home, Schedule, Assignments, AI Helper, Profile |

### Multi-Tenancy

Every API request includes `X-School-ID` header. The mobile app stores the active school in SecureStore and injects it via Axios request interceptor. Users with access to multiple schools can switch via `POST /api/auth/switch-school/`.

---

## 3. Mobile App Architecture

### Project Structure

```
mobile/
├── app/                          # Expo Router — file-based routing
│   ├── _layout.tsx               # Root: AuthProvider + NotificationProvider
│   ├── index.tsx                 # Entry redirect (role-based)
│   ├── payment-result.tsx        # Shared payment result page
│   ├── (auth)/                   # Public screens (3)
│   ├── (admin)/                  # Admin/Staff screens (24 including _layout)
│   ├── (parent)/                 # Parent screens (11 including _layout)
│   └── (student)/                # Student screens (11 including _layout)
├── components/                   # 14 reusable components
│   ├── ui/                       # 6 base UI components
│   └── *.tsx                     # 8 feature components
├── services/                     # 4 service files
│   ├── api.ts                    # Axios client + 15 API namespaces
│   ├── auth.ts                   # SecureStore token CRUD
│   ├── location.ts               # GPS background tracking
│   └── notifications.ts          # Expo push registration
├── contexts/                     # 2 React contexts
│   ├── AuthContext.tsx            # Auth state + role detection
│   └── NotificationContext.tsx    # Push + unread count
├── constants/                    # 3 constant files
│   ├── colors.ts                 # Color palette, spacing, font sizes
│   ├── roles.ts                  # Role constants
│   └── modules.ts                # Module keys
├── types/                        # 2 type files
│   ├── models.ts                 # Student, Fee, Attendance types
│   └── api.ts                    # API response types
├── app.json                      # Expo config + plugins + permissions
├── eas.json                      # EAS Build profiles
├── tsconfig.json                 # TypeScript config
└── package.json                  # Dependencies
```

### Key Stats

| Metric | Count |
|--------|-------|
| Total screen files (.tsx in app/) | 52 |
| Shared components | 14 |
| Services | 4 |
| Contexts | 2 |
| API namespaces | 15 |
| API endpoint methods | 95+ |
| Total lines of code | ~12,000 |
| TypeScript errors | 0 |

---

## 4. Complete File Inventory

### Screens (52 files)

**Root (3):**
- `app/_layout.tsx` — Root layout: AuthProvider → NotificationProvider → Slot
- `app/index.tsx` — Entry redirect based on auth state + role
- `app/payment-result.tsx` — Payment success/failure display

**Auth (3):**
- `app/(auth)/_layout.tsx` — Stack navigator
- `app/(auth)/login.tsx` — Username/password login → JWT tokens
- `app/(auth)/register.tsx` — Parent/student registration

**Admin/Staff (24):**
- `app/(admin)/_layout.tsx` — Bottom tabs: Dashboard, Attendance, Finance, Students, More
- `app/(admin)/dashboard.tsx` — Stats grid + quick action buttons
- `app/(admin)/attendance/capture.tsx` — Camera capture for attendance photos
- `app/(admin)/attendance/review.tsx` — Review AI recognition results + confirm
- `app/(admin)/students/index.tsx` — Student card list with search
- `app/(admin)/students/[id].tsx` — Student profile with Info/Attendance/Fees tabs
- `app/(admin)/students/[id]/edit.tsx` — Edit student form
- `app/(admin)/finance/index.tsx` — Finance summary cards + navigation
- `app/(admin)/finance/fee-collection.tsx` — Fee payment list + record payment modal
- `app/(admin)/finance/expense.tsx` — Expense form with category chips
- `app/(admin)/finance/income.tsx` — Income form with source chips
- `app/(admin)/finance/transactions.tsx` — Combined feed: fees + expenses + income
- `app/(admin)/notifications/send.tsx` — Quick compose with audience/channel chips
- `app/(admin)/notifications/template-send.tsx` — Template browser + variable fill + send
- `app/(admin)/notifications/history.tsx` — Sent notification log with status badges
- `app/(admin)/hr/staff.tsx` — Staff card list with search
- `app/(admin)/hr/leave-approvals.tsx` — Pending leave approve/reject
- `app/(admin)/hostel/gate-passes.tsx` — Gate pass approve/reject/checkout/return
- `app/(admin)/transport/index.tsx` — Route list with vehicle/student counts
- `app/(admin)/timetable.tsx` — Class selector chips + TimetableGrid
- `app/(admin)/results.tsx` — Exam list → tap for student results
- `app/(admin)/library/issue.tsx` — 3-step: search student → search book → issue
- `app/(admin)/inbox.tsx` — Admin notification inbox with mark read
- `app/(admin)/ai-assistant.tsx` — 3 tabs: Finance AI, Academics AI, Comms AI

**Parent (11):**
- `app/(parent)/_layout.tsx` — Bottom tabs: Home, Children, Messages, Leave, Profile
- `app/(parent)/dashboard.tsx` — Children cards with quick actions
- `app/(parent)/children/[id]/index.tsx` — Child overview: stats + navigation grid
- `app/(parent)/children/[id]/attendance.tsx` — AttendanceCalendar with month navigation
- `app/(parent)/children/[id]/fees.tsx` — Fee summary + FeeCards with Pay Now
- `app/(parent)/children/[id]/timetable.tsx` — TimetableGrid for child's class
- `app/(parent)/children/[id]/results.tsx` — Results grouped by exam + progress bars
- `app/(parent)/leave.tsx` — Leave form (child/type chips, dates) + history list
- `app/(parent)/messages.tsx` — Thread list → chat view → compose
- `app/(parent)/payment.tsx` — Gateway selection → WebView checkout
- `app/(parent)/track-child.tsx` — GPS tracking: child selector, live location, history

**Student (11):**
- `app/(student)/_layout.tsx` — Bottom tabs: Home, Schedule, Assignments, AI Helper, Profile
- `app/(student)/dashboard.tsx` — Today's classes, attendance donut, upcoming assignments
- `app/(student)/attendance.tsx` — AttendanceCalendar with summary stats
- `app/(student)/fees.tsx` — Read-only fee list with summary
- `app/(student)/timetable.tsx` — TimetableGrid
- `app/(student)/results.tsx` — Results grouped by exam + progress bars
- `app/(student)/assignments.tsx` — Assignment list + inline text submission
- `app/(student)/ai-helper.tsx` — ChatInterface with study helper endpoints
- `app/(student)/profile.tsx` — Personal/guardian/academic info + logout
- `app/(student)/inbox.tsx` — Notification list with mark read/all
- `app/(student)/location-sharing.tsx` — Start/End journey + elapsed timer + GPS sharing

### Components (14 files)

**UI Kit (6):**
- `components/ui/Button.tsx` — Variants: primary, secondary, outline, danger, ghost. Sizes: sm, md, lg
- `components/ui/Card.tsx` — Card container with shadow
- `components/ui/Badge.tsx` — Status badges: success, warning, error, info, default
- `components/ui/Input.tsx` — Text input with label + error
- `components/ui/Spinner.tsx` — Loading spinner with optional fullScreen + message
- `components/ui/EmptyState.tsx` — Empty placeholder with title + message

**Feature Components (8):**
- `components/StatCard.tsx` — Dashboard metric card (title, value, subtitle, color, icon)
- `components/AttendanceCalendar.tsx` — Calendar heatmap with color-coded days + legend
- `components/FeeCard.tsx` — Fee row with status badge + Pay Now button
- `components/TimetableGrid.tsx` — Weekly grid grouped by day
- `components/ChatInterface.tsx` — Reusable AI chat UI (messages + input + send + clear)
- `components/StudentCard.tsx` — Student card with avatar, name, class, roll number
- `components/StaffCard.tsx` — Staff card with avatar, name, department, designation
- `components/NotificationItem.tsx` — Notification row with icon, unread dot, time-ago

---

## 5. Screen-by-Screen Reference

### Admin Screens (23 functional screens)

| # | Screen | File | API Calls | Key Features |
|---|--------|------|-----------|-------------|
| 1 | Dashboard | `(admin)/dashboard.tsx` | `studentsApi.getStudents`, `financeApi.getFinanceSummary` | Stats grid, 8 quick action buttons |
| 2 | Attendance Capture | `(admin)/attendance/capture.tsx` | `attendanceApi.uploadImageToStorage`, `attendanceApi.createUpload` | Camera (expo-camera), gallery picker, upload |
| 3 | Attendance Review | `(admin)/attendance/review.tsx` | `attendanceApi.getPendingReviews`, `attendanceApi.confirmAttendance` | Review AI results, confirm names |
| 4 | Student Directory | `(admin)/students/index.tsx` | `studentsApi.getStudents` | Debounced search, StudentCard grid |
| 5 | Student Profile | `(admin)/students/[id].tsx` | `studentsApi.getStudent`, `.getAttendanceHistory`, `.getFeeLedger` | 3 tabs: Info, Attendance, Fees |
| 6 | Edit Student | `(admin)/students/[id]/edit.tsx` | `studentsApi.updateStudent` | Name, email, phone, guardian, DOB form |
| 7 | Finance Dashboard | `(admin)/finance/index.tsx` | `financeApi.getFinanceSummary` | Summary cards + nav to sub-screens |
| 8 | Fee Collection | `(admin)/finance/fee-collection.tsx` | `financeApi.getFeePayments`, `.recordPayment` | Search, list, record payment modal |
| 9 | Expense Entry | `(admin)/finance/expense.tsx` | `financeApi.createExpense` | Category chips, amount, description form |
| 10 | Income Entry | `(admin)/finance/income.tsx` | `financeApi.createOtherIncome` | Source chips, amount, description form |
| 11 | Transactions | `(admin)/finance/transactions.tsx` | `financeApi.getFeePayments`, `.getExpenses`, `.getOtherIncome` | Combined feed with type tabs |
| 12 | Send Notification | `(admin)/notifications/send.tsx` | `notificationsApi.send` | Audience/channel chips, message compose |
| 13 | Template Send | `(admin)/notifications/template-send.tsx` | `notificationsApi.getTemplates`, `.send` | Template browser, variable fill, preview |
| 14 | Notification History | `(admin)/notifications/history.tsx` | `notificationsApi.getLogs` | Status badges, filter by channel/date |
| 15 | Staff Directory | `(admin)/hr/staff.tsx` | `hrApi.getStaff` | Search, StaffCard grid |
| 16 | Leave Approvals | `(admin)/hr/leave-approvals.tsx` | `parentsApi.getAdminLeaveRequests`, `.reviewLeaveRequest` | Approve/reject buttons |
| 17 | Gate Passes | `(admin)/hostel/gate-passes.tsx` | `hostelApi.getGatePasses`, `.approveGatePass`, `.rejectGatePass`, `.checkoutGatePass`, `.returnGatePass` | Multi-action workflow |
| 18 | Transport Dashboard | `(admin)/transport/index.tsx` | `transportApi.getDashboardStats`, `.getRoutes` | Route list with stats |
| 19 | Timetable | `(admin)/timetable.tsx` | `classesApi.getClasses`, `academicsApi.getTimetableByClass` | Class selector + TimetableGrid |
| 20 | Exam Results | `(admin)/results.tsx` | `examinationsApi.getExams`, `.getExamResults` | Exam list → student results |
| 21 | Library Issue | `(admin)/library/issue.tsx` | `libraryApi.searchStudents`, `.getBooks`, `.createIssue` | 3-step wizard |
| 22 | Inbox | `(admin)/inbox.tsx` | `notificationsApi.getMyNotifications`, `.markRead`, `.markAllRead` | NotificationItem list |
| 23 | AI Assistant | `(admin)/ai-assistant.tsx` | `financeApi.*Chat*`, `academicsApi.*Chat*`, `notificationsApi.sendChatMessage` | 3-tab ChatInterface |

### Parent Screens (10 functional screens)

| # | Screen | File | API Calls |
|---|--------|------|-----------|
| 1 | Dashboard | `(parent)/dashboard.tsx` | `parentsApi.getMyChildren` |
| 2 | Child Overview | `children/[id]/index.tsx` | `parentsApi.getChildOverview` |
| 3 | Child Attendance | `children/[id]/attendance.tsx` | `parentsApi.getChildAttendance` |
| 4 | Child Fees | `children/[id]/fees.tsx` | `parentsApi.getChildFees`, `.getPaymentGateways` |
| 5 | Child Timetable | `children/[id]/timetable.tsx` | `parentsApi.getChildTimetable` |
| 6 | Child Results | `children/[id]/results.tsx` | `parentsApi.getChildExamResults` |
| 7 | Leave Application | `(parent)/leave.tsx` | `parentsApi.getLeaveRequests`, `.createLeaveRequest`, `.cancelLeaveRequest` |
| 8 | Messages | `(parent)/messages.tsx` | `parentsApi.getMessageThreads`, `.getThreadMessages`, `.sendMessage` |
| 9 | Payment | `(parent)/payment.tsx` | `parentsApi.initiatePayment`, WebView |
| 10 | Track Child (GPS) | `(parent)/track-child.tsx` | `transportApi.trackStudent`, `parentsApi.getMyChildren` |

### Student Screens (10 functional screens)

| # | Screen | File | API Calls |
|---|--------|------|-----------|
| 1 | Dashboard | `(student)/dashboard.tsx` | `studentPortalApi.getDashboard` |
| 2 | Attendance | `(student)/attendance.tsx` | `studentPortalApi.getAttendance` |
| 3 | Fee Status | `(student)/fees.tsx` | `studentPortalApi.getFees` |
| 4 | Timetable | `(student)/timetable.tsx` | `studentPortalApi.getTimetable` |
| 5 | Results | `(student)/results.tsx` | `studentPortalApi.getExamResults` |
| 6 | Assignments | `(student)/assignments.tsx` | `studentPortalApi.getAssignments`, `.submitAssignment` |
| 7 | AI Study Helper | `(student)/ai-helper.tsx` | `studentPortalApi.sendStudyHelperMessage`, `.getStudyHelperHistory` |
| 8 | Profile | `(student)/profile.tsx` | `studentPortalApi.getProfile` |
| 9 | Inbox | `(student)/inbox.tsx` | `notificationsApi.getMyNotifications`, `.markRead`, `.markAllRead` |
| 10 | GPS Sharing | `(student)/location-sharing.tsx` | `transportApi.startJourney`, `.endJourney`, background location updates |

---

## 6. Shared Components

| Component | Used By | Screens |
|-----------|---------|---------|
| `ChatInterface` | Admin AI Assistant (3 tabs), Student AI Helper | 2 screens, 4 contexts |
| `AttendanceCalendar` | Parent child attendance, Student attendance | 2 screens |
| `TimetableGrid` | Parent child timetable, Student timetable, Admin timetable | 3 screens |
| `FeeCard` | Parent child fees, Student fees | 2 screens |
| `StudentCard` | Admin student directory | 1 screen |
| `StaffCard` | Admin HR staff directory | 1 screen |
| `NotificationItem` | Admin inbox, Student inbox | 2 screens |
| `StatCard` | Admin dashboard, Finance dashboard, Parent dashboard | 3 screens |

---

## 7. Services & Infrastructure

### api.ts — Axios Client (436 lines)

**Base URL:** `http://10.0.2.2:8000` (Android emulator) — needs env var for production

**Interceptors:**
- **Request:** Injects `Authorization: Bearer <token>` + `X-School-ID` from SecureStore
- **Response:** On 401 → attempts token refresh via `/api/auth/refresh/` → queues concurrent requests → retries all on success → calls `onLogout()` on failure

**15 API Namespaces:**
`attendanceApi`, `studentsApi`, `classesApi`, `financeApi`, `hrApi`, `academicsApi`, `examinationsApi`, `authApi`, `notificationsApi`, `parentsApi`, `studentPortalApi`, `paymentApi`, `transportApi`, `libraryApi`, `hostelApi`

### auth.ts — Token Storage (47 lines)

Uses `expo-secure-store` (encrypted storage):
- `getAccessToken()` / `setAccessToken()` / `getRefreshToken()` / `setRefreshToken()`
- `getActiveSchoolId()` / `setActiveSchoolId()`
- `setTokens()` / `clearTokens()`

### notifications.ts — Push Registration (101 lines)

- `registerForPushNotifications()` → request permission → get Expo push token → POST to backend
- `unregisterPushToken()` → DELETE from backend on logout
- `configureNotificationHandlers()` → foreground display + tap navigation handlers

### location.ts — GPS Tracking (98 lines)

- Uses `expo-task-manager` for background execution
- `requestLocationPermissions()` → foreground + background permissions
- `startBackgroundLocationUpdates(journeyId)` → GPS every 30s / 50m, foreground service notification
- `stopBackgroundLocationUpdates()` → cleanup

---

## 8. Complete API Endpoint Reference

Every endpoint the mobile app calls, grouped by namespace:

### Authentication (`authApi`)
| Method | Endpoint | Used By |
|--------|----------|---------|
| POST | `/api/auth/login/` | Login screen |
| POST | `/api/auth/refresh/` | Axios interceptor (auto) |
| GET | `/api/auth/me/` | AuthContext on init |
| POST | `/api/auth/switch-school/` | School switcher |
| PATCH | `/api/auth/me/` | Profile update |
| POST | `/api/auth/change-password/` | Profile screen |
| POST | `/api/auth/register-push-token/` | On login (auto) |
| DELETE | `/api/auth/unregister-push-token/` | On logout (auto) |

### Attendance (`attendanceApi`)
| Method | Endpoint | Used By |
|--------|----------|---------|
| POST | `/api/attendance/upload-image/` | Admin capture (multipart) |
| POST | `/api/attendance/uploads/` | Admin capture |
| GET | `/api/attendance/uploads/` | Admin review |
| GET | `/api/attendance/uploads/{id}/` | Admin review |
| POST | `/api/attendance/uploads/{id}/confirm/` | Admin review |
| GET | `/api/attendance/uploads/pending_review/` | Admin review |
| GET | `/api/attendance/records/` | Reports |
| GET | `/api/attendance/records/daily_report/` | Dashboard |
| GET | `/api/attendance/records/chronic_absentees/` | Dashboard |
| POST | `/api/attendance/uploads/{id}/reprocess/` | Admin review |
| DELETE | `/api/attendance/uploads/{id}/` | Admin review |
| GET | `/api/attendance/ai-status/` | Dashboard |

### Students (`studentsApi`)
| Method | Endpoint | Used By |
|--------|----------|---------|
| GET | `/api/students/` | Admin students list |
| GET | `/api/students/{id}/` | Admin student profile |
| POST | `/api/students/` | Admin create |
| PATCH | `/api/students/{id}/` | Admin edit |
| DELETE | `/api/students/{id}/` | Admin delete |
| GET | `/api/students/by_class/` | Class filter |
| GET | `/api/students/{id}/profile_summary/` | Profile |
| GET | `/api/students/{id}/attendance_history/` | Student profile tabs |
| GET | `/api/students/{id}/fee_ledger/` | Student profile tabs |
| GET | `/api/students/{id}/exam_results/` | Student profile tabs |

### Classes (`classesApi`)
| Method | Endpoint | Used By |
|--------|----------|---------|
| GET | `/api/classes/` | Admin timetable (class picker) |
| GET | `/api/classes/{id}/` | Class detail |

### Finance (`financeApi`)
| Method | Endpoint | Used By |
|--------|----------|---------|
| GET | `/api/finance/fee-payments/` | Admin fee collection |
| PATCH | `/api/finance/fee-payments/{id}/` | Record payment |
| POST | `/api/finance/fee-payments/` | Create payment |
| GET | `/api/finance/fee-payments/monthly_summary/` | Reports |
| GET | `/api/finance/fee-payments/student_ledger/` | Reports |
| GET | `/api/finance/expenses/` | Admin transactions |
| POST | `/api/finance/expenses/` | Admin expense entry |
| PATCH | `/api/finance/expenses/{id}/` | Update expense |
| DELETE | `/api/finance/expenses/{id}/` | Delete expense |
| GET | `/api/finance/other-income/` | Admin transactions |
| POST | `/api/finance/other-income/` | Admin income entry |
| GET | `/api/finance/reports/` | Finance summary |
| POST | `/api/finance/ai-chat/` | Admin AI assistant (Finance tab) |
| GET | `/api/finance/ai-chat/` | Chat history |
| DELETE | `/api/finance/ai-chat/` | Clear history |

### HR (`hrApi`)
| Method | Endpoint | Used By |
|--------|----------|---------|
| GET | `/api/hr/staff/dashboard_stats/` | Dashboard |
| GET | `/api/hr/staff/` | Admin staff list |
| GET | `/api/hr/staff/{id}/` | Staff detail |
| GET | `/api/hr/leave-applications/` | Leave approvals |
| POST | `/api/hr/leave-applications/{id}/approve/` | Leave approvals |
| POST | `/api/hr/leave-applications/{id}/reject/` | Leave approvals |

### Academics (`academicsApi`)
| Method | Endpoint | Used By |
|--------|----------|---------|
| GET | `/api/academics/timetable-entries/by_class/` | Admin/Parent/Student timetable |
| POST | `/api/academics/ai-chat/` | Admin AI assistant (Academics tab) |
| GET | `/api/academics/ai-chat/` | Chat history |
| DELETE | `/api/academics/ai-chat/` | Clear history |

### Examinations (`examinationsApi`)
| Method | Endpoint | Used By |
|--------|----------|---------|
| GET | `/api/examinations/exams/` | Admin results |
| GET | `/api/examinations/exams/{id}/results/` | Admin results |
| GET | `/api/examinations/exams/{id}/class_summary/` | Reports |
| GET | `/api/examinations/report-card/` | Reports |

### Notifications (`notificationsApi`)
| Method | Endpoint | Used By |
|--------|----------|---------|
| GET | `/api/notifications/templates/` | Admin template send |
| GET | `/api/notifications/logs/` | Admin notification history |
| GET | `/api/notifications/my/` | Admin/Student inbox |
| GET | `/api/notifications/unread-count/` | NotificationContext |
| POST | `/api/notifications/{id}/mark-read/` | Inbox |
| POST | `/api/notifications/mark-all-read/` | Inbox |
| POST | `/api/notifications/send/` | Admin send notification |
| POST | `/api/notifications/ai-chat/` | Admin AI assistant (Comms tab) |

### Parents (`parentsApi`)
| Method | Endpoint | Used By |
|--------|----------|---------|
| POST | `/api/parents/register/` | Registration |
| GET | `/api/parents/my-children/` | Parent dashboard, track child |
| GET | `/api/parents/children/{id}/overview/` | Child overview |
| GET | `/api/parents/children/{id}/attendance/` | Child attendance |
| GET | `/api/parents/children/{id}/fees/` | Child fees |
| GET | `/api/parents/children/{id}/pay-fee/` | Payment gateways |
| POST | `/api/parents/children/{id}/pay-fee/` | Initiate payment |
| GET | `/api/parents/children/{id}/timetable/` | Child timetable |
| GET | `/api/parents/children/{id}/exam-results/` | Child results |
| GET | `/api/parents/leave-requests/` | Leave screen |
| POST | `/api/parents/leave-requests/` | Create leave |
| PATCH | `/api/parents/leave-requests/{id}/cancel/` | Cancel leave |
| GET | `/api/parents/messages/threads/` | Messages |
| GET | `/api/parents/messages/threads/{id}/` | Thread messages |
| POST | `/api/parents/messages/` | Send message |
| PATCH | `/api/parents/messages/{id}/read/` | Mark read |
| GET | `/api/parents/admin/leave-requests/` | Admin leave approvals |
| PATCH | `/api/parents/admin/leave-requests/{id}/review/` | Admin approve/reject |

### Student Portal (`studentPortalApi`)
| Method | Endpoint | Used By |
|--------|----------|---------|
| GET | `/api/student-portal/dashboard/` | Student dashboard |
| GET | `/api/student-portal/profile/` | Student profile |
| GET | `/api/student-portal/attendance/` | Student attendance |
| GET | `/api/student-portal/fees/` | Student fees |
| GET | `/api/student-portal/timetable/` | Student timetable |
| GET | `/api/student-portal/exam-results/` | Student results |
| GET | `/api/student-portal/assignments/` | Student assignments |
| GET | `/api/student-portal/assignments/{id}/` | Assignment detail |
| POST | `/api/student-portal/assignments/{id}/submit/` | Submit assignment |
| GET | `/api/students/portal/study-helper/` | AI helper history |
| POST | `/api/students/portal/study-helper/` | AI helper chat |
| DELETE | `/api/students/portal/study-helper/` | Clear AI history |

### Payment (`paymentApi`)
| Method | Endpoint | Used By |
|--------|----------|---------|
| GET | `/api/finance/payment-status/{orderId}/` | Payment result |

### Transport (`transportApi`)
| Method | Endpoint | Used By |
|--------|----------|---------|
| GET | `/api/transport/dashboard/` | Admin transport |
| GET | `/api/transport/routes/` | Admin transport |
| GET | `/api/transport/vehicles/` | Admin transport |
| POST | `/api/transport/journey/start/` | Student GPS |
| POST | `/api/transport/journey/end/` | Student GPS |
| POST | `/api/transport/journey/update/` | Background GPS (every 30s) |
| GET | `/api/transport/journey/track/{studentId}/` | Parent tracking |
| GET | `/api/transport/journey/history/{studentId}/` | Journey history |
| GET | `/api/transport/journey/active/` | Admin active journeys |

### Library (`libraryApi`)
| Method | Endpoint | Used By |
|--------|----------|---------|
| GET | `/api/library/stats/` | Library stats |
| GET | `/api/library/books/` | Book search |
| POST | `/api/library/issues/` | Issue book |
| GET | `/api/students/` | Search students (reuses students API) |

### Hostel (`hostelApi`)
| Method | Endpoint | Used By |
|--------|----------|---------|
| GET | `/api/hostel/dashboard/` | Dashboard |
| GET | `/api/hostel/gate-passes/` | Gate pass list |
| PATCH | `/api/hostel/gate-passes/{id}/approve/` | Approve |
| PATCH | `/api/hostel/gate-passes/{id}/reject/` | Reject |
| PATCH | `/api/hostel/gate-passes/{id}/checkout/` | Checkout |
| PATCH | `/api/hostel/gate-passes/{id}/return/` | Return |

---

## 9. Backend Changes for Mobile

### Push Notifications (Phase 8)

| File | Change |
|------|--------|
| `backend/users/models.py` | Added `DevicePushToken` model (user, token, device_type, is_active) |
| `backend/users/views.py` | Added `RegisterPushTokenView`, `UnregisterPushTokenView` |
| `backend/users/urls.py` | Added `auth/register-push-token/`, `auth/unregister-push-token/` routes |
| `backend/users/serializers.py` | Added `DevicePushTokenSerializer` |
| `backend/notifications/channels/expo.py` | NEW — `ExpoChannel` extending BaseChannel, sends via Expo Push API |
| `backend/notifications/engine.py` | Registered `'PUSH': ExpoChannel` in handler dict + `_check_config` |
| `backend/notifications/models.py` | Added `('PUSH', 'Push Notification')` to CHANNEL_CHOICES, `push_enabled` to SchoolNotificationConfig |
| Migration: `users/0005_devicepushtoken.py` | DevicePushToken table |
| Migration: `notifications/0003_add_push_channel.py` | push_enabled field + channel choice updates |

### GPS Location Sharing (Phase 9)

| File | Change |
|------|--------|
| `backend/transport/models.py` | Added `StudentJourney` + `LocationUpdate` models |
| `backend/transport/views.py` | Added 6 views: JourneyStart/End/Update/Track/History/ActiveJourneys |
| `backend/transport/serializers.py` | Added journey + location serializers |
| `backend/transport/urls.py` | Added 6 journey URL routes |
| `backend/transport/tasks.py` | NEW — `cleanup_old_location_data`, `auto_end_stale_journeys` Celery tasks |
| `backend/config/settings.py` | Added 2 tasks to CELERY_BEAT_SCHEDULE |
| Migration: `transport/0002_add_gps_journey_models.py` | Journey + Location tables |

---

## 10. Navigation & Auth Flow

### Auth Flow

```
App loads → AuthContext checks SecureStore for tokens
  ├── No token → Navigate to (auth) login
  └── Has token → Call GET /api/auth/me/
      ├── 401 → Try refresh token → fail → Navigate to (auth) login
      └── 200 OK → Read user.role
          ├── PARENT role → Navigate to (parent) tabs
          ├── STUDENT role → Navigate to (student) tabs
          └── All others → Navigate to (admin) tabs
```

### Tab Layouts

**Admin/Staff:** Dashboard | Attendance | Finance | Students | More
- "More" button navigates to sub-screens: HR, Transport, Library, Hostel, Notifications, AI Assistant, Timetable, Results

**Parent:** Home | Children | Messages | Leave | Profile

**Student:** Home | Schedule | Assignments | AI Helper | Profile

---

## 11. What Is Done vs Pending

### COMPLETED

| Task | Status | Details |
|------|--------|---------|
| Expo project setup + infrastructure | DONE | app.json, eas.json, tsconfig, constants, types |
| Auth system (login, register, token refresh, role routing) | DONE | SecureStore, JWT, multi-school |
| UI Kit (6 base components) | DONE | Button, Card, Badge, Input, Spinner, EmptyState |
| 8 shared feature components | DONE | StatCard, AttendanceCalendar, FeeCard, TimetableGrid, ChatInterface, StudentCard, StaffCard, NotificationItem |
| Axios API client + 15 namespaces (95+ endpoints) | DONE | Request/response interceptors, token refresh queue |
| Parent Portal (10 screens) | DONE | Dashboard, child views (5), leave, messages, payment, GPS tracking |
| Student Portal (10 screens) | DONE | Dashboard, attendance, fees, timetable, results, assignments, AI helper, profile, inbox, GPS sharing |
| Admin Portal (23 screens) | DONE | All screens fully implemented |
| Push Notifications backend | DONE | DevicePushToken model, ExpoChannel, register/unregister endpoints, 2 migrations |
| Push Notifications mobile | DONE | notifications.ts service, NotificationContext, root layout integration |
| GPS backend (Phase 9) | DONE | StudentJourney + LocationUpdate models, 6 endpoints, 2 Celery tasks, migration |
| GPS mobile (Phase 9) | DONE | location.ts service, student location-sharing screen, parent track-child screen |
| TypeScript compilation | DONE | 0 errors |
| Django system check | DONE | 0 issues |
| All migrations | DONE | Applied successfully |

### PENDING (Week 5 Polish — Not Yet Started)

| Task | Priority | Notes |
|------|----------|-------|
| Test on real devices (iOS + Android) | HIGH | Push notifications + GPS require physical devices |
| Test all 3 role flows end-to-end | HIGH | Parent→Student→Admin complete workflows |
| EAS Build (`eas build --profile preview`) | HIGH | Generate APK + IPA |
| Error boundaries per screen | MEDIUM | Catch rendering errors gracefully |
| Offline handling / "No connection" banner | MEDIUM | Show cached data when offline |
| Skeleton loading states | LOW | Placeholder UI while loading |
| Image caching for avatars | LOW | Performance optimization |
| School switcher modal | LOW | For multi-school users in profile |
| Deep linking setup | LOW | Expo Router linking config |
| Environment variable for API URL | MEDIUM | Currently hardcoded to `10.0.2.2:8000` |

---

## 12. How to Continue in Future Sessions

### Quick Context for AI Assistants

Copy this into a new session:

> The project is at `d:\Personal\smart-attendance`. It's a school management platform with a Django backend (`backend/`) and React Native mobile app (`mobile/`). The mobile app has 52 screens across 3 roles (admin, parent, student), 14 shared components, and calls 95+ API endpoints on the existing backend. Phase 8 (Mobile App) and Phase 9 (GPS) are COMPLETE. TypeScript compiles with 0 errors. The detailed plan is at `C:\Users\hp\.claude\plans\golden-doodling-fern.md`. The comprehensive docs are at `MOBILE_APP.md` and `IMPLEMENTATION_PLAN.md` in the project root.

### Key Files to Read First

1. `MOBILE_APP.md` — This document (complete reference)
2. `IMPLEMENTATION_PLAN.md` — All phases with status
3. `mobile/services/api.ts` — All API endpoints (436 lines)
4. `mobile/contexts/AuthContext.tsx` — Auth system (215 lines)
5. `mobile/app/(admin)/_layout.tsx` — Admin tab navigation
6. `mobile/constants/colors.ts` — Design system

### Common Tasks

**Add a new admin screen:**
1. Create `mobile/app/(admin)/new-screen.tsx`
2. Import UI components from `../../components/ui/`
3. Import API namespace from `../../services/api`
4. Add navigation in `(admin)/_layout.tsx` if it needs a tab, or link from "More" menu

**Add a new API endpoint:**
1. Add to the relevant namespace in `mobile/services/api.ts`
2. Use in screens: `const response = await namespace.method(params)`

**Add a new shared component:**
1. Create `mobile/components/NewComponent.tsx`
2. Export from file, import where needed

**Run TypeScript check:**
```bash
cd mobile && npx tsc --noEmit
```

**Run Django check:**
```bash
cd backend && python manage.py check
```

**Run tests:**
```bash
cd backend && pytest
```

---

## 13. Environment & Build Setup

### app.json Plugins

```json
["expo-router", { "origin": "https://kodereduai.com" }],
"expo-secure-store",
["expo-camera", { "cameraPermission": "..." }],
["expo-location", { "isAndroidBackgroundLocationEnabled": true, "isAndroidForegroundServiceEnabled": true }],
["expo-notifications", { "icon": "./assets/notification-icon.png", "color": "#1e40af" }],
["expo-image-picker", { "photosPermission": "..." }]
```

### Android Permissions
- `CAMERA`
- `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`
- `RECEIVE_BOOT_COMPLETED`

### iOS Info.plist
- `NSCameraUsageDescription`
- `NSLocationWhenInUseUsageDescription`
- `NSLocationAlwaysAndWhenInUseUsageDescription`

### EAS Build Profiles (eas.json)
- **development** — Dev client, internal distribution, iOS simulator
- **preview** — Internal distribution, Android APK
- **production** — Auto-increment, app store submission

### Environment Variables Needed
- `API_URL` — Backend URL (currently hardcoded as `http://10.0.2.2:8000`)
- Backend `GROQ_API_KEY` — For AI chat features
- Backend `EXPO_PROJECT_ID` — For push notifications (if using Expo project ID)

---

## 14. Known Patterns & Conventions

### API Response Handling Pattern

All screens follow this pattern for API responses that may vary in shape:
```typescript
const data = response.data.results || response.data.items || response.data || [];
```

### Color System

Defined in `mobile/constants/colors.ts`:
- `Colors.primary` — #4F46E5 (indigo)
- `Colors.background` — #F8FAFC (light gray)
- `Colors.text` — #0F172A (dark)
- `Colors.success` / `.error` / `.warning` — Semantic colors
- `Spacing.xs/sm/md/lg/xl` — 4/8/12/16/24
- `FontSize.xs/sm/md/lg/xl` — 11/13/15/17/20
- `BorderRadius.sm/md/lg/full` — 6/8/12/999

### Screen Template

Every screen follows this pattern:
```typescript
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { someApi } from '../../services/api';
import Card from '../../components/ui/Card';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { Colors, FontSize, Spacing } from '../../constants/colors';

export default function ScreenName() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const response = await someApi.getData();
      setData(response.data.results || response.data || []);
    } catch (error) { console.error('Failed:', error); }
    finally { setLoading(false); }
  };

  if (loading) return <Spinner fullScreen message="Loading..." />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Screen Title</Text>
      {data.length === 0 ? (
        <EmptyState title="No Data" message="Nothing here yet." />
      ) : (
        data.map(item => <Card key={item.id}>...</Card>)
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.lg },
});
```

### Component Reuse Matrix

| Component | Props | Used in Screens |
|-----------|-------|-----------------|
| `ChatInterface` | `sendMessage`, `getHistory`, `clearHistory`, `placeholder`, `welcomeMessage` | admin/ai-assistant (3 tabs), student/ai-helper |
| `AttendanceCalendar` | `records` (array of {date, status}), `onMonthChange` | parent/children/attendance, student/attendance |
| `TimetableGrid` | `entries` (array of {day, start_time, end_time, subject_name, teacher_name}) | parent/children/timetable, student/timetable, admin/timetable |
| `FeeCard` | `fee` object, `onPayNow` callback (optional) | parent/children/fees, student/fees |
| `StatCard` | `title`, `value`, `subtitle`, `color`, `icon`, `style` | admin/dashboard, admin/finance, parent/dashboard |
