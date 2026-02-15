export const MODULES = {
  ATTENDANCE: 'attendance',
  FINANCE: 'finance',
  HR: 'hr',
  ACADEMICS: 'academics',
  EXAMINATIONS: 'examinations',
  STUDENTS: 'students',
  NOTIFICATIONS: 'notifications',
  PARENTS: 'parents',
  ADMISSIONS: 'admissions',
  LMS: 'lms',
  TRANSPORT: 'transport',
  LIBRARY: 'library',
  HOSTEL: 'hostel',
} as const;

export type ModuleKey = (typeof MODULES)[keyof typeof MODULES];
