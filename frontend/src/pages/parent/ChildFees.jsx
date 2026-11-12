import { useState } from 'react'
import Modal from '../../components/ui/Modal'
import KuickpayBillCard from '../../components/KuickpayBillCard'
import PageHeader from '../../components/ui/PageHeader'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { parentsApi } from '../../services/api'
import Spinner from '../../components/ui/Spinner'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import FeeLedger from '../../components/fees/FeeLedger'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { feeLabel, feeTotals, groupByBranch } from '../../utils/portalFees'

export default function ChildFees() {
  const { studentId } = useParams()
  const navigate = useNavigate()
  const { activeAcademicYear, loading: yearLoading } = useAcademicYear()
  const [payingFeeId, setPayingFeeId] = useState(null)
  const [selectedGateway, setSelectedGateway] = useState('')
  const [showPayModal, setShowPayModal] = useState(false)

  useEscapeKey(() => setShowPayModal(false), showPayModal)

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

  // Every year's and every branch's rows come back as one plain list; FeeLedger applies the
  // academic year to the current branch and gives each earlier branch its own tab.
  const { data: feesData, isLoading } = useQuery({
    queryKey: ['childFees', studentId],
    queryFn: () => parentsApi.getChildFees(studentId),
    enabled: !!studentId,
  })

  // Not blocking: the fees list renders without it, and a school without Kuickpay returns enabled:false.
  const { data: kuickpayData } = useQuery({
    queryKey: ['childKuickpayBill', studentId],
    queryFn: () => parentsApi.getChildKuickpayBill(studentId),
    enabled: !!studentId,
  })

  const rows = Array.isArray(feesData?.data) ? feesData.data : []
  // What is owed at the current branch this year (monthly running balance + yearly fees); drives
  // the pay banner below. Earlier branches are history and never payable here.
  const payments = groupByBranch(rows, activeAcademicYear?.id)[0].rows
  const outstanding = feeTotals(payments.filter((p) => p.fee_type === 'MONTHLY'), 'MONTHLY').balance
    + feeTotals(payments.filter((p) => p.fee_type !== 'MONTHLY'), 'ANNUAL').balance

  if (isLoading || yearLoading) {
    return (
      <div className="space-y-6">
        <Link to={`/parent/children/${studentId}`} className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Overview
        </Link>
        <div className="flex items-center justify-center py-20">
          <Spinner size="md" />
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
      <PageHeader title="Fee Details" subtitle={`Payment history and balance · ${activeAcademicYear?.name || ''}`} />

      <KuickpayBillCard summary={kuickpayData?.data} />

      <FeeLedger rows={rows} activeYear={activeAcademicYear} viewKey="child-fees" />

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
                      {feeLabel(p)}
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
        <Modal open  size="sm" closeOnBackdrop={false}>
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
          </Modal>
      )}
    </div>
  )
}
