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
- The report card PDF on the phone is drawn on the phone (see the report card section above); it is similar to, not pixel-identical with, the web's browser-made PDF.
- No live device results yet: nothing has been run on a phone.

## Built since: Admissions (2026-10-29)
Admin and principal: enquiries (funnel counts as filters, search, grade and source filters, today and overdue follow-ups, paged), add, edit, confirm, cancel (deletes, as on the web), detail with notes and call log, tap to call, convert confirmed enquiries to students (year, section, optional fee records), and the conversion likelihood scores (last result kept five minutes plus a refresh button). Code: `services/admissions.ts`, `hooks/useAdmissions.ts`, `components/admissions/*`, `app/(admin)/admissions/*`. Never run on a device.

## Built since (2026-10-30)

Admin and principal: exam types and the grade scale; date sheet editing and publishing (schedule and results, per group or per class); per-student fee amounts, month closing and account transfers; users and roles (Settings); staff create and edit, departments and designations, leave policies, staff documents (photos) and qualifications, HR dashboard. Also: staff documents as PDF, photo or Word file (needs `expo-document-picker`, a native module: build a new APK); school profile (logo, letterhead, time zone, exam and attendance settings); subjects, the subjects and class teacher of each section; timetable editing a day at a time, and the periods and breaks of the school day; classes and sections (this year's sections, and the permanent master classes). Code: `services/{examSetup,examGroups,studentFees,accountsAdmin,schoolUsers,hrAdmin,schoolProfile,subjectsAdmin,timetableEdit,classesAdmin}.ts`, matching `hooks/` and `components/{exams,finance,settings,hr,academics}/`. Never run on a device.

**Fixed on the way:** the old admin timetable screen compared the API's day codes (MON) with day names (Monday) and showed no timetable for any class; the old staff list read fields the API does not send. Both were replaced.

**Tab bar:** a folder under a tab group needs its own `_layout.tsx` (use `components/nav/FolderStack.tsx`). Without one, expo-router hoists every file into the parent tab bar as a button; that gave the admin bar 28 extra tabs. `__tests__/routeStructure.test.ts` fails if a folder lacks a layout or an admin route is not declared in `(admin)/_layout.tsx`.

## Sign-in, school choice and app lock (2026-10-30)

- **School front door:** a new phone opens on "Find your school": type the school code or scan the school's QR code (`educationai://school/<code>`). The chosen code is kept across sign-outs and the sign-in page shows that school's logo and name. "Skip" signs in without a school. The code is only a front door: the server still decides which schools a user may use, and the app sends the school id in `X-School-ID`. School profile shows the school's QR code and a share button. The code is checked with the web's public `GET /api/schools/by-subdomain/` (it returns the full school record, so the app keeps only code, name and logo; trimming it is open). The name search, the directory and the listing switch were removed in Batch 10 (`app-search`, `app-directory`, `app-info`, `app-listing` deleted from the server); the `School.listed_in_app` column is unused but still in the database. **APK rebuild needed** with the server deploy, since an old APK calls the removed endpoints.
- **Stay signed in:** the app now keeps the rotated refresh token the server returns (it used to keep only the access token, so every phone was signed out about a day after sign-in), and sends `X-Client: mobile` on sign-in. A phone session's refresh token lasts `MOBILE_REFRESH_DAYS` (default 30) of inactivity and renews on each use; the web keeps its short lifetimes. A deactivated user cannot renew. Changing a password does not end a phone session (that needs the token blacklist app and a migration).
- **App lock:** More, "Fingerprint or face lock". Needs the phone's fingerprint, face or screen lock; asks on a cold start and when the app returns after 30 seconds away; turning it on or off needs the prompt. "Sign out and use password" is on the lock screen. Needs `expo-local-authentication`, so a new APK.
- **New native modules since the last APK:** `expo-document-picker`, `react-native-svg` (QR code), `expo-local-authentication`.

## What is left (2026-10-30)

**Moved to version 2 (decided 2026-10-30)**
- Transport management, Library and Hostel screens for admin and principal. The driver app, student/parent transport and library views, and the existing gate-pass and issue/return screens stay as they are.

**Whole areas with no mobile screens for admin and principal**
- Enabled modules in Settings and the school setup wizard (a web notice only).
- Timetable auto-generation, AI suggestions, substitutes and splitting a class timetable into sections; the students-to-section allocator; subject workload and gap analysis; bulk subject assignment.
- Academic calendar editing and promotion (web notices). Academic years and terms are built (see below); the AI Setup Wizard and the calendar coverage, planning and holiday-suggestion pages stay on the web.
- Staff photo upload, linking or unlinking a staff member's sign-in account, bulk account creation.

**Finance and exams still on the web**
- One-time fees (the server marks admission, books and fine fees deprecated), payment gateway setup, AI finance chat and the fee predictor (no web page uses it).
- Re-opening a closed month (the web never calls it either).

**Built 2026-11-02 (uncommitted, browser-tested as SEED_TEST_admin, not on a phone):** account management (Accounts > Manage: add, edit, active and staff-visible, delete; `include_inactive` is sent so an inactive account can be edited and deleted) and a Categories screen (expense, income, monthly fee, annual fee: add, rename, delete, fee suggestions, sensitive flag when the server shows it). Admin and principal only. Same endpoints the web uses; no server change. Delete confirmations use `Alert`, which does nothing in the browser, so delete was checked against the API only. Income edit and delete go beyond the web (it only creates them inline).

**Timetable completed 2026-11-02 (uncommitted, browser-tested as SEED_TEST_admin on the seed timetable; read-only checks, nothing was written):** the admin Timetable screen has a Day / Week switch. Week is the web's grid: periods down, days across (only the days that have lessons), each lesson in its subject's colour with teacher and room, breaks as bars, section-only lessons marked with a dot; it scrolls sideways, and tapping a lesson jumps to that day and opens the period. Quality score badge (`quality_score`) with the five-part breakdown, hidden while there are unsaved changes. Picking a teacher in the period sheet checks `teacher_conflicts` and shows who they already teach, with "Suggest alternatives" (`suggest_resolution`: free teachers, free periods, swaps) and tap-to-use. "Find a substitute" (`suggest_substitute`: teacher and date). "Give each section its own timetable" (`split_for_sections`, with confirmation, only for a section that shares the class timetable). The Manager's read-only timetable gets the same Day / Week switch, the score badge, and the Timetable PDF (the server's own `download-pdf`, valid PDF checked), and the admin screen keeps its PDF. Auto-generate, slot suggestions and bulk-create from them stay on the web (decided). Server notes: the quality score, clash suggestions and substitute finder are labelled "AI" but are rule-based; while editing a section, `teacher_conflicts` still counts the class's shared lessons as clashes (the same on the web). Not built because no web page uses it: `GET timetable-entries/`.

