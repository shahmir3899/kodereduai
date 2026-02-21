import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { financeApi, notificationsApi } from '../services/api'

export default function AccountantDashboard() {
  const { user, activeSchool } = useAuth()

  const currentMonth = new Date().getMonth() + 1
  const currentYear = new Date().getFullYear()
  const now = new Date()
  const dateFrom = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`
  const dateTo = now.toISOString().split('T')[0]

  // Account balances
  const { data: balancesData, isLoading: balancesLoading } = useQuery({
    queryKey: ['accountBalances'],
    queryFn: () => financeApi.getAccountBalances(),
    enabled: !!activeSchool?.id,
  })

  // Monthly fee summary
  const { data: feeSummary } = useQuery({
    queryKey: ['feeSummary', currentMonth, currentYear],
    queryFn: () => financeApi.getMonthlySummary({ month: currentMonth, year: currentYear }),
    enabled: !!activeSchool?.id,
  })

  // Income/expense summary
  const { data: financeSummary } = useQuery({
    queryKey: ['financeSummaryDash', dateFrom, dateTo],
    queryFn: () => financeApi.getFinanceSummary({ date_from: dateFrom, date_to: dateTo }),
    enabled: !!activeSchool?.id,
  })

  // Notifications
  const { data: notificationsData } = useQuery({
    queryKey: ['myNotifications'],
    queryFn: () => notificationsApi.getMyNotifications({ limit: 5 }),
  })

  const balances = balancesData?.data || []
  const feeData = feeSummary?.data || {}
  const finData = financeSummary?.data || {}
  const notifications = notificationsData?.data?.results || notificationsData?.data || []

  const grandBalance = Array.isArray(balances)
    ? balances.reduce((sum, a) => sum + Number(a.balance || 0), 0)
    : 0

  const collected = Number(feeData.total_collected || 0)
  const pending = Number(feeData.total_pending || 0)
  const totalDue = Number(feeData.total_due || 0)
  const collectionRate = totalDue > 0 ? Math.round((collected / totalDue) * 100) : 0

  const kpis = [
    { label: 'Account Balance', value: grandBalance.toLocaleString(), color: 'bg-blue-100 text-blue-800' },
    { label: 'Fee Collected', value: collected.toLocaleString(), sub: 'This month', color: 'bg-green-100 text-green-800' },
    { label: 'Fee Pending', value: pending.toLocaleString(), sub: 'This month', color: 'bg-orange-100 text-orange-800' },
    { label: 'Collection Rate', value: `${collectionRate}%`, color: collectionRate >= 80 ? 'bg-green-100 text-green-800' : collectionRate >= 50 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800' },
  ]

  const quickActions = [
    { to: '/finance/fees/collect', label: 'Record Fee Payment', desc: 'Collect student fees', bg: 'bg-green-50 hover:bg-green-100' },
    { to: '/finance/expenses', label: 'Add Expense', desc: 'Record an expense', bg: 'bg-red-50 hover:bg-red-100' },
    { to: '/finance', label: 'Finance Dashboard', desc: 'Full financial overview', bg: 'bg-blue-50 hover:bg-blue-100' },
    { to: '/finance/discounts', label: 'Fee Discounts', desc: 'Manage discounts', bg: 'bg-purple-50 hover:bg-purple-100' },
    { to: '/notifications', label: 'Notifications', desc: 'View all notifications', bg: 'bg-gray-50 hover:bg-gray-100' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Accountant Dashboard</h1>
        <p className="text-sm sm:text-base text-gray-600">
          Welcome back, {[user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username}
        </p>
      </div>

      {/* KPI Cards */}
      {balancesLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="card">
              <p className="text-sm text-gray-500">{kpi.label}</p>
              <div className="mt-1">
                <p className="text-xl sm:text-2xl font-bold text-gray-900">{kpi.value}</p>
                {kpi.sub && <p className="text-xs text-gray-400">{kpi.sub}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick Actions */}
      <div className="card mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {quickActions.map((action) => (
            <Link key={action.to} to={action.to} className={`flex items-center p-4 rounded-lg transition-colors ${action.bg}`}>
              <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center mr-3">
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-gray-900 text-sm">{action.label}</p>
                <p className="text-xs text-gray-500">{action.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent Notifications */}
      {notifications.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Recent Notifications</h2>
            <Link to="/notifications" className="text-sm text-primary-600 hover:text-primary-700">View all</Link>
          </div>
          <div className="space-y-2">
            {notifications.map((n) => (
              <div key={n.id} className="flex items-start gap-3 py-2 border-b border-gray-100">
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.status === 'READ' ? 'bg-gray-300' : 'bg-primary-500'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900">{n.title}</p>
                  <p className="text-xs text-gray-500 truncate">{n.body}</p>
                </div>
                <span className="text-xs text-gray-400 shrink-0">
                  {n.created_at ? new Date(n.created_at).toLocaleDateString() : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
