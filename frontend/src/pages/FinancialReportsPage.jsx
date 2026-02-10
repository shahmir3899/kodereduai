import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { financeApi } from '../services/api'

const PERIODS = [
  { label: 'This Month', getValue: () => { const d = new Date(); return { date_from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, date_to: d.toISOString().split('T')[0] } } },
  { label: 'Last Month', getValue: () => { const d = new Date(); d.setMonth(d.getMonth() - 1); const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]; return { date_from: start, date_to: end } } },
  { label: 'This Quarter', getValue: () => { const d = new Date(); const q = Math.floor(d.getMonth() / 3); return { date_from: `${d.getFullYear()}-${String(q * 3 + 1).padStart(2, '0')}-01`, date_to: d.toISOString().split('T')[0] } } },
  { label: 'This Year', getValue: () => { const d = new Date(); return { date_from: `${d.getFullYear()}-01-01`, date_to: d.toISOString().split('T')[0] } } },
]

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function FinancialReportsPage() {
  const { user } = useAuth()
  const [periodIdx, setPeriodIdx] = useState(0)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [useCustom, setUseCustom] = useState(false)

  const period = useCustom
    ? { date_from: customFrom, date_to: customTo }
    : PERIODS[periodIdx].getValue()

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['financeSummary', period.date_from, period.date_to],
    queryFn: () => financeApi.getFinanceSummary(period),
    enabled: !!(period.date_from && period.date_to),
  })

  const { data: trend } = useQuery({
    queryKey: ['monthlyTrend'],
    queryFn: () => financeApi.getMonthlyTrend({ months: 6 }),
  })

  const { data: categorySummary } = useQuery({
    queryKey: ['expenseCategoryReport', period.date_from, period.date_to],
    queryFn: () => financeApi.getExpenseCategorySummary({
      date_from: period.date_from,
      date_to: period.date_to,
    }),
    enabled: !!(period.date_from && period.date_to),
  })

  const summaryData = summary?.data
  const trendData = trend?.data?.trend || []
  const categories = categorySummary?.data?.categories || []
  const catTotal = categorySummary?.data?.total || 0

  // Find max value for trend chart scaling
  const maxTrendValue = Math.max(
    ...trendData.map(t => Math.max(Number(t.income || 0), Number(t.expenses || 0))),
    1
  )

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Financial Reports</h1>
        <p className="text-sm text-gray-600">Overview of school financial health</p>
      </div>

      {/* Period Selector */}
      <div className="card mb-6">
        <div className="flex flex-wrap gap-2 mb-4">
          {PERIODS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => { setPeriodIdx(i); setUseCustom(false) }}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                !useCustom && periodIdx === i
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setUseCustom(true)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              useCustom
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Custom
          </button>
        </div>
        {useCustom && (
          <div className="flex gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="input-field text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="input-field text-sm" />
            </div>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      {summaryData && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="card">
            <p className="text-sm text-gray-500">Total Income</p>
            <p className="text-2xl font-bold text-green-700">{Number(summaryData.total_income || 0).toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-1">Fee collections</p>
          </div>
          <div className="card">
            <p className="text-sm text-gray-500">Total Expenses</p>
            <p className="text-2xl font-bold text-red-700">{Number(summaryData.total_expenses || 0).toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-1">All categories</p>
          </div>
          <div className="card">
            <p className="text-sm text-gray-500">Net Balance</p>
            <p className={`text-2xl font-bold ${Number(summaryData.balance) >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
              {Number(summaryData.balance || 0).toLocaleString()}
            </p>
            <p className="text-xs text-gray-400 mt-1">Income - Expenses</p>
          </div>
        </div>
      )}

      {/* Monthly Trend */}
      {trendData.length > 0 && (
        <div className="card mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Monthly Trend (Last 6 Months)</h2>

          {/* Legend */}
          <div className="flex gap-4 mb-4 text-sm">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-green-500 rounded" />
              <span className="text-gray-600">Income</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-red-400 rounded" />
              <span className="text-gray-600">Expenses</span>
            </div>
          </div>

          {/* Bar chart */}
          <div className="space-y-3">
            {trendData.map((item) => {
              const incomePct = (Number(item.income) / maxTrendValue) * 100
              const expensePct = (Number(item.expenses) / maxTrendValue) * 100
              return (
                <div key={`${item.year}-${item.month}`}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-700 font-medium w-16">{MONTH_NAMES[item.month - 1]} {item.year}</span>
                    <span className="text-xs text-gray-500">
                      Balance: <span className={Number(item.balance) >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {Number(item.balance).toLocaleString()}
                      </span>
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div className="bg-green-500 h-full rounded-full transition-all" style={{ width: `${incomePct}%` }} />
                      </div>
                      <span className="text-xs text-gray-600 w-20 text-right">{Number(item.income).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div className="bg-red-400 h-full rounded-full transition-all" style={{ width: `${expensePct}%` }} />
                      </div>
                      <span className="text-xs text-gray-600 w-20 text-right">{Number(item.expenses).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Expense Breakdown */}
      {categories.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Expense Breakdown</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">% of Total</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Entries</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {categories.map((cat) => (
                  <tr key={cat.category}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{cat.category_display}</td>
                    <td className="px-4 py-3 text-sm text-gray-900 text-right">{Number(cat.total_amount).toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 text-right">
                      {catTotal > 0 ? Math.round(cat.total_amount / catTotal * 100) : 0}%
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 text-center">{cat.count}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50">
                  <td className="px-4 py-3 text-sm font-bold text-gray-900">Total</td>
                  <td className="px-4 py-3 text-sm font-bold text-gray-900 text-right">{Number(catTotal).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm font-bold text-gray-500 text-right">100%</td>
                  <td className="px-4 py-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {summaryLoading && (
        <div className="text-center py-12 text-gray-500">Loading reports...</div>
      )}
    </div>
  )
}
