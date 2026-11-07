/* ─── Site-wide config ─────────────────────────────── */
const fallbackApiBase = import.meta.env.DEV
  ? ''
  : 'https://personal-gateway-sg.onrender.com/educationai';
const publicApiBase = (import.meta.env.PUBLIC_MAIN_APP_API_BASE_URL || fallbackApiBase).replace(/\/$/, '');

export const siteConfig = {
  brandName: 'Education AI',
  productName: 'Education AI',
  siteUrl: import.meta.env.SITE_URL || 'https://www.educationai.pk',
  salesEmail: 'admin@educationai.pk',
  contactPhone: '03167394390',
  contactCity: 'Islamabad',
  demoRequestEndpoint:
    import.meta.env.PUBLIC_DEMO_FORM_ENDPOINT ||
    `${publicApiBase || ''}/api/public/forms/demo-request/`,
  contactEnquiryEndpoint:
    import.meta.env.PUBLIC_CONTACT_FORM_ENDPOINT ||
    `${publicApiBase || ''}/api/public/forms/contact-enquiry/`,
  careersEndpoint:
    import.meta.env.PUBLIC_CAREERS_FORM_ENDPOINT ||
    `${publicApiBase || ''}/api/public/careers/apply/`,
  demoUrl: 'https://demo.educationai.pk',
  // The guide videos are uploaded once, with the main app; the public guide plays them from there.
  guideVideoBase: (import.meta.env.PUBLIC_GUIDE_VIDEO_BASE || 'https://m3d1a.educationai.pk').replace(/\/$/, ''),
  twitterUrl: 'https://twitter.com/koderkidspk',
  linkedInUrl: 'https://www.linkedin.com/company/koderkids',
  youtubeUrl: 'https://youtube.com/@koderkids',
};

