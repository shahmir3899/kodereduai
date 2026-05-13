// Flat pricing model — single plan with all modules included.
// Updated: 2026-05-13 (removed 3-tier Starter/Growth/Enterprise structure)

export type PricingTierKey = 'flat';

type TierDetail = {
  key: PricingTierKey;
  label: string;
  monthlyPrice: string;
  annualPrice: string;
  summary: string;
  bestFor: string;
  modules: string[];
  capabilities: string[];
  highlights: string[];
};

export const pricingDetails: Record<PricingTierKey, TierDetail> = {
  flat: {
    key: 'flat',
    label: 'All-Inclusive Plan',
    monthlyPrice: 'PKR 8,000 / month',
    annualPrice: 'PKR 86,400 / year (10% off)',
    summary: 'Every module. Every feature. One simple price. No tiers, no gates.',
    bestFor: 'Schools of any size that want a complete digital school management platform without choosing a plan.',
    modules: [
      'Students & Classes',
      'Attendance (Manual + Analytics)',
      'Academics & Timetable',
      'Examinations & Report Cards',
      'Finance & Fee Management',
      'HR & Payroll',
      'Parent Portal',
      'Admissions CRM',
      'LMS (Lesson Plans & Assignments)',
      'Notifications (In-App, Email, Push)',
      'Transport & GPS Tracking',
      'Library Management',
      'Hostel Management',
      'Inventory Management',
    ],
    capabilities: [
      'Student profiles, bulk import, document store',
      'Manual attendance entry and class-level analytics',
      'Subjects, timetable, academic sessions, bulk promotions',
      'Exam scheduling, marks entry, grade scales, report cards',
      'Fee collection, expenses, discounts, financial reports',
      'Staff profiles, payroll, leave management, appraisals',
      'Parent portal, messaging, leave requests',
      'Admission enquiries, pipeline CRM, batch conversion, analytics',
      'Lesson plans, homework assignments, submissions',
      'In-app notifications, email alerts, mobile push',
      'Route and stop management, GPS vehicle tracking',
      'Book catalog, issue/return, overdue fines',
      'Room management, allocations, gate passes',
      'Item tracking, procurement, staff/student assignments',
    ],
    highlights: [
      'AI-powered curriculum question paper builder',
      'AI finance assistant and AI notification drafting',
      'Multi-branch / multi-school support',
      'Role-based access (Admin, Principal, Teacher, HR, Accountant, Parent, Student)',
      'Supabase file storage for documents and images',
      'Mobile app for teachers and parents (Android)',
    ],
  },
};
};
