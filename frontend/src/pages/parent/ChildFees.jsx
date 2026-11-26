import KuickpayBillCard from '../../components/KuickpayBillCard'
import PageHeader from '../../components/ui/PageHeader'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { parentsApi } from '../../services/api'
import Spinner from '../../components/ui/Spinner'
import FeeLedger from '../../components/fees/FeeLedger'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { feeTotals, groupByBranch } from '../../utils/portalFees'

export default function ChildFees() {
  const { studentId } = useParams()
  const { activeAcademicYear, loading: yearLoading } = useAcademicYear()

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
              {kuickpayData?.data?.enabled
                ? 'Pay with the Kuickpay bill above, or at the school office.'
                : 'Please pay at the school office.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
