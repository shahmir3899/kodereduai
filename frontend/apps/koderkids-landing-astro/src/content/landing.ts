/* ─── Site-wide config ─────────────────────────────── */
const publicApiBase = (import.meta.env.PUBLIC_MAIN_APP_API_BASE_URL || '').replace(/\/$/, '');

export const siteConfig = {
  salesEmail: 'admin@koderkids.pk',
  contactPhone: '03167394390',
  contactCity: 'Islamabad',
  careersEndpoint:
    import.meta.env.PUBLIC_CAREERS_FORM_ENDPOINT ||
    `${publicApiBase || ''}/api/public/careers/apply/`,
  demoUrl: 'https://demo.kodereduai.pk',
  twitterUrl: 'https://twitter.com/koderkidspk',
  linkedInUrl: 'https://www.linkedin.com/company/koderkids',
  youtubeUrl: 'https://youtube.com/@koderkids',
};

/* ─── Typed content for the landing page ──────────── */
export const landingContent = {
  /* SEO */
  title: 'Education AI for Schools',
  description:
    'Modern school operations platform with AI-assisted attendance, fees, academics, communication, and analytics in one connected experience.',

  /* ── Hero ─────────────────────────────────────────── */
  hero: {
    label: 'EDUCATION AI',
    heading: 'The School Operating System Powered by AI.',
    subheading:
      'Admissions, attendance, finance, academics, HR, transport, inventory — one cloud platform with AI-assisted workflows for every role.',
    primaryCta: { label: 'Book a Demo', href: '#contact' },
    secondaryCta: { label: 'See it in action', href: '#walkthrough' },
    dashboardImage: '/dashboard_overview.jpg',
    dashboardAlt: 'Education AI School Dashboard Overview',
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
        desc: 'Finance AI, Academics AI, Communication AI, and an OCR attendance pipeline.',
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
    subheading: 'Real screens from the live platform — not mockups.',
    slides: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        title: 'Your Whole School at a Glance',
        description:
          'The command center: attendance overview, today\'s schedule, fee alerts, and system-wide health — one screen.',
        bullets: [
          'Live attendance ring with class drill-down',
          'Fee collection vs target chart',
          'Upcoming events + quick actions panel',
        ],
        image: '/dashboard.jpg',
        color: 'sky',
      },
      {
        id: 'attendance',
        label: 'Academic Calendar',
        title: 'Academic Calendar Planning & Tracking',
        description:
          'Configure working days, holidays, exam periods, and school events in one monthly calendar view.',
        bullets: [
          'Month-wise calendar completeness indicator',
          'Single-day and date-range event marking',
          'Automatic Sunday and off-day handling',
        ],
        image: '/academiccalendar.jpg',
        color: 'indigo',
      },
      {
        id: 'academics',
        label: 'Time table',
        title: 'Timetable & Lesson Plans',
        description:
          'Drag-and-drop weekly timetable with automatic clash detection. Lesson plans linked to curriculum objectives.',
        bullets: [
          'Conflict detection across teachers and rooms',
          'AI-assisted lesson plan generation',
          'Curriculum coverage progress bar',
        ],
        image: '/timetable.jpg',
        color: 'emerald',
      },
      {
        id: 'finance',
        label: 'Finance',
        title: 'Fee Ledger & Collection',
        description:
          'Per-student fee ledgers, monthly billing cycles, partial payments, discounts, and outstanding reports.',
        bullets: [
          'Fee type setup with annual/monthly toggle',
          'Automated due-date alerts via SMS / app',
          'Class-wise collection summary dashboard',
        ],
        image: '/fee.jpg',
        color: 'violet',
      },
      {
        id: 'hr',
        label: 'HR & Staff',
        title: 'Staff, Salary & Leave',
        description:
          'Complete HR from hiring to payroll: departments, designations, salary slabs, leave management, and appraisals.',
        bullets: [
          'Staff profile with document vault',
          'Payroll generation with deductions',
          'Leave calendar with approval workflow',
        ],
        image: '/hrstaff.jpg',
        color: 'rose',
      },
      {
        id: 'exams',
        label: 'Exams',
        title: 'Marks, Grade Scales & Report Cards',
        description:
          'Configurable grade scales per exam, marks entry per subject, and one-click printable report cards.',
        bullets: [
          'Weighted exam scoring with grade mapping',
          'Per-student report card generation',
          'Class-wise result analytics with pass/fail breakdown',
        ],
        image: '/exams.jpg',
        color: 'amber',
      },
      {
        id: 'parents',
        label: 'Notifications',
        title: 'School Notifications & Alerts',
        description:
          'Send targeted announcements to staff, students, and parents with clear delivery visibility.',
        bullets: [
          'Broadcast by role, class, or whole school',
          'In-app notification history and status',
          'Fee, event, and attendance reminder alerts',
        ],
        image: '/messages.jpg',
        color: 'teal',
      },
      {
        id: 'lms',
        label: 'Lesson Plans',
        title: 'Lesson Planning by Class & Subject',
        description:
          'Create and manage lesson plans mapped to timetable slots and curriculum objectives.',
        bullets: [
          'Plan topics with objectives and classwork',
          'Track curriculum coverage progress by subject',
          'Share plans with academic leadership for review',
        ],
        image: '/lessonplan.jpg',
        color: 'fuchsia',
      },
      {
        id: 'settings',
        label: 'Settings',
        title: 'Multi-School & Role Configuration',
        description:
          'One super-admin account manages a network of schools. Each school controls its own modules and user roles.',
        bullets: [
          '9 built-in roles with granular permissions',
          'Per-school module enable/disable toggle',
          'Academic year and term configuration',
        ],
        image: '/settings.jpg',
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
        name: 'Dr. Sarah Mitchell',
        role: 'Principal, Oakridge Academy',
        content:
          'The AI attendance upload alone saves our admin team 3 hours a day. The fee module replaced an entire spreadsheet workflow. I\'d never go back.',
        avatar: 'SM',
      },
      {
        name: 'Michael Chen',
        role: 'Director, Global Learning Institute',
        content:
          'We run 4 branches from one account. The multi-school switcher and per-branch reporting make oversight genuinely easy for the first time.',
        avatar: 'MC',
      },
      {
        name: 'Priya Sharma',
        role: 'Principal, Delhi Public School',
        content:
          'Parent engagement went up 60% after we gave parents the portal. They check fees, attendance, and marks themselves — reception calls dropped immediately.',
        avatar: 'PS',
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
    heading: 'Flexible Plans by School Stage',
    subheading:
      'Simple monthly billing with annual savings for every plan.',
    plans: [
      {
        tier: 'Starter',
        badge: null as string | null,
        title: 'Core Operations',
        desc: 'Manual attendance, student management, timetable, and notifications.',
        monthlyPrice: 'PKR 6,000 / month',
        annualPrice: 'PKR 64,800 / year (10% off)',
        features: [
          'Students & Classes',
          'Manual Attendance',
          'Subjects & Timetable',
          'Broadcast Notifications',
        ],
        cta: 'Discuss Plan',
        highlight: false,
        accentClass: 'text-sky-400',
        badgeBg: '',
      },
      {
        tier: 'Growth',
        badge: 'Most Popular',
        title: 'Full School Suite',
        desc: 'AI register OCR, finance, exams, parent portal, admissions, and LMS.',
        monthlyPrice: 'PKR 8,000 / month',
        annualPrice: 'PKR 86,400 / year (10% off)',
        features: [
          'Everything in Starter',
          'AI Register Upload & OCR Review',
          'Fee Collection & Reports',
          'Exams, Marks & Report Cards',
          'Parent Portal & Messaging',
          'Admissions CRM & LMS',
        ],
        cta: 'Discuss Plan',
        highlight: true,
        accentClass: 'text-white',
        badgeBg: 'bg-white/15 text-white',
      },
      {
        tier: 'Enterprise',
        badge: null as string | null,
        title: 'Full Platform + AI',
        desc: 'All 18 modules + face recognition, AI paper builder, and payment gateway.',
        monthlyPrice: 'PKR 12,000 / month',
        annualPrice: 'PKR 129,600 / year (10% off)',
        features: [
          'Everything in Growth',
          'Face Recognition Attendance',
          'AI Question Paper Builder',
          'Online Payment Gateway',
          'Transport, Hostel, Library & Inventory',
          'HR, Payroll & Appraisals',
        ],
        cta: 'Discuss Plan',
        highlight: false,
        accentClass: 'text-amber-400',
        badgeBg: '',
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
        desc: 'Native iOS and Android apps for parents and teachers.',
      },
      {
        icon: 'zap',
        title: 'Cloud Infrastructure',
        desc: 'Hosted on Supabase + Render — no on-premise setup required.',
      },
    ] as const,
  },

  /* ── Final CTA ────────────────────────────────────── */
  finalCta: {
    label: 'GET STARTED',
    heading: 'Ready to run a fully connected school?',
    subheading:
      'Book a personalized demo — see admissions, academics, attendance, and finance workflows in one production-ready platform.',
    chips: ['Cloud-based', 'Role-based access', 'AI-assisted workflows', '18 live modules'],
    primaryCta: { label: 'Book a Demo', href: '#contact' },
    secondaryCta: { label: 'Try Live Demo', href: 'https://demo.kodereduai.pk' },
    formTitle: 'Send us a message',
  },

  /* ── Footer ───────────────────────────────────────── */
  footer: {
    tagline:
      'A complete school operating system for admissions, academics, attendance, finance, HR, transport, and inventory.',
    productLinks: [
      { label: 'Platform Overview', href: '#overview' },
      { label: 'Feature Walkthrough', href: '#walkthrough' },
      { label: 'Pricing', href: '#pricing' },
      { label: 'Live Demo', href: 'https://demo.kodereduai.pk', external: true },
    ],
    companyLinks: [
      { label: 'Contact', href: '#contact' },
      { label: 'Careers', href: '/careers' },
      { label: 'About', href: '/about' },
    ],
    legalLinks: [
      { label: 'Privacy Policy', href: '/privacy', modalKey: 'privacy' },
      { label: 'Terms of Service', href: '/terms', modalKey: 'terms' },
      { label: 'Support', href: '/support', modalKey: 'support' },
    ],
    copyright: 'Education AI (a product of Koder Kids)',
  },
};

