# Mobile UI refresh plan

Status (2026-11-25): plan approved. **Phase 1 built** (uncommitted): `BackButton`, `RoleStack`
(replaces the 20 copied Stack headers; `FolderStack` now wraps it), ☰ on every tab, ← on every
non-tab screen and on folders opened from the menu, `backBehavior="history"`, short year chip,
`__tests__/headerView.test.ts`. Checked in the browser as parent and admin.

**Phase 2 built** (2026-11-26, uncommitted). The audit (`mobile/scripts/ui_audit.js`) showed the
real gaps were smaller than the survey counts: only 1 bare full-screen spinner (camera permission,
kept), every view screen already had pull-to-refresh (the 23 without it are forms/editors holding
drafts, listed as exempt in the script), but all 138 `EmptyState`s had no icon and about 30 card
sections used plain "Loading…" / "Could not load…" / "No …" text with no retry. Done:
- `EmptyState` picks an icon from its title (`services/emptyIcon.ts` + test) unless one is given.
- New `components/ui/SectionState.tsx` (`SectionLoading`, `SectionError` with Try again,
  `SectionEmpty` with an icon from its message), used in 31 files (dashboards, finance cards,
  student/exam/report-card sections, parent child card, assistant history).
- Audit now reports 0 / 0 / 0. Checked in the browser as admin (empty state icon, finance card
  empties, forced load failure → inline error → Try again reloads).

