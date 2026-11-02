# Mobile app audit: web parity

Started 2026-11-01. Purpose: replace page-by-page guessing with a systematic comparison of the mobile app against the web app (its mobile view), ending in one prioritised change list that we then build and test.

Related: `MOBILE_WEB_GAP_REPORT.md` (first, code-reading pass on admin pages, now to be superseded by this audit), `MOBILE_STUDENTS_FIX_PLAN.md` (Students steps 1 and 2 are built, step 3 is waiting for this audit).

## The five phases

| # | Phase | Output | Status |
|---|---|---|---|
| 1 | **API coverage**: every endpoint the web calls, and whether the mobile app calls it | This file, section "Phase 1", plus `MOBILE_API_GAP_APPENDIX.md` | **Done 2026-11-01** (automated) |
| 2 | **Classify the missing endpoints**: needed for v1, version 2, web only by design, or not applicable | Table in Phase 1 below | Draft done; needs your confirmation |
| 3 | **Screen inventory and comparison** for the endpoints both sides use: for each web page, list its features (fields, filters, tabs, actions, empty and error states, exports) and compare with the matching mobile screen; screenshots only for visual checks | `MOBILE_AUDIT_SCREENS.md`, one table per area, admin first, then teacher, parent, student, driver, accountant, manager, staff | **Admin and principal done 2026-11-01**; other roles not started |
| 4 | **Highlight missing front-end features** found in phase 3 | Same file, "Missing" column | Not started |
| 5 | **One change list**: every gap from phases 2 to 4 with size, risk and priority; you pick what goes into the next release; then build and test in batches | `MOBILE_CHANGE_LIST.md` | Not started |

How phase 3 will be done (so it is fast and repeatable): for each area I read the web page and its child components once and write its feature list, read the mobile screen the same way, then fill the table. I take screenshots from the browser build at 375px only where the layout matters (list rows, forms, dashboards). Each row gets: Feature, Web, Mobile (Yes / Partial / No), Note.

## Phase 1: API coverage (automated)

Method (rerun any time with `python scripts/mobile_api_gap.py`, which rewrites `MOBILE_API_GAP_APPENDIX.md` with totals, mobile-only calls, and a feature-grouped table): scanned `frontend/src` and `mobile/` for `api.get/post/put/patch/delete` calls with a literal URL, normalised ids to `{}`, treated a mobile URL with a variable segment (for example `followups/${type}/`) as a wildcard, and skipped test mocks.

| | Count |
|---|---|
| Distinct endpoints (method and path) the web calls | 769 |
| Also called by mobile | 387 (50%) |
| Web endpoints the mobile app never calls | 382 |
| Mobile-only endpoints | 2 after the 2026-11-02 cleanup (push token register and unregister); was 16, then 6 after Batch 10 |

**Caveats:** a call built from a non-literal URL is invisible to the scan, so some "missing" entries may be covered (check before building; for example mobile reads expense categories somewhere the scan did not see). A shared endpoint does not mean the same features: phase 3 checks that. Full list per app: `MOBILE_API_GAP_APPENDIX.md`.

### Missing endpoints, grouped (my draft classification, please confirm)

Key: **V1** = should be built for the first release; **V2** = already decided for version 2 or low value on a phone; **WEB** = web only by design; **N/A** = not for the mobile personas.

| App | Missing of web total | Main things missing | Draft class |
|---|---|---|---|
| students | 15 of 43 | Documents (list, upload, delete), enrollment history, earlier assessments, AI profile, **delete preview, restore, outcome (status), reclassify and its preview, parent portal account creation**, bulk create and bulk accounts, purge | **V1**: restore, delete, outcome, reclassify, documents, history. **WEB**: bulk create and bulk accounts, purge |
| student-exits | 13 of 13 | Exit wizard, readmit, carry, waive, finalize | **WEB** (decided earlier: exit wizard and readmit stay on web) |
| attendance | 11 of 26 | Register PDF, monthly bulk, anomalies, accuracy and threshold tuning, photo-register OCR helpers | **V1**: register PDF, anomalies. **WEB**: OCR tuning (OCR is parked) |
| face-attendance | 5 of 16 | Devices, live events and feedback, live match | **V2** (live capture runs on web) |
| finance | 35 of 85 | **Bulk update and bulk delete of fee payments**, category CRUD (expense, income, monthly, annual), account CRUD and reopen, ledger and balances, fee summaries, fee predictor, fee breakdown, siblings, one-time fees | **V1**: bulk update, fee summary, ledger, siblings, fee breakdown. **WEB**: category and account management, predictor, one-time fees |
| examinations | 52 of 108 | Worksheets (whole area), paper uploads and image extraction, DOCX generation, semantic search and AI question generation, exam-group CRUD and bulk delete, **bulk report cards**, student responses and term assessment, marks by student and template download, coverage stats | **V1**: bulk report cards, exam-group CRUD, marks by student. **V2**: worksheets, AI question features, DOCX. **WEB**: paper image extraction |
| lms | 33 of 64 | Curriculum sub-topics, content blocks and revisions, tags, TOC suggestion, lesson plan publish and bulk actions, link objectives, planned dates, syllabus progress | **V2** mostly; **V1**: lesson plan publish, syllabus progress |
| academics | 20 of 44 | Timetable auto-generate, substitutes, conflicts, quality score, PDF, split for sections, slots, workload and gap analysis, class-subject bulk assign, AI analytics | **WEB** (generation and analysis); **V1**: timetable PDF; **V2**: AI analytics |
| sessions | 39 of 51 | Academic year and term CRUD, calendar entries, enrollments, promotion, promotion advisor, section allocator, setup wizard, session health | **WEB** (decided: sessions, promotion and setup stay on web); **V1**: read-only calendar for admin |
| hr | 16 of 68 | **Staff attendance (admin mark and bulk mark)**, staff photo, link and unlink user account, bulk accounts, payslip detail and net pay history, salary structure current, appraisal detail | **V1**: staff attendance, staff photo, payslip detail. **WEB**: account linking and bulk accounts |
| notifications | 15 of 23 | Templates CRUD, broadcast and preview, preferences, digest, analytics, config, run, mark read bulk | **V1**: preferences, mark all read, broadcast. **WEB**: template and config management |
| transport | 20 of 31 | Routes, vehicles, stops, assignments, attendance CRUD (admin side) | **V2** (decided 2026-10-30) |
| library | 13 of 16 | Catalog, categories, config, issues list, overdue, return | **V2** (decided) |
| hostel | 14 of 20 | Hostels, rooms, allocations, vacate | **V2** (decided) |
| inventory | 10 of 24 | Item, vendor, category deletes, low stock, AI suggest | **V1**: low stock and deletes; **V2**: AI suggest |
| parents | 10 of 25 | Admin side (invite, link, unlink child), parent message threads, pay fee | **WEB** for admin tools; parent messaging uses `/api/messaging` by decision; pay fee deprecated |
| schools | 8 of 14 | Attendance, exam and register config, mark mappings, completion, by-subdomain | **V1**: completion; **WEB**: configs |
| admissions | 1 of 13 | Enquiry notes list (probably read through the detail screen; verify) | Verify |
| messaging | 1 of 7 | Mark thread read | **V1** (small; unread badge depends on it) |
| users | 4 of 8 | Other users' photos, delete | **WEB** |
| auth | 2 of 10 | Password reset confirm and validate | **V1** (forgot password flow, verify how mobile handles it) |
| reports | 5 of 13 | Generated reports list, download, custom letters AI draft | **V1**: reports list and download (confirm) |
| tasks | 6 of 6 | Background tasks and AI jobs | N/A (internal) |
| admin | 27 of 27 | Super admin: organizations, schools, memberships, brochure, platform stats, activity log | **N/A** (not for mobile, decided) |
| guide | 7 of 7 | User guide progress | **N/A** (web guide only) |