**Picture extraction built 2026-11-02 (uncommitted, browser-tested against the real server AI with a generated paper image, not with a phone camera):** "Capture from photos" in the paper builder (needs class and subject) and a "Scan" tab in the worksheet builder, one shared `PaperCaptureSheet`. Take or choose a photo (JPEG, PNG or WebP, up to 10 MB), the server stores it and reads it in the background (OCR and an AI reading), the app polls every 2.5 s for up to 3 minutes; later pages are sent with the first page's `group_id`; a failed page can be retried under its own number. Review: paper title and duration from the first page's header, the sections (shared section editor) and every question (text, type, marks, MCQ options, section, remove), and a note when the captured marks differ from the printed total (papers only). Accept: a worksheet gets the sections and inline items; a paper gets each reviewed question created in the bank (the mobile builder works from bank questions) and placed in its section, the title and duration set, and once the paper is saved each page is confirmed (`confirm`, feedback only). The capture is held by the builder, so closing the sheet keeps it; there is no recovery after the app is closed (the web keeps it in the browser). Test result: a generated one-page paper came back as 2 sections and 6 questions (extraction confidence 0.85, about 40 s) and a worksheet as 1 section and 4 items; the paper saved with all of them and the page showed CONFIRMED. The photo files stay in the server's storage (not removable from here). Browser note: React Native sends a picked file as { uri, name, type }, which a browser cannot read, so the capture sheet fetches the bytes first on the web (`services/formFile.ts`); the contents scan and question pictures still use the plain form and work on phones only. Not built because no web page uses them: `GET paper-uploads/`, `GET worksheet-uploads/`, worksheet `confirm`.

