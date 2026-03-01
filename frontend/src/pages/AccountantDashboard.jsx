import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useAcademicYear } from '../contexts/AcademicYearContext'
import { financeApi } from '../services/api'
import StatCard from '../components/dashboard/StatCard'
import QuickActionGrid from '../components/dashboard/QuickActionGrid'
import NotificationsFeed from '../components/dashboard/NotificationsFeed'

// ─── Icons ──────────────────────────────────────────────────────────────────────
const icons = {
  balance: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  ),
  collected: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  pending: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  rate: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  ),
  payment: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  expense: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  transfer: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
    </svg>
  ),
  generate: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  dashboard: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  discount: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
    </svg>
  ),
}

const ACCOUNT_TYPE_COLORS = {
  CASH: 'bg-green-100 text-green-700',
  BANK: 'bg-blue-100 text-blue-700',
  PERSON: 'bg-purple-100 text-purple-700',
}

export default function AccountantDashboard() {
  const { user, activeSchool } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()
  const dateFrom = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`
  const dateTo = now.toISOString().split('T')[0]

  // ─── Queries ──────────────────────────────────────────────────────────────────

  const { data: balancesRes, isLoading: loadingBalances } = useQuery({
    queryKey: ['accountBalances'],
    queryFn: () => financeApi.getAccountBalances(),
    enabled: !!activeSchool?.id,
  })
  const accounts = balancesRes?.data || []

  const { data: feeSummaryRes, isLoading: loadingFees } = useQuery({
    queryKey: ['feeSummary', currentMonth, currentYear, activeAcademicYear?.id],
    queryFn: () => financeApi.getMonthlySummary({
      month: currentMonth, year: currentYear,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: !!activeSchool?.id,
  })
  const feeData = feeSummaryRes?.data || {}

  const { data: financeSummaryRes } = useQuery({
    queryKey: ['financeSummaryDash', dateFrom, dateTo],
    queryFn: () => financeApi.getFinanceSummary({ date_from: dateFrom, date_to: dateTo }),
    enabled: !!activeSchool?.id,
  })
  const finData = financeSummaryRes?.data || {}

  const { data: recentEntriesRes } = useQuery({
    queryKey: ['recentEntries'],
    queryFn: () => financeApi.getRecentEntries({ limit: 8 }),
    enabled: !!activeSchool?.id,
  })
  const recentEntries = recentEntriesRes?.data || []

  const { data: overdueRes } = useQuery({
    queryKey: ['overdueFees', currentMonth, currentYear],
    queryFn: () => financeApi.getFeePayments({ status: 'UNPAID', ordering: '-due_date', page_size: 8 }),
    enabled: !!activeSchool?.id,
  })
  const overduePayments = overdueRes?.data?.results || overdueRes?.data || []

  // ─── Computed ─────────────────────────────────────────────────────────────────

  const grandBalance = Array.isArray(accounts) ? accounts.reduce((sum, a) => sum + Number(a.balance || 0), 0) : 0
  const collected = Number(feeData.total_collected || 0)
  const pendingAmt = Number(feeData.total_pending || 0)
  const totalDue = Number(feeData.total_due || 0)
  const collectionRate = totalDue > 0 ? Math.round((collected / totalDue) * 100) : 0
  const totalIncome = Number(finData.total_income || 0)
  const totalExpenses = Number(finData.total_expenses || 0)

  const byClass = feeData.by_class || []

  // ─── Quick Actions ──────────────────────────────────────────────────────────

  const quickActions = [
    { label: 'Record Payment', href: '/finance/fee-payments', icon: icons.payment },
    { label: 'Add Expense', href: '/finance/expenses', icon: icons.expense },
    { label: 'Record Transfer', href: '/finance/transfers', icon: icons.transfer },
    { label: 'Generate Fees', href: '/finance/fee-payments', icon: icons.generate },
    { label: 'Finance Dashboard', href: '/finance', icon: icons.dashboard },
    { label: 'Fee Discounts', href: '/finance/discounts', icon: icons.discount },
  ]

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Finance Dashboard</h1>
        <p className="text-sm text-gray-500">
          {activeSchool?.name || 'Welcome back'} — {now.toLocaleString('default', { month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Account Balance"
          value={`Rs. ${grandBalance.toLocaleString()}`}
          subtitle={`${accounts.length} accounts`}
          icon={icons.balance}
          color="blue"
          loading={loadingBalances}
        />
        <StatCard
          label="Fee Collected"
          value={`Rs. ${collected.toLocaleString()}`}
          subtitle="this month"
          icon={icons.collected}
          color="green"
          loading={loadingFees}
        />
        <StatCard
          label="Fee Pending"
          value={`Rs. ${pendingAmt.toLocaleString()}`}
          subtitle="this month"
          icon={icons.pending}
          color={pendingAmt > 0 ? 'orange' : 'green'}
          loading={loadingFees}
        />
        <StatCard
          label="Collection Rate"
          value={`${collectionRate}%`}
          subtitle={collectionRate >= 80 ? 'on track' : collectionRate >= 50 ? 'needs attention' : 'critical'}
          icon={icons.rate}
          color={collectionRate >= 80 ? 'green' : collectionRate >= 50 ? 'amber' : 'red'}
          loading={loadingFees}
        />
      </div>

      {/* Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Left Column */}
        <div className="lg:col-span-3 space-y-6">

          {/* Fee Collection by Class */}
          {byClass.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">Collection by Class</h2>
                <Link to="/finance" className="text-xs text-sky-600 hover:text-sky-700 font-medium">View Details</Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 text-xs font-medium text-gray-500">Class</th>
                      <th className="text-right py-2 text-xs font-medium text-gray-500">Due</th>
                      <th className="text-right py-2 text-xs font-medium text-gray-500">Collected</th>
                      <th className="text-right py-2 text-xs font-medium text-gray-500">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byClass.slice(0, 8).map((c, i) => {
                      const cDue = Number(c.total_due || 0)
                      const cCollected = Number(c.total_collected || 0)
                      const cRate = cDue > 0 ? Math.round((cCollected / cDue) * 100) : 0
                      return (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="py-2 text-gray-800 font-medium">{c.class_name || c.class_obj__name || `Class ${i + 1}`}</td>
                          <td className="py-2 text-right text-gray-500">{cDue.toLocaleString()}</td>
                          <td className="py-2 text-right text-gray-700">{cCollected.toLocaleString()}</td>
                          <td className="py-2 text-right">
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                              cRate >= 80 ? 'bg-green-100 text-green-700'
                                : cRate >= 50 ? 'bg-amber-100 text-amber-700'
                                  : 'bg-red-100 text-red-700'
                            }`}>
                              {cRate}%
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent Transactions */}
          {recentEntries.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">Recent Transactions</h2>
                <Link to="/finance" className="text-xs text-sky-600 hover:text-sky-700 font-medium">View All</Link>
              </div>
              <div className="space-y-1.5">
                {recentEntries.slice(0, 8).map((entry, i) => (
                  <div key={i} className="flex items-center justify-between py-2 px-2.5 hover:bg-gray-50 rounded-lg transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-800 truncate">{entry.description || entry.narration || 'Transaction'}</p>
                      <p className="text-xs text-gray-400">{entry.date ? new Date(entry.date).toLocaleDateString() : ''}</p>
                    </div>
                    <span className={`text-sm font-medium ml-3 shrink-0 ${
                      entry.type === 'CREDIT' || entry.entry_type === 'CREDIT' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {entry.type === 'CREDIT' || entry.entry_type === 'CREDIT' ? '+' : '-'}Rs. {Number(entry.amount || 0).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Overdue Fee Payments */}
          {overduePayments.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">Overdue Fees</h2>
                <Link to="/finance/fee-payments?status=UNPAID" className="text-xs text-sky-600 hover:text-sky-700 font-medium">View All</Link>
              </div>
              <div className="space-y-1.5">
                {overduePayments.slice(0, 6).map(p => (
                  <div key={p.id} className="flex items-center justify-between py-2 px-2.5 bg-red-50/50 rounded-lg">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">{p.student_name || 'Student'}</p>
                      <p className="text-xs text-gray-500">{p.class_name || ''} {p.due_date ? `— Due: ${new Date(p.due_date).toLocaleDateString()}` : ''}</p>
                    </div>
                    <span className="text-sm font-semibold text-red-600 shrink-0 ml-3">
                      Rs. {Number(p.amount || p.monthly_amount || 0).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column */}
        <div className="lg:col-span-2 space-y-6">

          {/* Quick Actions */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h2>
            <QuickActionGrid actions={quickActions} />
          </div>

          {/* Income vs Expense */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Income vs Expense</h2>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-500">Income</span>
                  <span className="font-medium text-green-600">Rs. {totalIncome.toLocaleString()}</span>
                </div>
                <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all duration-500"
                    style={{ width: `${totalIncome + totalExpenses > 0 ? (totalIncome / (totalIncome + totalExpenses)) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-500">Expenses</span>
                  <span className="font-medium text-red-600">Rs. {totalExpenses.toLocaleString()}</span>
                </div>
                <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-400 rounded-full transition-all duration-500"
                    style={{ width: `${totalIncome + totalExpenses > 0 ? (totalExpenses / (totalIncome + totalExpenses)) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <div className="pt-2 border-t border-gray-100 flex justify-between items-center">
                <span className="text-xs text-gray-500">Net Balance</span>
                <span className={`text-sm font-bold ${totalIncome - totalExpenses >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  Rs. {(totalIncome - totalExpenses).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Account Balances */}
          {Array.isArray(accounts) && accounts.length > 0 && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Account Balances</h2>
              <div className="space-y-2">
                {accounts.map(a => (
                  <div key={a.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-gray-800 truncate">{a.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ACCOUNT_TYPE_COLORS[a.account_type] || 'bg-gray-100 text-gray-600'}`}>
                        {a.account_type}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900 shrink-0 ml-2">
                      Rs. {Number(a.balance || 0).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notifications */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Notifications</h2>
            <NotificationsFeed limit={5} />
          </div>
        </div>
      </div>
    </div>
  )
}