/* ─── Typed content for the landing page ──────────── */
export const landingContent = {
  /* SEO */
  // Titles over ~60 characters and descriptions over ~160 are cut off in Google results.
  title: 'School Management Software & AI Agent | Education AI',
  description:
    'Cloud school management software and AI agent for Pakistan: attendance, fees, exams, timetable, HR and parent portal in one place. Book a free demo.',

  /* ── Hero ─────────────────────────────────────────── */
  hero: {
    label: 'EDUCATION AI',
    heading: 'Run your whole school from one place, with an AI agent that does the admin work.',
    subheading:
      'Admissions, attendance, finance, academics, HR, transport, inventory — one cloud platform with AI-assisted workflows for every role.',
    primaryCta: { label: 'Book a Demo', href: '#contact' },
    secondaryCta: { label: 'See it in action', href: '#walkthrough' },
    dashboardImage: '/screens/dashboard-desktop.webp',
    dashboardAlt: 'Education AI dashboard showing daily attendance, fee collection against target and upcoming school events',
    /* Fallback metrics shown when live fetch is unavailable */
    metrics: {
      schools: '1,200+',
      students: '450K+',
      teachers: '35K+',
      countries: '45',
    },
  },

  /* ── Platform Overview ────────────────────────────── */
  overview: {
    label: 'WHY EDUCATION AI',
    heading: 'One Platform. Every Workflow.',
    subheading:
      '18 connected modules, 9 role-based experiences, and AI that works across your entire school.',
    pillars: [
      {
        icon: 'zap',
        color: 'amber',
        title: 'Automate Admin',
        desc: 'Attendance, billing, and reports run themselves — freeing up hours every day.',
      },
      {
        icon: 'brain',
        color: 'blue',
        title: 'AI Across Modules',
        desc: 'Finance AI, Academics AI and Communication AI built into everyday school workflows.',
      },
      {
        icon: 'network',
        color: 'emerald',
        title: 'Connected Campus',
        desc: 'Parents, teachers, and admins on one platform — no fragmented tools.',
      },
      {
        icon: 'trending',
        color: 'violet',
        title: 'Operational Insights',
        desc: 'Attendance risk, session health, fee anomalies — visible before they become problems.',
      },
    ] as const,
  },

  /* ── Product Walkthrough slides (Phase 3 island; Phase 2 shows first slide) ── */
  walkthrough: {
    label: 'PRODUCT WALKTHROUGH',
    heading: 'See Your School Platform',
    subheading: 'Screen from the live platform',
    slides: [
      {
        id: 'dashboard',
        alt: 'Dashboard with an attendance ring, fee collection against target chart and upcoming school events',
        label: 'Dashboard',
        title: 'Your Whole School at a Glance',
        description:
          'The command center: attendance overview, today\'s schedule, fee alerts, and system-wide health — one screen.',
        bullets: [
          'Live attendance ring with class drill-down',
          'Fee collection vs target chart',
          'Upcoming events + quick actions panel',
        ],
        image: '/screens/dashboard-desktop.webp',
        imageMobile: '/screens/dashboard-mobile.webp',
        color: 'sky',
      },
      {
        id: 'attendance',
        alt: 'Monthly academic calendar with holidays, exam periods and school events marked',
        label: 'Academic Calendar',
        title: 'Academic Calendar Planning & Tracking',
        description:
          'Configure working days, holidays, exam periods, and school events in one monthly calendar view.',
        bullets: [
          'Month-wise calendar completeness indicator',
          'Single-day and date-range event marking',
          'Automatic Sunday and off-day handling',
        ],
        image: '/screens/calendar-desktop.webp',
        imageMobile: '/screens/calendar-mobile.webp',
        color: 'indigo',
      },
      {
        id: 'academics',
        alt: 'Weekly drag-and-drop timetable with teacher and room clash warnings',
        label: 'Time table',
        title: 'Timetable & Lesson Plans',
        description:
          'Drag-and-drop weekly timetable with automatic clash detection. Lesson plans linked to curriculum objectives.',
        bullets: [
          'Conflict detection across teachers and rooms',
          'AI-assisted lesson plan generation',
          'Curriculum coverage progress bar',
        ],
        image: '/screens/timetable-desktop.webp',
        imageMobile: '/screens/timetable-mobile.webp',
        color: 'emerald',
      },
      {
        id: 'finance',
        alt: 'Fee ledger screen with fee types, due dates and a class-wise collection summary',
        label: 'Finance',
        title: 'Fee Ledger & Collection',
        description:
          'Per-student fee ledgers, monthly billing cycles, partial payments, discounts, and outstanding reports.',
        bullets: [
          'Fee type setup with annual/monthly toggle',
          'Automated due-date alerts via SMS / app',
          'Class-wise collection summary dashboard',
        ],
        image: '/screens/fees-desktop.webp',
        imageMobile: '/screens/fees-mobile.webp',
        color: 'violet',
      },
      {
        id: 'hr',
        alt: 'Staff profile, payroll and leave management screen',
        label: 'HR & Staff',
        title: 'Staff, Salary & Leave',
        description:
          'Complete HR from hiring to payroll: departments, designations, salary slabs, leave management, and appraisals.',
        bullets: [
          'Staff profile with document vault',
          'Payroll generation with deductions',
          'Leave calendar with approval workflow',
        ],
        image: '/screens/hr-desktop.webp',
        imageMobile: '/screens/hr-mobile.webp',
        color: 'rose',
      },
      {
        id: 'exams',
        alt: 'Marks entry and grade scale setup with printable student report cards',
        label: 'Exams',
        title: 'Marks, Grade Scales & Report Cards',
        description:
          'Configurable grade scales per exam, marks entry per subject, and one-click printable report cards.',
        bullets: [
          'Weighted exam scoring with grade mapping',
          'Per-student report card generation',
          'Class-wise result analytics with pass/fail breakdown',
        ],
        image: '/screens/exams-desktop.webp',
        imageMobile: '/screens/exams-mobile.webp',
        color: 'amber',
      },
      {
        id: 'parents',
        alt: 'Notification centre sending announcements to staff, students and parents with delivery status',
        label: 'Notifications',
        title: 'School Notifications & Alerts',
        description:
          'Send targeted announcements to staff, students, and parents with clear delivery visibility.',
        bullets: [
          'Broadcast by role, class, or whole school',
          'In-app notification history and status',
          'Fee, event, and attendance reminder alerts',
        ],
        image: '/screens/notifications-desktop.webp',
        imageMobile: '/screens/notifications-mobile.webp',
        color: 'teal',
      },
      {
        id: 'lms',
        alt: 'Lesson plan editor showing topics, objectives and curriculum coverage by subject',
        label: 'Lesson Plans',
        title: 'Lesson Planning by Class & Subject',
        description:
          'Create and manage lesson plans mapped to timetable slots and curriculum objectives.',
        bullets: [
          'Plan topics with objectives and classwork',
          'Track curriculum coverage progress by subject',
          'Share plans with academic leadership for review',
        ],
        image: '/screens/lessonplans-desktop.webp',
        imageMobile: '/screens/lessonplans-mobile.webp',
        color: 'fuchsia',
      },
      {
        id: 'settings',
        alt: 'Multi-school settings with user role permissions and module toggles',
        label: 'Settings',
        title: 'Multi-School & Role Configuration',
        description:
          'One super-admin account manages a network of schools. Each school controls its own modules and user roles.',
        bullets: [
          '9 built-in roles with granular permissions',
          'Per-school module enable/disable toggle',
          'Academic year and term configuration',
        ],
        image: '/screens/settings-desktop.webp',
        imageMobile: '/screens/settings-mobile.webp',
        color: 'slate',
      },
    ],
  },

  /* ── Social Proof ─────────────────────────────────── */
  socialProof: {
    label: 'TRUSTED BY SCHOOLS',
    heading: 'What Principals Say',
    testimonials: [
      {
        name: 'Dr. Ayesha Khan',
        role: 'Principal, Beacon Horizon School, Lahore',
        content:
          'The AI attendance upload alone saves our admin team 3 hours daily. The fee module replaced our spreadsheet process completely and made fee follow-ups much faster.',
        avatar: 'AK',
      },
      {
        name: 'Usman Tariq',
        role: 'Director, The City Campus Network, Karachi',
        content:
          'We run four branches from one account. The multi-school switcher and per-campus reporting finally give us clean oversight without extra manual work.',
        avatar: 'UT',
      },
      {
        name: 'Sara Mahmood',
        role: 'Principal, Allied Public School, Islamabad',
        content:
          'Parent engagement increased sharply after launching the parent portal. Families now check fees, attendance, and marks themselves, and front-desk call volume dropped right away.',
        avatar: 'SM',
      },
    ],
    metrics: [
      { value: '1,200+', label: 'Schools' },
      { value: '450K+', label: 'Students' },
      { value: '35K+', label: 'Teachers' },
      { value: '45', label: 'Countries' },
    ],
  },

  /* ── Pricing ──────────────────────────────────────── */
  pricing: {
    label: 'PRICING',
    heading: 'Simple Per-Student Pricing',
    subheading:
      'One plan. Every module. Pay only for the students you have. Priced in PKR. Annual billing saves 20%.',
    plans: [
      {
        tier: 'flat',
        badge: 'All Modules Included' as string | null,
        title: 'All-Inclusive Plan',
        desc: 'Every module, every feature — one simple per-student price. No tiers, no gates.',
        monthlyPrice: 'Rs 25 / student / month',
        annualPrice: 'Rs 20 / student / month (billed annually)',
        features: [
          'Students, Classes & Bulk Import',
          'Academics, Timetable & Exams',
          'Finance, Fees & Payroll',
          'Parent Portal & Admissions CRM',
          'LMS, Transport, Hostel, Library & Inventory',
          'AI Paper Builder & AI Finance Assistant',
          'Fee collection via Kuickpay',
          'Mobile App (Android)',
        ],
        cta: 'Book a Free Demo',
        highlight: true,
        accentClass: 'text-white',
        badgeBg: 'bg-white/15 text-white',
      },
    ],
  },

  /* ── Trust Strip ──────────────────────────────────── */
  trustStrip: {
    items: [
      {
        icon: 'shield',
        title: 'Role-Based Access',
        desc: '9 scoped roles — each user sees only what they need.',
      },
      {
        icon: 'network',
        title: 'School-Scoped Isolation',
        desc: 'Multi-tenant architecture — data never crosses school boundaries.',
      },
      {
        icon: 'mobile',
        title: 'Mobile Ready',
        desc: 'Android app for parents and teachers.',
      },
      {
        icon: 'zap',
        title: 'Secure Cloud Hosting',
        desc: 'Accessible from anywhere, on any device. No on-premise setup required.',
      },
    ] as const,
  },

  /* ── Final CTA ────────────────────────────────────── */
  finalCta: {
    label: 'GET STARTED',
    heading: 'Ready to run a fully connected school?',
    subheading:
      'Book a personalized demo — see admissions, academics, attendance, and finance workflows in one production-ready platform.',
    chips: ['Cloud-based', 'Role-based access', 'AI-assisted workflows', '18 live modules', 'PKR pricing', 'Kuickpay fee collection', 'Urdu video guides'],
    primaryCta: { label: 'Book a Demo', href: '#contact' },
    secondaryCta: { label: 'Try Live Demo', href: 'https://demo.educationai.pk' },
    formTitle: 'Send us a message',
  },

  /* ── Footer ───────────────────────────────────────── */
  footer: {
    tagline:
      'A complete school operating system for admissions, academics, attendance, finance, HR, transport, and inventory.',
    productLinks: [
      // Rooted with "/" so the anchors also work from /about, /guide and the other inner pages.
      { label: 'Platform Overview', href: '/#overview' },
      { label: 'Feature Walkthrough', href: '/#walkthrough' },
      { label: 'Pricing', href: '/#pricing' },
      { label: 'User Guide & Videos', href: '/guide' },
      { label: 'Live Demo', href: 'https://demo.educationai.pk', external: true },
    ],
    companyLinks: [
      { label: 'Contact', href: '/#contact' },
      { label: 'Careers', href: '/careers' },
      { label: 'About', href: '/about' },
    ],
    legalLinks: [
      { label: 'Privacy Policy', href: '/privacy', modalKey: 'privacy' },
      { label: 'Terms of Service', href: '/terms', modalKey: 'terms' },
      { label: 'Support', href: '/support', modalKey: 'support' },
    ],
    copyright: 'Education AI, a product of Koder Kids Pvt Ltd',
  },
};

