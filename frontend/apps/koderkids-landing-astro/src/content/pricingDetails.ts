export type PricingTierKey = 'starter' | 'growth' | 'enterprise';

type TierDetail = {
  key: PricingTierKey;
  label: string;
  monthlyPrice: string;
  annualPrice: string;
  summary: string;
  bestFor: string;
  modules: string[];
  capabilities: string[];
  notIncluded: string[];
  expensiveFeatures: string[];
};

export const pricingDetails: Record<PricingTierKey, TierDetail> = {
  starter: {
    key: 'starter',
    label: 'Starter',
    monthlyPrice: 'PKR 6,000 / month',
    annualPrice: 'PKR 64,800 / year (10% off)',
    summary: 'Essential operations for schools starting digital workflows with core finance and exams.',
    bestFor: 'Small schools that need student records, class setup, attendance, fee operations, and report cards.',
    modules: [
      'Students & Classes',
      'Attendance',
      'Academics',
      'Finance',
      'Examinations',
      'Notifications',
    ],
    capabilities: [
      'Student profiles',
      'Manual attendance entry',
      'Basic attendance analytics',
      'Subjects and timetable',
      'Fee collection and expenses',
      'Basic financial reports',
      'Exam scheduling and marks entry',
      'Report card generation',
      'Broadcast notifications',
    ],
    notIncluded: [
      'AI register OCR upload and review',
      'Parent portal and admissions CRM',
      'LMS, transport, library, hostel, inventory',
    ],
    expensiveFeatures: [
      'No payment gateway integration',
      'No WhatsApp absence alerts',
      'No premium AI capabilities',
    ],
  },
  growth: {
    key: 'growth',
    label: 'Growth',
    monthlyPrice: 'PKR 8,000 / month',
    annualPrice: 'PKR 86,400 / year (10% off)',
    summary: 'Full school suite with OCR attendance and core expansion modules.',
    bestFor: 'Growing schools that need finance, exams, admissions, and parent workflows.',
    modules: [
      'Everything in Starter',
      'Finance',
      'Examinations',
      'Parent Portal',
      'Admissions CRM',
      'LMS',
    ],
    capabilities: [
      'AI attendance register upload + OCR review',
      'Fee collection, expenses, discounts, reports',
      'Exam scheduling, marks entry, report cards, grade scales',
      'Parent portal, messaging, leave requests',
      'Admission enquiry tracking and pipeline',
      'Lesson plans, assignments, submissions',
      'WhatsApp absence alerts',
    ],
    notIncluded: [
      'Face recognition attendance',
      'Advanced attendance analytics and auto-tune',
      'Question paper builder',
      'Transport, library, hostel, inventory',
    ],
    expensiveFeatures: [
      'No payment gateway capability in entitlement preset',
      'No AI compose entitlement for notifications',
      'No enterprise-only AI/advanced analytics features',
    ],
  },
  enterprise: {
    key: 'enterprise',
    label: 'Enterprise',
    monthlyPrice: 'PKR 12,000 / month',
    annualPrice: 'PKR 129,600 / year (10% off)',
    summary: 'All modules and all capabilities unlocked, including costly integrations.',
    bestFor: 'Multi-branch or advanced schools that need full automation and premium integrations.',
    modules: [
      'All platform modules (14 toggleable modules)',
      'Transport, Library, Hostel, Inventory',
      'Complete operations + analytics stack',
    ],
    capabilities: [
      'Everything in Growth',
      'Face recognition attendance',
      'Advanced attendance analytics + AI auto-tune',
      'Payment gateway integration',
      'Question paper builder',
      'Notifications AI compose',
      'Admissions analytics',
      'GPS transport tracking',
    ],
    notIncluded: [
      'No functional restrictions from bundle preset',
    ],
    expensiveFeatures: [
      'AI insights and advanced AI capabilities included',
      'WhatsApp + absence alert workflow enabled',
      'Payment gateway capability enabled',
    ],
  },
};
