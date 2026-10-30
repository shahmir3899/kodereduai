import type { Persona } from './personas';
import { routeFor } from './routes';
import type { ModuleKey } from '../constants/modules';

// Port of frontend/src/navigation/navigationConfig.js (buildStaffNavigation). The web file is
// the source of truth for who sees what; when its rules change, change this too (the role
// tests mirror frontend/src/navigation/__tests__/navigationConfig.roles.test.js).

export interface NavItem {
  name: string;
  webPath: string;
  // undefined until the mobile screen exists.
  href?: string;
}

export interface NavGroup {
  name: string;
  items: NavItem[];
}

export interface NavContext {
  persona: Persona;
  effectiveRole: string | undefined;
  isModuleEnabled: (key: ModuleKey) => boolean;
  isStaffLevel: boolean;
  isManager: boolean;
  isTeacher: boolean;
  isStaff: boolean;
  isDriver: boolean;
  isSchoolAdminNav: boolean;
  hasInventoryAssignments: boolean;
}

// A driver's work is transport plus their own HR self-service; everything else sits on APIs
// a driver is refused.
const DRIVER_GROUPS = new Set(['General', 'Transport', 'Self Service']);

// Staff are HR self-service, messages, notifications and their own inventory assignments. The
// web sidebar also lists Transport and Library for them (they are not gated on `!isStaff`), but
// the phone sticks to the brief rather than showing screens that do not exist.
const STAFF_GROUPS = new Set(['General', 'Self Service', 'Inventory', 'Me']);