### What this says
- Half the web's API surface is unused on mobile, but a large part of that is deliberate (super admin, web-only setup, version 2 modules, OCR).
- The realistic **V1 candidates** are about 60 endpoints, concentrated in: Students lifecycle and documents, fee bulk actions and ledger, staff attendance, bulk report cards, register PDF and anomalies, notification preferences and broadcast, lesson plan publish, inventory low stock.
- The first report's "Students are almost read-only" finding is confirmed from the API side: 8 of the 15 missing student endpoints are lifecycle actions.

## Phase 2 decisions needed from you
1. Confirm or change the **V1 / V2 / WEB / N/A** column above, especially: worksheets (V2?), staff attendance (V1?), notification broadcast (V1?), face attendance devices (V2?).
2. Roles: this audit starts with **admin and principal**. Which role next? Default order: teacher, parent, student, accountant, manager, staff, driver.

## Next steps
Phase 3 starts with the admin screens in this order: Students, Dashboard, Attendance, Finance, Academics and exams, HR, Notifications, Settings, Admissions, Inventory. Output goes to `MOBILE_AUDIT_SCREENS.md`.

## Role status

| Role | Status |
|---|---|
| Admin, principal | Done (Batches 1 to 10) |
| Teacher | Audit done 2026-11-01. Batches 11 and 12 built (all items on the teacher change list except Library and Transport read-only, which wait for your call). Needs your phone test. Next role: student |
| Student | Audit done 2026-11-01 (screens table + change list S1-S7, V1-V6). Batch 13 built (dashboard, attendance off days, results Pass/Fail; needs your phone test). Batch 14 built (fees year filter, profile email, study helper starters, timetable break rows; needs your phone test). Student role done except optional F1 / F2. Next role: parent |
| Parent | Audit done 2026-11-02 (screens table + change list: V1-V8 verify, A1 attention strip; child pages already lifted by student Batches 13-14). Batch 15 built (attention strip; needs your phone test). Parent role done except optional H1 / H2. Next role: accountant |
| Accountant | Audit done 2026-11-02 (screens table + change list: V1-V7 verify, AC1-AC4; role is read-only on the server). Batch 16 built (fee overview card, home panels, balances bug fix; needs your phone test). Batch 17 built (ledger, transfers, expenses and income filters; needs your phone test). Accountant role done except the optional P1, P2, L1 to L3. Next role: manager |
| Manager | Audit done 2026-11-02 (screens table + change list: V1-V6 verify, M1-M4; server writes limited to curriculum, assignments, question bank, papers, worksheets, promotion). Batch 18 built (read-only Exams, Lesson Plans tile, quick actions; needs your phone test). Batch 19 built (assignment drafts for the manager, server + web + mobile + guide; needs your phone test). Manager role done except the optional P1 to P3. Next role: staff |
| Staff | Audit done 2026-11-02 (screens table + change list: V1-V7 verify, SF1-SF3; the role is small and mostly done). Batch 20 built in code (Home tiles, panels, quick actions, and a fix for the attendance cards that always read 0); waiting for a working staff login to check it in a browser; needs your phone test. Next role: driver |
| Driver | Audit done 2026-11-02 (screens table + change list: DR1-DR3; no driver account exists in the dev database, so no browser check is possible without your decision). Batch 21 built (Home tiles, panels, quick actions, My Payslips; checked with a seed driver; needs your phone test). Driver role done except the optional L1 and P1. **Every role is now audited.** |
