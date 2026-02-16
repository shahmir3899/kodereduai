import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import { useBackgroundTask } from '../../hooks/useBackgroundTask'

const statusBadge = {
  DRAFT: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  PAID: 'bg-green-100 text-green-800',
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function PayrollPage() {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()

  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [statusFilter, setStatusFilter] = useState('')
  const [generateConfirm, setGenerateConfirm] = useState(false)
  const [detailSlip, setDetailSlip] = useState(null)

  // Fetch payslips for selected month/year
  const { data: payslipData, isLoading } = useQuery({
    queryKey: ['hrPayslips', month, year],
    queryFn: () => hrApi.getPayslips({ month, year, page_size: 9999 }),
    staleTime: 2 * 60 * 1000,
  })

  // Fetch payroll summary
  const { data: summaryData } = useQuery({
    queryKey: ['hrPayrollSummary', month, year],
    queryFn: () => hrApi.getPayrollSummary({ month, year }),
    staleTime: 2 * 60 * 1000,
  })

  // Generate payslips (background task)
  const generateTask = useBackgroundTask({
    mutationFn: () => hrApi.generatePayslips({ month, year }),
    taskType: 'PAYSLIP_GENERATION',
    title: `Generating payslips for ${MONTHS[month - 1]} ${year}`,
    onSubmitted: () => setGenerateConfirm(false),
  })

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: (id) => hrApi.approvePayslip(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrPayslips', month, year] })
      queryClient.invalidateQueries({ queryKey: ['hrPayrollSummary', month, year] })
      queryClient.invalidateQueries({ queryKey: ['hrDashboardStats'] })
      showSuccess('Payslip approved!')
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to approve'),
  })

  // Mark paid mutation
  const markPaidMutation = useMutation({
    mutationFn: (id) => hrApi.markPayslipPaid(id, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrPayslips', month, year] })
      queryClient.invalidateQueries({ queryKey: ['hrPayrollSummary', month, year] })
      queryClient.invalidateQueries({ queryKey: ['hrDashboardStats'] })
      showSuccess('Payslip marked as paid!')
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to mark paid'),
  })

  const allPayslips = payslipData?.data?.results || payslipData?.data || []
  const summary = summaryData?.data || {}
  const filteredPayslips = statusFilter
    ? allPayslips.filter((p) => p.status === statusFilter)
    : allPayslips

  const fmt = (v) => {
    const n = parseFloat(v)
    return isNaN(n) ? '0.00' : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  // Year options
  const years = []
  for (let y = now.getFullYear() - 2; y <= now.getFullYear() + 1; y++) years.push(y)

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Payroll</h1>
          <p className="text-sm text-gray-600">
            {MONTHS[month - 1]} {year} &middot; {allPayslips.length} payslip{allPayslips.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => setGenerateConfirm(true)} className="btn btn-primary">
          Generate Payslips
        </button>
      </div>

      {/* Month/Year Selector + Filter */}
      <div className="card mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select className="input" value={month} onChange={(e) => setMonth(parseInt(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
          <select className="input" value={year} onChange={(e) => setYear(parseInt(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="APPROVED">Approved</option>
            <option value="PAID">Paid</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      {summary.total_payslips > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div className="card">
            <p className="text-xs text-gray-500 mb-1">Total Basic</p>
            <p className="text-lg font-bold text-gray-900">{fmt(summary.total_basic)}</p>
          </div>
          <div className="card">
            <p className="text-xs text-gray-500 mb-1">Allowances</p>
            <p className="text-lg font-bold text-green-700">{fmt(summary.total_allowances)}</p>
          </div>
          <div className="card">
            <p className="text-xs text-gray-500 mb-1">Deductions</p>
            <p className="text-lg font-bold text-red-600">{fmt(summary.total_deductions)}</p>
          </div>
          <div className="card">
            <p className="text-xs text-gray-500 mb-1">Net Payroll</p>
            <p className="text-lg font-bold text-gray-900">{fmt(summary.total_net)}</p>
          </div>
          <div className="card">
            <p className="text-xs text-gray-500 mb-1">Draft</p>
            <p className="text-lg font-bold text-yellow-700">{summary.draft_count || 0}</p>
          </div>
          <div className="card">
            <p className="text-xs text-gray-500 mb-1">Approved</p>
            <p className="text-lg font-bold text-blue-700">{summary.approved_count || 0}</p>
          </div>
          <div className="card">
            <p className="text-xs text-gray-500 mb-1">Paid</p>
            <p className="text-lg font-bold text-green-700">{summary.paid_count || 0}</p>
          </div>
          <div className="card">
            <p className="text-xs text-gray-500 mb-1">Total</p>
            <p className="text-lg font-bold text-gray-900">{summary.total_payslips || 0}</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : filteredPayslips.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">
          {allPayslips.length === 0
            ? 'No payslips for this period. Click "Generate Payslips" to create them from salary structures.'
            : 'No payslips match your filter.'}
        </div>
      ) : (
        <>
          {/* Mobile Cards */}
          <div className="sm:hidden space-y-3">
            {filteredPayslips.map((p) => (
              <div key={p.id} className="card">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-semibold text-gray-900">{p.staff_member_name}</p>
                    {p.staff_employee_id && <p className="text-xs text-gray-500">ID: {p.staff_employee_id}</p>}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[p.status]}`}>
                    {p.status_display}
                  </span>
                </div>
                <div className="text-sm text-gray-500 space-y-1">
                  <p>Basic: {fmt(p.basic_salary)} | Net: {fmt(p.net_salary)}</p>
                  {p.department_name && <p>Dept: {p.department_name}</p>}
                </div>
                <div className="flex justify-end gap-3 mt-3 pt-3 border-t border-gray-100">
                  <button onClick={() => setDetailSlip(p)} className="text-sm text-gray-600 hover:text-gray-800 font-medium">View</button>
                  {p.status === 'DRAFT' && (
                    <button onClick={() => approveMutation.mutate(p.id)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">Approve</button>
                  )}
                  {(p.status === 'DRAFT' || p.status === 'APPROVED') && (
                    <button onClick={() => markPaidMutation.mutate(p.id)} className="text-sm text-green-600 hover:text-green-800 font-medium">Mark Paid</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table */}
          <div className="hidden sm:block card overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="pb-3 pr-4">Staff Member</th>
                  <th className="pb-3 pr-4">Department</th>
                  <th className="pb-3 pr-4 text-right">Basic</th>
                  <th className="pb-3 pr-4 text-right">Allowances</th>
                  <th className="pb-3 pr-4 text-right">Deductions</th>
                  <th className="pb-3 pr-4 text-right">Net</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredPayslips.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="py-3 pr-4">
                      <p className="text-sm font-medium text-gray-900">{p.staff_member_name}</p>
                      {p.staff_employee_id && <p className="text-xs text-gray-500">{p.staff_employee_id}</p>}
                    </td>
                    <td className="py-3 pr-4 text-sm text-gray-600">{p.department_name || '—'}</td>
                    <td className="py-3 pr-4 text-sm text-gray-900 text-right">{fmt(p.basic_salary)}</td>
                    <td className="py-3 pr-4 text-sm text-green-700 text-right">{fmt(p.total_allowances)}</td>
                    <td className="py-3 pr-4 text-sm text-red-600 text-right">{fmt(p.total_deductions)}</td>
                    <td className="py-3 pr-4 text-sm text-gray-900 text-right font-semibold">{fmt(p.net_salary)}</td>
                    <td className="py-3 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[p.status]}`}>
                        {p.status_display}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button onClick={() => setDetailSlip(p)} className="text-sm text-gray-600 hover:text-gray-800 font-medium">View</button>
                        {p.status === 'DRAFT' && (
                          <button
                            onClick={() => approveMutation.mutate(p.id)}
                            disabled={approveMutation.isPending}
                            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Approve
                          </button>
                        )}
                        {(p.status === 'DRAFT' || p.status === 'APPROVED') && (
                          <button
                            onClick={() => markPaidMutation.mutate(p.id)}
                            disabled={markPaidMutation.isPending}
                            className="text-sm text-green-600 hover:text-green-800 font-medium"
                          >
                            Mark Paid
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Generate Confirmation Modal */}
      {generateConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Generate Payslips</h2>
            <p className="text-gray-600 mb-6">
              Generate payslips for <strong>{MONTHS[month - 1]} {year}</strong> from active salary structures?
              Existing payslips will be skipped.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setGenerateConfirm(false)} className="btn btn-secondary">Cancel</button>
              <button
                onClick={() => generateTask.trigger()}
                disabled={generateTask.isSubmitting}
                className="btn btn-primary"
              >
                {generateTask.isSubmitting ? 'Starting...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailSlip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">Payslip Details</h2>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[detailSlip.status]}`}>
                {detailSlip.status_display}
              </span>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Staff Member</span>
                <span className="font-medium">{detailSlip.staff_member_name}</span>
              </div>
              {detailSlip.staff_employee_id && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Employee ID</span>
                  <span>{detailSlip.staff_employee_id}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Period</span>
                <span>{MONTHS[detailSlip.month - 1]} {detailSlip.year}</span>
              </div>

              <div className="border-t pt-3 mt-3">
                <div className="flex justify-between mb-1">
                  <span className="text-gray-500">Basic Salary</span>
                  <span>{fmt(detailSlip.basic_salary)}</span>
                </div>

                {detailSlip.allowances_breakdown && Object.keys(detailSlip.allowances_breakdown).length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-gray-400 mb-1">Allowances:</p>
                    {Object.entries(detailSlip.allowances_breakdown).map(([k, v]) => (
                      <div key={k} className="flex justify-between ml-2 text-green-700">
                        <span>{k.replace(/_/g, ' ')}</span>
                        <span>+{fmt(v)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {detailSlip.deductions_breakdown && Object.keys(detailSlip.deductions_breakdown).length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-gray-400 mb-1">Deductions:</p>
                    {Object.entries(detailSlip.deductions_breakdown).map(([k, v]) => (
                      <div key={k} className="flex justify-between ml-2 text-red-600">
                        <span>{k.replace(/_/g, ' ')}</span>
                        <span>-{fmt(v)}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-between font-bold border-t pt-2 mt-2">
                  <span>Net Salary</span>
                  <span>{fmt(detailSlip.net_salary)}</span>
                </div>
              </div>

              {detailSlip.payment_date && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Payment Date</span>
                  <span>{detailSlip.payment_date}</span>
                </div>
              )}
              {detailSlip.generated_by_name && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Generated By</span>
                  <span>{detailSlip.generated_by_name}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end mt-6">
              <button onClick={() => setDetailSlip(null)} className="btn btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
