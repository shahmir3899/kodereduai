import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { financeApi, classesApi } from '../../services/api'
import { computeSummaryData } from './feeUtils'

/**
 * Read-only data hook for FeeOverviewPage.
 * No mutations — this page is purely for viewing fee status.
 */
export function useFeeOverview({ month, year, academicYearId }) {
  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses({ page_size: 9999 }),
    staleTime: 5 * 60_000,
  })

  const { data: payments, isLoading } = useQuery({
    queryKey: ['feePayments', month, year, 'MONTHLY', academicYearId],
    queryFn: () => financeApi.getFeePayments({
      month, year,
      fee_type: 'MONTHLY',
      ...(academicYearId && { academic_year: academicYearId }),
      page_size: 9999,
    }),
  })

  const allPayments = payments?.data?.results || payments?.data || []
  const classList = classes?.data?.results || classes?.data || []

  const summaryData = useMemo(
    () => computeSummaryData(allPayments, month, year),
    [allPayments, month, year]
  )

  return {
    allPayments,
    summaryData,
    classList,
    isLoading,
  }
}
