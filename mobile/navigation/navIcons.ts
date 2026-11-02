import type { IconName } from '../components/ui/Icon';

// Icons for the menu, matching the web sidebar's picks (frontend/src/navigation/navigationConfig.js,
// Heroicons there, the nearest Ionicons here). Kept apart from navConfig.ts, which is a port of
// the web rules. Keyed by the web path, which is unique per entry; the test in
// __tests__/navIcons.test.ts fails when a menu entry has no icon.
const ITEM_ICONS: Record<string, IconName> = {
  '/dashboard': 'home-outline',
  '/attendance/manual-entry': 'create-outline',
  '/attendance/register': 'grid-outline',
  '/face-attendance': 'checkbox-outline',
  '/messages': 'mail-outline',
  '/notifications': 'notifications-outline',

  '/finance': 'bar-chart-outline',
  '/finance/accounts': 'cash-outline',
  '/finance/fees': 'checkbox-outline',
  '/finance/fees/collect': 'receipt-outline',
  '/finance/fees/setup': 'settings-outline',
  '/finance/income': 'cash-outline',
  '/finance/expenses': 'wallet-outline',
  '/finance/discounts': 'pricetag-outline',
  '/finance/categories': 'list-outline',

  '/academics/subjects': 'school-outline',
  '/academics/timetable': 'time-outline',
  '/academics/exam-types': 'folder-outline',
  '/academics/exams': 'clipboard-outline',
  '/academics/exam-schedule': 'calendar-outline',
  '/assessments': 'document-text-outline',
  '/academics/marks-entry': 'document-text-outline',
  '/academics/grade-scale': 'options-outline',
  '/academics/results': 'bar-chart-outline',
  '/academics/report-cards': 'ribbon-outline',
  '/academics/assignments': 'document-text-outline',
  '/academics/questions': 'create-outline',
  '/academics/paper-builder': 'create-outline',
  '/academics/papers': 'document-text-outline',
  '/academics/worksheets': 'document-text-outline',
  '/academics/curriculum': 'book-outline',
  '/academics/curriculum-coverage': 'bar-chart-outline',
  '/academics/lesson-plans': 'book-outline',
  '/academics/analytics': 'bar-chart-outline',
  '/academics/academic-risk': 'warning-outline',
  '/academics/calendar': 'calendar-outline',
  '/academics/sessions': 'calendar-outline',
  '/academics/promotion': 'people-outline',

  '/hr': 'bar-chart-outline',
  '/hr/staff': 'people-outline',
  '/hr/departments': 'folder-outline',
  '/hr/salary': 'cash-outline',
  '/hr/payroll': 'receipt-outline',
  '/hr/payslips': 'receipt-outline',
  '/hr/leave': 'calendar-outline',
  '/hr/attendance': 'checkbox-outline',
  '/hr/appraisals': 'star-outline',
  '/hr/documents': 'document-text-outline',
  '/hr/letters': 'document-text-outline',
  '/hr/risk': 'warning-outline',
  '/hr/self-service': 'calendar-outline',

  '/classes': 'grid-outline',
  '/students': 'people-outline',
  '/students/risk-score': 'warning-outline',
  '/students/deleted': 'trash-outline',
  '/admissions': 'person-add-outline',
  '/admissions/conversion-likelihood': 'warning-outline',

  '/transport': 'bar-chart-outline',
  '/transport/routes': 'location-outline',
  '/transport/vehicles': 'bus-outline',
  '/transport/assignments': 'people-outline',
  '/transport/attendance': 'checkbox-outline',
  '/transport/journey': 'navigate-outline',

  '/library': 'bar-chart-outline',
  '/library/catalog': 'search-outline',
  '/library/issues': 'book-outline',
  '/library/overdue': 'warning-outline',

  '/hostel': 'bar-chart-outline',
  '/hostel/rooms': 'grid-outline',
  '/hostel/allocations': 'people-outline',
  '/hostel/gate-passes': 'document-text-outline',

  '/inventory': 'bar-chart-outline',
  '/inventory/items': 'folder-outline',
  '/inventory/transactions': 'document-text-outline',
  '/inventory/assignments': 'people-outline',
  '/inventory/reorder-prediction': 'warning-outline',

  '/guide': 'book-outline',
  '/school-setup': 'rocket-outline',
  '/settings': 'settings-outline',

  '/parent/dashboard': 'home-outline',
  '/parent/children': 'people-outline',
  '/parent/leave': 'calendar-outline',
  '/parent/messages': 'mail-outline',

  '/student/dashboard': 'home-outline',
  '/student/attendance': 'clipboard-outline',
  '/student/fees': 'cash-outline',
  '/student/timetable': 'time-outline',
  '/student/exam-schedule': 'calendar-outline',
  '/student/results': 'bar-chart-outline',
  '/student/assignments': 'create-outline',
  '/student/library': 'library-outline',
  '/student/transport': 'bus-outline',
  '/student/study-helper': 'chatbubbles-outline',
  '/student/profile': 'person-outline',

  '/accountant/change-password': 'key-outline',
  '/driver/change-password': 'key-outline',
  '/parent/change-password': 'key-outline',
  '/staff/change-password': 'key-outline',
  '/student/change-password': 'key-outline',
};

// Group headers, as on the web (Heroicons there).
const GROUP_ICONS: Record<string, IconName> = {
  General: 'home-outline',
  Attendance: 'clipboard-outline',
  Finance: 'cash-outline',
  Academics: 'book-outline',
  'Content Creation': 'create-outline',
  'Planning & Delivery': 'calendar-outline',
  'HR & Staff': 'briefcase-outline',
  Management: 'folder-outline',
  Admissions: 'person-add-outline',
  Transport: 'bus-outline',
  Library: 'library-outline',
  Hostel: 'home-outline',
  Inventory: 'checkbox-outline',
  Messages: 'mail-outline',
  'My HR': 'briefcase-outline',
  'My School': 'school-outline',
  Me: 'person-outline',
  Pinned: 'star-outline',
  Recent: 'time-outline',
};

const FALLBACK: IconName = 'ellipse-outline';

export const itemIcon = (webPath: string): IconName => ITEM_ICONS[webPath] ?? FALLBACK;
export const groupIcon = (name: string): IconName => GROUP_ICONS[name] ?? FALLBACK;
export const hasItemIcon = (webPath: string) => webPath in ITEM_ICONS;
export const hasGroupIcon = (name: string) => name in GROUP_ICONS;
