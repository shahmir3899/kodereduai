# Mobile vs web: balance work plan

Created 2026-11-23. This is the **one** place for what is still open from the phone-vs-web comparison work. It replaces these docs (deleted 2026-11-23; read them in git history at commit `7e2a0cc2` if needed):

| Old doc | What it was |
|---|---|
| `MOBILE_PLAN.md` | First finalisation plan, all roles, phases 1-10 (2026-10-27) |
| `MOBILE_WEB_GAP_REPORT.md` | First code-reading comparison, admin pages (2026-11-01) |
| `MOBILE_AUDIT.md`, `MOBILE_AUDIT_SCREENS.md`, `MOBILE_CHANGE_LIST.md` | Five-phase audit, every role, Batches 1-21 (2026-11-01/02). The screens and change-list files had already lost every section except the driver one |
| `MOBILE_STUDENTS_FIX_PLAN.md` | Students add / edit / lifecycle plan (2026-11-01) |
| `MOBILE_UI_POLISH_PLAN.md`, `MOBILE_UI_POLISH.md` | Polish phases A-F and U1-U8 |
| `PAPER_BUILDER_PARITY_PLAN.md` | Old paper builder parity (2026-11-03); the old builder was replaced by Paper Builder v2 |
| (memory only) gap batches A-H, T1, T2 | Web-only features brought to the phone (2026-11-10/12) |

Still kept: `MOBILE.md` (how the app works), `MOBILE_QA.md` (phone test script), `MOBILE_API_GAP_APPENDIX.md` (written by `python scripts/mobile_api_gap.py`).

**Phone tests are parked** for this plan (user, 2026-11-23). They are all in `MOBILE_QA.md`; nothing below is a phone test.

Rules for every phase: plan shown and approved before any code; writes only in seed school 37 (or demo 42 when agreed); no schema change without sign-off; run only the touched tests while building; nothing pushed without approval.

---

## What is already done (no work left apart from phone tests)

- Every role audited and Batches 1-21 built: admin, principal, teacher, student, parent, finance manager, manager, staff, driver.
- Gap batches A-D (messages, student exit and re-admit, document upload, exam bulk delete, date sheet Excel, payroll bulk, staff logins) and, from git, E-H + T1 (library, hostel, transport, reports, face enrollment, teacher library and transport).
- Students: Add (`students/new`), full Edit, Recently Deleted, restore, reclassify, status, parent invite, photo.
- Polish A-F and U1-U8 (AI remark, user photo, AI comments, dashboards, header, older screens, side menu, search, pins, skeletons, tab bar, year switcher, icons).
- Old paper builder parity phases 0-6 and web fixes W1/W2.
- Web bugs found by the audit and **already fixed**: student dashboard `stats` keys, student timetable times, student fees year (now filtered in the page).
- Every item above is committed (git was clean on 2026-11-23).

---

## Phase 1: checks (read-only, no code) - IN PROGRESS 2026-11-23

Goal: turn every "maybe" below into "open" or "done", so later phases build only real gaps.

| # | Check | Result |
|---|---|---|
| 1.1 | Web Daily Diary is refused (no `teacher` sent by teacher/admin) | **Open.** `bulkDiaryMutation` still sends no `teacher`; the serializer still needs it; only the manager path fills it on the server |
| 1.2 | Web own-attendance cards read `PRESENT` etc. (server sends lowercase) | **Open.** `StaffAttendancePage.jsx` lines 72-76 |
| 1.3 | Web manager Exams page shows create controls the server refuses | **Done.** Create Exam and date sheet editing are behind `isSchoolAdmin` |
| 1.4 | Students: delete uses the web's removal preview; reclassify uses its preview | **Done.** `getRemovalPreview` / `getReclassifyPreview` in `services/api.ts`, used by `services/studentLifecycle.ts` |
| 1.5 | T2: paper builder AI and Word export on the phone (Paper Builder v2) | **Done.** Word export via `sharePaperWord`; the web has no AI question generation any more (only AI badges, which the phone has) |
| 1.6 | `MOBILE.md` "What is left (2026-10-30)": which items are still missing | Almost all built or web-only by decision. **Open, small:** removing the first or last date row of an exam group's date sheet (web `updateExamGroup` start/end date). Staff photo: skipped by you. Sub-topic create/delete, `bulk_toc`: no web page uses them |
| 1.7 | Old paper parity Phase 7 (web <-> phone round trip): still meaningful after Paper Builder v2? | **Yes, in a new form:** v2 blocks are shared, but no web <-> phone round trip of a v2 paper is recorded. Kept as Phase 5 |
| 1.8 | Fresh numbers | API: web 802 endpoints, phone covers 592, missing 210, phone-only 2 (push tokens). Mobile: `tsc` clean; jest 1621 of 1622 pass, **1 fails**: `navIcons.test.ts`, menu entries `/hr/teacher-performance` and `/my-performance` have no icon. Web vitest: see below |
| 1.9 | Finance-manager web findings after the role simplification | Transport/Library in nav: **done** (hidden for managers). **Open:** Finance Dashboard "Export PDF" is shown to a finance manager but `CanGenerateInstantReport` allows only admin roles, so it answers 403 |

