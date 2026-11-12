import { useState } from 'react'
import { TONE } from '../ui/statusTones'
import KuickpayReceived from '../KuickpayReceived'
import { LedgerCard, ViewToggle, TrendStrip } from '../cards'
import DataTable from '../ui/DataTable'
import Badge from '../ui/Badge'
import { useViewPreference } from '../../hooks/useViewPreference'
import { feeLabel, feeTotals, groupByBranch, sortFeeRows, num } from '../../utils/portalFees'

const STATUS_COLORS = {
  PAID: TONE.success,
  PARTIAL: TONE.warning,
  UNPAID: TONE.danger,
  PENDING: TONE.danger,
  ADVANCE: TONE.info,
  OVERDUE: TONE.danger,
}

// TrendStrip tone per fee status — same success/warning/danger vocabulary as the status pill.
const TREND_TONE = {
  PAID: 'success',
  ADVANCE: 'success',
  PARTIAL: 'warning',
  UNPAID: 'danger',
  PENDING: 'danger',
  OVERDUE: 'danger',
}

const money = (v) => `PKR ${Number(v).toLocaleString()}`

// Full class names (not built from `tone`) so Tailwind keeps them.
const ACTIVE_TAB = { blue: 'bg-white text-blue-700 shadow-sm', indigo: 'bg-white text-indigo-700 shadow-sm' }

function Tabs({ items, value, onChange, tone = 'blue' }) {
  return (
    <div role="tablist" className="inline-flex flex-wrap rounded-lg border border-gray-200 bg-gray-50 p-1 gap-1">
      {items.map(({ key, label, count }) => (
        <button
          key={String(key)}
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            value === key ? ACTIVE_TAB[tone] : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {label}{count != null && <span className="text-xs text-gray-400"> ({count})</span>}
        </button>
      ))}
    </div>
  )
}