**Phase 3 built** (2026-11-26, uncommitted): `components/dashboard/HomeHero.tsx` (blue gradient band,
curved bottom, ☰ / year / bell / photo in white, time-of-day greeting, school switcher, white card
of up to 4 figures; `HomeShell` keeps it on Home's loading/error states) on all 8 Homes; white
header hidden on Home. Rules in `services/homeHero.ts` (+ test): greeting, `splitTiles` (manager,
finance, staff, driver: first 3 tiles in the banner, the rest stay in the grid), `parentFigures`.
Decision while building: banner figures must not repeat what is right below, so admin = students /
staff present / fees collected and teacher = classes today / plans done this week / my classes
(their to-dos stay in "Needs attention"); student's 4 tiles moved into the banner. Checked as
admin, parent, teacher.

**Phase 4 built** (2026-11-26, uncommitted):
- `components/ui/TileGrid.tsx` (round icon tiles, 4 a row, red badge, `collapseAfter` → "More")
  replaces the quick-action boxes on all 7 staff/student Homes (emoji swapped for icons) and the 9
  grey chips on the parent child card (3 + More; the card's top is now its own button, so the
  shortcuts no longer sit inside a button — the web nested-button warning is gone).
- `components/ui/AttentionCard.tsx` + `services/attentionLook.ts` (+ test): icon and action word
  per item key; used by admin and teacher "Needs attention" and the parent attention strip. Fixed
  in passing: admin attention rows all had the screen-reader label "Next day".
- `RecordCard` gained `icon`, unread `badge` and a `footer` outside its button; messages, my leave
  and overdue books lists moved onto it (students and staff already used it). Other lists keep
  their own card layouts for now (same surface and radius).
- `docs/MOBILE.md` "Screen building blocks" section lists what to use.
Checked as teacher (tiles with badges, attention cards, messages) and parent (child tiles, More,
attention).

**Phase 5 built** (2026-11-26, uncommitted):
- `constants/colors.ts`: `FontSize.xxs` (badges, chart axes) and `FontSize.display` (one big
  figure); new `GlyphSize` (sm/md/lg) for symbols drawn as text (‹ › arrows, ✓ ticks); one-off
  shades named in `Colors` (leaveLight, purpleLight, infoBorder, errorSoft, star, gold/silver/bronze,
  black); new `Palette` (timetable subject colours, timetable slot backgrounds, talk-orb moods).
- All 69 raw `fontSize` numbers (45 files) and 47 of 50 raw colours (22 files) replaced; the 2 left
  are the calendar's default event colours, saved with each event as data (exempt in the audit).
  Raw spacing 10/12/16 replaced; 5/7 (inside pills) and 56/96 (room for the banner card and a
  floating button) kept on purpose.
- 84 styles left unused by Phases 3-4 removed (`scripts/unused_styles.js` finds them).
- Touch: only 5 icon-only buttons exist and all already have a 44px box or hitSlop; buttons
  already dim on press (TouchableOpacity), so no extra press effect was added.
- Not done, by decision: the `AppText` wrapper (would sit unused unless every Text is migrated;
  the named sizes give the same rule) and haptics (native module, needs a new APK; not asked for).
- `scripts/ui_audit.js` now also checks raw font sizes, raw colours and small icon buttons:
  all six checks report 0.
Full mobile suite: 162 files, 1682 tests pass; typecheck clean. **All five phases built.**

Builds on the bottom bar + side panel work done the same day (raised-circle tab bar, side panel for
every role, no stars/Pinned/Recent, every menu group foldable). All of this is mobile-only: no
server, API or database change.

Every item lives in a shared component, so all 8 roles (admin, teacher, manager, finance, staff,
driver, parent, student) get it at once.

## What the code looks like today (survey 2026-11-25)

| Area | Today |
|---|---|
| Screens | 285 screen files in `mobile/app`, 8 role folders, 37 nested Stack folders |
| Screens with no back button | Hidden tab screens (`href: null`): admin 48, teacher 21, finance 16, student 10, driver 6, staff 5, parent 3. Plus the first screen of every Stack folder opened from the menu (e.g. admin HR, Hostel, Transport, Messages) |
| Android back key | Tabs use the default `backBehavior` (jump to the first tab), not "go back to where I was" |
| Menu button (☰) | Only on Home |
| Year chip | Shows the full year name (e.g. `SEED_TEST_2025-2026`) and squeezes the title |
| Stack headers | Same header style copied into 20 separate `_layout.tsx` files |
| Home screens | Each role's dashboard starts with its own plain "Welcome" text; `HeroCard` (light tinted card) used by admin + teacher only |
| Loading / empty / error | Shared `QueryBoundary`, `Skeleton`, `EmptyState`, `ErrorState` exist and are widely used, but 32 files still show a bare spinner and about 50 scrolling screens have no pull-to-refresh |
| Cards | `Card` (99 files), `StatusPill` (102), but `RecordCard` only 5 and `ListRow` 2; most lists build their own rows. Parent child cards use 9 grey chips |
| Styles | 69 raw `fontSize: <number>`, 16 raw paddings, 50 raw hex colours outside `constants/colors.ts`; no haptics |

## Phase 1: Header and back buttons (items 1 + missing back buttons)

**Rule for every role:**
- A **tab screen** (Home, Attendance, Marks…) shows **☰** on the left.
- **Any other screen** (opened from the menu, a card, a notification) shows **← back** on the left.
- Android back key and the ← button both go to the previous screen.

**Build:**
1. `components/nav/BackButton.tsx`: chevron-back icon, 44px target. Calls `router.back()`; when
   there is nothing to go back to (opened from a notification or a deep link) it goes to the role's
   Home instead of doing nothing. The "where to go" decision is a small pure function with a test.
2. `PersonaTabs.tsx` and `app/(admin)/_layout.tsx`:
   - hidden screens (`href: null`) get `headerLeft: BackButton`;
   - every visible tab gets `headerLeft: MenuButton` (not just the first);
   - `backBehavior="history"` on `<Tabs>`, so the Android back key returns to the last screen.
3. `components/nav/stackOptions.ts`: one `useStackScreenOptions()` with the shared header style,
   plus a back button on the Stack's first screen when that Stack is **not** a bottom tab (a Stack
   that is a tab, like admin Finance, keeps ☰ on its first screen). Replace the copied header
   block in the 20 Stack `_layout.tsx` files with it.
4. **Year chip:** show a short form (`2025-2026` → `2025-26`, any prefix dropped), max width so the
   title never gets cut. Pure `shortYearLabel()` in `services/headerView.ts` with tests.
5. Header title: one line, ellipsis.

**Check:** sign in as admin, teacher, parent; open 5 screens from the menu each, confirm ← works
and the Android-style back (browser back) returns to the previous screen.

## Phase 2: Loading, empty and error states (item 4)

1. A small audit script (`scripts/ui_audit.js`, read-only) that lists:
   screens with a bare `ActivityIndicator`/`Spinner`, scrolling screens without `RefreshControl`,
   and screens that only show a toast on load failure.
2. Replace bare spinners (32 files) with `Skeleton` in the right shape, or wrap the screen in
   `QueryBoundary`.
