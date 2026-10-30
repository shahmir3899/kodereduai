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

- The older admin screens (finance dashboard, expenses, income, transactions, hostel gate passes, library issue, notification send and history, attendance capture/review, face attendance) still use ad hoc spinners and alerts rather than the shared loading, error and offline components.
- Icon-only buttons have roles but not all have descriptive labels.
- No live device results yet: nothing has been run on a phone.

## Built since: Admissions (2026-10-29)
Admin and principal: enquiries (funnel counts as filters, search, grade and source filters, today and overdue follow-ups, paged), add, edit, confirm, cancel (deletes, as on the web), detail with notes and call log, tap to call, convert confirmed enquiries to students (year, section, optional fee records), and the conversion likelihood scores (last result kept five minutes plus a refresh button). Code: `services/admissions.ts`, `hooks/useAdmissions.ts`, `components/admissions/*`, `app/(admin)/admissions/*`. Never run on a device.

## Built since (2026-10-30)

Admin and principal: exam types and the grade scale; date sheet editing and publishing (schedule and results, per group or per class); per-student fee amounts, month closing and account transfers; users and roles (Settings); staff create and edit, departments and designations, leave policies, staff documents (photos) and qualifications, HR dashboard. Also: staff documents as PDF, photo or Word file (needs `expo-document-picker`, a native module: build a new APK); school profile (logo, letterhead, time zone, exam and attendance settings); subjects, the subjects and class teacher of each section; timetable editing a day at a time, and the periods and breaks of the school day; classes and sections (this year's sections, and the permanent master classes). Code: `services/{examSetup,examGroups,studentFees,accountsAdmin,schoolUsers,hrAdmin,schoolProfile,subjectsAdmin,timetableEdit,classesAdmin}.ts`, matching `hooks/` and `components/{exams,finance,settings,hr,academics}/`. Never run on a device.

**Fixed on the way:** the old admin timetable screen compared the API's day codes (MON) with day names (Monday) and showed no timetable for any class; the old staff list read fields the API does not send. Both were replaced.

**Tab bar:** a folder under a tab group needs its own `_layout.tsx` (use `components/nav/FolderStack.tsx`). Without one, expo-router hoists every file into the parent tab bar as a button; that gave the admin bar 28 extra tabs. `__tests__/routeStructure.test.ts` fails if a folder lacks a layout or an admin route is not declared in `(admin)/_layout.tsx`.

## What is left (2026-10-30)

**Whole areas with no mobile screens for admin and principal**
- Transport management: routes, vehicles, assignments, transport attendance (the dashboard and the driver app exist).
- Library: dashboard, catalog, overdue (issue and return exist).
- Hostel: dashboard, rooms, allocations (gate passes exist).
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
- Camera and upload screens (attendance capture and review, face attendance) still use their own loading and error handling.
- Urdu and right-to-left, dark mode, iOS, over-the-air updates (all deliberately out of v1).
- Store assets (graphics, screenshots, listing text), the Sentry DSN, and a fresh APK for the new native modules.
- Commits: nothing in this work is committed yet.

