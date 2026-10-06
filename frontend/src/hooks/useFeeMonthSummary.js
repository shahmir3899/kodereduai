import { useQuery } from '@tanstack/react-query'
import { financeApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useAcademicYear } from '../contexts/AcademicYearContext'
import {
  ANNUAL_FEE_PARAMS, MONTHLY_FEE_PARAMS, feeMonthSummaryKey, normalizeFeeMonthResponse,
} from '../utils/feeMonthSummary'

// The one source for dashboard fee-collection numbers: the current month's
// MONTHLY fees, or this year's ANNUAL fees. Admins with several schools get
// every school plus a combined total; everyone else gets their active school.
function useFeeCollectionSummary({ enabled = true, feeType = 'MONTHLY' } = {}) {
  const { user, isStaffMember } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const isMulti = !isStaffMember && (user?.schools?.length > 1 || !!user?.is_super_admin)

  const now = new Date()
  const isAnnual = feeType === 'ANNUAL'
  const month = isAnnual ? 0 : now.getMonth() + 1
  const year = now.getFullYear()
  const academicYearId = activeAcademicYear?.id
  const feeParams = isAnnual ? ANNUAL_FEE_PARAMS : MONTHLY_FEE_PARAMS

  const query = useQuery({
    queryKey: feeMonthSummaryKey(isMulti ? 'all' : 'single', month, year, academicYearId, feeType),
    queryFn: () => (isMulti
      ? financeApi.getMonthlySummaryAll({ month, year, ...feeParams })
      : financeApi.getMonthlySummary({ month, year, ...feeParams, ...(academicYearId && { academic_year: academicYearId }) })),
    select: (res) => normalizeFeeMonthResponse(res?.data, isMulti),
    enabled,
  })

  return { summary: query.data ?? null, isLoading: query.isLoading, isMulti, month, year }
}

export const useFeeMonthSummary = (options) => useFeeCollectionSummary({ ...options, feeType: 'MONTHLY' })
export const useAnnualFeeSummary = (options) => useFeeCollectionSummary({ ...options, feeType: 'ANNUAL' })
