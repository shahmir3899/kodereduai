import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { financeApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import TransferModal from '../components/TransferModal'

const typeColors = {
  CASH: 'bg-green-100 text-green-800',
  BANK: 'bg-blue-100 text-blue-800',
  PERSON: 'bg-purple-100 text-purple-800',
}

const categoryColors = {
  SALARY: 'bg-blue-500',
  RENT: 'bg-purple-500',
  UTILITIES: 'bg-yellow-500',
  SUPPLIES: 'bg-green-500',
  MAINTENANCE: 'bg-orange-500',
  MISC: 'bg-gray-500',
}

export default function FinanceDashboardPage() {
  const { user, isStaffMember, isPrincipal } = useAuth()
  const canWrite = !isStaffMember
  const hasMultipleSchools = !isStaffMember && (user?.schools?.length > 1 || user?.is_super_admin)
  const isAdmin = !isPrincipal && !isStaffMember // SCHOOL_ADMIN

  const [showTransferModal, setShowTransferModal] = useState(false)

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

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

  // Expense category summary (current month)
  const firstOfMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`
  const { data: expenseSummary } = useQuery({
    queryKey: ['expenseSummaryDashboard', currentMonth, currentYear],
    queryFn: () => financeApi.getExpenseCategorySummary({ date_from: firstOfMonth }),
  })

  // Recent transfers (last 5)
  const { data: transfersData } = useQuery({
    queryKey: ['recentTransfers'],
    queryFn: () => financeApi.getTransfers(),
  })

  // Monthly trend (admin only, last 3 months)
  const { data: trendData } = useQuery({
    queryKey: ['monthlyTrendDashboard'],
    queryFn: () => financeApi.getMonthlyTrend({ months: 3 }),
    enabled: isAdmin,
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

  const expenseCategories = expenseSummary?.data?.categories || []
  const expenseTotal = expenseSummary?.data?.total || 0

  const allTransfers = transfersData?.data?.results || transfersData?.data || []
  const recentTransfers = allTransfers.slice(0, 5)

  const feeSummaryAllData = feeSummaryAll?.data
  const trendMonths = trendData?.data?.months || []

  const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Finance Dashboard</h1>
          <p className="text-sm text-gray-600">
            {monthNames[currentMonth]} {currentYear} overview
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

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
            // Single school view
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
            // Multi-school view
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

        {/* --- Fee Collection Card --- */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Fee Collection — {monthNames[currentMonth]}</h2>
            <Link to="/finance/fees" className="text-xs text-primary-600 hover:underline">
              Details
            </Link>
          </div>

          {!hasMultipleSchools ? (
            // Single school
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
            // Multi-school admin
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

        {/* --- Expense Summary Card --- */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Expenses — {monthNames[currentMonth]}</h2>
            <Link to="/finance/expenses" className="text-xs text-primary-600 hover:underline">
              Details
            </Link>
          </div>

          {expenseCategories.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No expenses this month</p>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-2xl font-bold text-gray-900">{Number(expenseTotal).toLocaleString()}</span>
              </div>
              <div className="space-y-2">
                {expenseCategories.map((cat) => {
                  const pct = expenseTotal > 0 ? (cat.total_amount / expenseTotal * 100) : 0
                  return (
                    <div key={cat.category} className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${categoryColors[cat.category] || 'bg-gray-400'}`} />
                      <span className="text-xs text-gray-600 w-20 truncate">{cat.category_display}</span>
                      <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${categoryColors[cat.category] || 'bg-gray-400'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-gray-700 w-16 text-right">
                        {Number(cat.total_amount).toLocaleString()}
                      </span>
                    </div>
                  )
                })}
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

      {/* --- Quick Actions --- */}
      {canWrite && (
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Link
            to="/finance/fees"
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

      {/* --- Admin-Only: Monthly Trend --- */}
      {isAdmin && trendMonths.length > 0 && (
        <div className="mt-6 card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Monthly Trend</h2>
            <Link to="/finance/reports" className="text-xs text-primary-600 hover:underline">
              Full Reports
            </Link>
          </div>
          <div className="flex items-end gap-2 h-32">
            {trendMonths.map((m, idx) => {
              const maxVal = Math.max(...trendMonths.map(t => Math.max(t.income || 0, t.expenses || 0)), 1)
              const incomeH = ((m.income || 0) / maxVal) * 100
              const expenseH = ((m.expenses || 0) / maxVal) * 100
              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                  <div className="flex items-end gap-0.5 h-24 w-full justify-center">
                    <div
                      className="bg-green-400 rounded-t w-4"
                      style={{ height: `${Math.max(incomeH, 2)}%` }}
                      title={`Income: ${Number(m.income || 0).toLocaleString()}`}
                    />
                    <div
                      className="bg-red-400 rounded-t w-4"
                      style={{ height: `${Math.max(expenseH, 2)}%` }}
                      title={`Expenses: ${Number(m.expenses || 0).toLocaleString()}`}
                    />
                  </div>
                  <span className="text-[10px] text-gray-500">{m.month_name?.slice(0, 3)}</span>
                </div>
              )
            })}
          </div>
          <div className="flex items-center justify-center gap-4 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" /> Income</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> Expenses</span>
          </div>
        </div>
      )}

      {/* --- Admin-Only: Quick Links --- */}
      {isAdmin && (
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/finance/reports" className="text-sm text-primary-600 hover:underline">
            View Full Reports &rarr;
          </Link>
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
