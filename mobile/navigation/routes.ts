import type { Persona } from './personas';

// Web path -> mobile route, per persona. A path with no entry is "not built yet" and shows
// as "Soon" in the More screen; add the screen, then add its row here (the test in
// __tests__/navConfig.test.ts fails if a row points at a missing file).
const ADMIN_ROUTES: Record<string, string> = {
  '/finance': '/(admin)/finance',
  '/finance/accounts': '/(admin)/finance/accounts',
  '/finance/discounts': '/(admin)/finance/discounts',
  '/finance/categories': '/(admin)/finance/categories',
  '/finance/fees/setup': '/(admin)/finance/fee-setup',
  '/admissions': '/(admin)/admissions',
  '/admissions/conversion-likelihood': '/(admin)/admissions/conversion-likelihood',
  '/inventory': '/(admin)/inventory',
  '/inventory/items': '/(admin)/inventory/items',
  '/inventory/transactions': '/(admin)/inventory/transactions',
  '/inventory/assignments': '/(admin)/inventory/assignments',
  '/inventory/reorder-prediction': '/(admin)/inventory/reorder-prediction',
  '/finance/fees': '/(admin)/finance/fee-overview',
  '/finance/fees/collect': '/(admin)/finance/fee-collection',
  '/finance/income': '/(admin)/finance/income',
  '/finance/expenses': '/(admin)/finance/expense',
  '/students': '/(admin)/students',
  '/students/deleted': '/(admin)/students/deleted',
  '/classes': '/(admin)/classes',
  '/academics/timetable': '/(admin)/timetable',
  '/academics/calendar': '/(admin)/calendar',
  '/academics/subjects': '/(admin)/subjects',
  '/academics/results': '/(admin)/results',
  '/academics/marks-entry': '/(admin)/marks-entry',
  '/academics/exams': '/(admin)/exams-manage',
  '/academics/exam-types': '/(admin)/exam-types',
  '/academics/grade-scale': '/(admin)/grade-scale',
  '/academics/sessions': '/(admin)/sessions',
  '/academics/promotion': '/(admin)/promotion-web',
  '/school-setup': '/(admin)/school-setup-web',
  '/settings': '/(admin)/settings',
  '/academics/academic-risk': '/(admin)/insights',
  '/students/risk-score': '/(admin)/insights',
  '/hr/risk': '/(admin)/insights',
  '/academics/curriculum': '/(admin)/curriculum',
  '/academics/lesson-plans': '/(admin)/lesson-plans',
  '/academics/curriculum-coverage': '/(admin)/coverage',
  '/academics/questions': '/(admin)/questions',
  '/academics/papers': '/(admin)/papers',
  '/academics/paper-builder': '/(admin)/paper-builder',
  '/academics/worksheets': '/(admin)/worksheets',
  '/assessments': '/(admin)/assessments',
  '/academics/assignments': '/(admin)/assignments',
  '/academics/report-cards': '/(admin)/report-cards',
  '/hr': '/(admin)/hr/dashboard',
  '/hr/staff': '/(admin)/hr/staff',
  '/hr/departments': '/(admin)/hr/departments',
  '/hr/documents': '/(admin)/hr/documents',
  '/hr/leave': '/(admin)/hr/leave',
  '/hr/attendance': '/(admin)/hr/attendance',
  '/hr/payroll': '/(admin)/hr/payroll',
  '/hr/salary': '/(admin)/hr/salary',
  '/hr/appraisals': '/(admin)/hr/appraisals',
  '/hr/letters': '/(admin)/hr/letters',
  '/notifications': '/(admin)/inbox',
  '/messages': '/(admin)/messages',
  '/attendance/manual-entry': '/(admin)/attendance/manual',
  '/attendance/register': '/(admin)/attendance/register',
  '/transport': '/(admin)/transport',
  '/transport/routes': '/(admin)/transport/routes',
  '/library': '/(admin)/library',
  '/library/catalog': '/(admin)/library/catalog',
  '/library/issues': '/(admin)/library/issue',
  '/library/overdue': '/(admin)/library/overdue',
  '/hostel': '/(admin)/hostel',
  '/hostel/rooms': '/(admin)/hostel/rooms',
  '/hostel/allocations': '/(admin)/hostel/allocations',
  '/hostel/gate-passes': '/(admin)/hostel/gate-passes',
  '/face-attendance': '/(admin)/face-attendance/capture',
  '/face-attendance/enrollment': '/(admin)/face-attendance/enrollment',
};

const TEACHER_ROUTES: Record<string, string> = {
  '/notifications': '/(teacher)/inbox',
  '/attendance/manual-entry': '/(teacher)/attendance',
  '/attendance/register': '/(teacher)/register',
  '/academics/timetable': '/(teacher)/schedule',
  '/academics/marks-entry': '/(teacher)/marks',
  '/academics/results': '/(teacher)/results',
  '/assessments': '/(teacher)/assessments',
  '/academics/assignments': '/(teacher)/assignments',
  '/academics/report-cards': '/(teacher)/report-cards',
  '/finance/fees/collect': '/(teacher)/fees',
  '/hr/leave': '/(teacher)/leave',
  '/students': '/(teacher)/students',
  '/classes': '/(teacher)/classes',
  '/hr/attendance': '/(teacher)/my-attendance',
  '/academics/exam-schedule': '/(teacher)/exam-schedule',
  '/academics/curriculum': '/(teacher)/curriculum',
  '/academics/lesson-plans': '/(teacher)/lesson-plans',
  '/academics/curriculum-coverage': '/(teacher)/coverage',
  '/academics/questions': '/(teacher)/questions',
  '/academics/papers': '/(teacher)/papers',
  '/academics/paper-builder': '/(teacher)/paper-builder',
  '/academics/worksheets': '/(teacher)/worksheets',
  '/inventory/assignments': '/(teacher)/inventory',
  '/messages': '/(teacher)/messages',
  '/library': '/(teacher)/library',
  '/library/catalog': '/(teacher)/library/catalog',
  '/library/issues': '/(teacher)/library/issue',
  '/library/overdue': '/(teacher)/library/overdue',
  '/transport': '/(teacher)/transport',
  '/transport/routes': '/(teacher)/transport/routes',
};

