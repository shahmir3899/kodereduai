import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { RecordCard, CardGrid } from '../cards'
import EmptyState from './EmptyState'
import { Skeleton } from './Skeleton'
import Pagination from '../Pagination'
import { THEAD, TBODY, th, td } from './tableStyles'

/**
 * One list-page table: the same header/cell/row styling everywhere, a skeleton
 * while loading, an EmptyState when there are no rows, and — below the md
 * breakpoint — the shared RecordCard grid instead of a sideways-scrolling table.
 * Pages used to hand-write both the <table> and a separate mobile-card block
 * (or nothing, leaving phones with horizontal scroll).
 *
 * columns: [{
 *   key, header,
 *   align: 'left' | 'right' | 'center',
 *   render: (row, index) => node        // defaults to row[key]
 *   mobile: 'title' | 'meta' | 'status' | 'hide'   // how the column maps onto a card;
 *                                                  // omitted = a labelled field; first column is the title by default
 *   cellClassName: extra classes for the <td>
 * }]
 * view: 'table' | 'cards' — pair with <ViewToggle/> + useViewPreference when the page offers the toggle.
 *   Omit for automatic: table from md up, cards below.
 * renderCard: (row, index) => node — use a richer card (e.g. LedgerCard) instead of the generic RecordCard.
 * actions: (row) => [{ label, onClick?, to?, tone?, disabled? }]  // a trailing "Actions" column + card footer
 * pagination: { page, totalPages, totalCount, onPageChange, itemLabel? }
 *
 * Matrix-style grids (timetable, marks entry, attendance register) are not list
 * tables — keep them as raw <table> and use the classes from ./tableStyles.
 */
const ACTION_TONE = {
  primary: 'text-primary-600 hover:text-primary-800',
  info: 'text-primary-600 hover:text-primary-800',
  danger: 'text-red-600 hover:text-red-800',
  success: 'text-green-600 hover:text-green-800',
  muted: 'text-gray-600 hover:text-gray-800',
}

function Action({ action }) {
  const cls = `text-sm font-medium ${ACTION_TONE[action.tone] || ACTION_TONE.primary} ${action.disabled ? 'opacity-50 pointer-events-none' : ''}`
  if (action.to) {
    return <Link to={action.to} className={cls} onClick={(e) => e.stopPropagation()}>{action.label}</Link>
  }
  return (
    <button
      type="button"
      disabled={action.disabled}
      className={cls}
      onClick={(e) => {
        e.stopPropagation()
        action.onClick?.(e)
      }}
    >
      {action.label}
    </button>
  )
}

export default function DataTable({
  columns,
  rows = [],
  rowKey = 'id',
  loading = false,
  emptyTitle = 'No records found',
  emptyDescription,
  emptyAction,
  onRowClick,
  actions,
  pagination,
  stickyHeader = false,
  view,
  renderCard,
  className = '',
}) {
  const getKey = (row, i) => (typeof rowKey === 'function' ? rowKey(row, i) : row[rowKey] ?? i)
  const cell = (col, row, i) => (col.render ? col.render(row, i) : row[col.key])
  const colCount = columns.length + (actions ? 1 : 0)

  // Card mapping for < md screens.
  const titleCol =
    columns.find((c) => c.mobile === 'title') ||
    columns.find((c) => c.mobile !== 'hide' && c.mobile !== 'status' && c.mobile !== 'meta')
  const metaCol = columns.find((c) => c.mobile === 'meta')
  const statusCol = columns.find((c) => c.mobile === 'status')
  const fieldCols = columns.filter((c) => c !== titleCol && c !== metaCol && c !== statusCol && c.mobile !== 'hide')

  const empty = !loading && rows.length === 0

  return (
    <div className={className}>
      {/* Desktop / tablet table */}
      <div className={`${view === 'table' ? '' : view === 'cards' ? 'hidden' : 'hidden md:block'} bg-white rounded-xl border border-gray-200 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100">
            <thead className={`${THEAD} ${stickyHeader ? 'sticky top-0 z-10' : ''}`}>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={th(c.align)}>{c.header}</th>
                ))}
                {actions && <th className={th('right')}>Actions</th>}
              </tr>
            </thead>
            <tbody className={TBODY}>
              {loading &&
                Array.from({ length: 5 }).map((_, r) => (
                  <tr key={`sk-${r}`}>
                    {Array.from({ length: colCount }).map((__, c) => (
                      <td key={c} className="px-4 py-3">
                        <Skeleton className="h-4 w-full max-w-[10rem]" />
                      </td>
                    ))}
                  </tr>
                ))}
              {rows.map((row, i) => (
                <tr
                  key={getKey(row, i)}
                  className={`hover:bg-gray-50 ${onRowClick ? 'cursor-pointer' : ''}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={td(c.align, c.cellClassName)}>{cell(c, row, i) ?? '—'}</td>
                  ))}
                  {actions && (
                    <td className="px-4 py-3 text-sm text-right whitespace-nowrap">
                      <div className="flex justify-end gap-3">
                        {actions(row).map((a, k) => (
                          <Action key={k} action={a} />
                        ))}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {empty && <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />}
      </div>

      {/* Phones: shared card grid */}
      <div className={view === 'cards' ? '' : view === 'table' ? 'hidden' : 'md:hidden'}>
        {loading && (
          <CardGrid>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </CardGrid>
        )}
        {empty && <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />}
        {!loading && rows.length > 0 && (
          <CardGrid>
            {rows.map((row, i) => renderCard ? <Fragment key={getKey(row, i)}>{renderCard(row, i)}</Fragment> : (
              <RecordCard
                key={getKey(row, i)}
                title={titleCol ? cell(titleCol, row, i) : null}
                meta={metaCol ? cell(metaCol, row, i) : null}
                status={statusCol ? cell(statusCol, row, i) : null}
                fields={fieldCols.map((c) => ({ label: c.header, value: cell(c, row, i) }))}
                actions={actions ? actions(row) : []}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              />
            ))}
          </CardGrid>
        )}
      </div>

      {pagination && <Pagination {...pagination} />}
    </div>
  )
}
