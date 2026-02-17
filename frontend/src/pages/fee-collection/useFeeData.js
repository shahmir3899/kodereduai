import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi, classesApi } from '../../services/api'
import { useBackgroundTask } from '../../hooks/useBackgroundTask'

export function useFeeData({ month, year, classFilter, statusFilter, academicYearId }) {
  const queryClient = useQueryClient()

  // Bulk fee structure state
  const [bulkFees, setBulkFees] = useState({})
  const [bulkEffectiveFrom, setBulkEffectiveFrom] = useState(new Date().toISOString().split('T')[0])

  // Queries
  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => financeApi.getAccounts({ page_size: 9999 }),
  })

  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses({ page_size: 9999 }),
  })

  const { data: feeStructures } = useQuery({
    queryKey: ['feeStructures', academicYearId],
    queryFn: () => financeApi.getFeeStructures({
      page_size: 9999,
      ...(academicYearId && { academic_year: academicYearId }),
    }),
  })

  const { data: payments, isLoading } = useQuery({
    queryKey: ['feePayments', month, year, classFilter, statusFilter, academicYearId],
    queryFn: () => financeApi.getFeePayments({
      month, year,
      ...(classFilter && { class_id: classFilter }),
      ...(statusFilter && { status: statusFilter }),
      ...(academicYearId && { academic_year: academicYearId }),
      page_size: 9999,
    }),
  })

  const { data: summary } = useQuery({
    queryKey: ['monthlySummary', month, year, academicYearId],
    queryFn: () => financeApi.getMonthlySummary({
      month, year,
      ...(academicYearId && { academic_year: academicYearId }),
    }),
  })

  const { data: otherIncomeData, isLoading: incomeLoading } = useQuery({
    queryKey: ['otherIncome', month, year],
    queryFn: () => {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`
      const endDate = new Date(year, month, 0).toISOString().split('T')[0]
      return financeApi.getOtherIncome({ date_from: startDate, date_to: endDate, page_size: 9999 })
    },
  })

  // Pre-fill bulk fee form when structures load
  useEffect(() => {
    if (feeStructures?.data && classes?.data) {
      const structList = feeStructures.data?.results || feeStructures.data || []
      const existing = {}
      structList.forEach(fs => {
        if (fs.class_obj && !fs.student && fs.is_active) {
          existing[fs.class_obj] = String(fs.monthly_amount)
        }
      })
      setBulkFees(existing)
    }
  }, [feeStructures, classes])

  // Generate monthly fees (background task)
  const generateMutation = useBackgroundTask({
    mutationFn: (data) => financeApi.generateMonthly(data),
    taskType: 'FEE_GENERATION',
    title: `Generating fees for ${month}/${year}`,
  })

  const paymentMutation = useMutation({
    mutationFn: ({ id, data }) => financeApi.recordPayment(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feePayments'] })
      queryClient.invalidateQueries({ queryKey: ['monthlySummary'] })
    },
  })

  const bulkFeeMutation = useMutation({
    mutationFn: (data) => financeApi.bulkSetFeeStructures(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeStructures'] })
    },
  })

  const incomeMutation = useMutation({
    mutationFn: (data) => financeApi.createOtherIncome(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['otherIncome'] })
    },
  })

  const deleteIncomeMutation = useMutation({
    mutationFn: (id) => financeApi.deleteOtherIncome(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['otherIncome'] })
    },
  })

  const studentFeeMutation = useMutation({
    mutationFn: (data) => financeApi.createFeeStructure(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeStructures'] })
    },
  })

  // New mutations
  const deleteFeePaymentMutation = useMutation({
    mutationFn: (id) => financeApi.deleteFeePayment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feePayments'] })
      queryClient.invalidateQueries({ queryKey: ['monthlySummary'] })
    },
  })

  const bulkUpdateMutation = useMutation({
    mutationFn: (data) => financeApi.bulkUpdatePayments(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feePayments'] })
      queryClient.invalidateQueries({ queryKey: ['monthlySummary'] })
    },
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: (data) => financeApi.bulkDeletePayments(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feePayments'] })
      queryClient.invalidateQueries({ queryKey: ['monthlySummary'] })
    },
  })

  // Derived data
  const summaryData = summary?.data
  const paymentList = payments?.data?.results || payments?.data || []
  const classList = classes?.data?.results || classes?.data || []
  const incomeList = otherIncomeData?.data?.results || otherIncomeData?.data || []
  const accountsList = accountsData?.data?.results || accountsData?.data || []

  return {
    // Queries
    summaryData,
    paymentList,
    isLoading,
    classList,
    incomeList,
    incomeLoading,
    accountsList,
    // Bulk fee structure
    bulkFees,
    setBulkFees,
    bulkEffectiveFrom,
    setBulkEffectiveFrom,
    // Existing mutations
    generateMutation,
    paymentMutation,
    bulkFeeMutation,
    incomeMutation,
    deleteIncomeMutation,
    studentFeeMutation,
    // New mutations
    deleteFeePaymentMutation,
    bulkUpdateMutation,
    bulkDeleteMutation,
  }
}
