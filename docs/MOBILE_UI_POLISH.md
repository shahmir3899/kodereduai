# Mobile UI polish (independent of the parity batches)

Kept apart from the parity docs so it never collides with the other session's updates.
Rules: no new native packages, no edits to `services/api.ts`, `navigation/routes.ts`, or role screens.

## U1 Side menu (admin only) - built 2026-11-01, browser-tested, uncommitted
- `components/nav/SideMenu.tsx`: slide-in panel (Modal + Animated), permanent left rail at 768 px and wider. Closes itself on any route change.
- `components/nav/SideMenuContext.tsx`: open/close state, `DOCKED_MIN_WIDTH = 768`. Outside the provider it does nothing, so other roles are unaffected.
- `components/nav/MenuButton.tsx`: hamburger in the Dashboard header (hidden when docked).
- `components/nav/MoreScreen.tsx`: body extracted as `MoreContent`, shared with the panel; the More page is unchanged.
- `components/nav/NavGroupList.tsx`: optional `onNavigate` prop.
- `app/(admin)/_layout.tsx`: provider, rail, More tab press opens the panel on a phone (the More page stays as the fallback route).
- Tested at 390 px (hamburger, More tab, row navigation, backdrop close) and 1000 px (rail). Not tested on a phone: slide animation feel, Android back button closing the panel.
- Other roles adopt it with the same few lines in their layout.

