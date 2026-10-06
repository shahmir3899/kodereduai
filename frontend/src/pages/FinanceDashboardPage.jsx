import { useState } from 'react'
import { TONE } from '../components/ui/statusTones'
import Button from '../components/ui/Button'
import PageHeader from '../components/ui/PageHeader'
import LoadingState from '../components/ui/LoadingState'
import EmptyState from '../components/ui/EmptyState'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { financeApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import TransferModal from '../components/TransferModal'
import { useEscapeKey } from '../hooks/useEscapeKey'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { exportFinanceReport } from './finance/financeReportExport'
import FeeCategoryBreakdown from '../components/dashboard/FeeCategoryBreakdown'
import { useAnnualFeeSummary, useFeeMonthSummary } from '../hooks/useFeeMonthSummary'

const typeColors = {
  CASH: TONE.success,
  BANK: TONE.info,
  PERSON: TONE.accent,
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
  const [ledgerPreviewAccount, setLedgerPreviewAccount] = useState(null)

  useEscapeKey(() => setLedgerPreviewAccount(null), !!ledgerPreviewAccount)
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

  // Monthly fee collection (current month) — shared with the admin dashboard
  const { summary: fee } = useFeeMonthSummary()

  // Annual fee collection (this year) — all schools for multi-school admins, like monthly
  const { summary: annual } = useAnnualFeeSummary()

  // Recent transfers (last 5) — Transfer's default ordering is -date,-created_at,
  // so the first page is already "most recent first"; no need to fetch every row.
  const { data: transfersData } = useQuery({
    queryKey: ['recentTransfers'],
    queryFn: () => financeApi.getTransfers({ page_size: 5 }),
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

  const allTransfers = transfersData?.data?.results || transfersData?.data || []
  const recentTransfers = allTransfers.slice(0, 5)

  const recentEntries = recentEntriesData?.data || []

  // Ledger preview for clicked account
  const { data: previewLedgerData, isLoading: previewLedgerLoading } = useQuery({
    queryKey: ['ledgerPreview', ledgerPreviewAccount?.id],
    queryFn: () => financeApi.getAccountLedger({ account_id: ledgerPreviewAccount.id, ordering: 'desc', limit: 10 }),
    enabled: !!ledgerPreviewAccount,
  })
  const previewLedgerPayload = previewLedgerData?.data
  const previewEntries = previewLedgerPayload?.entries || []

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
      feeCollectionRate: fee?.rate ?? 0,
      feeTotalCollected: fee?.totalCollected ?? 0,
      feeTotalPending: fee?.totalPending ?? 0,
    })
  }

  return (
    <div>
      {/* --- Header with Period Selector + PDF Button --- */}
      <PageHeader title="Finance Dashboard" subtitle={<>{useCustom ? 'Custom period' : PERIODS[periodIdx].label} overview</>} className="mb-4" actions={<>
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
</>} />

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
          <p className="text-xs text-gray-500">Monthly Fee Rate</p>
          <p className="text-lg font-bold text-blue-700">{fee?.rate != null ? `${fee.rate}%` : '—'}</p>
          <p className="text-[10px] text-gray-400">{MONTH_NAMES[currentMonth]} {currentYear} · monthly fees</p>
        </div>
      </div>

      {/* --- Two-Column Grid --- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">

        {/* --- Monthly Fee Collection Card (Current Month) --- */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">
              Monthly Fee Collection — {MONTH_NAMES[currentMonth]}{fee?.isMulti ? ' · all schools' : ''}
            </h2>
            <Link to="/finance/fees?feeType=MONTHLY" className="text-xs text-primary-600 hover:underline">
              Details
            </Link>
          </div>

          {!fee ? (
            <LoadingState label="Loading..." compact />
          ) : (
            <div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-green-600 mb-1">Collected</p>
                  <p className="text-lg font-bold text-green-700">{fee.totalCollected.toLocaleString()}</p>
                </div>
                <div className="bg-orange-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-orange-600 mb-1">Pending</p>
                  <p className="text-lg font-bold text-orange-700">{fee.totalPending.toLocaleString()}</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-blue-600 mb-1">Rate</p>
                  <p className="text-lg font-bold text-blue-700">{fee.rate != null ? `${fee.rate}%` : '—'}</p>
                </div>
              </div>
              <FeeCategoryBreakdown summary={fee} />
            </div>
          )}
        </div>

        {/* --- Annual Fee Overview Card --- */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">
              Annual Fee Overview{annual?.isMulti ? ' · all schools' : ''}
            </h2>
            <Link to="/finance/fees?feeType=ANNUAL" className="text-xs text-primary-600 hover:underline">
              Details
            </Link>
          </div>

          {!annual ? (
            <LoadingState label="Loading..." compact />
          ) : annual.totalDue === 0 && annual.byCategory.length === 0 ? (
            <EmptyState title="No annual fee records for this academic year" compact />
          ) : (
            <div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-green-600 mb-1">Collected</p>
                  <p className="text-lg font-bold text-green-700">{annual.totalCollected.toLocaleString()}</p>
                </div>
                <div className="bg-orange-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-orange-600 mb-1">Pending</p>
                  <p className="text-lg font-bold text-orange-700">{annual.totalPending.toLocaleString()}</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-blue-600 mb-1">Rate</p>
                  <p className="text-lg font-bold text-blue-700">{annual.rate != null ? `${annual.rate}%` : '—'}</p>
                </div>
              </div>
              <FeeCategoryBreakdown summary={annual} alwaysShowCategories />
            </div>
          )}
        </div>

        {/* --- Account Balances Card --- */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Account Balances</h2>
            {isAdmin && (
              <Link to="/finance/accounts" className="text-xs text-primary-600 hover:underline">
                Manage
              </Link>
            )}
          </div>

          {!hasMultipleSchools ? (
            balancesLoading ? (
              <LoadingState label="Loading..." compact />
            ) : balances.length === 0 ? (
              <EmptyState title="No accounts created yet" compact />
            ) : (
              <div>
                <div className="space-y-2">
                  {balances.map((acct, idx) => (
                    <div key={idx} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${typeColors[acct.account_type] || 'bg-gray-100'}`}>
                          {acct.account_type}
                        </span>
                        <button
                          onClick={() => setLedgerPreviewAccount(acct)}
                          className="text-sm text-primary-700 hover:underline text-left"
                        >
                          {acct.name}
                        </button>
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
              <LoadingState label="Loading..." compact />
            ) : (balanceGroups.length === 0 && balanceShared.accounts.length === 0) ? (
              <EmptyState title="No accounts created yet" compact />
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
                          <button
                            onClick={() => setLedgerPreviewAccount(acct)}
                            className="text-primary-700 hover:underline text-left"
                          >
                            {acct.name}
                          </button>
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
                        <button
                          onClick={() => setLedgerPreviewAccount(acct)}
                          className="text-primary-700 hover:underline text-left"
                        >
                          {acct.name}
                        </button>
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
            <EmptyState title="No expenses in this period" compact />
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
                  <tbody className="divide-y divide-gray-100">
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
            <EmptyState title="No transfers recorded" compact />
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
              <tbody className="divide-y divide-gray-100">
                {recentEntries.map((entry) => {
                  const typeBadge = {
                    fee_payment: { label: entry.fee_type_label || 'Fee', cls: TONE.success },
                    other_income: { label: 'Income', cls: TONE.info },
                    expense: { label: 'Expense', cls: TONE.danger },
                    transfer: { label: 'Transfer', cls: TONE.accent },
                  }[entry.type] || { label: entry.type, cls: TONE.neutral }
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
          <Link to="/finance/accounts" className="text-sm text-primary-600 hover:underline">
            Accounts & Ledger &rarr;
          </Link>
        </div>
      )}

      {/* Ledger Preview Modal */}
      {ledgerPreviewAccount && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black bg-opacity-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-xl sm:rounded-lg shadow-xl w-full max-w-xl max-h-[85vh] sm:max-h-[80vh] flex flex-col">
            <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <div className="min-w-0">
                <h3 className="text-sm sm:text-base font-semibold text-gray-900 truncate">{ledgerPreviewAccount.name}</h3>
                <p className="text-[11px] sm:text-xs text-gray-500 mt-0.5">
                  {ledgerPreviewAccount.account_type} &middot; Last {previewEntries.length} entries
                </p>
              </div>
              <button onClick={() => setLedgerPreviewAccount(null)} className="text-gray-400 hover:text-gray-600 p-1 flex-shrink-0 ml-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-4 sm:px-6 py-3 sm:py-4 overflow-y-auto flex-1 min-h-0">
              {previewLedgerLoading ? (
                <LoadingState label="Loading..." />
              ) : previewEntries.length === 0 ? (
                <EmptyState title="No transactions yet for this account" compact />
              ) : (
                <>
                  {/* Current balance banner */}
                  <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 mb-3">
                    <span className="text-xs sm:text-sm text-gray-600">Current Balance</span>
                    <span className="text-base sm:text-lg font-bold text-gray-900">{Number(previewLedgerPayload?.closing_balance || 0).toLocaleString()}</span>
                  </div>
                  {/* Entries table */}
                  <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
                    <table className="min-w-full">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b border-gray-200">
                          <th className="py-2 pr-2 text-left text-[10px] font-medium text-gray-500 uppercase">Date / Description</th>
                          <th className="py-2 px-1 sm:px-2 text-right text-[10px] font-medium text-green-600 uppercase w-16 sm:w-20">Cr</th>
                          <th className="py-2 px-1 sm:px-2 text-right text-[10px] font-medium text-red-600 uppercase w-16 sm:w-20">Dr</th>
                          <th className="py-2 pl-1 sm:pl-2 text-right text-[10px] font-medium text-gray-500 uppercase w-20 sm:w-24">Bal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {previewEntries.map((entry, idx) => (
                          <tr key={idx} className={idx === 0 ? 'bg-blue-50/40' : ''}>
                            <td className="py-1.5 sm:py-2 pr-2">
                              <p className="text-xs sm:text-sm text-gray-900 truncate max-w-[140px] sm:max-w-[220px]">{entry.description}</p>
                              <p className="text-[10px] sm:text-[11px] text-gray-400">{entry.date || '—'}</p>
                            </td>
                            <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right text-xs sm:text-sm text-green-700 tabular-nums">
                              {entry.credit > 0 ? Number(entry.credit).toLocaleString() : '—'}
                            </td>
                            <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right text-xs sm:text-sm text-red-700 tabular-nums">
                              {entry.debit > 0 ? Number(entry.debit).toLocaleString() : '—'}
                            </td>
                            <td className="py-1.5 sm:py-2 pl-1 sm:pl-2 text-right text-xs sm:text-sm font-semibold text-gray-900 tabular-nums">
                              {Number(entry.running_balance).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
            <div className="px-4 sm:px-6 pb-4 sm:pb-5 pt-2 border-t border-gray-100 flex gap-3 flex-shrink-0">
              <Button variant="secondary"
 onClick={() => setLedgerPreviewAccount(null)}
 className="flex-1">
                Close
              </Button>
              <Link
                to="/finance/accounts"
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm text-center"
              >
                View Full Ledger &rarr;
              </Link>
            </div>
          </div>
        </div>
      )}

      <TransferModal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
      />
    </div>
  )
}
