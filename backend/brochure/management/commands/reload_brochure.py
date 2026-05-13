from django.core.management.base import BaseCommand
from brochure.models import BrochureSection

# Import the SECTIONS from the migration
SECTIONS = [
    {
        'key': 'introduction',
        'title': 'Introducing KoderEduAI',
        'order': 0,
        'content_html': """<p><strong>KoderEduAI</strong> is a cloud-based, AI-powered School ERP platform designed for modern educational institutions — from single-branch schools to large multi-campus networks.</p>
<p>Built on a multi-tenant architecture with a simple <strong>per-student pricing model</strong>, every school on the platform gets a fully isolated environment with role-based access, real-time data, and intelligent automation built in from day one.</p>
<blockquote>One plan. Every module. All included. No hidden tiers.</blockquote>
<p>From AI-assisted attendance reading to automated fee collection, timetable management to parent portals, KoderEduAI is the single platform that replaces dozens of disconnected tools. All 18 modules are included in one flat price.</p>""",
    },
    {
        'key': 'use-cases',
        'title': 'Who Is It For?',
        'order': 1,
        'content_html': """<p>KoderEduAI serves a wide range of educational institutions:</p>
<ul>
  <li><strong>Private K-12 Schools</strong> — Full academic year lifecycle: enrolments, timetables, exams, report cards, and parent communication.</li>
  <li><strong>Multi-Branch School Networks</strong> — One admin dashboard to manage all branches. Each campus gets its own isolated data and staff.</li>
  <li><strong>Coaching Institutes &amp; Tuition Centres</strong> — Fast student registration, flexible fee plans, and attendance in seconds.</li>
  <li><strong>International Schools</strong> — Multi-currency finance, curriculum builder, and cloud-first infrastructure.</li>
  <li><strong>Government-Aided Schools</strong> — Budget-friendly per-student model, offline-capable mobile attendance, and bulk reporting tools.</li>
</ul>
<p>No matter the size — 50 students or 5,000 — KoderEduAI scales without configuration overhead. You pay only for the students you have.</p>""",
    },
    {
        'key': 'benefits',
        'title': 'Key Benefits',
        'order': 2,
        'content_html': """<h3>Save Time. Reduce Errors. Delight Parents.</h3>
<ul>
  <li><strong>AI Attendance from Paper Registers</strong> — Photograph a handwritten register and let the AI populate records automatically. Zero manual entry.</li>
  <li><strong>Instant Report Cards</strong> — Generate beautifully formatted PDF report cards for all students with one click.</li>
  <li><strong>Real-Time Fee Tracking</strong> — Automated payment reminders, overdue alerts, and financial dashboards that update the moment a payment lands.</li>
  <li><strong>Unified Parent Portal</strong> — Parents access attendance, marks, fee balances, and communicate with teachers — all from one mobile-friendly app.</li>
  <li><strong>Zero IT Overhead</strong> — Hosted, maintained, and updated by us. Your staff just logs in.</li>
  <li><strong>Role-Based Security</strong> — Nine user roles with granular permissions. Teachers see only their classes; accountants see only finance.</li>
  <li><strong>All 18 Modules Included</strong> — No surprise add-ons. Every school gets students, finance, HR, LMS, transport, library, hostel, inventory, and more.</li>
</ul>""",
    },
    {
        'key': 'features',
        'title': 'Complete Feature Set',
        'order': 3,
        'content_html': """<h3>Academic Management</h3>
<ul>
  <li>Student profiles, bulk import, document storage</li>
  <li>Class and section management with auto-promotion</li>
  <li>Subjects, timetable generation, and scheduling</li>
  <li>Exams, marks entry, and grade scales</li>
  <li>Report card generation and distribution</li>
</ul>
<h3>Attendance & Analytics</h3>
<ul>
  <li>Manual attendance entry</li>
  <li>AI-powered register OCR (upload photo, auto-fill)</li>
  <li>Real-time class and student analytics</li>
  <li>Automated absence notifications to parents</li>
</ul>
<h3>Finance Management</h3>
<ul>
  <li>Fee collection and payment tracking</li>
  <li>Invoicing, receipts, and billing reports</li>
  <li>Expense tracking and budget management</li>
  <li>Discounts and concessions</li>
  <li>Multi-branch reconciliation</li>
</ul>
<h3>HR & Payroll</h3>
<ul>
  <li>Staff profiles and department management</li>
  <li>Salary slips and payroll processing</li>
  <li>Leave management and approvals</li>
  <li>Staff appraisals and evaluations</li>
</ul>
<h3>Communication & Portals</h3>
<ul>
  <li>Parent portal with real-time updates</li>
  <li>In-app notifications, email, and SMS alerts</li>
  <li>Leave request workflows</li>
  <li>Mass messaging and announcements</li>
</ul>
<h3>Operations & Logistics</h3>
<ul>
  <li>Transport routes and vehicle tracking</li>
  <li>Library book management and circulation</li>
  <li>Hostel management and room allocations</li>
  <li>Inventory and procurement tracking</li>
  <li>Gate pass generation and access control</li>
</ul>
<h3>Learning & Development</h3>
<ul>
  <li>Lesson plan creation and sharing</li>
  <li>Assignment distribution and grading</li>
  <li>AI curriculum paper builder (generate question papers)</li>
  <li>AI chat assistant for academic support</li>
</ul>""",
    },
    {
        'key': 'pricing',
        'title': 'Transparent Per-Student Pricing',
        'order': 4,
        'content_html': """<h3>One Plan. All Modules. No Hidden Tiers.</h3>
<table>
  <thead>
    <tr><th>Billing Period</th><th>Price Per Student</th><th>Annual Savings</th></tr>
  </thead>
  <tbody>
    <tr><td><strong>Monthly</strong></td><td>Rs 25 / month</td><td>—</td></tr>
    <tr><td><strong>Annually</strong></td><td>Rs 20 / month</td><td>Save 20%</td></tr>
  </tbody>
</table>
<p style="margin-top: 1rem;"><strong>Examples:</strong></p>
<ul>
  <li>100-student school: <strong>Rs 2,500/month</strong> or <strong>Rs 24,000/year</strong> (save Rs 6,000)</li>
  <li>500-student school: <strong>Rs 12,500/month</strong> or <strong>Rs 120,000/year</strong> (save Rs 30,000)</li>
  <li>1,000-student school: <strong>Rs 25,000/month</strong> or <strong>Rs 240,000/year</strong> (save Rs 60,000)</li>
</ul>
<h3>What's Included?</h3>
<p>Every plan includes all 18 modules:</p>
<p>✓ Student & Class Management · ✓ Attendance & Analytics · ✓ Finance & Payroll · ✓ HR & Leave · ✓ Academic & Exams · ✓ Parent Portal · ✓ LMS & Assignments · ✓ Transport & GPS · ✓ Library & Inventory · ✓ Hostel Management · ✓ Admissions CRM · ✓ AI Features (OCR, Paper Builder, Chat)</p>
<p style="margin-top: 1rem;"><strong>No module add-ons. No surprise charges. Just one simple price based on your student count.</strong></p>
<p style="margin-top: 1rem; font-size: 0.95rem; color: #666;"><em>Prices in Pakistani Rupees (PKR). Annual plans billed once per year. You can upgrade or downgrade your student count anytime; changes take effect on the next billing cycle.</em></p>""",
    },
    {
        'key': 'automations',
        'title': 'Powerful Automations',
        'order': 5,
        'content_html': """<p>KoderEduAI replaces repetitive administrative work with intelligent, configurable automations:</p>
<h3>Attendance Automations</h3>
<ul>
  <li>AI reads scanned handwritten registers and auto-fills records.</li>
  <li>Absent students trigger SMS/WhatsApp notifications to parents automatically.</li>
  <li>Daily absence summaries emailed to principals with no manual effort.</li>
</ul>
<h3>Finance Automations</h3>
<ul>
  <li>Fee schedules auto-generate invoices at the start of each term.</li>
  <li>Overdue reminders escalate via SMS → WhatsApp → email on configurable schedules.</li>
  <li>Salary slips generated and distributed to staff each month automatically.</li>
</ul>
<h3>Academic Automations</h3>
<ul>
  <li>Year-end student promotions run in bulk with one approval click.</li>
  <li>Exam timetables auto-populate the student and teacher portals.</li>
  <li>Assignment due-date reminders sent to students via the LMS module.</li>
  <li>AI generates question papers and model answers in seconds.</li>
</ul>
<h3>Communication Automations</h3>
<ul>
  <li>Holiday announcements and circular letters delivered to all parents instantly.</li>
  <li>Leave request approvals notify teachers and parents in real time.</li>
  <li>Custom scheduled notifications for events and milestones.</li>
</ul>""",
    },
    {
        'key': 'faq',
        'title': 'Frequently Asked Questions',
        'order': 6,
        'content_html': """<h3>How is per-student pricing calculated?</h3>
<p>Simple: You report the number of active students at the start of each billing period. That's it. No hidden per-module charges, no seat licenses for staff — just one price per student.</p>

<h3>Do we need special hardware?</h3>
<p>No. We support both cloud-only (zero hardware) and on-device setups. Your existing phones or tablets are sufficient for attendance capture via our mobile app.</p>

<h3>How long does setup take?</h3>
<p>Most schools are fully operational within 48 hours. Our onboarding team handles data import, user setup, and staff training at no extra charge.</p>

<h3>Is our data safe?</h3>
<p>Yes. All data is encrypted at rest and in transit. Each school's data is fully isolated — no cross-tenant access is possible by design. We comply with GDPR and local data protection laws.</p>

<h3>Can we change our plan anytime?</h3>
<p>Absolutely. You can add more students, remove students, or switch billing periods at any time. Changes take effect on the next billing cycle with no penalty.</p>

<h3>What if we have fewer students mid-year?</h3>
<p>You can reduce your student count, and we'll credit the unused portion to your next invoice. No lock-in contracts.</p>

<h3>Do you offer offline access?</h3>
<p>The mobile app supports offline attendance capture. Data syncs automatically when connectivity is restored.</p>

<h3>What support is included?</h3>
<p>All plans include email support and access to our help center. We also offer optional phone/WhatsApp support and dedicated onboarding for Enterprise customers.</p>

<h3>Can we export our data?</h3>
<p>Yes. You can export student records, financials, and attendance at any time in standard formats (CSV, Excel, PDF). No lock-in.</p>""",
    },
]


class Command(BaseCommand):
    help = 'Reload brochure sections with updated content (pricing, features, etc)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--reset',
            action='store_true',
            help='Delete all existing sections and reload from scratch'
        )

    def handle(self, *args, **options):
        if options['reset']:
            deleted_count, _ = BrochureSection.objects.all().delete()
            self.stdout.write(f"Deleted {deleted_count} sections")
        
        for section_data in SECTIONS:
            section, created = BrochureSection.objects.update_or_create(
                key=section_data['key'],
                defaults={
                    'title': section_data['title'],
                    'order': section_data['order'],
                    'content': {},
                    'content_html': section_data['content_html'],
                    'is_visible': True,
                }
            )
            action = "Created" if created else "Updated"
            self.stdout.write(f"{action} section: {section.title}")

        self.stdout.write(self.style.SUCCESS("✓ Brochure sections reloaded successfully"))
