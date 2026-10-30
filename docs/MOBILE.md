# Education AI mobile app

One Expo app (`mobile/`, React Native 0.81, Expo 54, expo-router) for every role. The role decides which route group the user lands in; the web sidebar rules in `frontend/src/navigation/navigationConfig.js` are the source of truth for who sees what. Plan and decisions: `docs/MOBILE_PLAN.md`. Device test script: `docs/MOBILE_QA.md`. Driver tracking and the Play location declaration: `docs/ANDROID_BACKGROUND_LOCATION.md`.

## Layout

| Path | What |
|---|---|
| `app/(admin\|teacher\|manager\|accountant\|staff\|parent\|student\|driver)` | Route group per persona (SUPER_ADMIN, SCHOOL_ADMIN and PRINCIPAL share `(admin)`) |
| `navigation/{personas,navConfig,routes}.ts` | Role to persona, role/module-gated More menu, web path to mobile route table |
| `components/` | Shared screens by area (`attendance`, `exams`, `lms`, `finance`, `hr`, `students`, `messaging`, `notifications`, `nav`, `ui`) |
| `services/` | API clients and pure, unit-tested logic |
| `hooks/` | React Query hooks; `useScopedQuery` puts the school id in the key |
| `__tests__/` | Jest: nav rules per role, pure logic, accessibility roles |

## Commands

```bash
cd mobile
npm install
npm start                      # expo start
npx tsc --noEmit
npx jest
npx expo export --platform android --output-dir <scratch>   # bundle check
```

## Behaviour worth knowing

- **Offline:** read-only. Reference data (classes, subjects, staff, timetable, academic years) is persisted; money, marks, attendance and student data are in memory only. No offline writes. `OfflineBanner` shows when there is no connection.
- **Session:** an access token that expires is refreshed once; only an explicit rejection of the refresh token signs the user out, and the login screen then says the session expired. Logout unregisters the push token first (while still authenticated), then clears tokens and the query cache.
- **Push taps:** the backend sends only `log_id`, so a tap opens the persona's notifications inbox (home if it has none). A `screen` in the payload is honoured only inside the user's own route group (`services/notificationRoute.ts`).
- **Crashes:** a root error boundary shows a plain "Something went wrong" screen. Sentry reporting is on only when `EXPO_PUBLIC_SENTRY_DSN` is set in the EAS build env and the app env is not `development`; it sends no PII, request data or screenshots (`services/crashReporting.ts`). Never commit the DSN.
- **Report files** (finance report, fee collection, defaulters, ledger PDF/Excel) are made by the server and shared through the phone's share sheet (`services/reportShare.ts`), so they are identical to the web downloads. Needs `expo-file-system` and `expo-sharing` (native: rebuild the APK).
- **Accountant** is read-only on all finance APIs; **Staff** is HR self-service, messages, notifications and own inventory. See `MOBILE_PLAN.md` Phase 7.

## Release

- **Identity:** display name `Education AI`, slug `kodereduai` (internal only, never shown to users), package/bundle `pk.educationai.app`. The EAS project is `extra.eas.projectId`. **The slug must match the Expo project's slug, and expo.dev cannot change it** (only the display name). Renaming it would need a new project via `eas init`, which gets a new Android signing key, so old APKs could not update in place. Keep `kodereduai`.
- **Profiles (`eas.json`):** `development` (dev client), `preview` (internal APK, API on Render Singapore), `production` (AAB, `autoIncrement` with remote app version source). No over-the-air updates in v1: every change ships as a new build, so there is no runtime-version policy to maintain.
- **Versioning:** bump `expo.version` in `app.json` for user-visible releases; EAS auto-increments the Android `versionCode`.
- **Native changes** (new native modules, permissions, Sentry) need a fresh EAS build, not just a bundle.

```bash
cd mobile
eas build --platform android --profile preview       # APK for testers
eas build --platform android --profile production    # Play bundle
```

## Play Store checklist

- **Permissions in the manifest:** camera, fine/coarse/background location, foreground service (location). Microphone and boot-complete are not requested.
- **Background location declaration and video:** text in `ANDROID_BACKGROUND_LOCATION.md`.
- **Data safety form (draft, confirm before submitting):**
  - Collected: name, email, phone (account), user ID, precise location (driver role only, during a journey, shared with parents of that route), photos (student and attendance photos the school uploads), app diagnostics (crash reports, if Sentry is on), push token.
  - Shared with third parties: none for advertising. Crash reports go to Sentry if enabled.
  - Encrypted in transit: yes (HTTPS). Users can request deletion through their school (the school owns the data).
  - No ads, no data sold.
