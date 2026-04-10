import { useQuery } from '@tanstack/react-query'
import { financeApi } from '../../services/api'

/**
 * Read-only data hook for FeeOverviewPage.
 * No mutations — this page is purely for viewing fee status.
 *
 * Summary data (stat cards + by_class ordering) now comes from the
 * canonical backend endpoint so that ordering is consistent with
 * FeeCollectPage and any future consumer.
 */
export function useFeeOverview({ month, year, feeType = 'MONTHLY', academicYearId }) {
  const isMonthly = feeType === 'MONTHLY'

  // Canonical backend summary — single source of truth for stat cards
  const { data: summaryRes, isLoading: summaryLoading } = useQuery({
    queryKey: ['feeSummary', isMonthly ? month : 0, year, feeType, academicYearId],
    queryFn: () => financeApi.getFeeSummary({
      ...(isMonthly ? { month } : { month: 0 }),
      year,
      fee_type: feeType,
      ...(academicYearId && { academic_year: academicYearId }),
    }),
    staleTime: 30_000,
  })

  // Individual payments — still needed for ClassBreakdown expansion rows
  // and PendingStudents drill-down
  const { data: payments, isLoading: paymentsLoading } = useQuery({
    queryKey: isMonthly
      ? ['feePayments', month, year, feeType, academicYearId]
      : ['feePayments', year, feeType, academicYearId],
    queryFn: () => financeApi.getFeePayments({
      ...(isMonthly ? { month } : { month: 0 }),
      year,
      fee_type: feeType,
      ...(academicYearId && { academic_year: academicYearId }),
      page_size: 9999,
    }),
  })

  const allPayments = payments?.data?.results || payments?.data || []
  const summaryData = summaryRes?.data || null

  return {
    allPayments,
    summaryData,
    isLoading: summaryLoading || paymentsLoading,
  }
}
