import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi, classesApi } from '../../services/api'
import { useBackgroundTask } from '../../hooks/useBackgroundTask'
import { computeSummaryData, filterPayments } from './feeUtils'

/**
 * Data hook for FeeCollectPage — payment collection workbench.
 * Handles fee payments queries + all payment-related mutations.
 */
export function useFeeCollection({ month, year, classFilter, statusFilter, feeTypeFilter, academicYearId }) {
  const queryClient = useQueryClient()

  // Reference data
  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => financeApi.getAccounts({ page_size: 9999 }),
    staleTime: 5 * 60_000,
  })

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses({ page_size: 9999 }),
    staleTime: 5 * 60_000,
  })

  const isMonthlyType = !feeTypeFilter || feeTypeFilter === 'MONTHLY'
  const apiMonth = isMonthlyType ? month : 0

  const { data: payments, isLoading } = useQuery({
    queryKey: ['feePayments', apiMonth, year, feeTypeFilter, academicYearId],
    queryFn: () => financeApi.getFeePayments({
      month: apiMonth, year,
      ...(feeTypeFilter && { fee_type: feeTypeFilter }),
      ...(academicYearId && { academic_year: academicYearId }),
      page_size: 9999,
    }),
  })

  // Mutations
  const generateMutation = useBackgroundTask({
    mutationFn: (data) => financeApi.generateMonthly(data),
    taskType: 'FEE_GENERATION',
    title: `Generating fees for ${month}/${year}`,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feePayments'] })
      queryClient.invalidateQueries({ queryKey: ['generate-preview'] })
    },
  })

  const paymentMutation = useMutation({
    mutationFn: ({ id, data }) => financeApi.recordPayment(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feePayments'] }),
  })

  const deleteFeePaymentMutation = useMutation({
    mutationFn: (id) => financeApi.deleteFeePayment(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feePayments'] }),
  })

  const bulkUpdateMutation = useMutation({
    mutationFn: (data) => financeApi.bulkUpdatePayments(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feePayments'] }),
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: (data) => financeApi.bulkDeletePayments(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feePayments'] }),
  })

  const generateOnetimeMutation = useMutation({
    mutationFn: (data) => financeApi.generateOnetimeFees(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feePayments'] })
      queryClient.invalidateQueries({ queryKey: ['generate-preview'] })
    },
  })

  const createFeePaymentMutation = useMutation({
    mutationFn: (data) => financeApi.createPayment(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feePayments'] }),
  })

  // Derived data
  const allPayments = payments?.data?.results || payments?.data || []
  const classList = classes?.data?.results || classes?.data || []
  const accountsList = accountsData?.data?.results || accountsData?.data || []

  const filteredPayments = useMemo(
    () => filterPayments(allPayments, classFilter, statusFilter, classList),
    [allPayments, classFilter, statusFilter, classList]
  )

  const summaryData = useMemo(
    () => computeSummaryData(allPayments, apiMonth, year),
    [allPayments, apiMonth, year]
  )

  return {
    // Data
    summaryData,
    paymentList: filteredPayments,
    allPayments,
    isLoading,
    classList,
    accountsList,
    // Mutations
    generateMutation,
    paymentMutation,
    deleteFeePaymentMutation,
    bulkUpdateMutation,
    bulkDeleteMutation,
    generateOnetimeMutation,
    createFeePaymentMutation,
  }
}
