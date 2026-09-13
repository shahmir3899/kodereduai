# Card System

Shared card-view components for list pages, replacing the ad hoc "mobile card"
`<div>` blocks that ~55 pages previously hand-rolled next to their `<table>`.
Lives in `frontend/src/components/cards/`.

## Why

A repo-wide scan (Sept 2026) found ~150 `<table>` instances across ~92 files,
each with its own independently-written mobile-card fallback (or none at all —
33 pages had no responsive fallback). This component family is the single
replacement for all of them, rolled out incrementally page-by-page.

## Components

- **`RecordCard`** — the card shell. Props: `leading`, `title`, `meta`,
  `status`, `fields` (`[{label, value, mono?}]` — `value` can be any node,
  e.g. a `<Badge>` or `<WhatsAppTick>`, not just text), `actions`
  (`[{label, onClick?, to?, tone?, disabled?}]` — rendered as text links/buttons matching
  the existing table-row action convention, e.g. `tone: 'info'` for Edit,
  `tone: 'danger'` for Delete; `to` renders a router `<Link>` instead of a
  button), `stripeTone` (`'success'|'warning'|'danger'|'neutral'` — left-edge
  accent for event/activity records that skip the leading avatar, e.g. Lesson
  Plans), `highlighted` (selected/active row tint), and `children` for
  freeform content that doesn't fit the fixed slots (a description, chip
  rows) — rendered below `fields`, above `actions`.
- **`CardGrid`** — grid wrapper (1/2/3 columns by breakpoint). Wrap a
  `.map()` of `RecordCard`s in this instead of a bare `<div className="grid ...">`.
- **`StatusPill`** — `{label, tone}`, tone ∈ `success|warning|danger|neutral|info`.
  Also fine to use standalone in a table cell so table and card badges agree.
- **`Avatar`** — initials avatar, deterministic color from name.
- **`ViewToggle`** + **`useViewPreference(pageKey)`** (in `src/hooks/`) — the
  Table/Cards switch. Remembers the choice per page in `localStorage`
  (`viewPref:<pageKey>`), and forces `'cards'` below the `sm` breakpoint
  regardless of the stored value.
- **`LedgerCard`** — amount-led variant for money-shaped records (Student/Child
  Fees, Payroll, Expenses) that don't fit `RecordCard`'s identity-first,
  stacked key/value layout. Pass either `amount` (single figure, tone
  `credit`/`debit`/`neutral`) or `breakdown` (`[{label, value, tone?,
  emphasis?}]`, a mono-column grid — `emphasis` marks the total, e.g. Net Pay)
  — not both. Also takes `title`, `meta`, `status`, `description`, `trend`
  (a `<TrendStrip>` or any node), `footer` (`{label, value}`, e.g. running
  balance), and `actions` (same shape as `RecordCard`).
- **`TrendStrip`** — the small bar-sparkline used inside `LedgerCard` for
  recent history (Student/Child Fees' 6-month paid trend, Payroll's 6-month
  net pay). `points: [{label, value, tone?}]`; each bar is labeled with its
  own value (not just color/height — a bare colored bar wasn't legible enough
  on its own, per review). `currentLabel` outlines the current period's bar.
- **`RouteCard`** — nested-record variant for a parent with a child list
  (Transport Routes → Stops), which `RecordCard`'s flat field grid has no slot
  for. A summary row (`title`, `meta`, `stats: [{label, value}]`) that expands
  to `renderStops()` (deferred so the nested list/map only renders once
  opened). Supports both controlled (`open` + `onToggle`, when the page needs
  to know which one is expanded — e.g. to scope a single stops-fetch query)
  and uncontrolled use.

## Usage

```jsx
// paths relative to the importing page — no '@' alias is configured in this repo
import { RecordCard, CardGrid, StatusPill, Avatar, ViewToggle } from '../../components/cards'
import { useViewPreference } from '../../hooks/useViewPreference'

const [view, setView] = useViewPreference('students')

<ViewToggle view={view} onChange={setView} />

{view === 'table' ? (
  <table>...</table>
) : (
  <CardGrid>
    {students.map((s) => (
      <RecordCard
        key={s.id}
        leading={<Avatar name={s.name} />}
        title={s.name}
        meta={s.className}
        status={<StatusPill label={s.status} tone={s.status === 'Active' ? 'success' : 'danger'} />}
        fields={[
          { label: 'Roll no.', value: s.rollNo, mono: true },
          { label: 'Parent phone', value: s.parentPhone, mono: true },
        ]}
        actions={[
          { label: 'View', to: `/students/${s.id}` },
          { label: 'Edit', tone: 'info', onClick: () => editStudent(s.id) },
          { label: 'Delete', tone: 'danger', onClick: () => deleteStudent(s.id) },
        ]}
      />
    ))}
  </CardGrid>
)}
```