/* ─── FAQ content (used for JSON-LD FAQPage schema) ── */
export const faqContent = [
  {
    question: 'What is Education AI?',
    answer:
      'Education AI is a cloud-based school operating system that brings admissions, attendance, academics, finance, HR, transport, library, hostel, and inventory management into a single platform designed for K-12 schools.',
  },
  {
    question: 'How does attendance work in Education AI?',
    answer:
      'Teachers mark attendance class by class on the web or the Android app. Admins see class-wise attendance analytics and risk flags, and parents can follow attendance in the parent portal.',
  },
  {
    question: 'Can Education AI manage multiple school branches?',
    answer:
      'Yes. The platform is fully multi-tenant. Each school or branch operates in an isolated data environment. A super-admin can oversee all organisations, while school admins only see their own data.',
  },
  {
    question: 'What modules are included in Education AI?',
    answer:
      'Education AI includes 18 modules: Admissions, Attendance, Academics, Examinations, Finance & Fees, HR & Payroll, Transport & GPS, Library, Hostel & Gate Passes, Inventory, LMS & Assignments, Parent Portal, Notifications, Reports, and more.',
  },
  {
    question: 'Is Education AI available on mobile?',
    answer:
      'Yes. An Android app is available, giving teachers, parents, and admins on-the-go access to attendance, notifications, fee status, and more.',
  },
  {
    question: 'How is school data kept secure?',
    answer:
      'All data is encrypted in transit (TLS) and at rest. Role-based access control ensures users only see data relevant to their role. Files are kept in private, access-controlled cloud storage. The platform is built following OWASP security best practices.',
  },
  {
    question: 'Can I try Education AI before committing?',
    answer:
      'Yes. Request a demo with the form on this page and we will email you login details for a ready-made demo school at demo.educationai.pk. Our team will also contact you to walk you through the platform.',
  },
  {
    question: 'How is Education AI pricing structured?',
    answer:
      'Education AI has one all-inclusive plan with every module: Rs 25 per student per month, or Rs 20 per student per month when billed annually (20% less). There are no tiers and prices are in PKR.',
  },
  {
    question: 'Is Education AI built for Pakistani schools?',
    answer:
      'Yes. Pricing is in PKR, parents can pay school fees through Kuickpay, and the video tutorials are available in both Urdu and English. The application interface itself is in English.',
  },
];
