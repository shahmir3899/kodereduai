import { useQuery } from '@tanstack/react-query'
import PageHeader from '../../components/ui/PageHeader'
import Spinner from '../../components/ui/Spinner'
import FeeLedger from '../../components/fees/FeeLedger'
import { studentPortalApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'

export default function StudentFees() {
  const { activeAcademicYear, loading: yearLoading } = useAcademicYear()

  // The endpoint returns every year's rows (and every branch's) as a plain list that parents and
  // mobile share, so the academic year is applied in FeeLedger. Keyed by year so a switch refetches.
  const { data: feesData, isLoading, error } = useQuery({
    queryKey: ['studentFees', activeAcademicYear?.id],
    queryFn: () => studentPortalApi.getFees(),
    enabled: !!activeAcademicYear,
  })

  if (isLoading || yearLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="md" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <h3 className="text-base font-medium text-red-900 mb-1">Failed to load fee details</h3>
        <p className="text-sm text-red-600">{error.message || 'Please try again later.'}</p>
      </div>
    )
  }

  const rows = Array.isArray(feesData?.data) ? feesData.data : []

  return (
    <div className="space-y-6">
      <PageHeader title="My Fees" subtitle={`Payment history and balance · ${activeAcademicYear?.name || ''}`} />
      <FeeLedger rows={rows} activeYear={activeAcademicYear} viewKey="student-fees" />
    </div>
  )
}