**Worksheets built 2026-11-02 (uncommitted, browser-tested as SEED_TEST_admin, not on a phone):** Worksheets list for admin, principal, teacher and manager (replaces the read-only list): class, subject and status filters, search, "+ New worksheet" (title, class, optional subject; `ensure-draft`), Share PDF, Share Word, Duplicate (opens the copy) and Delete. Worksheet builder: title, instructions, the same sections editor as the paper builder (now a shared `SectionsEditor`), and items added by hand (type, section, question, MCQ options, answer, optional marks, optional picture), from the question bank (several at once, questions already on the sheet left out), reordered and removed. A draft autosaves 0.8 s after you stop with Saving / Saved / Save failed, and once more when you leave; a worksheet that is not a draft is read-only. The server saves inline items into the question bank as well. Differences from the web: question text is plain text (the web stores rich text HTML); matching questions cannot be written on a worksheet; the bank picker filters by subject only (the web also sends the class, which hides questions with no topic link); scanning a printed sheet comes with picture extraction. Not built because no web page uses them: `PATCH worksheets/{id}/`, worksheet upload list and confirm.

**Question bank and paper builder completed 2026-11-02 (uncommitted, browser-tested as SEED_TEST_admin, not on a phone):** Question bank: Keyword / By meaning switch (`semantic_search`, needs a class, 600 ms wait, falls back to keyword results when nothing is close, hits show book > chapter > topic), thinking-level and tag filters, subject tags in the question form (pick or create; linked after the first save, or at once on a saved question), AI badges "AI · Unverified / Verified" with "Mark verified" (`verified_by`, `verified_at`). Papers list: class, subject and status filters, Select / Select page / Delete selected (`bulk_delete`, page-scoped, shows skipped papers and why), Share Word (`generate-docx`) next to Share PDF. Paper builder: optional Exam (this class, this year) with the title following "Exam - Class - Subject" until you type your own, answer lines option (`render_options`), lesson plans of the class and subject (linked on save with `link_lesson_plans`, and they narrow the question picker to their topics with `topics=` repeated), "Write a new question" (creates a bank question and adds it), a thinking-level mix, and a curriculum coverage panel (`coverage_stats`: objectives covered and not, percent, marks mismatch warning) refreshed by "Save and check coverage". Server findings, not fixed: (1) the web's AI source filter (`is_ai_generated`, `verified_by__isnull`) is ignored by the server, so it never filters; mobile does not offer it. (2) The server never returns a question's tags, so neither client can list which tags a question has (adding, removing and the tag filter work). (3) `class_id` only matches questions tagged to topics of that class's books, so a question with no topics never appears in a by-meaning search for a class (and the paper builder's bank picker needs the topic link). (4) A paper loaded from the server has no thinking level per question (the server's paper rows omit it), so the mix counts those as unclassified; the web does the same. Not built because no web page uses them: `GET questions/{id}`, `by_lesson_plan`, `generate_from_lesson`, `create_from_lessons`, `review-questions`, `paper-feedback`. Matching questions and pictures are written in the question bank, not in the builder's quick question form.

**Curriculum completed 2026-11-02 (uncommitted, browser-tested as SEED_TEST_admin, not on a phone):** the book screen now matches the web Curriculum page. A book card shows details and syllabus progress (topics with a published lesson plan, `books/syllabus_progress/`), Edit book (title, author, publisher, edition, language, description) and Delete (admin, principal, teacher, manager), and Search content (the web's semantic search, 600 ms after typing). "Add contents" now takes a photo, or typed or pasted text: lines labelled CHAPTER: / TOPIC: are used as they are, text over 50 KB goes to `parse_toc_stream`, anything else to `parse_toc`, and "Build outline with AI" calls `suggest_toc` with `raw_text`, exactly as the web does; the outline is checked and trimmed before anything is added. Each topic opens a Topic screen: content blocks (8 types, order, difficulty, minutes, optional rich JSON; add, edit, delete), revision history with restore, tags (add or remove, subject tags), and sub-topic text and minutes. Topics already taught show a tick. Server findings: (1) `suggest_toc` never reached the AI: `toc_ai_suggester.py` called `TOC_SUGGESTION_PROMPT.format(raw_text=...)` on a prompt that contains literal `{ "chapters": ...}` braces, so Python raised KeyError and the server answered with its rule-based fallback (the web too). FIXED 2026-11-02 (`.replace`, regression test `test_suggest_toc_reaches_the_ai_prompt`); a live call now answers source `ai`, confidence 0.99. (2) The server never returns a block's tags, so neither the web nor mobile can list which tags a block has (adding and removing work). Not built because no web page uses them: `bulk_toc`, `GET books/{id}`, `GET chapters/`, `GET subtopics/`, creating or deleting sub-topics, `topics/{id}/standards`.

**Academic years and terms built 2026-11-02 (uncommitted, browser-tested as SEED_TEST_admin, not on a phone):** Academic Sessions screen (admin and principal; replaces the "on the web" notice for them, managers keep it): years with status, dates and a term bar, add, edit, set as current (confirm dialog, then `confirm_warnings`), delete; the form shows the server's overlap and length warnings live with a Save anyway button. Terms screen per year: bar, list, add (90 day default starting the day after the last term), edit, delete, and import from another year (preview with create, update, skip and conflict counts, apply blocked on conflicts). **Reworked the same day to match the web:** the Terms screen is one page with a draggable year bar (drag the selected term's start and end handles; edges snap to whole days and never cross; hatched grey = days no term covers, red rings = overlaps, month labels, today line), the terms as chips, the selected term's fields inline with -7 / -1 / +1 / +7 day buttons for fine adjustment, a coverage summary, and a button that adds a term for the first uncovered stretch. Edits autosave after 0.7 s; an overlap or a server warning holds the change with a "Save anyway" button. The years list shows the same bar, compact. Pure rules in `services/yearTimeline.ts`. Dragging was checked with the mouse in a browser, not with a finger on a phone. Same endpoints as the web; no server change. Delete confirmations use `Alert`, which does nothing in a browser.
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

## Report card PDF and layout choice (rebuilt 2026-11-02: the phone draws it, no server endpoint)

The report card screen has a PDF layout picker (Enhanced or Traditional, remembered on the phone) and a "Share report card PDF" button that opens the share sheet. The PDF is **drawn on the phone** from the report card data the screen already loads (`GET /api/examinations/report-card/`, the same call the web uses) and the school's name, address and logo (`GET /api/schools/current/`): `services/reportCardHtml.ts` builds an HTML page in either layout (pure, 17 tests), `services/reportCardPdf.ts` turns it into a PDF file with **`expo-print`** (a new native module: **APK rebuild needed**), and `services/reportShare.ts` opens the share sheet. The class ZIP (admin, principal, teacher) loads each student's card data the same way, draws each PDF on the phone and packs them with `fflate`. The former server endpoint `report-card/pdf/` and its ReportLab renderer were **deleted** (2026-11-02): there is no mobile-only report card endpoint any more. Because the page is HTML, Urdu and other non-Latin names now print, which the old server PDF could not do. **Not run on a phone:** `expo-print` has no browser version, so the PDF itself, the ZIP and the logo loading are untested; the HTML layout was checked in the browser (a trimmed copy of a real card) and the generator by unit tests. Limits: the traditional frame is drawn around the content, so on a card that runs to a second page the frame lines break at the page edge; no student photo or podium banner (as before).

**Teacher, Batch 11 (2026-11-01):** teachers now have Messages (`app/(teacher)/messages/*`, shared messaging screens; a new thread carries the web's message type), Worksheets and, when items are assigned, My Inventory; the teacher Report Cards screen has the class ZIP button. No new packages or native modules, so no APK rebuild is needed for this batch beyond the earlier Batch 9 and 10 ones.

**Teacher, Batch 12 (2026-11-01):** Curriculum Coverage (`app/(teacher|admin)/coverage.tsx`, `components/lms/CurriculumCoverageScreen.tsx`, `services/curriculumCoverage.ts`), Daily Diary (`components/lms/DailyDiaryScreen.tsx`, `services/dailyDiary.ts`, `assignments/diary` in the teacher and admin stacks), the Class teacher / Subject teacher badge (`services/teacherScope.ts`, `components/teacher/ScopeBadge.tsx`) and the dashboard Lesson plans this week and Notifications panels. New calls the web already makes: `lms/topics/` (list), `lms/topics/{id}/set-planned-date/`, `academics/class-subjects/my_subject_assignments/`. No new packages or native modules: no APK rebuild needed for this batch.

**Student, Batch 13 (2026-11-01):** the student Home now has a tasks tile, off-day N/A for attendance, Recent results, a Notifications panel and nine quick links; Attendance shades closed days (shared with the parent child view); Results show Pass / Fail / Absent and a Total row. New code: `useStudentDayStatus` in `hooks/useStudentPortal.ts` and the pure helpers in `services/studentPortal.ts`. No new packages or native modules: no APK rebuild needed for this batch.

**Student, Batch 14 (2026-11-02):** Fees has Due / Paid / Outstanding tiles and a year filter (shared with the parent child view); the profile shows guardian email; the AI Study Helper has starter questions (`ChatInterface` got an optional `suggestions` prop); the student timetable shows Break / Lunch / Assembly rows with a legend. No new packages or native modules: no APK rebuild needed for this batch.

**Parent, Batch 15 (2026-11-02):** the parent Home has an attention strip (`components/parent/AttentionStrip.tsx`, `attentionItems` in `services/parentPortal.ts`, `useChildOverviews`). No new packages or native modules: no APK rebuild needed for this batch.

**Accountant, Batch 16 (2026-11-02):** the Fees screen opens with the fee collection card (`FeeOverviewCard`); Home has an Income vs expense panel and an Account balances list (`components/finance/IncomeExpenseCard.tsx`, now also used by Reports); the accountant balances now load (`accountsOf` in `services/accountant.ts`; they read as empty before). No new packages or native modules: no APK rebuild needed for this batch.

**Accountant, Batch 17 (2026-11-02):** Accounts has a Ledger view per account and a read-only Transfers list; Expenses has Expenses and Transfers tabs, a month filter and a category breakdown; Other Income has the month filter (`components/finance/{AccountLedgerScreen,MonthFilter}.tsx`, `TransfersScreen` got a `readOnly` prop). No new packages or native modules: no APK rebuild needed for this batch.

**Manager, Batch 18 (2026-11-02):** the manager Exams screen is now a read-only list with each exam subjects (`ExamsAdminScreen` got a `readOnly` prop); Home has a Lesson Plans tile and the Question Bank, Paper Builder and Assignments quick actions. No new packages or native modules: no APK rebuild needed for this batch.

**Manager, Batch 19 (2026-11-02):** the manager Assignments screen creates and edits DRAFTS only (new assignment, Daily diary, Edit and Delete on drafts); the teacher is set by the server and a teacher publishes. Needs the matching backend change (`lms/assignment_rules.py`, `AssignmentViewSet`), so **deploy the server first**: an old server still demands a teacher and will refuse the manager form. No new packages or native modules: no APK rebuild needed beyond the earlier ones.

**Staff, Batch 20 (2026-11-02):** the staff Home has Attendance this month and Leave balance tiles, Leave balance and Assigned items panels, and My Profile and Notifications quick actions; the My Attendance cards (shared by every role that has them) now read the real summary keys (`attendanceCounts` in `services/myHr.ts`). No new packages or native modules: no APK rebuild needed for this batch.

**Driver, Batch 21 (2026-11-02):** the driver Home has Attendance this month, Leave balance and Latest payslip tiles, quick actions, and Leave balance, Recent payslips and Notifications panels; a My Payslips screen (More > My HR). The staff and driver Homes share `components/hr/OwnHrHome.tsx`. **Test driver for browser and phone checks:** `SEED_TEST_driver_app` in school 37, created by `python manage.py seed_test_driver` (idempotent, `--remove` deletes it). No new packages or native modules: no APK rebuild needed for this batch.

**API cleanup (2026-11-02, owner decision "use the existing APIs"):** the mobile app now calls only endpoints the web also calls, except the two push-token calls. Removed: **driver boarding** (the `transport/driver/boarding/` view, its URL, serializer, the `IsDriver` permission and the 9 tests on the server; the Boarding tab, its hook, API calls and logic on the phone; the web driver has no boarding either), **the server report card PDF** (replaced by the on-phone PDF above), and the **unused `payment-status` client call** (the server endpoint stays: the web uses it). Mobile-only endpoints: 2 (push token register and unregister, kept as the only real need). **Deploy note:** deploying this server removes `driver/boarding/` and `report-card/pdf/`, so an old app build that still has the Boarding tab or the Share PDF button stops working for those two features: ship the new APK together with the server.
