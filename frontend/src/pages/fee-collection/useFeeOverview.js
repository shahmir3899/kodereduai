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
export function useFeeOverview({
  month,
  year,
  feeType = 'MONTHLY',
  academicYearId,
  annualCategoryId,
  monthlyCategoryId,
}) {
  const isMonthly = feeType === 'MONTHLY'

  // Canonical backend summary — single source of truth for stat cards
  const { data: summaryRes, isLoading: summaryLoading } = useQuery({
    queryKey: ['feeSummary', isMonthly ? month : 0, year, feeType, academicYearId, annualCategoryId, monthlyCategoryId],
    queryFn: () => financeApi.getFeeSummary({
      ...(isMonthly ? { month } : { month: 0 }),
      year,
      fee_type: feeType,
      ...(annualCategoryId && { annual_category: annualCategoryId }),
      ...(monthlyCategoryId && { monthly_category: monthlyCategoryId }),
      ...(academicYearId && { academic_year: academicYearId }),
    }),
    staleTime: 30_000,
  })

  // Individual payments — still needed for ClassBreakdown expansion rows
  // and PendingStudents drill-down
  const { data: payments, isLoading: paymentsLoading } = useQuery({
    queryKey: isMonthly
      ? ['feePayments', month, year, feeType, academicYearId, monthlyCategoryId]
      : ['feePayments', year, feeType, academicYearId, annualCategoryId],
    queryFn: () => financeApi.getFeePayments({
      ...(isMonthly ? { month } : { month: 0 }),
      year,
      fee_type: feeType,
      ...(annualCategoryId && { annual_category: annualCategoryId }),
      ...(monthlyCategoryId && { monthly_category: monthlyCategoryId }),
      ...(academicYearId && { academic_year: academicYearId }),
      page_size: 9999,
    }),
  })

  const { data: annualCategoriesData } = useQuery({
    queryKey: ['annual-categories'],
    queryFn: () => financeApi.getAnnualCategories({ page_size: 9999 }),
    staleTime: 5 * 60_000,
  })

  const { data: monthlyCategoriesData } = useQuery({
    queryKey: ['monthly-categories'],
    queryFn: () => financeApi.getMonthlyCategories({ page_size: 9999 }),
    staleTime: 5 * 60_000,
  })

  const allPayments = payments?.data?.results || payments?.data || []
  const summaryData = summaryRes?.data || null
  const annualCategories = annualCategoriesData?.data?.results || annualCategoriesData?.data || []
  const monthlyCategories = monthlyCategoriesData?.data?.results || monthlyCategoriesData?.data || []

  return {
    allPayments,
    summaryData,
    annualCategories,
    monthlyCategories,
    isLoading: summaryLoading || paymentsLoading,
  }
}
