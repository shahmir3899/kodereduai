# Mobile UI Polish Plan

Status: **Planned 2026-10-30. Nothing built. Nothing committed.**
Scope: version 1 polish only. Transport, Library and Hostel screens for admin and principal are version 2.
Source of truth for "what good looks like": the web app (`frontend/src`). Mobile uses the same API, so most work is presentation plus two features the phone never called (AI comments, user photo).

## Phase A: AI remark on Assessments (requested) - BUILT 2026-10-30, uncommitted, never run on a device

Shown inline in the editor (it is a Modal, which would cover a toast). Code: `buildRemarkRequest` and `canSuggestRemark` in `services/assessments.ts`, `aiSuggestAssessmentRemark` in `services/api.ts`, test `__tests__/assessmentRemark.test.ts`. `tsc` clean, new and nav tests pass.

Why: the web suggests the teacher and principal remark from the skill and behaviour ratings. The phone has plain text boxes.

- Add a "Suggest with AI" button under both remark boxes in `components/exams/AssessmentsScreen.tsx`.
- Call `POST /api/examinations/student-term-assessment/ai-remark/` with `{ratings: {label: 1-5}, remark_type: 'teacher'|'principal'}`. The reply is `{remark, fallback}`.
- Fill the box with the draft, never save by itself. The teacher edits, then saves as today.
- If `fallback` is true, show a small "template text, not AI" hint.
- Disable the button until at least one rating is set. Show a spinner and an error toast on failure.
- The principal button follows the existing `canEditPrincipalRemark` rule.
- Add the API call to `services/assessments.ts` and a test for the payload builder.

Done when: both remarks can be drafted from ratings on a phone, and a failed call leaves the typed text untouched.

## Phase B: User photo instead of the school logo (requested) - BUILT 2026-10-30, uncommitted, never run on a device

