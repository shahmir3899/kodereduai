import { Link } from 'react-router-dom'

const MAX_CHIPS = 6

const TONE = {
  red: 'bg-red-50 border-red-200 text-red-800 hover:bg-red-100',
  amber: 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100',
  blue: 'bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100',
}
const DOT = { red: 'bg-red-500', amber: 'bg-amber-500', blue: 'bg-sky-500' }
const TONE_RANK = { red: 0, amber: 1, blue: 2 }

/**
 * Turns the dashboard's already-fetched numbers into chips. Kept pure so the
 * zero-hiding / off-day / module rules are testable without mounting the page.
 * Every field is optional: a failed or role-withheld query simply yields no chip
 * instead of a misleading "0".
 */
export function buildAttentionItems({
  isModuleEnabled = () => true,
  isOffDay = false,
  notMarkedStudents,
  unpaidFees,
  partialFees,
  feesAllSchools = false,
  pendingLeave,
  pendingPayroll,
  staffUnmarked,
  newEnquiries,
  overdueBooks,
  lowStock,
  aiAlerts,
}) {
  const items = []
  const add = (key, count, label, href, tone) => {
    if (Number(count) > 0) items.push({ key, count: Number(count), label, href, tone })
  }

  if (isModuleEnabled('attendance') && !isOffDay) {
    add('att', notMarkedStudents, 'students not marked today', '/attendance/register', 'red')
  }
  if (isModuleEnabled('finance')) {
    // The link is scoped to the active school, so say so when the count spans several.
    const scope = feesAllSchools ? ' (all schools)' : ''
    add('unpaid', unpaidFees, `monthly fees unpaid this month${scope}`, '/finance/fees', 'red')
    add('partial', partialFees, `monthly fees partially paid${scope}`, '/finance/fees', 'amber')
  }
  if (isModuleEnabled('hr')) {
    add('leave', pendingLeave, 'leave requests pending', '/hr/leave', 'amber')
    add('payroll', pendingPayroll, 'payslips awaiting approval', '/hr/payroll', 'amber')
    if (!isOffDay) add('staffatt', staffUnmarked, 'staff attendance unmarked', '/hr/attendance', 'amber')
  }
  if (isModuleEnabled('admissions')) {
    add('enq', newEnquiries, 'new enquiries', '/admissions', 'blue')
  }
  if (isModuleEnabled('library')) {
    add('lib', overdueBooks, 'overdue library books', '/library/overdue', 'amber')
  }
  if (isModuleEnabled('inventory')) {
    add('stock', lowStock, 'items low on stock', '/inventory', 'red')
  }
  add('ai', aiAlerts, 'AI alerts', '#ai-insights', 'red')

  // Array.prototype.sort is stable, so equal tones keep the insertion order above.
  return items.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])
}

/**
 * @param {object} props
 * @param {Array<{key:string,count:number,label:string,href:string,tone:'red'|'amber'|'blue'}>} props.items
 * @param {boolean} [props.loading] - true while the numbers are still arriving; avoids flashing "All clear".
 */
export default function AttentionStrip({ items, loading }) {
  if (loading) {
    return <div className="mb-6 h-12 rounded-xl bg-gray-50 border border-gray-100 animate-pulse" />
  }

  if (!items?.length) {
    return (
      <div className="mb-6 flex items-center gap-2 px-4 py-3 rounded-xl bg-green-50 border border-green-200 text-sm text-green-800">
        <span className="w-2 h-2 rounded-full bg-green-500" />
        All clear for today — nothing needs your attention.
      </div>
    )
  }

  const shown = items.slice(0, MAX_CHIPS)
  const hidden = items.length - shown.length

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-gray-900 mb-2">Needs your attention</h2>
      <div className="flex flex-wrap gap-2">
        {shown.map(({ key, count, label, href, tone }) => {
          const className = `inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${TONE[tone] || TONE.blue}`
          const body = (
            <>
              <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[tone] || DOT.blue}`} />
              <span className="font-bold tabular-nums">{count}</span>
              <span>{label}</span>
            </>
          )
          // Hash targets are in-page anchors, not routes.
          return href.startsWith('#')
            ? <a key={key} href={href} className={className}>{body}</a>
            : <Link key={key} to={href} className={className}>{body}</Link>
        })}
        {hidden > 0 && (
          <span className="inline-flex items-center px-3 py-2 text-xs text-gray-500">+{hidden} more</span>
        )}
      </div>
    </div>
  )
}