## U2 Menu search, pins and recents - built 2026-11-01, browser-tested, uncommitted
- `services/menuSearch.ts` (`filterGroups`, `openableItems`), `services/menuShortcuts.ts` (pins max 6, recents max 4, saved per person and school in AsyncStorage, tolerant of bad data), `hooks/useMenuShortcuts.ts`, tests in `__tests__/menuShortcuts.test.ts`.
- `components/nav/MoreScreen.tsx` (`MoreContent`): search box, Pinned and Recent groups above the menu (hidden while searching), "Nothing in the menu matches" message. The More page and the side panel both get it.
- `components/nav/NavGroupList.tsx`: `onNavigate` now passes the item; optional `pinned` and `onTogglePin` show a star on each openable row.
- Tested at 390 px as admin: search filtered to one match, the star pinned it, clearing the search showed Pinned, and after a full page reload the pin and a Recent entry were still there. Not tested: the pin limit and Android keyboard behaviour (phone).
- Test setup note: the other session shares the browser pane on port 3000 and was switching it to the teacher login, so this batch was tested on a second Metro at port 4321 (the only other port the backend's CORS allows).

## U3 Skeleton shapes - built 2026-11-01, list shape browser-tested, uncommitted
- Finding that changed the plan: first loads already use skeletons everywhere (27 screens via `QueryBoundary` or `<Skeleton />`). The spinners left in list screens are the small "loading more" footers, which are right as they are, and the full-screen ones (camera, opening the school) show a message. So U3 became "make the skeleton match the content", not "replace spinners".
- `components/ui/Skeleton.tsx`: `variant` = `card` (default, unchanged), `list` (avatar and two lines), `stats` (figure tiles), `detail` (photo header and lines). `QueryBoundary` takes an optional `skeleton` prop.
- Applied: `list` in Students list, Staff directory, Payroll, Inventory items, Finance lists; `stats` in the admin dashboard; `detail` in the student profile. Teacher and shared screens untouched.
- Seen: the `list` shape (Students, with the network slowed by 6 s). Not seen: `stats` (dashboard was cached) and `detail`; they are plain layouts that type-check.

## U4 Tab bar and touch targets - built 2026-11-01, measured in the browser at 320 px, uncommitted
- Measured every tab and small button at 320 px wide (browser). All five tabs are 64 px wide and 47 px tall, labels sit 4 px above the bottom edge. Only one real problem: "Attendance" at 11 px was 57 px wide in a 54 px box and got an ellipsis.
- `components/nav/tabBarStyle.ts`: label drops to 10 px under 340 px wide (all labels now fit, "Attendance" 52 of 52). The extra padding is inside the navigation library, so `tabBarItemStyle` could not remove it.
- `components/dashboard/RecentNotifications.tsx`: the "See all" link is now at least 44 px wide (it was 38).
- Checked and left alone: the dashboard day arrows look small (25 x 38) but already have a 10 px `hitSlop`, so the real tap area is about 45 x 58.
- Not covered (needs a phone): the Android navigation-bar and gesture-bar inset. The code already grows the bar with the safe-area inset, and the browser has no inset to test.

## U5 Collapsible menu groups - built 2026-11-01, browser-tested, uncommitted
- `services/menuCollapse.ts` (+ `__tests__/menuCollapse.test.ts`), `hooks/useMenuCollapse.ts`; `NavGroupList` takes optional `isOpen` and `onToggleGroup` (the Academics menu does not pass them, so it is unchanged).
- Rules: groups of 2 or fewer are always open; others start closed unless they hold the current screen; a tap overrides that and is kept per person and school; search opens everything; Pinned and Recent never collapse. Headers show "Finance . 8" and an arrow, 44 px tall.
- Seen: General and Attendance closed, Finance open on /finance/accounts; after opening General and closing Finance and a full reload, both choices held.

## U6 School block - built 2026-11-01, browser-tested (sheet opens, no switch made), uncommitted
- `components/nav/SchoolBlock.tsx` replaces the logo row and the plain name in the menu. With more than one school it shows "Switch school" and a swap icon and opens the sheet.
- `SchoolSwitcher.tsx` now exports `SchoolSwitchSheet` (shared with the dashboards' school name) and shows errors in a toast instead of `Alert.alert` (Alert shows nothing on the web build).
- Tested with `focus3899` (Branch 1 and Branch 2). I did not actually switch school, because that writes to the real database. The switch itself is old, unchanged code.

## U7 Academic year switcher - built 2026-11-01, browser-tested, uncommitted
- Roles: admin (incl. principal and super admin), manager, finance manager (`canChooseYear`). Teacher, staff, parent, student and driver keep the current year.
- `services/yearChoice.ts` (+ `__tests__/yearChoice.test.ts`): `resolveYear`, saved choice per person and school, a small shared store so a change shows on every screen at once.
- `hooks/useAcademicYear.ts` now returns `current` (the chosen year), `actual` (the school's current year), `isPast`, `canChoose`, `choose`. Option `lockToCurrent` ignores the choice.
- Locked to the current year: the attendance class list (`useAttendanceClassOptions`), the fee collection screen and the fee payments list (`useFees.ts`).
- UI: header chip is tappable for those roles and turns amber for a past year; `components/nav/YearSheet.tsx` (year list, "Current" tag, warning); `components/nav/YearRow.tsx` under the school block in the menu. The chip is now up to 130 px wide because "Academic Year 2026-27" was cut off.
- Seen as `focus3899`: chose 2025-26, the dashboard changed from 232 to 217 students and the chip turned amber; the attendance register still asked for the current year's classes (year 33, not 11).
- Not tested: the manager and finance manager shells (the chip is shared, so it should appear there); the web's term badge is not included.
- Known: the choice is saved in the browser or phone only, and a school switch starts with that school's own saved choice.

## U8 Menu icons - built 2026-11-01, browser-tested, uncommitted
- `navigation/navIcons.ts`: one icon per menu entry (keyed by web path) and per group, taken from the web sidebar's Heroicons and mapped to the nearest Ionicons. Unknown entries get a plain dot. `__tests__/navIcons.test.ts` fails if an entry or group in `navConfig.ts` has no icon, so new menu entries cannot be added without one.
- `components/nav/NavGroupList.tsx`: group header icon, a 20 px icon before each entry, and the entry for the current screen is highlighted (longest matching path, so "/finance" does not light on "/finance/accounts"). The Academics menu uses the same list and gets the icons too.
- `navConfig.ts` is untouched (it is a port of the web rules the other session may edit).
- Seen at 390 px: icons on group headers and rows, Accounts highlighted on /finance/accounts. Icons are near matches, not identical to the web's (Heroicons there).
- Small change: the year row says "past" instead of "past year" so it fits on one line.

## Next
A phone check of U1 to U7, then commit with your approval. `__tests__/studentPortal.test.ts` fails because of the other session's unfinished change to `services/studentPortal.ts` (it adds an `off` field), not these batches.