export function buildStaffNavigation(ctx: NavContext): NavGroup[] {
  const {
    persona, effectiveRole, isModuleEnabled: on, isStaffLevel, isManager, isTeacher,
    isStaff, isDriver, isSchoolAdminNav, hasInventoryAssignments,
  } = ctx;

  const item = (name: string, webPath: string): NavItem => ({
    name,
    webPath,
    href: routeFor(persona, webPath),
  });
  const groups: NavGroup[] = [];
  const add = (name: string, items: NavItem[]) => {
    if (items.length) groups.push({ name, items });
  };

  add('General', [
    item('Dashboard', '/dashboard'),
    ...(on('notifications') ? [item('Notifications', '/notifications')] : []),
    item('Messages', '/messages'),
  ]);

  // Student/class attendance: admins + teachers only (the API refuses the rest).
  if (on('attendance') && (isSchoolAdminNav || isTeacher)) {
    add('Attendance', [
      item('Manual Entry', '/attendance/manual-entry'),
      // Face attendance runs on admin-only APIs; teachers mark through Manual Entry.
      ...(isSchoolAdminNav ? [item('Face Attendance', '/face-attendance')] : []),
      item('Attendance Record', '/attendance/register'),
    ]);
  }

  if (on('finance') && !isStaff && !isManager) {
    add('Finance', isTeacher
      ? [item('Collect Payments', '/finance/fees/collect')]
      : [
          item('Dashboard', '/finance'),
          item('Accounts', '/finance/accounts'),
          item('Fee Overview', '/finance/fees'),
          item('Collect Payments', '/finance/fees/collect'),
          ...(!isStaffLevel ? [item('Fee Setup', '/finance/fees/setup')] : []),
          item('Other Income', '/finance/income'),
          item('Expenses', '/finance/expenses'),
          ...(!isStaffLevel ? [item('Discounts', '/finance/discounts')] : []),
        ]);
  }

  if (on('academics') && !isStaff) {
    const exams = on('examinations');
    const lms = on('lms');
    add('Academics', [
      ...(!isTeacher ? [item('Subjects', '/academics/subjects')] : []),
      item('Timetable', '/academics/timetable'),
      ...(exams ? [
        ...(!isTeacher ? [item('Exam Types', '/academics/exam-types'), item('Exams', '/academics/exams')] : []),
        ...(isTeacher ? [item('Exam Schedule', '/academics/exam-schedule')] : []),
        ...(isSchoolAdminNav || isTeacher
          ? [item('Assessments', '/assessments'), item('Marks Entry', '/academics/marks-entry')]
          : []),
        ...(isSchoolAdminNav ? [item('Grade Scale', '/academics/grade-scale')] : []),
        ...(isSchoolAdminNav || isTeacher
          ? [item('Results', '/academics/results'), item('Report Cards', '/academics/report-cards')]
          : []),
      ] : []),
      ...(lms ? [item('Assignments', '/academics/assignments')] : []),
    ]);

    if (exams || lms) {
      add('Content Creation', [
        ...(exams ? [
          item('Question Bank', '/academics/questions'),
          ...(isSchoolAdminNav || isTeacher || isManager ? [
            item('Paper Builder', '/academics/paper-builder'),
            item('Question Papers', '/academics/papers'),
            item('Worksheets', '/academics/worksheets'),
          ] : []),
        ] : []),
        ...(lms ? [item('Curriculum', '/academics/curriculum')] : []),
      ]);
    }

    if (!isManager && (exams || lms)) {
      add('Planning & Delivery', [
        ...(exams ? [item('Curriculum Coverage', '/academics/curriculum-coverage')] : []),
        ...(lms ? [item('Lesson Plans', '/academics/lesson-plans')] : []),
      ]);
    }

    if (!isStaffLevel) {
      add('Insights', [
        item('AI Analytics', '/academics/analytics'),
        ...(exams ? [item('Academic Risk', '/academics/academic-risk')] : []),
      ]);
    }
  }

  // Full HR group is admin/principal only; teacher/manager get just their own leave and
  // attendance; staff and drivers one self-service hub (enforced backend-side in hr/permissions.py).
  if (on('hr')) {
    if (!isStaffLevel) {
      add('HR & Staff', [
        item('Dashboard', '/hr'),
        item('Staff Directory', '/hr/staff'),
        item('Departments', '/hr/departments'),
        item('Salary', '/hr/salary'),
        item('Payroll', '/hr/payroll'),
        item('Leave', '/hr/leave'),
        item('Attendance', '/hr/attendance'),
        item('Performance', '/hr/appraisals'),
        item('Documents', '/hr/documents'),
        item('Letter Composer', '/hr/letters'),
        item('Staff Risk', '/hr/risk'),
      ]);
    } else if (isTeacher || isManager) {
      add('My HR', [item('My Leave', '/hr/leave'), item('My Attendance', '/hr/attendance')]);
    }
    if (isStaff || isDriver) {
      // Payslips are read from the same own-record API the web staff dashboard uses; the web
      // has no payslip page for staff, so '/hr/payslips' is a mobile-only path.
      add('Self Service', [
        item('Self Service', '/hr/self-service'),
        ...(isStaff ? [item('My Payslips', '/hr/payslips')] : []),
      ]);
    }
  }

  if ((on('students') || on('academics')) && !isStaff) {
    add('Management', [
      ...(on('students') ? [
        item('Classes', '/classes'),
        ...(!isManager ? [item('Students', '/students')] : []),
        ...(!isStaffLevel ? [item('Student Risk Score', '/students/risk-score')] : []),
        ...(effectiveRole === 'SCHOOL_ADMIN' || effectiveRole === 'PRINCIPAL'
          ? [item('Recently Deleted', '/students/deleted')]
          : []),
      ] : []),
      ...(!isTeacher && on('academics') ? [item('Academic Calendar', '/academics/calendar'), item('Sessions', '/academics/sessions'), item('Promotion', '/academics/promotion')] : []),
    ]);
  }

  if (on('admissions') && !isStaffLevel) {
    add('Admissions', [
      item('Enquiries', '/admissions'),
      item('Conversion Likelihood', '/admissions/conversion-likelihood'),
    ]);
  }

  if (on('transport') && !isManager) {
    add('Transport', [
      item('Dashboard', '/transport'),
      item('Routes', '/transport/routes'),
      item('Vehicles', '/transport/vehicles'),
      item('Assignments', '/transport/assignments'),
      item('Attendance', '/transport/attendance'),
    ]);
  }

  if (on('library') && !isManager) {
    add('Library', [
      item('Dashboard', '/library'),
      item('Catalog', '/library/catalog'),
      item('Issue / Return', '/library/issues'),
      item('Overdue', '/library/overdue'),
    ]);
  }

  // Admin and principal only: it lists students and gate-pass reasons.
  if (on('hostel') && !isStaffLevel) {
    add('Hostel', [
      item('Dashboard', '/hostel'),
      item('Rooms', '/hostel/rooms'),
      item('Allocations', '/hostel/allocations'),
      item('Gate Passes', '/hostel/gate-passes'),
    ]);
  }

  if (on('inventory') && !isManager && (!isTeacher && !isStaff ? true : hasInventoryAssignments)) {
    add('Inventory', isTeacher || isStaff
      ? [item('Assignments', '/inventory/assignments')]
      : [
          item('Dashboard', '/inventory'),
          item('Items', '/inventory/items'),
          item('Transactions', '/inventory/transactions'),
          item('Assignments', '/inventory/assignments'),
          item('Reorder Prediction', '/inventory/reorder-prediction'),
        ]);
  }

  // Admin and principal only, like the web; the wizard itself stays on the web. Settings holds the
// users and roles screen.
  if (!isStaffLevel) add('Setup', [item('School Setup', '/school-setup'), item('Settings', '/settings')]);

  if (persona === 'staff' && isStaff) add('Me', [item('Change Password', '/staff/change-password')]);

  if (isDriver) return groups.filter((g) => DRIVER_GROUPS.has(g.name));
  return persona === 'staff' && isStaff ? groups.filter((g) => STAFF_GROUPS.has(g.name)) : groups;
}