3. `EmptyState`: always an icon + one line + an action button where there is a next step
   ("Mark attendance", "Apply for leave", "New message"). It already supports `icon` and
   `actionLabel`; add a default icon so no empty state is text-only.
4. Load failures show `ErrorState` with **Try again** inline (toasts stay for save/submit errors).
5. Pull-to-refresh on every list and dashboard that lacks it.

## Phase 3: Home hero for every role (item 2)

1. `components/dashboard/HomeHero.tsx`: blue band (primary → primaryDark, `expo-linear-gradient`
   is already installed) with a curved bottom edge, holding:
   - ☰, bell and avatar in white (the white header is hidden on Home only);
   - greeting ("Good morning, Hassan"), school name, short year;
   - a white summary card overlapping the band's bottom edge with 2-3 key numbers.
2. Each role's `dashboard.tsx` passes its own numbers, **only from data the dashboard already
   loads** (no new API calls):

   | Role | Summary card |
   |---|---|
   | Admin | % present today · students not marked · fees collected this month |
   | Teacher | classes to mark today · exams awaiting marks · submissions to grade |
   | Manager | classes · today's attendance % · items needing attention |
   | Finance | collected this month · pending fees · expenses this month |
   | Staff | my attendance this month · leave balance · pending requests |
   | Driver | today's journey status · stops · students on route |
   | Parent | per child: attendance % · fees due (swipe when more than one child) |
   | Student | attendance % · next exam · pending assignments |

   Any figure the dashboard does not already fetch is dropped, not added.
3. The existing "today" `HeroCard` stays below the hero as normal content.

## Phase 4: One card, list and tile style (item 3)

1. **List card:** extend `RecordCard` to be the one row style: leading icon or avatar, title,
   subtitle, optional `StatusPill`, chevron, 44px+ height. Move ad hoc list rows onto it, starting
   with the most-used lists (students, staff, messages, notifications, fees, leave, library).
2. **Action tiles:** new `ActionTile` + `TileGrid` (round tinted icon, label under it, 4 per
   row, a "More" tile when there are more than 4). Use for:
   - parent child cards (replaces the 9 grey chips);
   - each role's dashboard quick actions.
3. **Attention cards:** new `AttentionCard` for the "Needs attention" lists (admin, teacher,
   manager, parent): coloured icon per type (attendance, stock, leave, library, fees), the count,
   the sentence, and a short action label ("Mark now", "Review").
4. Add a short "Mobile cards" section to `docs/MOBILE.md` so new screens use these.

## Phase 5: Typography, spacing, touch and colour (item 5)

1. **Text sizes:** `components/ui/AppText.tsx` with 4 variants (title, section, body, caption)
   mapped to `FontSize`. Replace the 69 raw `fontSize: <number>` values.
2. **Spacing:** one card gap (`Spacing.md`) and one inner padding (`Spacing.lg`); replace the
   16 raw paddings.
3. **Touch:** every pressable at least 44px (audit-script check); press feedback (slight dim +
   scale) through one shared pressable style.
4. **Haptics:** light tap on tab press and primary buttons with `expo-haptics`.
   **This is a native module: it needs a new APK build.** Optional; can be left out.
5. **Colour:** status colours from one map (green good, amber warning, red overdue) used by
   `StatusPill`, attention cards and hero numbers. Move the 50 raw hex colours into
   `constants/colors.ts`, so a dark theme is possible later (dark mode itself is not in this plan).

## Order and checks

| Phase | Size | Why this order |
|---|---|---|
| 1 Header + back | small | Fixes a real navigation gap; everything else sits under this header |
| 2 States | medium | Quick wins on many screens |
| 3 Home hero | medium | Biggest visual change; needs Phase 1's header rule |
| 4 Cards + tiles | large | Touches the most screens; done list by list |
| 5 Type, spacing, touch | medium | Final polish pass over everything above |

For each phase: run only the new/touched test files (full suite at the end), check in the browser at
375px and 320px as admin, teacher and parent, no videos. Nothing is committed until you say so.

## Things to decide or know

- **Haptics** (Phase 5.4) needs a new APK; say if you want it.
- **Guide videos are not affected.** The phone guide videos record the web app (React frontend on
  :3100) at phone width, not this Expo app, so nothing here changes them.
- **Hero colour:** plan uses the app's blue. Say if you want a different brand colour for it.