## Migration status

| Stage | Scope | Status |
|---|---|---|
| 0 | Build the component family (this doc) | ✅ Done |
| 1 | Students, Staff Directory, Lesson Plans, Departments | ✅ Done |
| 2 | Shape-A backlog: Vehicles, Book Catalog, Hostel Rooms + Hostels tab, Inventory Items | ✅ Done (this batch) |
| 2b | Remaining shape-A backlog: Transport Assignments, Transport Attendance, Book Issue (2 tabs), Overdue Books, Item Assignments, Stock Transactions | ✅ Done |
| 3 | Shape-B backlog: Leave Requests, Assignments | ✅ Done |
| 3b | Remaining shape-B backlog: Activity Log (SuperAdminDashboard), Admissions Enquiries | ✅ Done |
| 4 | Ledger/nested shapes: Expenses, Transport Routes, Student/Child Fees (+ 6-month trend), Payroll (+ 6-month trend) | ✅ Done |
| 5 | No-fallback batch: Exam Papers, Worksheets, Curriculum Coverage, Face Live Events, Student/Child Library history, Student/Child/Teacher Exam Schedule, Parent Leave Requests | ✅ Done |
| 5b | No-fallback batch: Letter History (HR), Settings → Users | ✅ Done |
| 5c | Remaining pages — mostly excluded by the two new exceptions below; anything left needs case-by-case review | Not started |

## Known exception: dashboard summary widgets

Compact numeric-preview tables embedded inside a dashboard/overview "card"
widget (e.g. `DashboardPage.jsx`'s teacher/class lesson-plan-count grid,
`AccountantDashboard.jsx`'s "Collection by Class") — capped to a handful of
rows, no per-row actions, a "View Details" link elsewhere for the full picture.
These aren't browsable record lists; they're meant for quick at-a-glance
scanning inside limited widget space, where `RecordCard`'s per-item layout
would take more room than the numbers it's showing. Left as plain tables.
Applies to `DashboardPage.jsx`, `AccountantDashboard.jsx`, `ManagerDashboard.jsx`,
`FinanceDashboardPage.jsx`, `FinancialReportsPage.jsx`, `AccuracyDashboardPage.jsx`.

## Known exception: printable/document tables

A table that **is** the document — e.g. `ReportCardPage.jsx`'s marks table,
formatted for print/export with a `tfoot` summary row as part of the
certificate-like layout. This isn't a list of records to browse and act on;
it's one student's report, laid out to be printed. Forcing it into cards would
break the print layout for no benefit. Left as-is.

## Known exception: wizard/preview grids

A table shown as a read-only confirmation step inside a modal or multi-step
wizard (e.g. `SectionAllocator.jsx`'s "Preview" step, `ExamWizard.jsx`'s
date-sheet entry, `BulkTestModal.jsx`, `BulkLessonPlansModal.jsx`) — transient,
shown once per wizard run, not a page users return to browse. Left as-is;
these aren't the "list pages" this system targets.

## Known exception: journal-style ledgers

`AccountsPage.jsx`'s account ledger (every credit/debit across every account,
in posting order) intentionally has **no card view** — confirmed in review.
It's read as a sequence, like a bank statement, not browsed as individual
items; a `LedgerCard` per row would fragment that. Table only, same as
before this system existed.

## Data note: Payroll's 6-month trend

`PayrollPage.jsx`'s trend strip needed net-pay history for every staff member
on the page at once, and the existing `getPayslips` endpoint only ever
fetches one month/year at a time — six sequential calls per page load was the
frontend-only alternative, rejected for being slower than the app should be.
Instead there's a small grouped backend endpoint,
`GET /api/hr/payslips/net_pay_history/` (`hr/views.py`,
`PayslipViewSet.net_pay_history`), returning the last N months' net pay for
every staff member in one query — wired up via `hrApi.getPayslipNetPayHistory`
and only fetched when the page is in card view (`enabled: view === 'cards'`).

## Known exception: pivot/matrix tables

`AttendanceRecordsPage.jsx`'s per-day register (student × day grid, with
running P/A/L totals) doesn't fit `RecordCard` — a card can't show 20+
day-columns at a glance, which is the whole point of that view. It already has
a horizontally-scrollable table plus a supplementary mobile summary-card block
underneath (not a replacement). Left as-is; don't force pivot/matrix-shaped
tables (this one, and likely others like timetables) into the card system.

## Convention going forward

New or touched list pages should use `RecordCard`/`CardGrid` for their mobile
view, not a new ad hoc `<div>` block. A `<table>` paired with a non-`RecordCard`
mobile-card block is a regression back to the pattern this system replaces —
flag it in review.
