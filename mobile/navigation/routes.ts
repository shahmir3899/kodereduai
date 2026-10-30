import type { Persona } from './personas';

// Web path -> mobile route, per persona. A path with no entry is "not built yet" and shows
// as "Soon" in the More screen; add the screen, then add its row here (the test in
// __tests__/navConfig.test.ts fails if a row points at a missing file).
const ADMIN_ROUTES: Record<string, string> = {
  '/finance': '/(admin)/finance',
  '/finance/accounts': '/(admin)/finance/accounts',
  '/finance/discounts': '/(admin)/finance/discounts',
  '/finance/fees/setup': '/(admin)/finance/fee-setup',
  '/admissions': '/(admin)/admissions',
  '/admissions/conversion-likelihood': '/(admin)/admissions/conversion-likelihood',
  '/inventory': '/(admin)/inventory',
  '/inventory/items': '/(admin)/inventory/items',
  '/inventory/transactions': '/(admin)/inventory/transactions',
  '/inventory/assignments': '/(admin)/inventory/assignments',
  '/inventory/reorder-prediction': '/(admin)/inventory/reorder-prediction',
  '/finance/fees/collect': '/(admin)/finance/fee-collection',
  '/finance/income': '/(admin)/finance/income',
  '/finance/expenses': '/(admin)/finance/expense',
  '/students': '/(admin)/students',
  '/classes': '/(admin)/classes',
  '/academics/timetable': '/(admin)/timetable',
  '/academics/results': '/(admin)/results',
  '/academics/marks-entry': '/(admin)/marks-entry',
  '/academics/exams': '/(admin)/exams-manage',
  '/academics/exam-types': '/(admin)/exam-types-web',
  '/academics/grade-scale': '/(admin)/grade-scale-web',
  '/academics/sessions': '/(admin)/sessions-web',
  '/academics/promotion': '/(admin)/promotion-web',
  '/school-setup': '/(admin)/school-setup-web',
  '/academics/academic-risk': '/(admin)/insights',
  '/students/risk-score': '/(admin)/insights',
  '/hr/risk': '/(admin)/insights',
  '/academics/curriculum': '/(admin)/curriculum',
  '/academics/lesson-plans': '/(admin)/lesson-plans',
  '/academics/questions': '/(admin)/questions',
  '/academics/papers': '/(admin)/papers',
  '/academics/paper-builder': '/(admin)/paper-builder',
  '/assessments': '/(admin)/assessments',
  '/academics/assignments': '/(admin)/assignments',
  '/academics/report-cards': '/(admin)/report-cards',
  '/hr/staff': '/(admin)/hr/staff',
  '/hr/leave': '/(admin)/hr/leave-approvals',
  '/hr/payroll': '/(admin)/hr/payroll',
  '/hr/salary': '/(admin)/hr/salary',
  '/hr/appraisals': '/(admin)/hr/appraisals',
  '/hr/letters': '/(admin)/hr/letters',
  '/notifications': '/(admin)/inbox',
  '/attendance/manual-entry': '/(admin)/attendance/manual',
  '/attendance/register': '/(admin)/attendance/register',
  '/transport': '/(admin)/transport',
  '/library/issues': '/(admin)/library/issue',
  '/hostel/gate-passes': '/(admin)/hostel/gate-passes',
  '/face-attendance': '/(admin)/face-attendance/capture',
  '/face-attendance/enrollment': '/(admin)/face-attendance/enrollment',
};

const TEACHER_ROUTES: Record<string, string> = {
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
  '/academics/questions': '/(teacher)/questions',
  '/academics/papers': '/(teacher)/papers',
  '/academics/paper-builder': '/(teacher)/paper-builder',
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
  '/transport/boarding': '/(driver)/boarding',
  '/messages': '/(driver)/messages',
  '/notifications': '/(driver)/inbox',
  '/hr/leave': '/(driver)/leave',
  '/hr/attendance': '/(driver)/my-attendance',
  '/driver/change-password': '/(driver)/change-password',
};

const ACCOUNTANT_ROUTES: Record<string, string> = {
  '/finance': '/(accountant)/reports',
  '/finance/accounts': '/(accountant)/accounts',
  '/finance/fees': '/(accountant)/fees',
  '/finance/income': '/(accountant)/income',
  '/finance/expenses': '/(accountant)/expenses',
  '/inventory': '/(accountant)/inventory',
  '/inventory/items': '/(accountant)/inventory-items',
  '/inventory/transactions': '/(accountant)/inventory-movements',
  '/inventory/assignments': '/(accountant)/inventory-assignments',
  '/inventory/reorder-prediction': '/(accountant)/inventory-reorder',
  '/messages': '/(accountant)/messages',
  '/notifications': '/(accountant)/inbox',
  '/hr/leave': '/(accountant)/leave',
  '/hr/attendance': '/(accountant)/my-attendance',
  '/hr/payslips': '/(accountant)/payslips',
  '/accountant/change-password': '/(accountant)/change-password',
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
  accountant: ACCOUNTANT_ROUTES,
  staff: STAFF_ROUTES,
};

export function routeFor(persona: Persona, webPath: string): string | undefined {
  if (webPath === '/dashboard') return `/(${persona})/dashboard`;
  return ROUTES[persona]?.[webPath];
}
