# Attendance Section Redesign Plan

## Problems to Solve

1. **Attendance register table not viewable on mobile** — The records page at `/attendance/records` renders a wide table (roll# + name + 28-31 day columns + 2 summary columns) that is unusable on small screens even with horizontal scroll
2. **Settings page is misplaced** — Both tabs (Mark Mappings & Register Layout) are 100% attendance-specific but live as a separate top-level "Settings" nav item
3. **Too many pages in Attendance section** — Currently 4 nav items (Upload, Review, Records, AI Accuracy) + Settings = 5 pages. Needs to be compressed to 2-3 pages for a compact design that can scale

---

## Current Page Inventory

| Page | Route | Purpose |
|------|-------|---------|
| Upload | `/attendance/upload` | Upload register photos |
| Review | `/attendance/review` | Review & confirm AI results |
| Records | `/attendance/records` | Monthly attendance register |
| AI Accuracy | `/accuracy` | AI accuracy metrics |
| Settings | `/settings` | Mark mappings & register layout config |

---

## Part 1: Mobile-Friendly Attendance Register Table

### Option A: Week-View Pagination (Recommended)

Split the month into weekly chunks. On mobile, show **one week at a time** (7 day columns) with swipe/tab navigation between weeks.

```
┌─────────────────────────────────┐
│  ◀  Week 1: Jan 1-7  ▶         │
├──────┬──┬──┬──┬──┬──┬──┬──┐    │
│ Name │M │T │W │T │F │S │S │    │
├──────┼──┼──┼──┼──┼──┼──┼──┤    │
│ Ali  │P │A │P │P │- │- │P │    │
│ Sara │P │P │P │A │- │- │P │    │
└──────┴──┴──┴──┴──┴──┴──┴──┘    │
│  Week 1 │ Week 2 │ Week 3 │...│  (tab bar)
└─────────────────────────────────┘
```

**Pros:** Table fits on screen, still shows grid view, familiar weekly rhythm
**Cons:** Need to switch tabs to see full month

### Option B: Student-First Card View

Replace the table entirely on mobile with a card-per-student design. Each card shows the student name, overall P/A counts, and a mini calendar-style attendance grid.

```
┌─────────────────────────────────┐
│ 1. Ali Ahmed              P:22 A:3 │
│ ┌──┬──┬──┬──┬──┬──┬──┐         │
│ │🟢│🔴│🟢│🟢│⚪│⚪│🟢│  W1     │
│ │🟢│🟢│🟢│🔴│⚪│⚪│🟢│  W2     │
│ │🟢│🟢│🟢│🟢│⚪│⚪│🔴│  W3     │
│ │🟢│🟢│🟢│🟢│⚪│⚪│  │  W4     │
│ └──┴──┴──┴──┴──┴──┴──┘         │
├─────────────────────────────────┤
│ 2. Sara Khan              P:20 A:5 │
│ ...                              │
└─────────────────────────────────┘
```

**Pros:** Extremely mobile-friendly, shows full month at a glance per student, visually rich
**Cons:** Harder to compare across students, loses the traditional register feel

### Option C: Rotated / Transposed Table

Flip rows and columns — days become rows, students become columns. Fewer students than days, so fewer columns. Combine with horizontal scroll for students.

```
┌──────┬──────┬──────┬──────┐
│ Date │ Ali  │ Sara │ Omar │  → scroll for more students
├──────┼──────┼──────┼──────┤
│ Jan 1│  P   │  P   │  A   │
│ Jan 2│  A   │  P   │  P   │
│ ...  │      │      │      │
└──────┴──────┴──────┴──────┘
```

**Pros:** Date column stays fixed, vertical scroll is natural on mobile
**Cons:** Unconventional for school registers, many rows (28-31)

### Recommendation: **Option A (Week-View) + Option B (Card View toggle)**

Give users a toggle between "Grid" (week-paginated table) and "Cards" (student cards with mini calendar). Default to Cards on mobile, Grid on desktop.

---

## Part 2: Move Settings into Attendance Section

The Settings page has two tabs, both purely attendance-related:
- **Mark Mappings** — Symbol-to-status mapping for OCR
- **Register Layout** — Row/column configuration for register parsing

### Plan

1. **Remove** the standalone `/settings` route and nav item
2. **Embed** settings as a tab/section within the consolidated Attendance page (see Part 3)
3. Keep the same UI components — just relocate them into the Attendance section

---

## Part 3: Compress Attendance to 2-3 Pages

### Current: 5 Separate Pages

```
Attendance
  ├── Upload          (photo upload + crop/rotate)
  ├── Review          (AI results + manual corrections)
  ├── Records         (monthly register view)
  ├── AI Accuracy     (accuracy metrics + suggestions)
  └── Settings*       (mark mappings + register layout)
```

### Proposed: 2 Pages with Tabs

```
Attendance
  ├── Capture & Review    (combined upload + review workflow)
  └── Register            (records + analytics + config)
```

---

#### Page 1: "Capture & Review" (`/attendance`)

Combines Upload + Review into a **single workflow page** with steps/tabs:

```
┌─────────────────────────────────────────┐
│  Capture & Review                       │
│                                         │
│  [Upload]  [Pending Review]  [History]  │
│  ─────────────────────────────────────  │
│                                         │
│  Upload Tab:                            │
│    Same upload UI (drop zone, camera,   │
│    crop/rotate, multi-page)             │
│                                         │
│  Pending Review Tab:                    │
│    List of unconfirmed uploads          │
│    Click to expand inline review        │
│    (AI results, P/A toggles, confirm)   │
│                                         │
│  History Tab:                           │
│    Past confirmed uploads with status   │
│    Quick stats (date, class, accuracy)  │
└─────────────────────────────────────────┘
```

**Key changes:**
- Upload and Review are steps in one workflow, not separate pages
- The review detail view opens **inline** (expandable card or slide-over panel) instead of navigating away
- History replaces the old review list view
- Route: `/attendance` (default tab: Pending Review if items exist, else Upload)

#### Page 2: "Register & Analytics" (`/attendance/register`)

Combines Records + AI Accuracy + Settings into a **single dashboard page** with tabs:

```
┌──────────────────────────────────────────────┐
│  Register & Analytics                        │
│                                              │
│  [Register]  [Analytics]  [Configuration]    │
│  ──────────────────────────────────────────  │
│                                              │
│  Register Tab:                               │
│    Class selector + month nav                │
│    Summary cards (students, days, P, A)      │
│    Attendance table (with mobile fixes)      │
│    Grid/Card toggle for mobile               │
│                                              │
│  Analytics Tab:                              │
│    AI Accuracy metrics                       │
│    Weekly trends                             │
│    Common errors + suggestions               │
│    Quick link to Configuration tab           │
│                                              │
│  Configuration Tab:                          │
│    Mark Mappings (existing settings tab 1)   │
│    Register Layout (existing settings tab 2) │
└──────────────────────────────────────────────┘
```

**Key changes:**
- Records, AI Accuracy, and Settings merged into one page with tabs
- Configuration (old Settings) is naturally discoverable alongside Analytics
- All "view & analyze" attendance data lives in one place
- Route: `/attendance/register` (default tab: Register)

---

## Part 4: Updated Navigation

### Before
```
Sidebar:
  Dashboard
  ▼ Attendance
      Upload
      Review
      Records
      AI Accuracy
  ▼ Finance
      ...
  Settings          ← separate top-level item
```

### After
```
Sidebar:
  Dashboard
  ▼ Attendance
      Capture & Review     → /attendance
      Register & Analytics → /attendance/register
  ▼ Finance
      ...
```

**Benefits:**
- Attendance section goes from 4+1 items → 2 items
- Settings disappears as standalone (moves into Configuration tab)
- Cleaner sidebar, room for future sections
- Fewer clicks to navigate

---

## Part 5: Updated Routes

| Old Route | New Route | Notes |
|-----------|-----------|-------|
| `/attendance/upload` | `/attendance` (Upload tab) | Combined page |
| `/attendance/review` | `/attendance` (Pending Review tab) | Combined page |
| `/attendance/review/:id` | `/attendance?review=:id` | Query param opens review panel |
| `/attendance/records` | `/attendance/register` | Register tab |
| `/accuracy` | `/attendance/register` (Analytics tab) | Merged in |
| `/settings` | `/attendance/register` (Configuration tab) | Merged in |

---

## Implementation Steps

### Phase 1: Mobile-Friendly Register Table
1. Create `WeekTabs` component for week-based pagination
2. Create `StudentCard` component with mini calendar grid (color-coded dots)
3. Add Grid/Card toggle to `AttendanceRecordsPage`
4. Default to Card view on mobile (`< md` breakpoint), Grid on desktop
5. In Grid mode on mobile, show week-paginated table instead of full month

### Phase 2: Consolidate "Register & Analytics" Page
1. Create new `RegisterPage.jsx` with 3 tabs: Register, Analytics, Configuration
2. Move `AttendanceRecordsPage` content → Register tab
3. Move `AccuracyDashboardPage` content → Analytics tab
4. Move `SettingsPage` content → Configuration tab
5. Wire up new route `/attendance/register`
6. Remove old routes: `/attendance/records`, `/accuracy`, `/settings`

### Phase 3: Consolidate "Capture & Review" Page
1. Create new `CaptureReviewPage.jsx` with 3 tabs: Upload, Pending Review, History
2. Move `AttendanceUploadPage` content → Upload tab
3. Refactor `AttendanceReviewPage` list → Pending Review tab
4. Refactor `AttendanceReviewPage` detail → Inline expandable panel
5. Wire up new route `/attendance`
6. Remove old routes: `/attendance/upload`, `/attendance/review`

### Phase 4: Update Navigation & Cleanup
1. Update `Layout.jsx` sidebar with 2 nav items
2. Add redirects from old routes → new routes (for bookmarks/links)
3. Remove old page files or keep as sub-components
4. Test all flows end-to-end on mobile and desktop

---

## Design Principles for Future Expansion

- **Tab-based pages** — New features get added as tabs, not new pages
- **Inline detail views** — Use slide-over panels or expandable sections instead of separate pages
- **Mobile-first** — Card views and paginated tables as default patterns
- **Compact sidebar** — Each major section gets 2-3 nav items max
- **Consistent layout** — Every page follows: Header → Filters → Summary Cards → Main Content pattern