function SummaryCard({ label, value, valueClass = 'text-gray-900', iconClass, d }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconClass}`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
          </svg>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
          <p className={`text-xl font-bold mt-0.5 ${valueClass}`}>{value}</p>
        </div>
      </div>
    </div>
  )
}

/**
 * Fee history for the student and parent portals. `rows` is the whole fee_rows list; the current
 * branch is limited to the active academic year, and each earlier branch gets its own tab
 * (read-only). Inside a branch: Monthly and Yearly tabs.
 */
export default function FeeLedger({ rows, activeYear, viewKey }) {
  const [view, setView] = useViewPreference(viewKey)
  const [branchKey, setBranchKey] = useState(null)
  const [tab, setTab] = useState('MONTHLY')

  const groups = groupByBranch(rows, activeYear?.id)
  const group = groups.find((g) => g.key === branchKey) || groups[0]
  const isEarlier = group.key !== null
  const counts = { MONTHLY: 0, ANNUAL: 0 }
  group.rows.forEach((p) => { if (p.fee_type in counts) counts[p.fee_type] += 1 })

  const payments = sortFeeRows(group.rows.filter((p) => p.fee_type === tab), tab)
  const { charged, paid, balance } = feeTotals(payments, tab)
  const scope = isEarlier ? `at ${group.name}` : `for ${activeYear?.name || 'this academic year'}`

  // Last 6 months' paid amounts, shown on every card: one month's figures say little alone.
  const trendPoints = tab === 'MONTHLY'
    ? payments.slice(-6).map((p) => ({
        label: feeLabel(p).slice(0, 3),
        value: num(p.amount_paid),
        tone: TREND_TONE[p.status] || 'neutral',
      }))
    : []

  const yearCell = (p) => p.academic_year_name || p.year || '-'
  const statusBadge = (p) => (
    <span className="inline-flex items-center gap-1">
      <Badge colors={STATUS_COLORS[p.status]}>{p.status}</Badge>
      {p.handed_over && <Badge colors={TONE.info}>Handed over</Badge>}
    </span>
  )

  return (
    <div className="space-y-6">
      {groups.length > 1 && (
        <div className="space-y-1">
          <Tabs
            tone="indigo"
            value={group.key}
            onChange={(k) => { setBranchKey(k); setTab('MONTHLY') }}
            items={groups.map((g) => ({ key: g.key, label: g.key === null ? 'Current branch' : `Earlier · ${g.name}` }))}
          />
          {isEarlier && (
            <p className="text-xs text-gray-500">
              Read-only history from {group.name}. A balance handed over to the current branch is owed there, so it is not counted here.
            </p>
          )}
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: 'MONTHLY', label: 'Monthly', count: counts.MONTHLY },
          { key: 'ANNUAL', label: 'Yearly', count: counts.ANNUAL },
        ]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          label={tab === 'MONTHLY' ? 'Fees Charged' : 'Total Due'}
          value={money(charged)}
          iconClass="bg-blue-100 text-blue-600"
          d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
        />
        <SummaryCard
          label="Total Paid"
          value={money(paid)}
          valueClass="text-green-700"
          iconClass="bg-green-100 text-green-600"
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
        <SummaryCard
          label="Outstanding"
          value={money(Math.abs(balance))}
          valueClass={balance > 0 ? 'text-red-700' : 'text-green-700'}
          iconClass={balance > 0 ? TONE.danger : TONE.success}
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </div>

      {payments.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <h3 className="text-base font-medium text-gray-900 mb-1">
            No {tab === 'MONTHLY' ? 'monthly' : 'yearly'} fees {scope}
          </h3>
          <p className="text-sm text-gray-500">Fee records will appear here once generated.</p>
        </div>
      ) : (
        <>
          <div className="flex justify-end mb-3">
            <ViewToggle view={view} onChange={setView} />
          </div>
          <DataTable
            view={view}
            rows={payments}
            rowKey={(p, i) => p.id || i}
            columns={[
              { key: 'month', header: tab === 'MONTHLY' ? 'Month' : 'Fee', mobile: 'title', cellClassName: 'font-medium', render: (p) => feeLabel(p) },
              { key: 'year', header: isEarlier ? 'Academic year' : 'Year', cellClassName: 'text-gray-600', render: (p) => (isEarlier ? yearCell(p) : p.year || yearCell(p)) },
              { key: 'due', header: 'Amount Due', align: 'right', render: (p) => money(num(p.amount_due)) },
              { key: 'paid', header: 'Amount Paid', align: 'right', cellClassName: 'text-green-700 font-medium', render: (p) => (<div>{money(num(p.amount_paid))}<KuickpayReceived kuickpay={p.kuickpay} className="justify-end" /></div>) },
              { key: 'status', header: 'Status', mobile: 'status', render: statusBadge },
              { key: 'date', header: 'Payment Date', cellClassName: 'text-gray-500', render: (p) => (p.payment_date ? new Date(p.payment_date).toLocaleDateString() : '-') },
              { key: 'method', header: 'Method', cellClassName: 'text-gray-500', render: (p) => p.payment_method || '-' },
            ]}
            renderCard={(payment) => (
              <LedgerCard
                title={feeLabel(payment)}
                meta={payment.payment_date ? `Paid ${new Date(payment.payment_date).toLocaleDateString()}${payment.payment_method ? ` via ${payment.payment_method}` : ''}` : undefined}
                status={statusBadge(payment)}
                description={<KuickpayReceived kuickpay={payment.kuickpay} />}
                breakdown={[
                  { label: 'Due', value: num(payment.amount_due) },
                  { label: 'Paid', value: num(payment.amount_paid), emphasis: true },
                ]}
                trend={tab === 'MONTHLY' ? <TrendStrip points={trendPoints} currentLabel={feeLabel(payment).slice(0, 3)} formatValue={(v) => `${(v / 1000).toFixed(0)}k`} /> : undefined}
              />
            )}
          />
        </>
      )}
    </div>
  )
}
