import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { classesApi, financeApi, sessionsApi } from '../../services/api'
import { computeSummaryData } from './feeUtils'

/**
 * Read-only data hook for FeeOverviewPage.
 * No mutations — this page is purely for viewing fee status.
 */
export function useFeeOverview({ month, year, feeType = 'MONTHLY', academicYearId }) {
  const isMonthly = feeType === 'MONTHLY'

  const { data: classesData } = useQuery({
    queryKey: ['classes-ordering'],
    queryFn: () => classesApi.getClasses({ is_active: true, page_size: 9999 }),
    staleTime: 5 * 60_000,
  })

  const { data: sessionClassesData } = useQuery({
    queryKey: ['session-classes-ordering', academicYearId],
    queryFn: () => sessionsApi.getSessionClasses({
      academic_year: academicYearId,
      is_active: true,
      page_size: 9999,
    }),
    enabled: !!academicYearId,
    staleTime: 5 * 60_000,
  })

  const { data: payments, isLoading } = useQuery({
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
  const classes = classesData?.data?.results || classesData?.data || []
  const sessionClasses = sessionClassesData?.data?.results || sessionClassesData?.data || []

  const summaryData = useMemo(
    () => computeSummaryData(allPayments, month, year, { classes, sessionClasses }),
    [allPayments, month, year, classes, sessionClasses]
  )

  return {
    allPayments,
    summaryData,
    isLoading,
  }
}
