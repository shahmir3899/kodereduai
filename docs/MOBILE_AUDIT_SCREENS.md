

---

# Driver role: screen comparison (Stage B, 2026-11-02)

Web reference: `DRIVER_NAV` in `frontend/src/navigation/navigationConfig.js` (a driver sees Dashboard, Transport, Self Service, Notifications, Messages, User Guide), `frontend/src/pages/driver/DriverDashboard.jsx`, the five Transport pages (`transport/*`, every write refused for a driver: `canManageTransport` is admin and principal only), and the self-service pages. Mobile: `mobile/app/(driver)` (tabs Home, Journey, Boarding, Messages, More) with `services/driver.ts`, `services/tracking*.ts` and the shared own-HR screens. **Confidence:** "Read" = web and mobile code read. **No browser check is possible for this role:** the dev database has no driver account at all (a query for role DRIVER returns nobody), and the two names I would guess (`SEED_TEST_driver`, `SEED_TEST_driver_e2e`) do not exist. Journey and boarding also need a real phone (background location), which is already on the phone checklist (`MOBILE_QA.md` sections 6 and 6b).

## DR1. What the driver sees on the web, and the mobile screen for it

| Web item | Mobile screen | Status |
|---|---|---|
| Dashboard tiles: **Attendance This Month**, **Leave Balance**, **Last Salary**, My Vehicle (with its route) | `dashboard` | Yes (Batch 21: Attendance this month, Leave balance and Latest payslip tiles added above the vehicle, route, stops and journey) |
| Dashboard panels: My Route and its stops, My Attendance calendar, Announcements and Notifications, Quick Actions, My Vehicle, **Leave Balance breakdown**, **Recent Payslips (3)** | `dashboard` | Yes (Batch 21: Leave balance, Recent payslips and Notifications panels added; the month calendar is My Attendance) |
| Quick Actions: My Profile, Apply Leave, **My Payslips**, Notifications (unread badge) | `dashboard` | Yes (Batch 21: My Profile, Apply Leave, Payslips and Notifications with the unread count) |
| **My Payslips** (own payslips, PDF) | none | Yes (Batch 21: `payslips`, in More > My HR; Share PDF) |
| Self Service: Leave and Attendance tabs | `leave`, `my-attendance` (two More items, not one hub) | Yes (shared screens); a combined hub is not needed |
| Transport > Dashboard, Routes, Vehicles, Assignments, Attendance (read only for a driver) | none | Not built, on purpose: the driver's own route, vehicle and stops are on Home. A read-only view of the whole transport setup is optional (L1) |
| Journey (start, share location, end) | `journey`, Home | Mobile extra on endpoints the web calls; needs a phone (`MOBILE_QA.md` 6, 6b) |
| Boarding (mark students on the bus) | none | Removed 2026-11-02 (API cleanup): the web driver has no boarding and `transport/attendance/` is admin-write only |
| Messages, Notifications | `messages/*`, `inbox` | Yes (shared) |
| Change password, My Profile | `change-password`, `my-profile` | Yes |
| User Guide | none | Stays on the web |
