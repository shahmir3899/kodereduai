

---

# Mobile change list: driver role (Stage B, 2026-11-02)

Scope rule: web parity for what a driver sees. The comparison is in `MOBILE_AUDIT_SCREENS.md`, section "Driver role". The core of the driver app (route, vehicle, journey, boarding) is built and waits for phone tests; what is missing is the "own work and pay" half of the web dashboard, which the staff Home (Batch 20) already has.

## Verify first
There is no driver account in the dev database, so there is nothing to sign in as. Verification options, your call:
1. **You give me a driver login** (a real driver in a real school: read only, I would only look).
2. **I create a test driver in the seed school 37** (one user and one staff row; a database write, so only with your OK) and link one vehicle and route to it.
3. **Phone test only**: no browser check; the new screens are the staff screens reused, so the risk is small.

## P1: missing for a driver

| ID | Change | Size | Risk | Notes |
|---|---|---|---|---|
| DR1 | **Home tiles**: Attendance this month, Leave balance, Last salary (the web's KPI row), above the vehicle and journey cards. Reuse the staff Home's logic (`attendanceTile`, `leaveRemaining`). | S | Low | Reads only |
| DR2 | **My Payslips**: add the payslip screen to the driver app (the same `PayslipsScreen` the staff and finance manager use, with Share PDF) and the **Recent payslips** and **Leave balance** panels on Home. | S | Low | Reads only; the server allows a driver their own payslips |
| DR3 | **Notifications panel and quick actions** on Home: the recent notifications, and My Profile, Apply Leave, My Payslips, Notifications (unread count). | S | Low | |

## P2: low value, your call

| ID | Change | Notes |
|---|---|---|
| L1 | Transport read-only pages (Dashboard, Routes, Vehicles, Assignments, Attendance) | The web opens them to a driver, every write refused; the driver's own route and vehicle are already on Home |
| P1 | Month attendance calendar on Home | My Attendance already shows the month |

## Findings (web side, not fixed)
- The web driver dashboard shares the attendance-summary reading with the staff dashboard (lowercase keys, correct); the web own-attendance page reads uppercase keys and shows zeros (already logged under Batch 20).
- Nothing else new; the web Transport pages are admin pages that a driver can open read only.

## Stays on the web
User Guide, and every transport management page a driver cannot write.

## Proposed batch

| Batch | Items | Notes |
|---|---|---|
| **21** | DR1 Home tiles, DR2 My Payslips and panels, DR3 notifications and quick actions | **Built 2026-11-02** with a seed driver (see the Batch 21 note below) |
| later | L1, P1 only if you want them | |

The batch ends with `tsc`, `jest` (1071 now), the doc updates and your "Start Batch 21". No server change and no schema change is planned.

**Batch 21 built 2026-11-02 (driver: own work and pay on Home, a payslips screen; tsc clean, 1071 jest tests pass (nav tests cover the new route and menu item), browser-tested as a new seed driver, not on a phone, uncommitted):** **Your decision (2026-11-02):** create a seed driver. **Seed driver (a database write you approved, SEED_TEST rows in school 37 only):** new command `backend/core/management/commands/seed_test_driver.py` (idempotent, refuses any school that is not a SEED_TEST one, `--remove` deletes everything it made). It made user `SEED_TEST_driver_app` (role DRIVER, the dev password from the project CLAUDE.md), a staff record `SEED_TEST_D001`, a department and designation, route `SEED_TEST_Route_Driver` with three stops (Green Park, Main Market, City Mall), and vehicle `SEED-DRV-01` linked to the driver and the route. It makes no attendance for the driver (this month has no earlier working day yet), no payslip, no students on the route. The first run stopped half way on a required drop-off time on a stop (my mistake); the command was fixed and rerun, and a third run changed nothing. **API numbers after this batch:** web 769, covered 420, missing 349, mobile-only 6 (unchanged). **Built:** DR1 Home tiles Attendance this month, Leave balance (days left) and Latest payslip above the vehicle and journey cards; DR2 a **My Payslips** screen for the driver (the shared `PayslipsScreen` with Share PDF; route `(driver)/payslips`, in More > My HR) and the Leave balance and Recent payslips panels on Home; DR3 the notifications panel and quick actions My Profile, Apply Leave, Payslips and Notifications (with the unread count). The staff and driver Homes now share `components/hr/OwnHrHome.tsx` (`useOwnHr`, `OwnHrPanels`); the staff Home was rewritten on it with the same behaviour. **Checked in the browser as `SEED_TEST_driver_app`:** Home shows Attendance this month 0/1 with "0% present, 1 off" (one working day this month so far, none marked; the server gives the same), Leave balance 12 days, Payslips with a dash, then Start a journey, My vehicle SEED-DRV-01 (Bus, 30 seats), the route with its 9 km and 35 min, the three stops with pickup and drop times, the four quick actions, Leave balance "Casual Leave, 0% used, 12 of 12", and the empty notifications; More > My HR now lists My Leave, My Attendance and My Payslips and the payslips screen shows its empty state; the boarding endpoint answers 200 with the route and an empty roster; an expense write is refused 403. This also exercises the shared pieces the staff Home now uses. **Not tested:** starting a journey, background location and boarding with real students (they need a phone: `MOBILE_QA.md` 6 and 6b), the Recent payslips panel and the payslip PDF (the driver has no payslip), the Attendance tile with marked days, the staff Home itself (still no staff login). **Test data left in school 37:** the seed driver rows above; remove them with `python manage.py seed_test_driver --remove`. **Needs phone test:** the driver Home layout with the tiles and quick actions above the journey card.

**API cleanup, built 2026-11-02 (owner decision: use the existing APIs, delete what was built only for mobile except real needs like push notifications; server + mobile; backend transport and report card tests that remain pass apart from the 6 already-known transport journey failures, mobile tsc clean, 1078 jest tests pass, not on a phone, uncommitted):** **Mobile-only endpoints: 6 to 2** (web 769, covered 420, missing 349); the two left are the push token register and unregister. **Removed:** (1) **driver boarding**: server view `DriverBoardingView`, its URL, `DriverBoardingSerializer`, the `IsDriver` permission and `transport/test_driver_boarding.py` (9 tests); on the phone the Boarding tab and screen, `useBoardingRoster` and `useSaveBoarding`, the two API calls, the boarding logic in `services/driver.ts` and its tests, the nav entry, route and icon (the web driver has no boarding, and `transport/attendance/` stays admin-write only; Batch 21's driver Home is unaffected). (2) **the server report card PDF**: `ReportCardPdfView`, its URL, `report_card_pdf.py` (the ReportLab renderer), `test_report_card_pdf.py` and two endpoint tests; replaced by an **on-phone PDF** (below). (3) **the unused `payment-status` client call** (no screen used it; the server endpoint stays because the web uses it). **Built (replaces the server PDF):** `services/reportCardHtml.ts` (both layouts as HTML, ported from the removed renderer and the web templates, pure, 17 tests), `services/reportCardPdf.ts` (`expo-print` to a PDF file, then the share sheet), the single card Share PDF button and the class ZIP now draw the PDF on the phone from the report card data the screen already loads (`reportCardQueryParams` replaces `reportCardPdfParams`; the abort controller of the old server call went). New package: **`expo-print` ~15.0.8: APK rebuild needed**. Bonus: non-Latin names (Urdu) now print. **Checked:** unit tests for the HTML (escaping, ordinals, grade key, both layouts, Absent and Abs cells, draft banner, no logo, Urdu), a real report payload rendered with both templates and the HTML layout viewed in the browser (a trimmed copy), the remaining examinations and transport tests. **Not checked:** the PDF file itself (no browser version of `expo-print`), the logo loading in print, the ZIP, page breaks on a long card, all on a phone (`MOBILE_QA.md` 6n). **Behaviour changes to know:** the traditional frame is a block border, so on a card that runs to two pages the frame breaks at the page edge (the server PDF drew it on every page); a card needs a connection to the server for its data and to the school logo host for the picture. **Deploy note:** the server and the new APK must ship together (an old app would call the removed endpoints). **Needs phone test:** see section 6n.
