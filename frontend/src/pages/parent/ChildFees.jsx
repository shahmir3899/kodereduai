import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { parentsApi } from '../../services/api'

const STATUS_COLORS = {
  PAID: 'bg-green-100 text-green-800',
  PARTIAL: 'bg-yellow-100 text-yellow-800',
  UNPAID: 'bg-red-100 text-red-800',
  PENDING: 'bg-red-100 text-red-800',
  ADVANCE: 'bg-blue-100 text-blue-800',
  OVERDUE: 'bg-red-100 text-red-800',
}

export default function ChildFees() {
  const { studentId } = useParams()
  const navigate = useNavigate()
  const currentYear = new Date().getFullYear()
  const [filterYear, setFilterYear] = useState(currentYear)
  const [payingFeeId, setPayingFeeId] = useState(null)
  const [selectedGateway, setSelectedGateway] = useState('')
  const [showPayModal, setShowPayModal] = useState(false)

  // Fetch available gateways for this child's school
  const { data: gatewayData } = useQuery({
    queryKey: ['parentGateways', studentId],
    queryFn: () => parentsApi.getPaymentGateways(studentId),
    enabled: !!studentId,
  })
  const gateways = gatewayData?.data?.gateways || []

  const payMutation = useMutation({
    mutationFn: (data) => parentsApi.initiatePayment(studentId, data),
    onSuccess: (res) => {
      const data = res.data
      setShowPayModal(false)
      if (data.redirect_url) {
        // For gateway payments — redirect or navigate to result page
        navigate(`/parent/payment-result?order_id=${data.order_id}&status=INITIATED`)
      } else {
        // Manual payment
        navigate(`/parent/payment-result?order_id=${data.order_id}&status=MANUAL`)
      }
    },
    onError: () => {
      setShowPayModal(false)
    },
  })

  const openPayModal = (feeId) => {
    setPayingFeeId(feeId)
    const defaultGw = gateways.find(g => g.is_default)
    setSelectedGateway(defaultGw?.gateway || gateways[0]?.gateway || '')
    setShowPayModal(true)
  }

  const handlePay = () => {
    if (!selectedGateway || !payingFeeId) return
    payMutation.mutate({
      fee_payment_id: payingFeeId,
      gateway: selectedGateway,
      return_url: `${window.location.origin}/parent/payment-result`,
    })
  }

  const { data: feesData, isLoading } = useQuery({
    queryKey: ['childFees', studentId, filterYear],
    queryFn: () => parentsApi.getChildFees(studentId, { year: filterYear }),
    enabled: !!studentId,
  })

  const fees = feesData?.data
  const payments = fees?.payments || fees?.records || (Array.isArray(fees) ? fees : [])
  const summary = fees?.summary || {}

  const totalDue = summary.total_due ?? payments.reduce((sum, p) => sum + parseFloat(p.amount_due || 0), 0)
  const totalPaid = summary.total_paid ?? payments.reduce((sum, p) => sum + parseFloat(p.amount_paid || 0), 0)
  const outstanding = summary.outstanding ?? (totalDue - totalPaid)

  // Year options for filter
  const yearOptions = []
  for (let y = currentYear; y >= currentYear - 3; y--) {
    yearOptions.push(y)
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Link to={`/parent/children/${studentId}`} className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Overview
        </Link>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link to={`/parent/children/${studentId}`} className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Overview
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Fee Details</h1>
          <p className="text-sm text-gray-500 mt-1">Payment history and outstanding balance</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={filterYear}
            onChange={(e) => setFilterYear(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
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

      {/* Progress Bar */}
      {totalDue > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Payment Progress</span>
            <span className="text-sm font-medium text-gray-900">
              {Math.round((totalPaid / totalDue) * 100)}%
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${
                totalPaid >= totalDue ? 'bg-green-500' :
                totalPaid >= totalDue * 0.5 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${Math.min(100, Math.round((totalPaid / totalDue) * 100))}%` }}
            />
          </div>
        </div>
      )}

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
          {/* Mobile Card View */}
          <div className="sm:hidden space-y-3">
            {payments.map((payment, idx) => (
              <div key={payment.id || idx} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900">
                    {payment.month_name || payment.fee_type_name || `${payment.month}/${payment.year}`}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[payment.status] || 'bg-gray-100 text-gray-800'}`}>
                    {payment.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-gray-500">Due:</span>{' '}
                    <span className="font-medium text-gray-900">PKR {parseFloat(payment.amount_due || 0).toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Paid:</span>{' '}
                    <span className="font-medium text-green-700">PKR {parseFloat(payment.amount_paid || 0).toLocaleString()}</span>
                  </div>
                </div>
                {payment.payment_date && (
                  <p className="text-xs text-gray-400 mt-2">
                    Paid on: {new Date(payment.payment_date).toLocaleDateString()}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Desktop Table View */}
          <div className="hidden sm:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Month / Type</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount Due</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount Paid</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payment Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {payments.map((payment, idx) => (
                    <tr key={payment.id || idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {payment.month_name || payment.fee_type_name || `${payment.month}/${payment.year}`}
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Pay Now Banner */}
      {outstanding > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5 sm:mt-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">
              You have an outstanding balance of PKR {Number(outstanding).toLocaleString()}
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              {gateways.length > 0
                ? 'Select an unpaid fee below and click "Pay" to pay online.'
                : 'Online payment is not yet configured for this school. Contact the school office.'}
            </p>
          </div>
        </div>
      )}

      {/* Per-fee Pay buttons — show for unpaid/partial fees with available gateways */}
      {gateways.length > 0 && payments.some(p => p.status !== 'PAID') && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Pay Outstanding Fees</h3>
          <div className="space-y-2">
            {payments.filter(p => parseFloat(p.amount_due || 0) - parseFloat(p.amount_paid || 0) > 0).map((p, idx) => {
              const due = parseFloat(p.amount_due || 0) - parseFloat(p.amount_paid || 0)
              return (
                <div key={p.id || idx} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                  <div>
                    <span className="text-sm font-medium text-gray-900">
                      {p.month_name || p.fee_type_name || `${p.month}/${p.year}`}
                    </span>
                    <span className="text-sm text-gray-500 ml-2">— PKR {due.toLocaleString()} due</span>
                  </div>
                  <button
                    onClick={() => openPayModal(p.id)}
                    className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
                  >
                    Pay Now
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Pay Modal */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Choose Payment Method</h2>
            <div className="space-y-2 mb-4">
              {gateways.map((gw) => (
                <label key={gw.gateway} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedGateway === gw.gateway ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'
                }`}>
                  <input
                    type="radio"
                    name="gateway"
                    value={gw.gateway}
                    checked={selectedGateway === gw.gateway}
                    onChange={(e) => setSelectedGateway(e.target.value)}
                    className="text-primary-600"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-900">{gw.gateway}</span>
                    {gw.is_default && <span className="ml-1 text-xs text-yellow-600">(Default)</span>}
                  </div>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowPayModal(false)} className="btn btn-secondary text-sm">Cancel</button>
              <button
                onClick={handlePay}
                disabled={payMutation.isPending || !selectedGateway}
                className="btn btn-primary text-sm"
              >
                {payMutation.isPending ? 'Processing...' : 'Proceed to Pay'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
