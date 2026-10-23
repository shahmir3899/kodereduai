// Sidebar structure shared by Layout.jsx and the User Guide page, so the guide's
// "Show me" buttons follow exactly the same role/module visibility rules as the
// real sidebar. `I` is an icon lookup ({ HomeIcon: Component, ... }); callers that
// only need hrefs (the guide) can pass a lookup that returns null.

export function buildStaffNavigation(ctx, I) {
  const {
    effectiveRole, isModuleEnabled, isStaffLevel, isManager, isTeacher, isStaff,
    isSchoolAdminNav, hasInventoryAssignments,
  } = ctx
  const isDriver = ctx.isDriver ?? effectiveRole === 'DRIVER'
  const nav = [
    // Dashboard - always visible at top
    { type: 'item', name: 'Dashboard', href: '/dashboard', icon: I.HomeIcon },

    // Attendance group (consolidated) — student/class attendance, not
    // relevant to Staff (their own attendance lives in the Self Service
    // hub below, backed by hr.StaffAttendance, not this module).
    // Manager removed 2026-09: nav access scoped down to Dashboard/
    // Academics/Content Creation/Management only. Student attendance is
    // admins + teachers only (the API refuses every other role).
    ...(isModuleEnabled('attendance') && (isSchoolAdminNav || isTeacher) ? [{
      type: 'group',
      name: 'Attendance',
      icon: I.ClipboardIcon,
      children: [
        { type: 'divider', label: 'Mark Attendance' },
        { name: '1. Manual Entry', href: '/attendance/manual-entry', icon: I.PencilIcon },
        // Face attendance runs on admin-only APIs (sessions, enrolment): teachers mark through Manual Entry.
        ...(isSchoolAdminNav ? [{ name: '2. Face Attendance', href: '/face-attendance', icon: I.ClipboardCheckIcon }] : []),
        { type: 'divider', label: 'Records' },
        { name: 'Attendance Record', href: '/attendance/register', icon: I.TableIcon },
      ],
    }] : []),

    // Finance group — Manager removed 2026-09 (see Attendance comment above).
    ...(isModuleEnabled('finance') && !isStaff && !isManager ? [{
      type: 'group',
      name: 'Finance',
      icon: I.CurrencyIcon,
      children: isTeacher
        ? [{ name: 'Collect Payments', href: '/finance/fees/collect', icon: I.ReceiptIcon }]
        : [
            { name: 'Dashboard', href: '/finance', icon: I.ChartIcon },
            { name: 'Accounts', href: '/finance/accounts', icon: I.BanknotesIcon },
            { type: 'divider', label: 'Fees' },
            { name: 'Fee Overview', href: '/finance/fees', icon: I.ClipboardCheckIcon },
            { name: 'Collect Payments', href: '/finance/fees/collect', icon: I.ReceiptIcon },
            ...(!isStaffLevel
              ? [{ name: 'Fee Setup', href: '/finance/fees/setup', icon: I.CogIcon }]
              : []),
            { type: 'divider', label: 'Income & Expenses' },
            { name: 'Other Income', href: '/finance/income', icon: I.BanknotesIcon },
            { name: 'Expenses', href: '/finance/expenses', icon: I.WalletIcon },
            ...(!isStaffLevel
              ? [
                  { name: 'Discounts', href: '/finance/discounts', icon: I.TagIcon },
                ]
              : []),
          ],
    }] : []),

    // Academics navigation split into focused groups to reduce clutter —
    // none of Curriculum/Assessment/Content Creation/Planning & Delivery is
    // Staff's business (no backend access to any of it; Staff has no
    // teaching or curriculum role), so the whole cluster is hidden for them.
    ...(isModuleEnabled('academics') && !isStaff ? [{
      type: 'group',
      name: 'Academics',
      icon: I.BookOpenIcon,
      children: [
        { type: 'divider', label: 'Curriculum' },
        ...(!isTeacher ? [{ name: 'Subjects', href: '/academics/subjects', icon: I.AcademicIcon }] : []),
        { name: 'Timetable', href: '/academics/timetable', icon: I.ClockIcon },
        ...(isModuleEnabled('examinations') || isModuleEnabled('lms') ? [
          { type: 'divider', label: 'Assessment' },
        ] : []),
        ...(isModuleEnabled('examinations') ? [
          ...(!isTeacher ? [{ name: 'Exam Types', href: '/academics/exam-types', icon: I.FolderIcon }] : []),
          ...(!isTeacher ? [{ name: 'Exams', href: '/academics/exams', icon: I.ClipboardIcon }] : []),
          ...(isTeacher ? [{ name: 'Exam Schedule', href: '/academics/exam-schedule', icon: I.CalendarIcon }] : []),
          // Matches AssessmentAccessRoute's allow-list (SCHOOL_ADMIN/PRINCIPAL/
          // TEACHER/SUPER_ADMIN) -- keeps ACCOUNTANT/DRIVER from seeing a link
          // that immediately redirects them away.
          ...(isSchoolAdminNav || isTeacher ? [{ name: 'Assessments', href: '/assessments', icon: I.DocumentIcon }] : []),
          ...(isSchoolAdminNav || isTeacher ? [{ name: 'Marks Entry', href: '/academics/marks-entry', icon: I.DocumentIcon }] : []),
          ...(isSchoolAdminNav ? [{ name: 'Grade Scale', href: '/academics/grade-scale', icon: I.SettingsIcon }] : []),
          // Per-student marks: admins + teachers only (the API refuses the rest).
          ...(isSchoolAdminNav || isTeacher ? [
            { name: 'Results', href: '/academics/results', icon: I.ChartIcon },
            { name: 'Report Cards', href: '/academics/report-cards', icon: I.ReportIcon },
          ] : []),
        ] : []),
        ...(isModuleEnabled('lms') ? [
          { name: 'Assignments', href: '/academics/assignments', icon: I.DocumentIcon },
        ] : []),
      ],
    }] : []),

    ...(isModuleEnabled('academics') && !isStaff && (isModuleEnabled('examinations') || isModuleEnabled('lms')) ? [{
      type: 'group',
      name: 'Content Creation',
      icon: I.PencilIcon,
      children: [
        ...(isModuleEnabled('examinations') ? [
          { name: 'Question Bank', href: '/academics/questions', icon: I.PencilIcon },
          // Paper Builder/Question Papers/Worksheets match PaperBuilderRoute's
          // allow-list (SCHOOL_ADMIN/PRINCIPAL/TEACHER/MANAGER) -- keeps
          // ACCOUNTANT/DRIVER from seeing links that redirect them away.
          ...(isSchoolAdminNav || isTeacher || isManager ? [
            { name: 'Paper Builder', href: '/academics/paper-builder', icon: I.PencilIcon },
            { name: 'Question Papers', href: '/academics/papers', icon: I.DocumentIcon },
            { name: 'Worksheets', href: '/academics/worksheets', icon: I.DocumentIcon },
          ] : []),
        ] : []),
        ...(isModuleEnabled('lms') ? [
          { name: 'Curriculum', href: '/academics/curriculum', icon: I.BookOpenIcon },
        ] : []),
      ],
    }] : []),

    // Manager removed 2026-09 (see Attendance comment above).
    ...(isModuleEnabled('academics') && !isStaff && !isManager && (isModuleEnabled('examinations') || isModuleEnabled('lms')) ? [{
      type: 'group',
      name: 'Planning & Delivery',
      icon: I.CalendarIcon,
      children: [
        ...(isModuleEnabled('examinations') ? [
          { name: 'Curriculum Coverage', href: '/academics/curriculum-coverage', icon: I.ChartIcon },
        ] : []),
        ...(isModuleEnabled('lms') ? [
          { name: 'Lesson Plans', href: '/academics/lesson-plans', icon: I.BookOpenIcon },
        ] : []),
      ],
    }] : []),

    ...(isModuleEnabled('academics') && !isStaffLevel ? [{
      type: 'item',
      name: 'AI Analytics',
      href: '/academics/analytics',
      icon: I.ChartIcon,
    }] : []),

    ...(isModuleEnabled('examinations') && !isStaffLevel ? [{
      type: 'item',
      name: 'Academic Risk',
      href: '/academics/academic-risk',
      icon: I.ExclamationIcon,
    }] : []),

    // HR & Staff group (visible to SCHOOL_ADMIN, PRINCIPAL only —
    // 2026-09: Manager removed, dropped to the self-service tier below,
    // same as Teacher: nav access scoped down to Dashboard/Academics/
    // Content Creation/Management, with only own leave/attendance/payslip
    // as an exception, enforced backend-side in hr/permissions.py).
    ...(isModuleEnabled('hr') && !isStaffLevel
      ? [{
          type: 'group',
          name: 'HR & Staff',
          icon: I.BriefcaseIcon,
          children: [
            { name: 'Dashboard', href: '/hr', icon: I.ChartIcon },
            { name: 'Staff Directory', href: '/hr/staff', icon: I.UsersIcon },
            { name: 'Departments', href: '/hr/departments', icon: I.FolderIcon },
            { name: 'Salary', href: '/hr/salary', icon: I.BanknotesIcon },
            { name: 'Payroll', href: '/hr/payroll', icon: I.ReceiptIcon },
            { name: 'Leave', href: '/hr/leave', icon: I.CalendarIcon },
            { name: 'Attendance', href: '/hr/attendance', icon: I.ClipboardCheckIcon },
            { name: 'Performance', href: '/hr/appraisals', icon: I.StarIcon },
            { name: 'Documents', href: '/hr/documents', icon: I.DocumentIcon },
            { name: 'Letter Composer', href: '/hr/letters', icon: I.DocumentIcon },
            { name: 'Staff Risk', href: '/hr/risk', icon: I.ExclamationIcon },
          ],
        }]
      : []),

    // Standalone self-service items for Teacher/Manager — the full "HR &
    // Staff" group above stays admin-only; Teacher/Manager get just their
    // own leave and attendance, not the whole HR toolset
    // (LeaveManagementPage.jsx and StaffAttendancePage.jsx both render a
    // trimmed self-service view for TEACHER/STAFF/MANAGER).
    ...(isModuleEnabled('hr') && (isTeacher || isManager)
      ? [
          { type: 'item', name: 'My Leave', href: '/hr/leave', icon: I.CalendarIcon },
          { type: 'item', name: 'My Attendance', href: '/hr/attendance', icon: I.ClipboardCheckIcon },
        ]
      : []),

    // Staff gets one consolidated "Self Service" hub (Leave + Attendance
    // tabs) instead of separate items — Staff sits at the bottom of the
    // school hierarchy with no teaching/admin surface at all, so a single
    // entry point is clearer than scattering it across the sidebar. Also
    // reachable via the dashboard's "Apply Leave"/quick-action links.
    ...(isModuleEnabled('hr') && (isStaff || isDriver)
      ? [{ type: 'item', name: 'Self Service', href: '/hr/self-service', icon: I.CalendarIcon }]
      : []),

    // Management group
    ...((isModuleEnabled('students') || isModuleEnabled('academics')) && !isStaff ? [{
      type: 'group',
      name: 'Management',
      icon: I.FolderIcon,
      children: [
        ...(isModuleEnabled('students') ? [
          { name: 'Classes', href: '/classes', icon: I.TableIcon },
          // Manager has no student-level data; classes stay for its pickers.
          ...(!isManager ? [{ name: 'Students', href: '/students', icon: I.UsersIcon }] : []),
          ...(!isStaffLevel ? [{ name: 'Student Risk Score', href: '/students/risk-score', icon: I.ExclamationIcon }] : []),
          ...(effectiveRole === 'SCHOOL_ADMIN' || effectiveRole === 'PRINCIPAL' ? [{ name: 'Recently Deleted', href: '/students/deleted', icon: I.TableIcon }] : []),
        ] : []),
        ...(!isTeacher && isModuleEnabled('academics') ? [
          { type: 'divider', label: 'Academic Ops' },
          { name: 'Academic Calendar', href: '/academics/calendar', icon: I.CalendarIcon },
          { name: 'Sessions', href: '/academics/sessions', icon: I.CalendarIcon },
          { name: 'Promotion', href: '/academics/promotion', icon: I.UsersIcon },
        ] : []),
      ],
    }] : []),

    // Notifications
    ...(isModuleEnabled('notifications') ? [{
      type: 'item', name: 'Notifications', href: '/notifications', icon: I.ChatBotIcon,
    }] : []),

    // Messages
    { type: 'item', name: 'Messages', href: '/messages', icon: I.MailIcon },

    // Admissions (admin only)
    ...(isModuleEnabled('admissions') && !isStaffLevel ? [{
      type: 'group',
      name: 'Admissions',
      icon: I.UserPlusIcon,
      children: [
        { name: 'Enquiries', href: '/admissions', icon: I.UserPlusIcon },
        { name: 'Conversion Likelihood', href: '/admissions/conversion-likelihood', icon: I.ExclamationIcon },
      ],
    }] : []),

    // Transport group — Manager removed 2026-09 (see Attendance comment above).
    ...(isModuleEnabled('transport') && !isManager ? [{
      type: 'group',
      name: 'Transport',
      icon: I.TruckIcon,
      children: [
        { name: 'Dashboard', href: '/transport', icon: I.ChartIcon },
        { name: 'Routes', href: '/transport/routes', icon: I.MapPinIcon },
        { name: 'Vehicles', href: '/transport/vehicles', icon: I.TruckIcon },
        { name: 'Assignments', href: '/transport/assignments', icon: I.UsersIcon },
        { name: 'Attendance', href: '/transport/attendance', icon: I.ClipboardCheckIcon },
      ],
    }] : []),

    // Library group — Manager removed 2026-09 (see Attendance comment above).
    ...(isModuleEnabled('library') && !isManager ? [{
      type: 'group',
      name: 'Library',
      icon: I.LibraryIcon,
      children: [
        { name: 'Dashboard', href: '/library', icon: I.ChartIcon },
        { name: 'Catalog', href: '/library/catalog', icon: I.SearchIcon },
        { name: 'Issue / Return', href: '/library/issues', icon: I.BookOpenIcon },
        { name: 'Overdue', href: '/library/overdue', icon: I.ExclamationIcon },
      ],
    }] : []),

    // Hostel group — Manager removed 2026-09 (see Attendance comment above).
    ...(isModuleEnabled('hostel') && !isManager ? [{
      type: 'group',
      name: 'Hostel',
      icon: I.HomeIcon,
      children: [
        { name: 'Dashboard', href: '/hostel', icon: I.ChartIcon },
        { name: 'Rooms', href: '/hostel/rooms', icon: I.TableIcon },
        { name: 'Allocations', href: '/hostel/allocations', icon: I.UsersIcon },
        { name: 'Gate Passes', href: '/hostel/gate-passes', icon: I.DocumentIcon },
      ],
    }] : []),

    // Inventory group — Manager removed 2026-09 (see Attendance comment above).
    ...(isModuleEnabled('inventory') && !isManager && (!isTeacher && !isStaff ? true : hasInventoryAssignments) ? [{
      type: 'group',
      name: 'Inventory',
      icon: I.ClipboardCheckIcon,
      children: (isTeacher || isStaff)
        ? [{ name: 'Assignments', href: '/inventory/assignments', icon: I.UsersIcon }]
        : [
            { name: 'Dashboard', href: '/inventory', icon: I.ChartIcon },
            { name: 'Items', href: '/inventory/items', icon: I.FolderIcon },
            { name: 'Transactions', href: '/inventory/transactions', icon: I.DocumentIcon },
            { name: 'Assignments', href: '/inventory/assignments', icon: I.UsersIcon },
            { name: 'Reorder Prediction', href: '/inventory/reorder-prediction', icon: I.ExclamationIcon },
          ],
    }] : []),

    // Discounts moved into Finance group above

    // User Guide - visible to all roles
    { type: 'item', name: 'User Guide', href: '/guide', icon: I.BookOpenIcon },

    // School Setup - admin only
    ...(!isStaffLevel
      ? [{ type: 'item', name: 'School Setup', href: '/school-setup', icon: I.RocketIcon }]
      : []),

    // Settings - admin only (SCHOOL_ADMIN, not staff-level roles)
    ...(!isStaffLevel
      ? [{ type: 'item', name: 'Settings', href: '/settings', icon: I.CogIcon }]
      : []),
  ]
  return isDriver ? nav.filter((entry) => DRIVER_NAV.has(entry.name)) : nav
}