/* ─── FAQ content (used for JSON-LD FAQPage schema) ── */
export const faqContent = [
  {
    question: 'What is Education AI?',
    answer:
      'Education AI is a cloud-based school operating system that brings admissions, AI-assisted attendance, academics, finance, HR, transport, library, hostel, and inventory management into a single platform designed for K-12 schools.',
  },
  {
    question: 'How does the AI-powered attendance work?',
    answer:
      'Teachers photograph handwritten attendance registers. Education AI uses Google Cloud Vision OCR and an LLM to extract student names and present/absent marks from the image. Staff review the extracted data, confirm it, and the system saves the records — no manual data entry required.',
  },
  {
    question: 'Can Education AI manage multiple school branches?',
    answer:
      'Yes. The platform is fully multi-tenant. Each school or branch operates in an isolated data environment. A super-admin can oversee all organisations, while school admins only see their own data.',
  },
  {
    question: 'What modules are included in Education AI?',
    answer:
      'Education AI includes 18 modules: Admissions, Attendance (AI-powered), Academics, Examinations, Finance & Fees, HR & Payroll, Transport & GPS, Library, Hostel & Gate Passes, Inventory, LMS & Assignments, Parent Portal, Notifications, Reports, and more.',
  },
  {
    question: 'Is Education AI available on mobile?',
    answer:
      'Yes. A React Native mobile app is available for iOS and Android, giving teachers, parents, and admins on-the-go access to attendance, notifications, fee status, and more.',
  },
  {
    question: 'How is school data kept secure?',
    answer:
      'All data is encrypted in transit (TLS) and at rest. Role-based access control ensures users only see data relevant to their role. File storage is hosted on Supabase with private bucket policies. The platform is built following OWASP security best practices.',
  },
  {
    question: 'Can I try Education AI before committing?',
    answer:
      'Yes. Book a live demo via the form on this page and our team will walk you through the platform with a fully seeded demo environment. You can also access the live demo at demo.kodereduai.pk.',
  },
  {
    question: 'How is pricing structured?',
    answer:
      'Education AI offers three plans: Starter (PKR 6,000/month), Growth (PKR 8,000/month), and Enterprise (PKR 12,000/month). Annual billing gets a 10% discount on each plan.',
  },
];