const MANAGER_ROUTES: Record<string, string> = {
  '/academics/timetable': '/(manager)/schedule',
  '/academics/subjects': '/(manager)/subjects',
  '/academics/calendar': '/(manager)/calendar',
  '/academics/exam-types': '/(manager)/exam-types',
  '/academics/sessions': '/(manager)/sessions-web',
  '/academics/promotion': '/(manager)/promotion-web',
  '/academics/exams': '/(manager)/exams',
  '/academics/assignments': '/(manager)/assignments',
  '/academics/questions': '/(manager)/questions',
  '/academics/paper-builder': '/(manager)/paper-builder',
  '/academics/papers': '/(manager)/papers',
  '/academics/worksheets': '/(manager)/worksheets',
  '/academics/curriculum': '/(manager)/curriculum',
  '/classes': '/(manager)/classes',
  '/hr/leave': '/(manager)/leave',
  '/hr/attendance': '/(manager)/my-attendance',
  '/notifications': '/(manager)/inbox',
  '/messages': '/(manager)/messages',
};

const STUDENT_ROUTES: Record<string, string> = {
  '/student/dashboard': '/(student)/dashboard',
  '/student/attendance': '/(student)/attendance',
  '/student/fees': '/(student)/fees',
  '/student/timetable': '/(student)/schedule',
  '/student/exam-schedule': '/(student)/exam-schedule',
  '/student/results': '/(student)/results',
  '/student/assignments': '/(student)/assignments',
  '/student/library': '/(student)/library',
  '/student/transport': '/(student)/transport',
  '/student/study-helper': '/(student)/ai-helper',
  '/student/profile': '/(student)/profile',
  '/student/change-password': '/(student)/change-password',
  '/notifications': '/(student)/inbox',
};

const PARENT_ROUTES: Record<string, string> = {
  '/parent/dashboard': '/(parent)/dashboard',
  '/parent/children': '/(parent)/children',
  '/parent/messages': '/(parent)/messages',
  '/parent/leave': '/(parent)/leave',
  '/notifications': '/(parent)/inbox',
  '/parent/change-password': '/(parent)/change-password',
};

const DRIVER_ROUTES: Record<string, string> = {
  '/transport/journey': '/(driver)/journey',
  '/messages': '/(driver)/messages',
  '/notifications': '/(driver)/inbox',
  '/hr/leave': '/(driver)/leave',
  '/hr/attendance': '/(driver)/my-attendance',
  '/hr/payslips': '/(driver)/payslips',
  '/driver/change-password': '/(driver)/change-password',
};

const FINANCE_ROUTES: Record<string, string> = {
  '/finance': '/(finance)/reports',
  '/finance/accounts': '/(finance)/accounts',
  '/finance/fees': '/(finance)/fees',
  '/finance/income': '/(finance)/income',
  '/finance/expenses': '/(finance)/expenses',
  '/inventory': '/(finance)/inventory',
  '/inventory/items': '/(finance)/inventory-items',
  '/inventory/transactions': '/(finance)/inventory-movements',
  '/inventory/assignments': '/(finance)/inventory-assignments',
  '/inventory/reorder-prediction': '/(finance)/inventory-reorder',
  '/messages': '/(finance)/messages',
  '/notifications': '/(finance)/inbox',
  '/hr/leave': '/(finance)/leave',
  '/hr/attendance': '/(finance)/my-attendance',
  '/hr/payslips': '/(finance)/payslips',
  '/finance/change-password': '/(finance)/change-password',
};

const STAFF_ROUTES: Record<string, string> = {
  '/hr/self-service': '/(staff)/self-service',
  '/hr/payslips': '/(staff)/payslips',
  '/inventory/assignments': '/(staff)/inventory',
  '/messages': '/(staff)/messages',
  '/notifications': '/(staff)/inbox',
  '/staff/change-password': '/(staff)/change-password',
};

const ROUTES: Partial<Record<Persona, Record<string, string>>> = {
  admin: ADMIN_ROUTES,
  teacher: TEACHER_ROUTES,
  manager: MANAGER_ROUTES,
  student: STUDENT_ROUTES,
  parent: PARENT_ROUTES,
  driver: DRIVER_ROUTES,
  finance: FINANCE_ROUTES,
  staff: STAFF_ROUTES,
};

export function routeFor(persona: Persona, webPath: string): string | undefined {
  if (webPath === '/dashboard') return `/(${persona})/dashboard`;
  return ROUTES[persona]?.[webPath];
}

// A pasted or reloaded URL like "/paper-builder" names no group, so the router may open another persona's
// copy of the screen; this finds the signed-in persona's own screen for that path, if it has one.
export function ownRouteForPath(persona: Persona, pathname: string): string | undefined {
  const candidate = `/(${persona})${pathname}`;
  if (pathname === '/dashboard') return candidate;
  return Object.values(ROUTES[persona] ?? {}).includes(candidate) ? candidate : undefined;
}