// A driver's work is transport plus their own HR self-service. Everything else in the staff
// sidebar (finance, students, academics, inventory, ...) sits on APIs a driver is refused.
const DRIVER_NAV = new Set(['Dashboard', 'Transport', 'Self Service', 'Notifications', 'Messages', 'User Guide'])

export function buildParentNavigation(I) {
  return [
  { type: 'item', name: 'Dashboard', href: '/parent/dashboard', icon: I.HomeIcon },
  { type: 'item', name: 'Leave Requests', href: '/parent/leave', icon: I.CalendarIcon },
  { type: 'item', name: 'Messages', href: '/parent/messages', icon: I.MailIcon },
  { type: 'item', name: 'User Guide', href: '/guide', icon: I.BookOpenIcon },
]
}

export function buildStudentNavigation(I) {
  return [
  { type: 'item', name: 'Dashboard', href: '/student/dashboard', icon: I.HomeIcon },
  { type: 'item', name: 'Attendance', href: '/student/attendance', icon: I.ClipboardIcon },
  { type: 'item', name: 'Fees', href: '/student/fees', icon: I.CurrencyIcon },
  { type: 'item', name: 'Timetable', href: '/student/timetable', icon: I.ClockIcon },
  { type: 'item', name: 'Exam Schedule', href: '/student/exam-schedule', icon: I.CalendarIcon },
  { type: 'item', name: 'Results', href: '/student/results', icon: I.ChartIcon },
  { type: 'item', name: 'Assignments', href: '/student/assignments', icon: I.PencilIcon },
  { type: 'item', name: 'Library', href: '/student/library', icon: I.LibraryIcon },
  { type: 'item', name: 'Transport', href: '/student/transport', icon: I.TruckIcon },
  { type: 'item', name: 'AI Study Helper', href: '/student/study-helper', icon: I.ChatBotIcon },
  { type: 'item', name: 'My Profile', href: '/student/profile', icon: I.UsersIcon },
  { type: 'item', name: 'User Guide', href: '/guide', icon: I.BookOpenIcon },
]
}

// Every href reachable from a navigation array (items and group children).
export function collectNavHrefs(groups) {
  const hrefs = new Set()
  const walk = (entries) => {
    for (const entry of entries || []) {
      if (entry.href) hrefs.add(entry.href.split('?')[0])
      if (entry.children) walk(entry.children)
    }
  }
  walk(groups)
  return hrefs
}

// Icon lookup for callers that do not render icons.
export const NO_ICONS = new Proxy({}, { get: () => null })
