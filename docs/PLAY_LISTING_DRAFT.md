# Play Store listing: draft (2026-11-24)

Draft text for the Google Play listing of the Education AI Android app. Nothing here is submitted; edit freely.
Checklist and data-safety answers: `MOBILE.md`, "Play Store checklist".

## App name (max 30)
Education AI

## Short description (max 80)
School app for staff, teachers, parents and students: attendance, fees, results.

(77 characters)

## Full description (max 4000)

Education AI is the mobile app for schools that use the Education AI school management system. Your school creates your account; sign in with the school code (or QR code) your school gives you.

**For school leaders and office staff**
- Today's attendance, fee collection and items that need attention on one screen
- Students: add, edit, profiles, documents, exits and re-admission
- Fees: collect payments, fee records, discounts and scholarships, accounts and expenses
- Staff: directory, attendance, leave approvals, payroll and payslips
- Exams: create exams and date sheets, marks entry, results and report cards (PDF)
- Admissions enquiries, inventory, library, hostel and transport

**For teachers**
- Mark class attendance in a few taps
- Enter marks, see results, share report cards
- Lesson plans, curriculum coverage, assignments and daily diary
- Build question papers and worksheets, scan a printed paper with the camera, print or share as PDF or Word

**For parents and students**
- Attendance, timetable, exam schedule and results
- Fee status and history
- Assignments and homework
- Messages with teachers and school notifications
- Live bus location while the school bus is on its route

**Also**
- Aura, the built-in assistant: ask about your school data by typing or by voice
- Works in English, with Urdu papers and worksheets
- Sign in with a fingerprint or face once set up

Your school owns its data. Education AI does not show ads and does not sell data.

## Category and audience
- Category: Education
- Target audience: adults (school staff and parents). Students use accounts made by their school; the app is not directed at children under 13. Confirm with the content-rating questionnaire.

## Graphics still needed (not made)
- Store icon 512x512 (scale `mobile/assets/icon.png`)
- Feature graphic 1024x500
- 4 to 8 phone screenshots (demo school 42): dashboard, attendance, fee collection, results/report card, paper builder, parent home

## Privacy policy: proposed additions (not applied)
The live page (`frontend/apps/educationai-landing-astro/src/pages/privacy.astro`, section 3) covers location, camera, push token, saved data and crash reports. Before submitting, it should also say:
- **Microphone (optional).** Used only while you hold or tap the microphone in the Aura assistant. The recording is sent to our speech-to-text provider to turn it into text you can check before sending; the app does not keep it.
- **Assistant and AI features.** Questions you ask Aura, and photos you choose to scan (question papers, book contents pages, documents), are processed by AI service providers working for us (Groq, Cerebras, Google Gemini, Google Cloud Vision) only to answer or read them. They are not used for advertising.
- **Biometric unlock.** Fingerprint or face checks are done by your phone; the app never receives your biometric data.
