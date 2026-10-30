# Mobile app QA script

Manual checks to run on a real Android phone before each release build. The automated side is `npx jest` (nav rules per role and per module are in `mobile/__tests__/navConfig.test.ts` and `navMatrix.test.ts`); this script covers what only a device can show.

Accounts: use the dev test accounts listed in `CLAUDE.md` (Test Accounts), on School 37 (test school) and Demo School 42. Do not use real families or real data. The dev database is the remote Supabase one, so only use the test schools and note any write you make. Driver and Student/Parent accounts need to exist for these schools; create them through the web admin first if they do not.

Record every failure in `docs/PHASE5_KNOWN_FAILURES.md` with role, screen, steps and what you saw.

## 1. Every role: sign in and land

For each role (School Admin, Teacher, Manager, Driver, Student, Parent; Accountant, Staff and Principal once Phase 7 is final):

1. Sign in. You land on that role's home tab, and the tabs match the role (no tab or More entry for something the web hides from that role).
2. Open **More**. Every entry opens a screen or an "Open on web" page; none is a dead end. Entries marked "Soon" are expected only for unbuilt screens.
3. Turn one module off for the school (web admin, school settings), pull to refresh or sign in again: its entries disappear from More. Turn it back on.
4. School switcher (users with more than one school): switch, the data changes, no screen shows the previous school's data.
5. Sign out, sign in as a different role on the same phone: nothing from the first user is visible.

## 2. Role checks

| Role | Must work | Must NOT be reachable |
|---|---|---|
| School Admin | Dashboard numbers, Manual Entry attendance, Students list and profile, Fee collection, Leave approvals, Staff directory (scroll past 20 staff), Messages, Face attendance entry | none (but Setup wizard, promotion, exam types/grade scale show "Open on web") |
| Teacher | Own classes only, Manual Entry, Marks Entry, Assessments, Results, Report cards, Assignments with submissions, Collect Payments, My Leave | Finance beyond Collect Payments, Staff directory, Face attendance, Hostel, Admissions |
| Manager | Timetable, Subjects, Calendar, content lists, Classes, Messages, My Leave | Students, Attendance entry, Finance, Transport, Library, Inventory |
| Driver | Home, Journey, Boarding, Messages, My Leave | Anything academic or financial |
| Student | Dashboard, Schedule, Tasks (submit text + link), Results, Fees (view) | Other students' data |
| Parent | Children, per-child attendance/fees/results/timetable, Messages to teachers, Leave requests, Track bus | Another family's children |

Spot-check the boundary: sign in as Teacher and try to open a Student of another class by id from a notification or search; it must say not available.

## 3. Offline and session

1. Open Students, Subjects and Timetable while online, then turn on airplane mode: subjects and timetable still show (saved lists); the offline pill appears at the top.
2. Still offline, open Fees, Attendance, Marks: they show "No connection" with Try again, not an empty list.
3. Offline, try to save attendance, marks, a message, a leave request: each says nothing was saved because there is no connection; the form keeps what you typed.
4. Turn the connection back on: the pill goes away; Try again works.
5. Start the app offline while signed in: it must not clear your sign-in (it shows the login screen; signing in again works, and reconnecting then reopening keeps you in).
6. Session expiry: on the web, change this user's password (or wait for the refresh token to expire). Back in the app, any action returns to Login with "Your session has expired. Please sign in again."
7. A wrong password on Login says invalid credentials; with airplane mode on it says it cannot reach the server.

## 4. Push notifications

1. Sign in on the phone, allow notifications. Send a test notification from the web admin to this user: it arrives.
2. Sign out, then send another: it must NOT arrive on the phone (token unregistered on sign out).
3. Sign in as a different user, send to that user: it arrives for the new user only.
4. Tap a notification: the app opens (deep links are not wired yet, see PHASE5_KNOWN_FAILURES).

## 5. Accessibility

1. Turn on TalkBack. On Login, Home, a list screen and a form screen, swipe through: every control is announced with a name and role ("Save, button"); pickers say their current value; icons are not read as noise.
2. Open a picker (Select): TalkBack stays inside the sheet until it closes.
3. Set Android font size to the largest and Display size to largest. Check Login, Dashboard, Manual Entry attendance, Marks Entry and More: text may be large but nothing is cut off or overlapping, and every button is still tappable. (Text scaling is capped at 1.6x.)
4. In bright sunlight or with brightness low: status pills (Present, Absent, Pending) are readable.
5. Tap targets: you can hit every button with a thumb without mis-taps in the attendance and marks lists.

## 6. Driver and bus tracking

Follow the 12-step checklist in `docs/ANDROID_BACKGROUND_LOCATION.md`.

## 7. Performance feel

1. Students list with the largest class: scrolling is smooth, more rows load near the end.
2. Class picker with a large roster (Select with search): opens quickly and scrolls smoothly.
3. Cold start to home in under a few seconds on a mid-range phone; note the time.
4. Leave the app in the background for 10 minutes, return: it refreshes without a blank screen.

## 8. Release gate

All of sections 1 to 5 pass for every shipped role, section 6 passes for Driver, no open failure in `PHASE5_KNOWN_FAILURES.md` marked blocking.