## Phase 2: decisions only you can make

**Decided 2026-11-23: the defaults below, for every row** (skip optional items, no trend strips, barcode last before the APK, no KaTeX fonts, staff check waits for a password, finance PDF hidden for non-admins).

| # | Decision | Options |
|---|---|---|
| 2.1 | Optional per-role items: build any? | Teacher L1/L2 (library, transport read-only: now built in T1, confirm); finance manager P1, P2, L1-L3; manager P1-P3; staff L1, L2, P1; driver L1 (transport read-only), P1 (month calendar on Home); student F1 (fees chart), F2 (file name); parent H1/H2. Default: skip all |
| 2.2 | Trend strips on dashboards | Need a history API on the server (new endpoint). Default: skip |
| 2.3 | Barcode / SKU scan for inventory | New native module, new APK. Default: build last, before the APK |
| 2.4 | KaTeX fonts in the phone editor (+260 KB) so equations look exact | Default: skip |
| 2.5 | Staff browser check | Needs the password for `SEED_TEST_staff_e2e` (school 37) or OK to reset it |
| 2.6 | Any item Phase 1 finds open that changes the server | Per item |

## Phase 3: web bugs found by the comparison (code)

Confirmed open by Phase 1. Started 2026-11-23 (uncommitted):
- 3.1 **DONE.** Web My Attendance cards read uppercase keys (showed 0). `StaffAttendancePage.jsx` now reads `present`, `absent`, `late`, `half_day`, `on_leave`; new test in `StaffAttendanceFinanceManager.test.jsx` (2 pass).
- 3.2 **DONE (server; needs deploy).** Web Daily Diary refused for teacher/admin. `AssignmentViewSet._data_with_default_teacher` (`backend/lms/views.py`): when `teacher` is missing on create, a teacher gets their own staff record (as the phone already sends) and anyone else the subject's assigned teacher (`resolve_subject_teacher`, refused with a clear message when none or several). An explicit teacher is kept. `lms/tests/test_assignment_default_teacher.py` (4) + `test_manager_assignments.py` (10) pass. No web change needed.
- 3.3 **DONE.** Finance Dashboard "PDF" button now only for `isSchoolAdmin` (the server's instant reports are admin roles only). `src/pages/__tests__/FinanceDashboardExport.test.jsx` (2 pass).
- 3.4 **DONE (2026-11-24).** Full web run per file found 7 failing files (33 tests) and 2 files that never finished (a test worker ran out of memory, which is why a plain `npx vitest run` hung for 45+ minutes).
  - **Real bug fixed:** `StaffAttendancePage.jsx` admin view re-rendered forever while loading (`staffList` / `existingAttendance` were a new `[]` each render, the init effect set state, render again). Now memoised.
  - **Real inconsistency fixed:** `FeeTable.jsx` phone cards showed and let you edit "Prev Bal" on annual (and old one-time) fees; the desktop table already hid it. Cards now follow `showPrevBal`.
  - **Stale tests brought up to date** (no app change): `LearningObjectives` (fake `useQuery` / `useSessionClasses` returned new objects each render, causing the second hang; AI modal props renamed `open` / `onApply`), `LessonPlanWizard` (step renamed "AI assistant"), `ContentBlockModal` (Field label), `RevisionHistory`, `DiscountsPage` (year context mock, card + table duplicates, placeholder), `LeaveManagementPage` (card + table, confirm modal, `status_display`), `StaffDirectoryPage.userConversion` (`is_active` in the staff mock, modal fields), `FeeCollectionPage` (fee-type filter is All / Monthly / Annual; duplicates). Shared mocks in `src/test/mocks/handlers.js`: attendance summary is a list with lowercase keys, leave rows carry `status_display`, staff rows `is_active`.

## Phase 4: phone gaps still open (code)

Built from the Phase 1 results, in this order (each a small batch, browser-checked on Metro web, school 37):
- 4.1 **DONE (2026-11-24).** Icons for `/hr/teacher-performance` and `/my-performance` (`bar-chart-outline`, the web's ChartIcon) in `navigation/navIcons.ts`.
- 4.2 **DONE, not browser-checked (2026-11-24).** Date sheet: "Remove first day" / "Remove last day" buttons under the exam period when nothing is scheduled on that day (web rule). `periodEdgeTrims` in `services/examGroups.ts` (+4 tests), `updateExamGroup` in `services/api.ts`, `trimPeriod` in `hooks/useExamGroups.ts`, buttons in `components/exams/DateSheetScreen.tsx`. A live check writes to the database (needs your OK). Mobile: tsc clean, jest 1626 / 1626.
- 4.3 Optional items: none (Phase 2 default: skip).
- 4.4 Barcode scan: deferred to just before the APK (Phase 2 default).
(Students previews and paper Word export were found already built in Phase 1.)

## Phase 5: paper builder web <-> phone check

**DONE 2026-11-24, no differences found; nothing to fix.** Run on the scratch SQLite servers only (backend 8100, web 3100, Metro web 8181 as the phone; `SEED_TEST_admin`).
- **Paper 50 (new): every one of the 22 block types**, seeded from the four sample documents plus one essay block. Edits in turn: web activity heading, phone activity heading, web rich-text question, phone rich-text question. After each save the whole document was diffed against the previous one: every time, the only change was the intended edit.
- **Paper 15 (Urdu, right-to-left):** one heading edit on the web, then on the phone; again only the intended change each time.
- **Rich text:** both editors write the identical wrapper (`<div dir="ltr" lang="en" class="">…</div>`), as designed by the shared editor core.
- **Print:** paper 50's printed page before and after differs only by the 4 edits; Word, answer-key Word and answer-key print all answer 200. Paper 15 does not print on purpose (it has unfilled picture slots: lenient save, strict print).
- **Question bank:** the edited multiple-choice question stayed one bank row, updated in place, used by 1 paper; no copies.
- **Cosmetic note (not fixed):** the web editor stores its list-row ids (`key`) inside each list item when it saves; the phone keeps them and the print ignores them. Harmless; strip them on save only if smaller documents matter.
- Scratch leftovers: paper 50, and markers " W P" on paper 15's first heading.
- No guide text changes (no flow changed).

## Phase 6: release preparation (no phone tests)

- 6.1 **DONE 2026-11-24 (scratch).** No staff password was needed: scratch had no STAFF user, so I added `SEED_TEST_staff_app` (scratch SQLite only, dev password). Phone Home as staff: Attendance this month 0/20 with 4 off (equals the server's summary), Leave balance 10 days, Payslips, unread count, quick actions (My Profile, Apply Leave, Payslips, Notifications, Messages), Leave balance panel, Notifications. Server: finance and student reads and an expense write refused (403); the staff list answers a slim peer directory by design (name, department, designation only).
- 6.2 **DONE.** `MOBILE.md` Play checklist re-checked against the app; `MOBILE_API_GAP_APPENDIX.md` refreshed (web 802, phone covers 593, missing 209, phone-only 2).
- 6.3 **Partly yours.** Found and written up in `MOBILE.md` and `docs/PLAY_LISTING_DRAFT.md`:
  - The checklist said "microphone not requested"; it is now (Aura voice, `expo-audio`). Data-safety answers updated: audio, assistant chats, photos read by AI services (Groq, Cerebras, Gemini, Google Vision as service providers).
  - The live privacy page does not mention the microphone, the AI providers or biometric unlock: proposed wording in `PLAY_LISTING_DRAFT.md` (not applied; the landing site deploys separately).
  - `react-native-maps` (installed, never imported): **removed 2026-11-24** with `npm uninstall`; tsc clean, jest 1626 / 1626, Android bundle exports.
  - Listing text drafted (name, short and full description, category, audience).
  - Still yours: store icon 512x512 and feature graphic, screenshots, content-rating and data-safety forms in Play Console, `EXPO_PUBLIC_SENTRY_DSN` in the EAS build env.
- 6.4 **Checklist (nothing pushed):**
  1. Commit this work (diff shown first). Local `main` was equal to `origin/main` before it, so the only new server change is the Daily Diary teacher default (`backend/lms/views.py`, no migration).
  2. Push `kodereduai` and bump the submodule pointer in `D:/personal` (deploys `personal-gateway-sg`); not with `push-all.bat` (`git add .`). Your approval first.
  3. Web: build and upload the frontend (My Attendance, Finance PDF button, Staff Attendance render loop, fee cards).
  4. One APK (`eas build --platform android --profile preview`), after the server is live: native modules added since the last APK (`expo-print`, `expo-audio`, `expo-speech`, `expo-local-authentication` and others) need a fresh build, and older APKs call endpoints the server removed.
  5. Barcode scan (Phase 2: just before the APK) is not built; say if it should go into this APK.

## Parked: phone tests
All of `MOBILE_QA.md` (sections 6-6n and the role by module matrix), the rich editor and drawing pad device pass, camera and gallery uploads, background location for the driver journey, the on-phone report card PDF and ZIP.

---

## Fresh scan 2026-11-24 (read-only; nothing changed)

Method: `scripts/mobile_api_gap.py` (web calls 802 endpoints, phone 593, 209 web-only); every web-only call traced to the web page that uses it; every web and phone call resolved against the Django URL routes (`resolve()`, scratch settings, no requests); the phone menu built per role and checked for entries with no screen (a throwaway jest probe, deleted).

### A. Features the web has and the phone does not (candidates for Phase 7)
| # | Feature | Web page | Phone today | Size |
|---|---|---|---|---|
| A1 | **Transport admin: Vehicles, student transport assignments, boarding attendance** | `transport/VehiclesPage`, `TransportAssignmentsPage`, `TransportAttendancePage` | Menu shows these three as **"Soon"** for admin, principal and teacher (routes and stops are built) | M |
| A2 | **Aura insights** (admin/principal page of grouped AI findings, dismiss/act) | `admin/AuraInsightsPage` | No page (the phone has the assistant itself) | S-M |
| A3 | **Report card extras**: promotion status, issue date, signature labels, single and bulk | `ReportCardPage`, `BulkReportCardModal` | Phone report card edits comments only | S |
| A4 | **Bulk tests** ("Create Tests" for many classes at once: details, schedule, preview) | `BulkTestModal` on Exams | Phone has the exam wizard, not bulk tests | M |
| A5 | **Student response entry** (per-question answers on a paper) | `StudentResponsePage` (Papers > Responses) | None | M |
| A6 | **Document scan (OCR)** for student and staff documents (scan, rescan, edit read fields) | `StudentDocumentsTab`, `StaffDocumentsPage` | Phone uploads documents, no scan or rescan | M |
| A7 | **Inventory upkeep**: edit/delete categories and vendors, delete items, AI suggest | `InventoryItemsPage` | Add only | S |
| A8 | **Students bulk delete**; permanent purge from Recently Deleted | `BulkDeleteStudentsModal`, `DeletedStudentsPage` | Single soft delete and restore only | S |
| A9 | **Parent link status** on the student list; edit a parent-child link | `StudentsPage`, `ParentChildrenDrawer` | Parent invite only | S |
| A10 | Marks entry **Excel template** download | `MarksEntryPage` | None | XS |
| A11 | **Background task centre** (see and cancel running jobs) | `Layout`, `BackgroundTaskContext` | Each screen polls its own job | S |
| A12 | Dashboard extras: session health AI summary, setup completion, notification digest carousel | dashboard widgets | Not on the phone home | S |
| A13 | Notification preferences (inside the web Aura preferences sheet) | `assistant/PreferencesSheet` | None | XS |

### B. Web-only by earlier decision (no action unless you reverse it)
Promotion, enrollments and section allocator; session setup wizard; timetable auto-generate and slot tools; subject workload/gap analysis and bulk assign; academic calendar planning, coverage and holiday suggestions; attendance OCR tuning and register config (OCR parked); face-attendance devices and live capture; notification templates, config, analytics, run; AI Analytics (removed from the phone); user guide progress; bulk student import; super admin (33 calls).

### C. Issues in the web app itself
| # | Issue | Where | Effect |
|---|---|---|---|
| C1 | **Parent Fees calls a function that no longer exists**: `parentsApi.getPaymentGateways` is commented out in `api.js` but `ChildFees.jsx` still queries it | `pages/parent/ChildFees.jsx:27` | A TypeError (retried by React Query) every time a parent opens Fees; the Pay section stays hidden (the server's pay-fee is 410 anyway). Remove the gateway query and the dead Pay UI |
| C2 | **`class_summary` exam action is unreachable on the server**: indented inside the previous method after its `return`, so DRF never registers it | `backend/examinations/views.py:2148` | `getClassSummary` in web and phone clients points at a 404; no screen calls it. Delete or re-indent (a legacy root test references it) |
| C3 | **Client functions pointing at routes that do not exist**: `getSiblings`, student-portal `getAssignment`, `updateAIJob` (server is read-only) | `services/api.js` (and `mobile/services/api.ts` for two) | Dead code, no caller |
| C4 | **About 40 more unused client functions** (old parent messages x4, fee breakdown, fee predictor, reopen month, delete fee structure, curriculum sub-topics/bulk TOC/standards, AI question generation from lessons x5, paper-upload list, single mark create/update, single staff attendance create/update, user delete, report generate, many get-by-id) | `services/api.js` | Dead code; misleads scans like this one. One-time fee mutation built in two hooks with no UI (deprecated fee types) |
| C5 | Web editor stores list-row `key`s inside saved paper documents | Paper Builder v2 | Cosmetic (Phase 5 note) |

Found and **already fixed** this session (uncommitted): My Attendance cards, Daily Diary refused, Finance PDF button 403, Staff Attendance render loop, fee cards Prev Bal on annual fees.

**C1-C4 FIXED 2026-11-24 (uncommitted):**
- C1: `ChildFees.jsx` no longer queries the removed gateway call; the dead Pay list, payment mutation and gateway modal are gone. The balance banner now says "Pay with the Kuickpay bill above, or at the school office." when the school has Kuickpay, otherwise "Please pay at the school office." (it used to say online payment was not configured). Tests: `ChildFeesKuickpay.test.jsx` (+2, mock fixed: it lacked `getChildKuickpayBill`).
- C2: the unreachable `class_summary` action removed from `examinations/views.py`; its two always-404 tests (`tests/test_phase6_examinations.py` F3/F4) removed and the known-failures entry cleared. The manual root script `backend/test_phase6_examinations.py` (historical, not collected) still mentions it.
- C3+C4: a strict check (a function counts as unused only if its name appears nowhere else in the app, tests included; no dynamic `api[name]` access exists) found **101 unused functions in `frontend/src/services/api.js` and 18 in `mobile/services/api.ts`**; all removed (web: 125 lines deleted, nothing added) plus 8 comments left describing nothing. Web build passes; mobile tsc clean, jest 1626 / 1626. The unused one-time-fee mutation was removed from both fee hooks too (with `generateOnetimeFees`; fee-collection tests 42 / 42).

---

## Phase 7: phone gaps A1-A13 (all five batches BUILT 2026-11-25, uncommitted)

Written 2026-11-24 after reading each web page and the phone code it would build on. Corrections to the scan table above:
- **A13 is Aura preferences**, not notification preferences: the web `PreferencesSheet` stores the assistant's reply language, usual class and usual fee account. No web page uses notification preferences (that client call is unused).
- **A9 is smaller than listed**: the phone already links and unlinks parents (`components/students/ParentLinksSheet.tsx`); only the list status and editing a link (relation, primary) are missing.
- **A5 works with new papers**: Paper Builder v2 papers fill `paper_questions` (scratch paper 50: 43), which the responses page needs.

Rules for every batch: built on the scratch servers (8100 SQLite, Metro web 8181); `tsc` + only the touched jest files while building; browser check on Metro web; no phone test (parked); nothing committed until you say; same API calls as the web, **no server change and no new native module expected** (camera and image picker are already in the app).

### Batch 7.1: quick wins (all S, admin/principal unless noted)
| Item | What the phone gets | Built on |
|---|---|---|
| A3 Report card extras | On one card: promotion status (Promoted / Not promoted, only when the card offers it), date of issue, signature captions. In the bulk report-card sheet: date of issue and captions for the whole class. Admin, principal, teacher as on the web. | `ReportCardScreen.tsx`, `BulkReportCardsSheet.tsx` (both already show these values read-only) |
| A7 Inventory upkeep | Edit and delete categories and vendors; delete an item (the server refuses an item with stock movements, the message is shown). AI suggest left out (see "Not planned"). | `components/inventory/*` |
| A9 Parent links | "Parent linked / not linked" on each student row and a filter for it; edit a link (relation, primary contact) in the existing sheet. | `StudentsListScreen.tsx`, `ParentLinksSheet.tsx` |
| A13 Aura preferences | A "Preferences" sheet in the phone Aura: reply language, usual class, usual fee account (every role that has Aura). | `components/assistant/AuraChat.tsx` |

### Batch 7.2: transport admin (A1; M)
Replaces the three "Soon" menu entries for admin and principal; teacher gets the same screens **read-only** (the web shows them to a teacher and the server refuses a teacher's writes).
- **Vehicles**: list, add, edit, delete (number, type, make/model, capacity, assigned route, driver name, phone, licence).
- **Student transport**: pick a class, see each student's route, stop and vehicle; assign one or many at once (bulk assign), change, remove.
- **Boarding attendance**: pick a route and date, mark each student Boarded / Not boarded / Absent, save all at once.
Built on the existing `(admin)/transport` stack (dashboard, routes, route detail).

### Batch 7.3: exams (A4, A5; M each)
- **A4 Bulk tests**: "Create tests" from the exams screen, the web's three steps: details (year, term, test type, class, subjects), schedule (date per subject), preview (shows conflicts; apply only when the server says it can). Admin, principal and teacher (the server allows those).
- **A5 Student responses**: a "Responses" action on a paper: pick a student, enter per-question answer, marks and right/wrong, save; a student's saved answers load back. Same roles as the web route.

### Batch 7.4: document scan (A6; M)
Student documents and staff documents: take or choose a photo, the server reads it (Google Vision + Groq) and proposes the fields, the person checks and saves; rescan a saved document. **Test plan:** the scratch backend has no AI keys, so the scan is checked with the server's reply stubbed in the browser (as for the paper scan before); one real scan only with your OK.

### Batch 7.5: smaller admin items (S each)
- **A8 Students bulk delete**: select students in the list, see the same removal preview the web shows, type DELETE to confirm, soft delete (restorable from Recently Deleted).
- **A11 Task centre**: a "Running jobs" screen (payslips, fee generation, report PDFs...): progress, cancel; reachable from the header when something is running.
- **A12 Dashboard extras**: session health summary and setup completion on the admin home (both already on the web dashboard).

### Not planned (proposed web-only; say if you want any of them)
- **A2 Aura insights**: a product-planning board (what users asked Aura that it cannot do; New / Planned / Built / Won't do). It is for the product owner, not school work.
- **A10 Marks Excel template**: for filling marks offline in a spreadsheet; the phone enters marks directly.
- **Permanent purge** of deleted students: irreversible, and the soft-delete safeguards exist because of a past hard delete; keep it on the web.
- **Inventory AI suggest** and the notification digest carousel: low value on a phone.

### Decisions needed (defaults in brackets)
1. Keep A2, A10, purge, AI suggest web-only? [yes]
2. Transport pages for teachers read-only on the phone, as on the web? [yes]
3. Document scan: stubbed check only, or one real scan on the scratch server with keys you provide? [stubbed only]
4. Order: 7.1, 7.2, 7.3, 7.4, 7.5, one batch per approval? [yes]

Size: 7.1 about one session, 7.2 one to two, 7.3 one to two, 7.4 one, 7.5 one.

**Batch 7.1 BUILT 2026-11-24 (uncommitted):** A3 report card details (`components/exams/ReportCardMeta.tsx`: CardDetails + ClassDetailsSheet; helpers in `services/reportCard.ts`, tests `reportCardMeta.test.ts`), A7 inventory upkeep (`components/inventory/ManageListsScreen.tsx`, route `(admin)/inventory/lists`, "Delete item" in the item form; confirms say what cascades: a category delete also deletes its items, an item delete its movements and assignments), A9 parent portal pill + filter on the student list and relation/primary editing in `ParentLinksSheet`, A13 Aura preferences (`components/assistant/PreferencesPanel.tsx`, ⚙ in the Aura header). Mobile tsc clean, jest 1641 / 1641. **Browser-checked 2026-11-24 on scratch (Metro web 8181, backend 8100, SEED_TEST_admin), every change confirmed on the server:**
- A3: one card (Usman Ahmed, Weekly Quiz): Principal caption -> "Head Teacher" (toast, card line updated), date of issue -> 15 Dec 2026; no promotion picker (Weekly Quiz is not a final exam, as intended). Class print details: 8 students, "Form Tutor" class-teacher caption saved for all (server: every student has it; Usman keeps his own principal caption and date because those fields were left blank).
- A7: vendor add (bad email refused), rename, delete (warning shown, gone from the list); Stationery delete cancelled at the warning "Its 3 items and all their stock movements and assignments are deleted too" (nothing deleted); a throwaway item deleted with its warning.
- A9: pills on every row; "Linked" filter shows 2 of 10; primary switch off and on, relation Father -> Guardian -> Father (server matched each step).
- A13: needs `EXPO_PUBLIC_ASSISTANT_ENABLED=true` in the build (scratch Metro does not set it; set for the check, then reverted). Saved English / 1A / Main Cash (server matched), then cleared (server back to auto, class and account forgotten).
Scratch leftovers: report-card captions and date on Class 1 - A (Weekly Quiz); Aura preferences cleared; Ali Hassan's link restored to Father, primary.

**Batch 7.2 BUILT and browser-checked 2026-11-25 (uncommitted):** transport admin on the phone. `services/transportAdmin.ts` (+ `__tests__/transportAdmin.test.ts`), API calls in `services/api.ts`, hooks `useVehicles` / `useYearAssignments` / `useBoarding` and new actions in `hooks/useTransport.ts`, screens `components/transport/{VehiclesScreen,StudentTransportScreen,BoardingScreen}.tsx`, routes `transport/{vehicles,assignments,attendance}` in both the admin and teacher stacks, menu rows in `navigation/routes.ts` (the three "Soon" entries are gone), and four buttons on the transport home. Mobile tsc clean, jest 1650 / 1650.
- Checked on scratch as SEED_TEST_admin: vehicle validation, add (Van on Route A), edit (capacity), delete with its warning; student transport list, bulk assign (Sara + Fatima, "2 students assigned."), the sheet offers only students not on a route, remove with its warning, single assign (Fatima, Pickup only); boarding: Sara Absent, Fatima Not boarded, saved for 4, server matches, marks come back after a reload. As SEED_TEST_staff_teacher1: all three screens read-only (no add/assign/remove/save, choices disabled, a note says only the admin or principal can mark).
- Found while building: the vehicle form must require capacity, driver name and driver phone (the server and the web do); fixed, and a server field error now names its field.
- **New web bug (C6, not fixed):** the web Transport Assignments class filter sends `class_id`, which the server ignores (`TransportAssignmentViewSet` filters only route_id, student_id, academic_year, is_active, transport_type), so filtering by class does nothing. The phone offers a route filter and a name search instead.
- Scratch leftovers: boarding marks for Route A on 2026-11-25; Sara Khan and Fatima Noor assigned to Route A.

**Batch 7.3 BUILT and browser-checked 2026-11-25 (uncommitted):**
- **A4 Create tests** (admin and principal, as on the web, which shows the button only to them; the server would also take a teacher): `components/exams/BulkTestsScreen.tsx`, route `(admin)/bulk-tests`, button "+ Create tests (one class, several subjects)" on the admin Exams screen (not in the manager's read-only view). Logic `services/bulkTests.ts`. Three steps as on the web: details (year, optional term, test type, master class, subjects), schedule (name built like the server, date, total marks, optional times), server preview, then create only when the preview allows it. After creating it returns to the Exams list.
- **A5 Student responses** (admin, teacher, manager, as the web Papers page): `components/exams/StudentResponsesScreen.tsx`, route `paper-responses?id=` in the three stacks (and in `LINKED_SCREENS`), "Responses" button on every paper in `PapersScreen`. Logic `services/studentResponses.ts`. Pick a student (previous / next), per question: answer, marks (checked against the question's marks), right / wrong / not marked; progress "N of M students entered".
- API: `bulkTestPreview`, `bulkTestApply`, `getStudentResponses`, `submitStudentResponses` in `services/api.ts`. Tests `__tests__/bulkTests.test.ts`. Mobile tsc clean, jest 1652 / 1652.
- Checked on scratch as SEED_TEST_admin: missing-date check; English + Mathematics tests for SEED_TEST_Class_1A previewed ("2 to create") and created ("2 tests created."); the same request again previews "0 to create, 2 already exist" with the server's reason and Create disabled. Paper 50 (43 questions): 12 marks on a 10-mark question refused; Ali Hassan Q1 8 marks Right, Q2 "2, 4, 6" 5 marks saved ("Saved: 2 added"), server matches, progress 1 of 4; next student empty, back to Ali reloads his answers.
- Small finding (not fixed, existing code): the phone's exam wizard (`ExamWizardScreen`) ends with `router.back()`, which from a hidden tab screen lands on the Dashboard instead of the Exams list (the new Create tests screen uses an explicit route instead).
- Note: while building, another session was editing the phone navigation (`components/nav/*`, `FancyTabBar.tsx`, `menuShortcuts` removed, `navIcons.ts`); those files were not touched by this batch.
- Scratch leftovers: two tests on SEED_TEST_Class_1A (Dec 7 and 8), Ali Hassan's two responses on paper 50.

**Batch 7.4 BUILT and browser-checked 2026-11-25 (uncommitted):** document scan on the phone (A6), student and staff documents.
- Adding a document is now image-only, as on the web: take a photo, choose a photo (with the phone's crop) or a PDF / Word file, and it goes straight to `students/<id>/documents/scan/` or `hr/documents/scan/` (staff: choose the person first; never guessed). The list shows "Reading…" while the server reads it and checks every 3 s until done; "Needs review" when the server could not read everything. Opening a record shows the picture, the server's note and the fields (type, title, number, issue date, expiry, notes; institution, year and grade for degree, diploma, certification, training, licence); Save clears "Needs review"; "Read the picture again" rescans; Delete warns what goes with it.
- Code: `services/documentScan.ts` (types from the web, including B-Form, guardian ID and the five qualification types the phone did not know), `components/documents/{pickDocumentFile.ts,DocumentDetailsSheet.tsx}`, rewritten `components/students/StudentDocumentsTab.tsx` and the documents tab of `components/hr/StaffDocumentsScreen.tsx` (qualifications tab unchanged), API `scanDocument` / `rescanDocument` / `updateDocumentDetails` (students) and `scanDocument` / `rescanDocument` (hr). The old typed-upload calls (`studentsApi.uploadDocument`, `hrApi.createDocument`, hook `createDocument`) were removed; their pure helpers in `services/studentMove.ts` / `services/hrAdmin.ts` and tests are still there (unused, tidy later). Tests `__tests__/documentScan.test.ts`. Mobile tsc clean, jest 1658 / 1658.
- Checked on scratch (a second scratch pair, backend 8300 + Metro 8282, because another session was signing in as a parent on the shared 8181 preview): rows made in the scratch DB as if read; Reading -> polled -> updated without reload when marked done; review: corrected number and notes saved, server status DONE and note cleared; rescan: server back to Needs review with "Could not read this document..." and the corrections kept; staff degree: institution / year / grade saved and the linked qualification created; upload: the generated picture was sent as multipart (`file`, and `staff_member` for staff) to the scan endpoints; "Choose the staff member first" without a person. **Not checked:** a real read (scratch has no storage or AI keys: the server answers "Supabase storage not configured", which the app shows), the camera, the crop, PDF / Word picking on a phone.
- Scratch leftovers: student 1 documents "RT Birth certificate" (id 2), "RT Transfer certificate" (id 3); staff document "RT BSc Mathematics" (id 253) and its qualification.

**Batch 7.5 BUILT and browser-checked 2026-11-25 (uncommitted):** students bulk remove (A8), running jobs (A11), dashboard extras (A12).
- A8: on the Students list (admin and principal), Select -> tick students -> "Remove (n)". The sheet lists the names (ten, then "and N more"), says the records are kept and restorable from Recently deleted, asks for the count typed back and a reason, then sends batches of 100 to `students/bulk_delete/` (as the web `BulkDeleteStudentsModal`; the web also does not show the per-student removal preview here). The result says how many were removed and lists any the server skipped with its reason; a failed later batch says how many were already removed. Permanent purge stays web-only. Code `services/studentBulkRemove.ts`, `components/students/BulkRemoveSheet.tsx`, button in `StudentsListScreen.tsx`, API `studentsApi.bulkDeleteStudents`.
- A11: "Running jobs" screen (route `jobs` in the admin, manager and finance groups): the person's jobs from the last 24 hours, here or on the web, running first; progress bar and "4 of 10 (40%)" while running, the failure reason, Cancel with a confirm. A chip "N jobs" in the header (admin, manager, finance) shows only while a job is waiting or running and opens the screen. The list checks every 3 s only while something runs; otherwise it refreshes when a screen opens (at most every 30 s), so no steady polling. When nothing runs there is no way in (by plan: header only). Code `services/backgroundJobs.ts`, `hooks/useMyJobs.ts`, `components/jobs/RunningJobsScreen.tsx`, chip in `components/nav/HeaderActions.tsx`, API `tasksApi.getMyTasks` / `cancelTask`.
- A12: the admin home's Session health card now also fetches the AI-written summary after the numbers when the server offers one ("AI summary" badge; "Writing AI summary..." meanwhile; rule-based notes until then). New "School setup" card (school admin and principal): overall % and steps, a bar per module with what is missing; a bar opens the phone screen for its next step, or says "on the web" when there is none; "All modules fully set up." at 100%. Code `components/dashboard/SetupProgressCard.tsx`, `services/setupProgress.ts`, `SessionHealthCard.tsx` + `services/sessionHealth.ts` (`pickSummary`), API `schoolsApi.getCompletion`, `sessionsApi.getSessionHealthAISummary`. The notification digest carousel was not built (not in the 7.5 plan).
- Tests `__tests__/batch75.test.ts`. Mobile tsc clean, jest 1666 / 1666 (158 suites).
- Checked on scratch (8300 / 8282) as SEED_TEST_admin: setup card 54% (27 of 50) with module bars, HR bar opened Departments; header chip "1 job" -> Running Jobs showed a running payslip job (4 of 10, 40%) and a failed report with its reason; Cancel -> "Cancelled by user", chip gone. Two throwaway students: Remove (0) disabled until ticked, empty confirm refused ("Type 2 to confirm."), then removed: counts 12 -> 10, server rows soft-deleted with the reason. **Not checked:** a real AI summary (scratch has no AI key), a skipped student (branch transfer) in the result.
- Scratch leftovers: none (test jobs and students removed afterwards).