- **Privacy policy URL:** the landing site page `privacy` on the Astro site; check the live URL before submitting.
- **Listing assets still to produce:** feature graphic (1024x500), 4 to 8 phone screenshots (use the demo school 42), short and full description, content rating questionnaire, target audience (school staff, parents; not directed at children under 13).
- **Icon and splash:** `assets/icon.png`, `adaptive-icon.png`, `splash-icon.png` exist; check them against Play specs (512x512 icon, adaptive icon safe zone).

## Known gaps (see `PHASE5_KNOWN_FAILURES.md`)

- The finance, hostel, library and notification screens already use the shared loading, error and toast components (checked 2026-10-30). The face attendance screens were moved over then too. The photo-register capture and review screens (`attendance/capture`, `attendance/review`) still use their own handling, but nothing links to them while OCR is parked.
- The report card PDF on the phone comes from a new server endpoint (see the end of this file); it is similar to, not pixel-identical with, the web's browser-made PDF, and non-Latin text (for example Urdu names) is not drawn in it.
- No live device results yet: nothing has been run on a phone.

## Built since: Admissions (2026-10-29)
Admin and principal: enquiries (funnel counts as filters, search, grade and source filters, today and overdue follow-ups, paged), add, edit, confirm, cancel (deletes, as on the web), detail with notes and call log, tap to call, convert confirmed enquiries to students (year, section, optional fee records), and the conversion likelihood scores (last result kept five minutes plus a refresh button). Code: `services/admissions.ts`, `hooks/useAdmissions.ts`, `components/admissions/*`, `app/(admin)/admissions/*`. Never run on a device.

## Built since (2026-10-30)