// The accountant is read-only on every finance API (FinanceRoleAccessPermission), so unlike the
// web sidebar there is no Collect Payments entry, and the Academics, Management, Transport,
// Library groups the web shows by accident of `!isStaff` are left out (decided
// 2026-10-28). Own HR self-service is allowed by the API (HR_SELF_SERVICE_ROLES) even though the
// web sidebar omits it.
export function buildAccountantNavigation(isModuleEnabled: (key: ModuleKey) => boolean): NavGroup[] {
  const item = (name: string, webPath: string): NavItem => ({ name, webPath, href: routeFor('accountant', webPath) });
  const groups: NavGroup[] = [{ name: 'General', items: [item('Dashboard', '/dashboard')] }];
  if (isModuleEnabled('finance')) {
    groups.push({
      name: 'Finance',
      items: [
        item('Reports', '/finance'),
        item('Accounts', '/finance/accounts'),
        item('Fee Overview', '/finance/fees'),
        item('Other Income', '/finance/income'),
        item('Expenses', '/finance/expenses'),
      ],
    });
  }
  if (isModuleEnabled('inventory')) {
    // Read-only: the inventory API refuses every write for an accountant.
    groups.push({
      name: 'Inventory',
      items: [
        item('Dashboard', '/inventory'),
        item('Items', '/inventory/items'),
        item('Transactions', '/inventory/transactions'),
        item('Assignments', '/inventory/assignments'),
        item('Reorder Prediction', '/inventory/reorder-prediction'),
      ],
    });
  }
  groups.push({
    name: 'Messages',
    items: [
      ...(isModuleEnabled('notifications') ? [item('Notifications', '/notifications')] : []),
      item('Messages', '/messages'),
    ],
  });
  if (isModuleEnabled('hr')) {
    groups.push({
      name: 'My HR',
      items: [item('My Leave', '/hr/leave'), item('My Attendance', '/hr/attendance'), item('My Payslips', '/hr/payslips')],
    });
  }
  groups.push({ name: 'Me', items: [item('Change Password', '/accountant/change-password')] });
  return groups;
}

export function collectWebPaths(groups: NavGroup[]): string[] {
  return groups.flatMap((g) => g.items.map((i) => i.webPath));
}

// Port of buildStudentNavigation in frontend/src/navigation/navigationConfig.js. The web shows a
// student the same eleven pages whatever modules are on (the APIs gate themselves), plus the
// notifications inbox and change-password here.
export function buildStudentNavigation(): NavGroup[] {
  const item = (name: string, webPath: string): NavItem => ({ name, webPath, href: routeFor('student', webPath) });
  return [
    { name: 'General', items: [item('Dashboard', '/student/dashboard'), item('Notifications', '/notifications')] },
    {
      name: 'My School',
      items: [
        item('Attendance', '/student/attendance'),
        item('Fees', '/student/fees'),
        item('Timetable', '/student/timetable'),
        item('Exam Schedule', '/student/exam-schedule'),
        item('Results', '/student/results'),
        item('Assignments', '/student/assignments'),
        item('Library', '/student/library'),
        item('Transport', '/student/transport'),
      ],
    },
    {
      name: 'Me',
      items: [
        item('AI Study Helper', '/student/study-helper'),
        item('My Profile', '/student/profile'),
        item('Change Password', '/student/change-password'),
      ],
    },
  ];
}

// Port of buildParentNavigation in frontend/src/navigation/navigationConfig.js (Dashboard, Leave,
// Messages), plus the children list, notifications inbox and change-password here.
export function buildParentNavigation(): NavGroup[] {
  const item = (name: string, webPath: string): NavItem => ({ name, webPath, href: routeFor('parent', webPath) });
  return [
    {
      name: 'General',
      items: [
        item('Dashboard', '/parent/dashboard'),
        item('My Children', '/parent/children'),
        item('Messages', '/parent/messages'),
        item('Leave Requests', '/parent/leave'),
        item('Notifications', '/notifications'),
      ],
    },
    { name: 'Me', items: [item('Change Password', '/parent/change-password')] },
  ];
}

// A driver's web sidebar is the Transport group plus their own HR self-service (DRIVER_NAV in
// frontend/src/navigation/navigationConfig.js). On the phone Transport is the journey and
// boarding screens; the web's route, vehicle and assignment admin pages stay on the web.
export function buildDriverNavigation(isModuleEnabled: (key: ModuleKey) => boolean): NavGroup[] {
  const item = (name: string, webPath: string): NavItem => ({ name, webPath, href: routeFor('driver', webPath) });
  const groups: NavGroup[] = [
    {
      name: 'Transport',
      items: [
        item('Dashboard', '/dashboard'),
        item('Active Journey', '/transport/journey'),
        ...(isModuleEnabled('transport') ? [item('Student Boarding', '/transport/boarding')] : []),
      ],
    },
    {
      name: 'General',
      items: [
        ...(isModuleEnabled('notifications') ? [item('Notifications', '/notifications')] : []),
        item('Messages', '/messages'),
      ],
    },
  ];
  if (isModuleEnabled('hr')) groups.push({ name: 'My HR', items: [item('My Leave', '/hr/leave'), item('My Attendance', '/hr/attendance')] });
  groups.push({ name: 'Me', items: [item('Change Password', '/driver/change-password')] });
  return groups;
}
