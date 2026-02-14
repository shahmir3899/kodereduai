import { useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { paymentApi } from '../../services/api'

const STATUS_CONFIG = {
  SUCCESS: {
    icon: (
      <svg className="w-16 h-16 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: 'Payment Successful',
    description: 'Your payment has been processed successfully.',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
  },
  INITIATED: {
    icon: (
      <svg className="w-16 h-16 text-blue-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: 'Payment Initiated',
    description: 'Your payment is being processed. You will be redirected to the payment gateway.',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
  PENDING: {
    icon: (
      <svg className="w-16 h-16 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: 'Payment Pending',
    description: 'Your payment is being verified. This may take a few minutes.',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
  },
  FAILED: {
    icon: (
      <svg className="w-16 h-16 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: 'Payment Failed',
    description: 'Your payment could not be processed. Please try again.',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
  },
  MANUAL: {
    icon: (
      <svg className="w-16 h-16 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
    title: 'Manual Payment Recorded',
    description: 'Your payment request has been recorded. Please complete the bank transfer and inform the school office.',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
}

export default function PaymentResultPage() {
  const [searchParams] = useSearchParams()
  const orderId = searchParams.get('order_id')
  const initialStatus = searchParams.get('status') || 'PENDING'

  // Poll for status updates if payment was initiated
  const { data: statusData } = useQuery({
    queryKey: ['paymentStatus', orderId],
    queryFn: () => paymentApi.getPaymentStatus(orderId),
    enabled: !!orderId && initialStatus !== 'MANUAL',
    refetchInterval: (query) => {
      const status = query.state?.data?.data?.status
      return status === 'INITIATED' || status === 'PENDING' ? 5000 : false
    },
  })

  const liveStatus = statusData?.data?.status || initialStatus
  const paymentDetails = statusData?.data || {}
  const config = STATUS_CONFIG[liveStatus] || STATUS_CONFIG.PENDING

  return (
    <div className="max-w-lg mx-auto space-y-6 py-8">
      <Link to="/parent" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Dashboard
      </Link>

      <div className={`${config.bgColor} ${config.borderColor} border rounded-xl p-8 text-center`}>
        <div className="flex justify-center mb-4">{config.icon}</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{config.title}</h1>
        <p className="text-sm text-gray-600 mb-4">{config.description}</p>

        {orderId && (
          <p className="text-xs text-gray-500 font-mono">Order ID: {orderId}</p>
        )}
      </div>

      {/* Payment Details */}
      {paymentDetails.amount && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Payment Details</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Amount</span>
              <p className="font-medium text-gray-900">{paymentDetails.currency} {Number(paymentDetails.amount).toLocaleString()}</p>
            </div>
            <div>
              <span className="text-gray-500">Gateway</span>
              <p className="font-medium text-gray-900">{paymentDetails.gateway}</p>
            </div>
            <div>
              <span className="text-gray-500">Student</span>
              <p className="font-medium text-gray-900">{paymentDetails.student_name}</p>
            </div>
            <div>
              <span className="text-gray-500">Fee Period</span>
              <p className="font-medium text-gray-900">{paymentDetails.fee_month}/{paymentDetails.fee_year}</p>
            </div>
            {paymentDetails.completed_at && (
              <div className="col-span-2">
                <span className="text-gray-500">Completed</span>
                <p className="font-medium text-gray-900">{new Date(paymentDetails.completed_at).toLocaleString()}</p>
              </div>
            )}
            {paymentDetails.failure_reason && (
              <div className="col-span-2">
                <span className="text-gray-500">Reason</span>
                <p className="font-medium text-red-600">{paymentDetails.failure_reason}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="text-center">
        <Link to="/parent" className="btn btn-primary">
          Return to Dashboard
        </Link>
      </div>
    </div>
  )
}