Admin and principal: exam types and the grade scale; date sheet editing and publishing (schedule and results, per group or per class); per-student fee amounts, month closing and account transfers; users and roles (Settings); staff create and edit, departments and designations, leave policies, staff documents (photos) and qualifications, HR dashboard. Also: staff documents as PDF, photo or Word file (needs `expo-document-picker`, a native module: build a new APK); school profile (logo, letterhead, time zone, exam and attendance settings); subjects, the subjects and class teacher of each section; timetable editing a day at a time, and the periods and breaks of the school day; classes and sections (this year's sections, and the permanent master classes). Code: `services/{examSetup,examGroups,studentFees,accountsAdmin,schoolUsers,hrAdmin,schoolProfile,subjectsAdmin,timetableEdit,classesAdmin}.ts`, matching `hooks/` and `components/{exams,finance,settings,hr,academics}/`. Never run on a device.

**Fixed on the way:** the old admin timetable screen compared the API's day codes (MON) with day names (Monday) and showed no timetable for any class; the old staff list read fields the API does not send. Both were replaced.

**Tab bar:** a folder under a tab group needs its own `_layout.tsx` (use `components/nav/FolderStack.tsx`). Without one, expo-router hoists every file into the parent tab bar as a button; that gave the admin bar 28 extra tabs. `__tests__/routeStructure.test.ts` fails if a folder lacks a layout or an admin route is not declared in `(admin)/_layout.tsx`.

## Sign-in, school choice and app lock (2026-10-30)

- **School front door:** a new phone opens on "Find your school": search by name (3+ letters, listed schools only, 8 at most), type an exact code (works for unlisted schools), or scan the school's QR code (`educationai://school/<code>`). The chosen code is kept across sign-outs and the sign-in page shows that school's logo and name. "Skip" signs in without a school. The code is only a front door: the server still decides which schools a user may use, and the app sends the school id in `X-School-ID`. A school appears in the search only when an admin switches on "Show in the app's school search" (School profile, off by default); that screen also shows the school's QR code and a share button. Server: `GET /api/schools/app-search/`, `/api/schools/app-info/` (public, 30 a minute, code, name and logo only), `GET/PUT /api/schools/app-listing/` (admin); column `School.listed_in_app` (migration `schools/0021`). The older `/api/schools/by-subdomain/` is still used by the web and still returns the full school record to anyone; trimming it is open.
- **Stay signed in:** the app now keeps the rotated refresh token the server returns (it used to keep only the access token, so every phone was signed out about a day after sign-in), and sends `X-Client: mobile` on sign-in. A phone session's refresh token lasts `MOBILE_REFRESH_DAYS` (default 30) of inactivity and renews on each use; the web keeps its short lifetimes. A deactivated user cannot renew. Changing a password does not end a phone session (that needs the token blacklist app and a migration).
- **App lock:** More, "Fingerprint or face lock". Needs the phone's fingerprint, face or screen lock; asks on a cold start and when the app returns after 30 seconds away; turning it on or off needs the prompt. "Sign out and use password" is on the lock screen. Needs `expo-local-authentication`, so a new APK.
- **New native modules since the last APK:** `expo-document-picker`, `react-native-svg` (QR code), `expo-local-authentication`.

## What is left (2026-10-30)

**Moved to version 2 (decided 2026-10-30)**
- Transport management, Library and Hostel screens for admin and principal. The driver app, student/parent transport and library views, and the existing gate-pass and issue/return screens stay as they are.

**Whole areas with no mobile screens for admin and principal**
- Enabled modules in Settings and the school setup wizard (a web notice only).
- Timetable auto-generation, AI suggestions, substitutes and splitting a class timetable into sections; the students-to-section allocator; subject workload and gap analysis; bulk subject assignment.
- Academic calendar editing, sessions and promotion (web notices).
- Staff photo upload, linking or unlinking a staff member's sign-in account, bulk account creation.

**Finance and exams still on the web**
- One-time fees (the server marks admission, books and fine fees deprecated), account and category management, payment gateway setup, AI finance chat and the fee predictor.
- Creating or deleting an exam group on its own (the several-class wizard exists).

**Content still on the web**
- Curriculum sub-topics, content blocks and planned dates; curriculum coverage and syllabus progress pages; lesson plan revisions and attachments.
- Worksheets, AI question generation, picture-paper extraction, questions typed inline in a paper, paper render options, linking a paper to an exam, Word export.

**Platform and release**
- Barcode and SKU scanning for inventory (planned for the end).
- Device testing of everything above, and the role by module matrix in `MOBILE_QA.md`.
- Urdu and right-to-left, dark mode, iOS, over-the-air updates (all deliberately out of v1).
- Store assets (graphics, screenshots, listing text), the Sentry DSN, and a fresh APK for the new native modules.
- Commits: nothing in this work is committed yet.


## Web vs mobile comparison, and the polish list (2026-10-30)

Compared by reading the web pages and components against the mobile screens (no device or browser run). Mobile shares the same API, so the gap is mostly presentation and the AI tools mobile never called.

### The two requested items

| # | Web | Mobile today | To do |
|---|---|---|---|
| 1 | **AI comments.** Results page: Generate Comments (background job, progress, cancel), Regenerate, edit per subject and overall (`generate-comments/`, `comment-job/`, `cancel-comment-job/`, `edit-comment/`, `regenerate-comment/`). Assessments page: AI-suggest the teacher and principal remark from the ratings (`student-term-assessment/ai-remark/` returns `{remark, fallback}`). | Results screen is read-only (its header comment says the AI tools "stay" on the web). Report card shows comments but cannot edit or regenerate. Assessments remark boxes are plain text boxes. | (a) Assessments: "Suggest with AI" button beside both remark boxes, fills the box, teacher edits and saves. (b) Results/Report card: Generate for the exam with progress and cancel, Regenerate and Edit per student and subject, "AI / edited" label. Same role rules as the server (`_assert_can_bulk_generate_comments`). |
| 2 | **User photo.** Profile page: upload (with crop) and remove, `POST/DELETE /api/auth/me/photo/`; `profile_photo_url` is on the user. | The header and More show the **school** logo (`components/nav/SchoolBadge.tsx`). No profile screen, no photo upload; `Avatar` already supports a photo. | Header shows the user's photo (initials if none); the school logo moves into More beside the school name and the switcher. New Profile screen: photo (camera or gallery, crop square, upload, remove), name, phone, email. Needs `expo-image-picker` (new native module: new APK). Parents and students use the same endpoint. |

### Wider comparison (web is richer)

| Area | Web | Mobile | Polish to add |
|---|---|---|---|
| Admin dashboard (608 lines vs 198) | Hero card, stat cards with subtitles, date stepper, attendance breakdown, monthly fee collection card, session health, AI insights, leadership insight panels, guide progress, notifications feed, module health | Needs attention, absent list, quick actions | Stat card row, monthly fee card, attendance breakdown, leadership insights, recent notifications |
| Teacher dashboard (493 vs 297) | Hero (current period), timetable, section attendance, exams and marks entry, students needing attention | Close; no hero for the current period shown as card, no per-section attendance bars | Hero card, section attendance bars |
| Lists | Card/table toggle with shared `RecordCard`, `StatusPill`, `Avatar`, `TrendStrip`, `LedgerCard` | Many lists are plain rows; older admin screens use ad hoc spinners and alerts | Shared record card, consistent loading/error/empty states on the screens listed under Known gaps |
| Charts | Fee charts, trend strips, risk and analytics charts | Mostly numbers and bars | Small trend strips on dashboards, finance and attendance |
| Header / identity | Photo avatar, notification bell with unread count, school and year switchers in the top bar | School logo only | User photo, bell with unread badge, year chip |
| Search | Searchable selects for students and classes | Plain selects in places | Searchable picker for long lists |
| Report card | Templates (traditional/enhanced), bulk print, PDF | View and PDF | Template choice, share PDF in one tap |
| Empty states / skeletons | `EmptyState`, `Skeleton`, `ErrorState` everywhere | Present in the UI kit, not used everywhere | Use them on every list |

### Order of work (proposed)
1. AI remark on Assessments (small, one endpoint).
2. User photo: Profile screen, header avatar, More shows the school logo.
3. Results and report card AI comments (generate, regenerate, edit).
4. Admin dashboard polish, then the shared card, trend strip and empty/loading pass on the older screens.

### Built since (2026-10-30, polish phases A to C; uncommitted, never run on a device)
- **A. AI remark on Assessments:** "Suggest with AI" beside the teacher and principal remarks; fills the box, saves nothing by itself.
- **B. User photo and Profile:** the header and the top of More show the signed-in user's photo (initials if none) and open `my-profile` (all roles): take or choose a photo (square crop), upload, remove, edit name, phone and email. The school logo and name stay in More under the user row. No new native module.
- **C. AI comments:** Results has Generate comments / Regenerate all with live progress and Stop, and per student edit and regenerate; the Report card can edit and regenerate its comments. Code: `components/exams/CommentTools.tsx`, `services/examComments.ts`.
- Plan and what is next: `docs/MOBILE_UI_POLISH_PLAN.md` (phases D to F).
- **D and E (dashboards, header):** admin home has the day hero, four-state attendance bar, monthly fee card and latest notifications; the header has the academic year chip (staff shells), a notification bell with unread count, and the user's photo; `RecordCard` is the shared list row; pickers with more than 8 options get a search box; teachers now have a notifications inbox. Code: `components/dashboard/*`, `components/nav/HeaderActions.tsx`, `components/ui/RecordCard.tsx`, `services/{dashboardView,headerView}.ts`.
- **D finished, F done (2026-10-30, uncommitted, never run on a device):**
  - **D:** admin home has a "School insights" section (admissions and departures, books, question bank, lesson plans by teacher) that loads only when opened; manager, accountant and staff homes share `StatTiles`; accountant and staff homes show the latest notifications. Trend strips are not built (the dashboard API sends no history).
  - **F:** face attendance review, capture and enrollment now use `useScopedQuery`, `Skeleton`/`ErrorState`, the shared `Select` (searchable) and toasts; the review screen no longer resets the reviewer's ticks on a refetch. `__tests__/touchableA11y.test.ts` checks every touchable for a role and every symbol-only button for a label; 24 buttons were fixed (month and day steppers, remove and delete buttons, login links, the school switcher backdrop).

## Report card PDF and layout choice (2026-10-30; backend added, uncommitted, never run on a device)

The report card screen has a PDF layout picker (Enhanced or Traditional, remembered on the phone) and a "Share report card PDF" button that opens the share sheet. The PDF is made by the server: `GET /api/examinations/report-card/pdf/?template=...` (same params and permissions as `report-card/`), built in `backend/examinations/report_card_pdf.py` from that view's own payload, so it cannot disagree with the screen. **This is a backend change** (new view, URL, renderer, tests; no model or migration). Phone side: `services/reportCard.ts` (layout, params, file name, error text), `services/reportCardPrefs.ts`, `components/exams/ReportCardScreen.tsx`, test `__tests__/reportCardPdf.test.ts`. No new native module, so no new APK for this.
Checked here: the renderer's 9 tests pass and both layouts were rendered to images and looked over (single and multi-exam, one page for a typical card, two for a fully loaded multi-exam card). **Not run:** the endpoint tests in `backend/tests/test_phase6_examinations.py` (`test_f5b`, `test_f5c`; Django is not installed in this container) and the endpoint against a real database.
Limits: Helvetica only (Windows-1252 text); no student photo or podium banner on the server PDF; bulk PDFs and the web's own export are unchanged.
