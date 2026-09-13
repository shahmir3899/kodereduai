import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { studentPortalApi } from '../../services/api'
import Spinner from '../../components/ui/Spinner'
import { LedgerCard, CardGrid, ViewToggle, TrendStrip } from '../../components/cards'
import { useViewPreference } from '../../hooks/useViewPreference'

const STATUS_COLORS = {
  PAID: 'bg-green-100 text-green-800',
  PARTIAL: 'bg-yellow-100 text-yellow-800',
  UNPAID: 'bg-red-100 text-red-800',
  PENDING: 'bg-red-100 text-red-800',
  ADVANCE: 'bg-blue-100 text-blue-800',
  OVERDUE: 'bg-red-100 text-red-800',
}

// TrendStrip tone per fee status — same success/warning/danger vocabulary as
// the status pill above, just mapped to the strip's more limited palette.
const TREND_TONE = {
  PAID: 'success',
  ADVANCE: 'success',
  PARTIAL: 'warning',
  UNPAID: 'danger',
  PENDING: 'danger',
  OVERDUE: 'danger',
}

export default function StudentFees() {
  const currentYear = new Date().getFullYear()
  const [filterYear, setFilterYear] = useState(currentYear)
  const [view, setView] = useViewPreference('student-fees')

  const { data: feesData, isLoading, error } = useQuery({
    queryKey: ['studentFees', filterYear],
    queryFn: () => studentPortalApi.getFees({ year: filterYear }),
  })

  const fees = feesData?.data
  const payments = fees?.payments || fees?.records || (Array.isArray(fees) ? fees : [])
  const summary = fees?.summary || {}

  // Last 6 months' paid amounts, shown on every card — a single month's
  // due/paid figures don't say much without the recent pattern next to it.
  const trendPoints = payments
    .slice()
    .sort((a, b) => (a.year - b.year) || (a.month - b.month))
    .slice(-6)
    .map((p) => ({
      label: (p.month_name || '').slice(0, 3) || `M${p.month}`,
      value: parseFloat(p.amount_paid || 0),
      tone: TREND_TONE[p.status] || 'neutral',
    }))

  const totalDue = summary.total_due ?? payments.reduce((sum, p) => sum + parseFloat(p.amount_due || 0), 0)
  const totalPaid = summary.total_paid ?? payments.reduce((sum, p) => sum + parseFloat(p.amount_paid || 0), 0)
  const outstanding = summary.outstanding ?? (totalDue - totalPaid)

  // Year options
  const yearOptions = []
  for (let y = currentYear; y >= currentYear - 3; y--) {
    yearOptions.push(y)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="md" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <h3 className="text-base font-medium text-red-900 mb-1">Failed to load fee details</h3>
        <p className="text-sm text-red-600">{error.message || 'Please try again later.'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">My Fees</h1>
          <p className="text-sm text-gray-500 mt-1">Payment history and outstanding balance</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={filterYear}
            onChange={(e) => setFilterYear(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Total Due</p>
              <p className="text-xl font-bold text-gray-900 mt-0.5">PKR {Number(totalDue).toLocaleString()}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-100 text-green-600 flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Total Paid</p>
              <p className="text-xl font-bold text-green-700 mt-0.5">PKR {Number(totalPaid).toLocaleString()}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${outstanding > 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Outstanding</p>
              <p className={`text-xl font-bold mt-0.5 ${outstanding > 0 ? 'text-red-700' : 'text-green-700'}`}>
                PKR {Number(Math.abs(outstanding)).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Fee Table */}
      {payments.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <h3 className="text-base font-medium text-gray-900 mb-1">No fee records found</h3>
          <p className="text-sm text-gray-500">Fee records for {filterYear} will appear here once generated.</p>
        </div>
      ) : (
        <>
          <div className="flex justify-end mb-3">
            <ViewToggle view={view} onChange={setView} />
          </div>

          {view === 'cards' ? (
          <CardGrid>
            {payments.map((payment, idx) => (
              <LedgerCard
                key={payment.id || idx}
                title={payment.month_name || payment.fee_type_name || `${payment.month}/${payment.year}`}
                meta={payment.payment_date ? `Paid ${new Date(payment.payment_date).toLocaleDateString()}${payment.payment_method ? ` via ${payment.payment_method}` : ''}` : undefined}
                status={<span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${STATUS_COLORS[payment.status] || 'bg-gray-100 text-gray-800'}`}>{payment.status}</span>}
                breakdown={[
                  { label: 'Due', value: parseFloat(payment.amount_due || 0) },
                  { label: 'Paid', value: parseFloat(payment.amount_paid || 0), emphasis: true },
                ]}
                trend={<TrendStrip points={trendPoints} currentLabel={(payment.month_name || '').slice(0, 3)} formatValue={(v) => `${(v / 1000).toFixed(0)}k`} />}
              />
            ))}
          </CardGrid>
          ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Month</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Year</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount Due</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount Paid</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payment Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {payments.map((payment, idx) => (
                    <tr key={payment.id || idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {payment.month_name || payment.fee_type_name || payment.month || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {payment.year || filterYear}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right">
                        PKR {parseFloat(payment.amount_due || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-green-700 text-right font-medium">
                        PKR {parseFloat(payment.amount_paid || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[payment.status] || 'bg-gray-100 text-gray-800'}`}>
                          {payment.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {payment.payment_date
                          ? new Date(payment.payment_date).toLocaleDateString()
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {payment.payment_method || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </>
      )}
    </div>
  )
}