Built: `components/nav/UserBadge.tsx` (header avatar, and the user row at the top of More, both open the profile), `components/profile/ProfileScreen.tsx` (take or choose a photo with the phone's square crop, upload, remove, edit name, phone and email; only changed fields are sent), `services/profile.ts`, route `my-profile` in all eight groups, test `__tests__/profile.test.ts`. The school logo and name stay in More under the user row. **No new native module:** `expo-image-picker` was already in the build, so phase B does not need a new APK.

Why: after login the header shows the school logo. It should show the person.

- Header (`components/nav/SchoolBadge.tsx` compact slot): show the user's photo, initials if none. Tap opens Profile.
- More: top row shows the user (photo, name, role). The school logo and name move to a second row with the school switcher.
- New Profile screen, in every persona group: photo (camera or gallery, square crop), remove photo, edit first name, last name, phone, email.
- API: `POST /api/auth/me/photo/` (multipart `file`), `DELETE /api/auth/me/photo/`, `PATCH /api/auth/me/`. The user field is `profile_photo_url`; refresh `AuthContext` after each change.
- Parent and student see their own photo, not their child's.
- `expo-image-picker` is already a dependency (staff documents use it); the crop is the picker's own square crop.
- Route table and `__tests__/routeStructure.test.ts` must list the new screen in every group.

Done when: every role sees its own photo or initials in the header, can change or remove it, and the school logo still appears in More.

## Phase C: AI comments on Results and Report card (requested) - BUILT 2026-10-30, uncommitted, never run on a device

Built: `components/exams/CommentTools.tsx` (`CommentJobCard`: Generate, Regenerate all with confirm, live progress once a second, Stop, result message; `CommentRow`: source badge AI/Template/Edited/Older, Edit, Regenerate with confirm before replacing text), `services/examComments.ts`, API calls in `services/api.ts`. Used on Results (card above the list, comments under each expanded student) and on the Report card (edit and regenerate against `comment_exam_id` / `overall_comment_exam_id`; no source badge there because the report card API does not send the source). Test `__tests__/examComments.test.ts`. The server's refusal text is shown as is (for example only the class teacher may generate for the whole exam). `tsc` clean, 64 suites / 798 tests pass, Android bundle exports.

Why: the web generates, regenerates and edits report-card comments. The phone shows them read-only.

- Results (`components/exams/ResultsScreen.tsx`): "Generate comments" for the exam. It runs in the background, so poll `comment-job/` and show real progress with a Cancel button (`cancel-comment-job/`). A second "Regenerate all" asks for confirmation (`force`).
- Per student and subject: Edit (`edit-comment/`), Regenerate (`regenerate-comment/`). A null subject means the overall comment.
- Label each comment "AI", "Template" or "Edited" (`ai_comment_source`).
- Report card (`ReportCardScreen.tsx`): same Edit and Regenerate on the comment rows.
- Role rules come from the server (`_assert_can_bulk_generate_comments`): show the buttons by role, but let a 403 produce a clear message.
- Add the calls to `services/` and hooks that invalidate the results and report-card queries.

Done when: a teacher or admin can generate, watch, cancel, fix and regenerate comments for an exam from the phone, and the report card shows the result.

## Phase D: Dashboards - BUILT 2026-10-30 (trend strips not built), uncommitted, never run on a device

Finished: `components/dashboard/LeadershipInsights.tsx` (admin home, opened on demand, calls `/api/bootstrap/leadership-academic-insights/`), `StatTiles` shared by manager, accountant and staff homes, recent notifications on accountant and staff homes. Tests `__tests__/leadershipInsights.test.ts`.

Built: shared `components/dashboard/{HeroCard,AttendanceBreakdown,MonthlyFeeCard,RecentNotifications}.tsx`, logic and tests in `services/dashboardView.ts` / `__tests__/dashboardView.test.ts`. Admin home now has the day hero (percent present, or No school today), the four-state attendance bar, the monthly fee card (collected, pending, paid/partial/unpaid) and the latest notifications. The teacher home uses the shared hero (it already had section progress); the manager home uses the shared notifications block. Not done: leadership insight panels, a stat-card refresh on accountant and staff homes, trend strips (the dashboard API sends no history to draw).

Compare with `AdminDashboard.jsx` (608 lines) vs `app/(admin)/dashboard.tsx` (198).

- Admin and principal: stat card row with subtitles (present, absent, fee collected, staff on leave), attendance breakdown, monthly fee collection card, leadership insight panels, recent notifications, date stepper. Keep Needs attention and Quick actions.
- Teacher: hero card for the current period (exists as a card, tidy it), attendance bars per section.
- Manager, accountant, staff: same stat card style so every home screen looks like one family.
- Off-day handling ("OFF day") on every card, as on the web.

## Phase E: Header and shared components - BUILT 2026-10-30, uncommitted, never run on a device

Built: `components/nav/HeaderActions.tsx` (academic year chip for staff-type shells, notification bell with unread badge, then the user's photo), `components/ui/RecordCard.tsx` (used on the Assessments roster; `StudentCard` and `StaffCard` are rebuilt on it but no screen uses them yet), and `Select` now shows its search box by default for lists of more than 8 options. Added a teacher notifications inbox (`app/(teacher)/inbox.tsx`) so the bell and push taps work for teachers. The year chip is display only. Not done: trend strip.

- Notification bell with unread count in the header (web has it; the phone has an inbox tab only).
- Academic year chip beside the school switcher.
- Shared `RecordCard` and `StatusPill` for lists (analogue of `docs/CARD_SYSTEM.md`), a small trend strip for dashboards and finance.
- Searchable picker for long lists (students, classes) in place of plain selects.

## Phase F: Older screens - BUILT 2026-10-30 except report card templates and PDF, uncommitted, never run on a device

Audit result: the finance, hostel, library and notification screens listed below had already been moved to the shared components. Moved now: face attendance review, capture and enrollment. Left alone: `attendance/capture` and `attendance/review` (photo register OCR, not linked while OCR is parked). Accessibility: new per-element test `__tests__/touchableA11y.test.ts`; 24 labels and roles fixed. **Report card template choice and PDF share: built later the same day** with a new server-side PDF endpoint (see `docs/MOBILE.md`, last section); the web's browser-made PDF was not touched.

The finance dashboard, expenses, income, transactions, hostel gate passes, library issue, notification send and history, attendance capture and review, and face attendance still use ad hoc spinners and alerts.

- Move them to `QueryBoundary`, `Skeleton`, `ErrorState`, `EmptyState` and `Toast`.
- Give every icon-only button a descriptive accessibility label.
- Report card: template choice (traditional or enhanced) and one-tap PDF share.

## Order and effort

| Order | Phase | Size | Native rebuild |
|---|---|---|---|
| 1 | A: AI remark | small | no |
| 2 | B: User photo and Profile | medium | no (`expo-image-picker` already in the build) |
| 3 | C: AI comments | medium | no |
| 4 | D: Dashboards | medium | no |
| 5 | E: Header and shared components | medium | no |
| 6 | F: Older screens | medium | no |

Each phase is reviewed with you before the next. Phases A and C need a backend with an AI key set; test against the demo school (id 42).

## Rules for this work

- No commit, push or PR without your explicit approval in chat.
- No schema change. No backend change is expected for A to F.
- Checks before showing a phase: `npx tsc --noEmit`, `npx jest`, and a bundle export (see `docs/MOBILE.md`).
- Device testing stays open: nothing here has been run on a phone yet.
