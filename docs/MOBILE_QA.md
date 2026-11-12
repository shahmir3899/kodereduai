# Mobile app QA script

Manual checks to run on a real Android phone before each release build. The automated side is `npx jest` (nav rules per role and per module are in `mobile/__tests__/navConfig.test.ts` and `navMatrix.test.ts`); this script covers what only a device can show.

Accounts: use the dev test accounts listed in `CLAUDE.md` (Test Accounts), on School 37 (test school) and Demo School 42. Do not use real families or real data. The dev database is the remote Supabase one, so only use the test schools and note any write you make. Driver and Student/Parent accounts need to exist for these schools; create them through the web admin first if they do not.

Record every failure in `docs/PHASE5_KNOWN_FAILURES.md` with role, screen, steps and what you saw.

## 1. Every role: sign in and land

For each role (School Admin, Teacher, Manager, Driver, Student, Parent; Finance manager, Staff and Principal once Phase 7 is final):

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
| Driver | Home, Journey, Messages, My Leave, My Payslips | Anything academic or financial |
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

## 6b. Batch 10 phone checks

1. Driver: start a journey, move or walk about 100 m, confirm the parent app sees the bus (`route-journey/*`), end the journey. (The legacy student journey calls are gone.)
2. Driver: start a journey, force-close the app, reopen: the journey resumes. Pings keep arriving.
3. New phone: "Find your school" shows only the code box and the QR button. A real code (demo) continues to sign-in with the school name and logo; a wrong code says no school has it.
4. Scan a school QR code from School profile on another phone: it selects the school.
5. An old install that still had a student journey saved: the first ping gets a 404 and tracking stops without a crash.

## 6c. Batch 11 phone checks (teacher)

1. Teacher: More, Messages. Send a message to a parent of a class you teach; it appears in the thread. Try a parent of a class you do not teach: it is not offered.
2. Teacher: Report Cards, pick a class and exam, tap the class ZIP button, share the file from the share sheet.
3. Teacher with an inventory item assigned: More shows Inventory, and it lists the item. A teacher with none does not see it.
4. Sign out as one user and sign in as a different one on the same phone: the app shows the second user, not the first (seen once in the browser build).

## 6d. Batch 12 phone checks (teacher)

1. Teacher: More, Curriculum Coverage. Pick a class and subject; the topics list. Tap Planned date on one topic: the phone date picker opens, the date saves and shows; Clear planned date puts it back.
2. Teacher: Assignments, Daily diary (button under New assignment; check it is not hidden behind the keyboard or the tab bar on a small phone). Pick a class and today, write one subject, Save: it returns to the list and shows a Draft diary entry.
3. Teacher: a Class teacher badge (green) shows on the assignments of your own class; a subject you only teach shows Subject teacher (amber).
4. Teacher dashboard: Lesson plans this week shows the right done, published and draft counts for a week that has plans; Notifications shows the latest five.

## 6e. Batch 13 phone checks (student)
- [ ] Student Home: the nine quick links wrap cleanly on a small phone and every one opens its screen.
- [ ] Student Home on a school day: attendance tile shows a percentage; on a Sunday or holiday it shows N/A.
- [ ] Attendance: closed days are shaded and the Off day legend swatch is readable (light and dark).
- [ ] Results: expand an exam; a failed or absent subject shows the Fail or Absent pill (needs such a mark in a test school).

## 6f. Batch 14 phone checks (student)
- [ ] AI Study Helper: Clear chat asks first, then empties the chat; the six starter questions wrap cleanly and disappear after the first message.
- [ ] Fees: with more than one year of fees the year chips scroll sideways and the tiles change with the chosen year.
- [ ] Schedule: in a school with Break, Lunch or Assembly slots those rows show between the lessons, only on the days they apply to.

## 6g. Batch 15 phone checks (parent)
- [ ] Parent Home: the attention chips wrap on a small phone and each opens the right page (child attendance, fees, exam schedule, Leave, Messages).
- [ ] Messages: an open conversation shows the messages the right way up (it drew upside down in the browser preview), newest at the bottom.
- [ ] Leave: Withdraw asks first, then the request shows Cancelled.

## 6h. Batch 16 phone checks (finance)
- [ ] Finance manager Home: Account Balance tile and the Account balances list show the real balances; the Income vs expense panel sits under the quick links.
- [ ] Finance manager Fees: the fee collection card steps back through months and the list below still works.
- [ ] Finance manager Accounts: PDF and Excel buttons open the share sheet and the file opens.

## 6i. Batch 17 phone checks (finance)
- [ ] Accounts: the Ledger button opens the ledger; From and To date pickers work; rows read well with long descriptions.
- [ ] Expenses: the Expenses and Transfers tabs sit above the list; By month steps back and the list and the Category breakdown follow it.
- [ ] Transfers (read only): rows do not open an edit sheet; with a real transfer the from, to, amount and date show.

## 6j. Batch 18 phone checks (manager)
- [ ] Manager Home: the seven quick actions wrap cleanly and each opens its screen; the Lesson Plans tile shows a count and does nothing when tapped.
- [ ] Manager Exams: no buttons anywhere; tapping an exam expands its subjects with date, marks and pass mark.

## 6k. Batch 19 phone checks (manager)
- [ ] Manager Assignments: New assignment and Daily diary are there; published assignments show no actions; a draft shows Edit and Delete.
- [ ] Manager form: no Teacher or Status field; after Create the draft shows in the list; a teacher account then sees the draft and can publish it.
- [ ] Manager with a subject that has no teacher assigned: the message "No teacher is assigned to this subject..." shows and nothing is saved.

## 6l. Batch 20 phone checks (staff)
- [ ] Staff Home: Attendance this month shows present over working days; Leave balance shows days left; the Leave balance and Assigned items panels list real rows; the quick actions (My Profile, Apply Leave, Payslips, Notifications, Messages) wrap cleanly.
- [ ] My Attendance (every role that has it): the cards show the real counts and rate for the month (they showed 0 before the fix).

## 6m. Batch 21 phone checks (driver)
- [ ] Driver Home: the three tiles and four quick actions sit above the journey card and wrap cleanly; Start journey still works from there.
- [ ] More > My HR > My Payslips opens (empty until a payslip exists).
- [ ] Test login for browser or phone checks: `SEED_TEST_driver_app` in school 37 (a seed driver with vehicle `SEED-DRV-01` and a three-stop route; recreate with `python manage.py seed_test_driver`, delete with `--remove`).

## 6n. API cleanup phone checks (2026-11-02)
- [ ] Report card (admin, principal or teacher): pick a class, student and exam, choose Enhanced, tap Share report card PDF: the share sheet opens with a PDF that matches the card on screen (school name and logo, marks table, attendance, remarks, signatures). Repeat with Traditional (frame, gold labels). A student with an Urdu name prints the name.
- [ ] Class ZIP: All report cards for a small class: progress counts up, the ZIP opens in the share sheet, each PDF opens, and a student with no marks is listed as skipped.
- [ ] A long multi-exam card: it runs to a second page without cutting a table row.
- [ ] Driver: no Boarding tab; Home, Journey, Messages and More still work.

## 7. Performance feel

1. Students list with the largest class: scrolling is smooth, more rows load near the end.
2. Class picker with a large roster (Select with search): opens quickly and scrolls smoothly.
3. Cold start to home in under a few seconds on a mid-range phone; note the time.
4. Leave the app in the background for 10 minutes, return: it refreshes without a blank screen.

## 8. Release gate

All of sections 1 to 5 pass for every shipped role, section 6 passes for Driver, no open failure in `PHASE5_KNOWN_FAILURES.md` marked blocking.
