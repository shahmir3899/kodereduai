import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { financeApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import TransferModal from '../components/TransferModal'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { exportFinanceReport } from './finance/financeReportExport'

const typeColors = {
  CASH: 'bg-green-100 text-green-800',
  BANK: 'bg-blue-100 text-blue-800',
  PERSON: 'bg-purple-100 text-purple-800',
}

const EXPENSE_COLORS = ['#dc2626', '#ea580c', '#f59e0b', '#8b5cf6', '#06b6d4', '#6b7280']

const PERIODS = [
  { label: 'This Month', getValue: () => { const d = new Date(); return { date_from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, date_to: d.toISOString().split('T')[0] } } },
  { label: 'Last Month', getValue: () => { const d = new Date(); d.setMonth(d.getMonth() - 1); const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]; return { date_from: start, date_to: end } } },
  { label: 'This Quarter', getValue: () => { const d = new Date(); const q = Math.floor(d.getMonth() / 3); return { date_from: `${d.getFullYear()}-${String(q * 3 + 1).padStart(2, '0')}-01`, date_to: d.toISOString().split('T')[0] } } },
  { label: 'This Year', getValue: () => { const d = new Date(); return { date_from: `${d.getFullYear()}-01-01`, date_to: d.toISOString().split('T')[0] } } },
]

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function FinanceDashboardPage() {
  const { user, isStaffMember, isPrincipal } = useAuth()
  const canWrite = !isStaffMember
  const hasMultipleSchools = !isStaffMember && (user?.schools?.length > 1 || user?.is_super_admin)
  const isAdmin = !isPrincipal && !isStaffMember

  const [showTransferModal, setShowTransferModal] = useState(false)
  const [periodIdx, setPeriodIdx] = useState(0)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [useCustom, setUseCustom] = useState(false)

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  const period = useCustom
    ? { date_from: customFrom, date_to: customTo }
    : PERIODS[periodIdx].getValue()

  // --- Queries ---

  // Account balances (single school)
  const { data: balancesData, isLoading: balancesLoading } = useQuery({
    queryKey: ['accountBalances'],
    queryFn: () => financeApi.getAccountBalances(),
    enabled: !hasMultipleSchools,
  })

  // Account balances (multi-school admin)
  const { data: balancesAllData, isLoading: balancesAllLoading } = useQuery({
    queryKey: ['accountBalancesAll'],
    queryFn: () => financeApi.getAccountBalancesAll(),
    enabled: hasMultipleSchools,
  })

  // Fee collection summary (current month)
  const { data: feeSummary } = useQuery({
    queryKey: ['feeSummaryDashboard', currentMonth, currentYear],
    queryFn: () => financeApi.getMonthlySummary({ month: currentMonth, year: currentYear }),
  })

  // Cross-school fee summary (admin only)
  const { data: feeSummaryAll } = useQuery({
    queryKey: ['feeSummaryAllDashboard', currentMonth, currentYear],
    queryFn: () => financeApi.getMonthlySummaryAll({ month: currentMonth, year: currentYear }),
    enabled: hasMultipleSchools,
  })

  // Recent transfers (last 5)
  const { data: transfersData } = useQuery({
    queryKey: ['recentTransfers'],
    queryFn: () => financeApi.getTransfers({ page_size: 9999 }),
  })

  // Recent entries (admin only)
  const { data: recentEntriesData } = useQuery({
    queryKey: ['recentEntries'],
    queryFn: () => financeApi.getRecentEntries({ limit: 15 }),
    enabled: isAdmin,
  })

  // Finance summary (period-filtered: income/expenses/balance)
  const { data: summaryReport, isLoading: summaryLoading } = useQuery({
    queryKey: ['financeSummary', period.date_from, period.date_to],
    queryFn: () => financeApi.getFinanceSummary(period),
    enabled: !!(period.date_from && period.date_to),
  })

  // Monthly trend (6 months, Recharts)
  const { data: trendReport } = useQuery({
    queryKey: ['monthlyTrend6'],
    queryFn: () => financeApi.getMonthlyTrend({ months: 6 }),
  })

  // Expense category summary (period-filtered)
  const { data: categorySummary } = useQuery({
    queryKey: ['expenseCategoryReport', period.date_from, period.date_to],
    queryFn: () => financeApi.getExpenseCategorySummary({
      date_from: period.date_from,
      date_to: period.date_to,
    }),
    enabled: !!(period.date_from && period.date_to),
  })

  // --- Derived data ---
  const balances = balancesData?.data?.accounts || []
  const grandTotal = balancesData?.data?.grand_total || 0
  const balanceGroups = balancesAllData?.data?.groups || []
  const balanceShared = balancesAllData?.data?.shared || { accounts: [], subtotal: 0 }
  const grandTotalAll = balancesAllData?.data?.grand_total || 0

  const feeData = feeSummary?.data
  const feeTotalDue = feeData?.total_due || 0
  const feeTotalCollected = feeData?.total_collected || 0
  const feeTotalPending = feeData?.total_pending || 0
  const feeCollectionRate = feeTotalDue > 0 ? Math.round((feeTotalCollected / feeTotalDue) * 100) : 0

  const allTransfers = transfersData?.data?.results || transfersData?.data || []
  const recentTransfers = allTransfers.slice(0, 5)

  const feeSummaryAllData = feeSummaryAll?.data
  const recentEntries = recentEntriesData?.data || []

  const summaryData = summaryReport?.data
  const trendMonths = trendReport?.data?.trend || []
  const categories = categorySummary?.data?.categories || []
  const catTotal = categorySummary?.data?.total || 0

  const trendChartData = trendMonths.map(t => ({
    name: `${MONTH_NAMES[t.month]} ${t.year}`,
    Income: Number(t.income || 0),
    Expenses: Number(t.expenses || 0),
  }))

  const handleExportPDF = () => {
    exportFinanceReport({
      schoolName: user?.school_name || '',
      periodLabel: useCustom ? 'Custom' : PERIODS[periodIdx].label,
      dateFrom: period.date_from,
      dateTo: period.date_to,
      summary: summaryData || {},
      trendData: trendMonths,
      categories,
      catTotal,
      accounts: hasMultipleSchools ? [] : balances,
      grandTotal: hasMultipleSchools ? grandTotalAll : grandTotal,
      feeCollectionRate,
      feeTotalCollected,
      feeTotalPending,
    })
  }

  return (
    <div>
      {/* --- Header with Period Selector + PDF Button --- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Finance Dashboard</h1>
          <p className="text-sm text-gray-600">
            {useCustom ? 'Custom period' : PERIODS[periodIdx].label} overview
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {PERIODS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => { setPeriodIdx(i); setUseCustom(false) }}
              className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
                !useCustom && periodIdx === i
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setUseCustom(true)}
            className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
              useCustom ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Custom
          </button>
          <button
            onClick={handleExportPDF}
            className="px-3 py-1 bg-primary-600 text-white rounded-lg text-xs hover:bg-primary-700 transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            PDF
          </button>
        </div>
      </div>

      {/* Custom date range inputs */}
      {useCustom && (
        <div className="flex gap-3 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="input text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="input text-sm"
            />
          </div>
        </div>
      )}

      {/* --- KPI Row --- */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div className="card py-3 px-4">
          <p className="text-xs text-gray-500">Account Balance</p>
          <p className="text-lg font-bold text-gray-900">
            {Number(hasMultipleSchools ? grandTotalAll : grandTotal).toLocaleString()}
          </p>
        </div>
        <div className="card py-3 px-4">
          <p className="text-xs text-gray-500">Total Income</p>
          <p className="text-lg font-bold text-green-700">
            {summaryLoading ? '...' : Number(summaryData?.total_income || 0).toLocaleString()}
          </p>
        </div>
        <div className="card py-3 px-4">
          <p className="text-xs text-gray-500">Total Expenses</p>
          <p className="text-lg font-bold text-red-700">
            {summaryLoading ? '...' : Number(summaryData?.total_expenses || 0).toLocaleString()}
          </p>
        </div>
        <div className="card py-3 px-4">
          <p className="text-xs text-gray-500">Net Balance</p>
          <p className={`text-lg font-bold ${Number(summaryData?.balance) >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
            {summaryLoading ? '...' : Number(summaryData?.balance || 0).toLocaleString()}
          </p>
        </div>
        <div className="card py-3 px-4">
          <p className="text-xs text-gray-500">Fee Rate</p>
          <p className="text-lg font-bold text-blue-700">{feeCollectionRate}%</p>
          <p className="text-[10px] text-gray-400">{MONTH_NAMES[currentMonth]} {currentYear}</p>
        </div>
      </div>

      {/* --- Two-Column Grid --- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">

        {/* --- Fee Collection Card (Current Month) --- */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Fee Collection — {MONTH_NAMES[currentMonth]}</h2>
            <Link to="/finance/fees" className="text-xs text-primary-600 hover:underline">
              Details
            </Link>
          </div>

          {!hasMultipleSchools ? (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-xs text-green-600 mb-1">Collected</p>
                <p className="text-lg font-bold text-green-700">{Number(feeTotalCollected).toLocaleString()}</p>
              </div>
              <div className="bg-orange-50 rounded-lg p-3 text-center">
                <p className="text-xs text-orange-600 mb-1">Pending</p>
                <p className="text-lg font-bold text-orange-700">{Number(feeTotalPending).toLocaleString()}</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <p className="text-xs text-blue-600 mb-1">Rate</p>
                <p className="text-lg font-bold text-blue-700">{feeCollectionRate}%</p>
              </div>
            </div>
          ) : (
            feeSummaryAllData ? (
              <div>
                <div className="space-y-2 mb-3">
                  {feeSummaryAllData.schools?.map((school) => {
                    const rate = school.total_due > 0 ? Math.round((school.total_collected / school.total_due) * 100) : 0
                    return (
                      <div key={school.school_id} className="border rounded-lg p-2">
                        <p className="text-xs font-medium text-gray-600 mb-1">{school.school_name}</p>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-green-700">{Number(school.total_collected).toLocaleString()}</span>
                          <span className="text-gray-400">/</span>
                          <span className="text-gray-600">{Number(school.total_due).toLocaleString()}</span>
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${rate >= 80 ? 'bg-green-100 text-green-700' : rate >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                            {rate}%
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="grid grid-cols-3 gap-3 pt-2 border-t">
                  <div className="text-center">
                    <p className="text-xs text-green-600">Total Collected</p>
                    <p className="text-sm font-bold text-green-700">{Number(feeSummaryAllData.grand_total_collected).toLocaleString()}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-orange-600">Total Pending</p>
                    <p className="text-sm font-bold text-orange-700">{Number(feeSummaryAllData.grand_total_pending).toLocaleString()}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-blue-600">Rate</p>
                    <p className="text-sm font-bold text-blue-700">
                      {feeSummaryAllData.grand_total_due > 0
                        ? Math.round((feeSummaryAllData.grand_total_collected / feeSummaryAllData.grand_total_due) * 100)
                        : 0}%
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-4 text-gray-400 text-sm">Loading...</div>
            )
          )}
        </div>

        {/* --- Account Balances Card --- */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Account Balances</h2>
            {isAdmin && (
              <Link to="/settings?tab=accounts" className="text-xs text-primary-600 hover:underline">
                Manage
              </Link>
            )}
          </div>

          {!hasMultipleSchools ? (
            balancesLoading ? (
              <div className="text-center py-4 text-gray-400 text-sm">Loading...</div>
            ) : balances.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No accounts created yet</p>
            ) : (
              <div>
                <div className="space-y-2">
                  {balances.map((acct, idx) => (
                    <div key={idx} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${typeColors[acct.account_type] || 'bg-gray-100'}`}>
                          {acct.account_type}
                        </span>
                        <span className="text-sm text-gray-900">{acct.name}</span>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">
                        {Number(acct.net_balance).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-200">
                  <span className="text-sm font-semibold text-gray-700">Total</span>
                  <span className="text-lg font-bold text-gray-900">{Number(grandTotal).toLocaleString()}</span>
                </div>
              </div>
            )
          ) : (
            balancesAllLoading ? (
              <div className="text-center py-4 text-gray-400 text-sm">Loading...</div>
            ) : (balanceGroups.length === 0 && balanceShared.accounts.length === 0) ? (
              <p className="text-sm text-gray-400 py-4 text-center">No accounts created yet</p>
            ) : (
              <div>
                {balanceGroups.map((group) => (
                  <div key={group.school_id} className="mb-3">
                    <p className="text-xs font-medium text-gray-500 mb-1">{group.school_name}</p>
                    {group.accounts.map((acct, idx) => (
                      <div key={idx} className="flex items-center justify-between py-1 text-sm">
                        <div className="flex items-center gap-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${typeColors[acct.account_type] || 'bg-gray-100'}`}>
                            {acct.account_type}
                          </span>
                          <span className="text-gray-900">{acct.name}</span>
                        </div>
                        <span className="font-medium">{Number(acct.net_balance).toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-xs text-gray-500 border-b border-gray-100 pb-1 mb-1">
                      <span>Subtotal</span>
                      <span className="font-semibold">{Number(group.subtotal).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
                {balanceShared.accounts.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-medium text-purple-600 mb-1">Shared (Organization)</p>
                    {balanceShared.accounts.map((acct, idx) => (
                      <div key={idx} className="flex items-center justify-between py-1 text-sm">
                        <span className="text-gray-900">{acct.name}</span>
                        <span className="font-medium">{Number(acct.net_balance).toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-xs text-gray-500 border-b border-gray-100 pb-1">
                      <span>Subtotal</span>
                      <span className="font-semibold">{Number(balanceShared.subtotal).toLocaleString()}</span>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200">
                  <span className="text-sm font-semibold text-gray-700">Grand Total</span>
                  <span className="text-lg font-bold text-gray-900">{Number(grandTotalAll).toLocaleString()}</span>
                </div>
              </div>
            )
          )}
        </div>

        {/* --- Expense Breakdown Card (period-filtered) --- */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Expense Breakdown</h2>
            <Link to="/finance/expenses" className="text-xs text-primary-600 hover:underline">
              Details
            </Link>
          </div>

          {categories.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No expenses in this period</p>
          ) : (
            <div>
              {/* Donut Chart */}
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categories.map(c => ({ name: c.category_display, value: Number(c.total_amount) }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {categories.map((_, i) => (
                        <Cell key={i} fill={EXPENSE_COLORS[i % EXPENSE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => value.toLocaleString()} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Category Table */}
              <div className="overflow-x-auto mt-2">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">%</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {categories.map((cat) => (
                      <tr key={cat.category}>
                        <td className="px-3 py-1.5 text-sm text-gray-900">{cat.category_display}</td>
                        <td className="px-3 py-1.5 text-sm text-gray-900 text-right">{Number(cat.total_amount).toLocaleString()}</td>
                        <td className="px-3 py-1.5 text-sm text-gray-500 text-right">
                          {catTotal > 0 ? Math.round(cat.total_amount / catTotal * 100) : 0}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50">
                      <td className="px-3 py-1.5 text-sm font-bold text-gray-900">Total</td>
                      <td className="px-3 py-1.5 text-sm font-bold text-gray-900 text-right">{Number(catTotal).toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-sm font-bold text-gray-500 text-right">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* --- Recent Transfers Card --- */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Recent Transfers</h2>
            <Link to="/finance/expenses?tab=transfers" className="text-xs text-primary-600 hover:underline">
              View All
            </Link>
          </div>

          {recentTransfers.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No transfers recorded</p>
          ) : (
            <div className="space-y-2">
              {recentTransfers.map((tfr) => (
                <div key={tfr.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="text-sm text-gray-900">
                      {tfr.from_account_name} &rarr; {tfr.to_account_name}
                    </p>
                    <p className="text-xs text-gray-400">{tfr.date}{tfr.description ? ` — ${tfr.description}` : ''}</p>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">{Number(tfr.amount).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          {canWrite && (
            <button
              onClick={() => setShowTransferModal(true)}
              className="mt-3 w-full px-3 py-2 bg-primary-50 text-primary-700 rounded-lg hover:bg-primary-100 text-sm font-medium transition-colors"
            >
              + Record Transfer
            </button>
          )}
        </div>
      </div>

      {/* --- Monthly Trend (Recharts, 6 months) --- */}
      {trendChartData.length > 0 && (
        <div className="card mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Monthly Trend (Last 6 Months)</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                <Tooltip formatter={(value, name) => [value.toLocaleString(), name]} labelStyle={{ fontWeight: 'bold' }} />
                <Bar dataKey="Income" fill="#16a34a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-4 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-600" /> Income</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Expenses</span>
          </div>
        </div>
      )}

      {/* --- Recent Entries (Admin+ only) --- */}
      {isAdmin && recentEntries.length > 0 && (
        <div className="card mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Recent Entries</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">By</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {recentEntries.map((entry) => {
                  const typeBadge = {
                    fee_payment: { label: 'Fee', cls: 'bg-green-100 text-green-800' },
                    other_income: { label: 'Income', cls: 'bg-blue-100 text-blue-800' },
                    expense: { label: 'Expense', cls: 'bg-red-100 text-red-800' },
                    transfer: { label: 'Transfer', cls: 'bg-purple-100 text-purple-800' },
                  }[entry.type] || { label: entry.type, cls: 'bg-gray-100 text-gray-800' }
                  return (
                    <tr key={`${entry.type}-${entry.id}`}>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${typeBadge.cls}`}>
                          {typeBadge.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-900 max-w-[200px] truncate">{entry.description}</td>
                      <td className={`px-3 py-2 text-sm font-medium text-right ${entry.type === 'expense' ? 'text-red-700' : 'text-green-700'}`}>
                        {Number(entry.amount).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">{entry.account_name || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{entry.date || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{entry.recorded_by || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- Quick Actions --- */}
      {canWrite && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <Link
            to="/finance/fees/collect"
            className="card flex items-center justify-center py-3 hover:bg-gray-50 transition-colors"
          >
            <span className="text-sm font-medium text-primary-700">Record Fee Payment</span>
          </Link>
          <Link
            to="/finance/expenses"
            className="card flex items-center justify-center py-3 hover:bg-gray-50 transition-colors"
          >
            <span className="text-sm font-medium text-primary-700">Add Expense</span>
          </Link>
          <button
            onClick={() => setShowTransferModal(true)}
            className="card flex items-center justify-center py-3 hover:bg-gray-50 transition-colors"
          >
            <span className="text-sm font-medium text-primary-700">Record Transfer</span>
          </button>
        </div>
      )}

      {/* --- Admin Quick Links --- */}
      {isAdmin && (
        <div className="flex flex-wrap gap-3">
          <Link to="/settings?tab=accounts" className="text-sm text-primary-600 hover:underline">
            Finance Settings &rarr;
          </Link>
        </div>
      )}

      <TransferModal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
      />
    </div>
  )
}
