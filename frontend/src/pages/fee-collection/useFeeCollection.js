import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi, classesApi } from '../../services/api'
import { useBackgroundTask } from '../../hooks/useBackgroundTask'
import { computeSummaryData, filterPayments } from './feeUtils'

/**
 * Data hook for FeeCollectPage — payment collection workbench.
 * Handles fee payments queries + all payment-related mutations.
 */
export function useFeeCollection({ month, year, classFilter, statusFilter, feeTypeFilter, annualCategoryFilter, monthlyCategoryFilter, academicYearId }) {
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
    queryKey: ['feePayments', apiMonth, year, feeTypeFilter, annualCategoryFilter, monthlyCategoryFilter, academicYearId],
    queryFn: () => financeApi.getFeePayments({
      month: apiMonth, year,
      ...(feeTypeFilter && { fee_type: feeTypeFilter }),
      ...(annualCategoryFilter && { annual_category: annualCategoryFilter }),
      ...(monthlyCategoryFilter && { monthly_category: monthlyCategoryFilter }),
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

  // Annual categories for sub-filter
  const { data: annualCategoriesData } = useQuery({
    queryKey: ['annual-categories'],
    queryFn: () => financeApi.getAnnualCategories({}),
    staleTime: 5 * 60_000,
  })
  const annualCategories = annualCategoriesData?.data?.results || annualCategoriesData?.data || []

  // Monthly categories for sub-filter
  const { data: monthlyCategoriesData } = useQuery({
    queryKey: ['monthly-categories'],
    queryFn: () => financeApi.getMonthlyCategories({}),
    staleTime: 5 * 60_000,
  })
  const monthlyCategories = monthlyCategoriesData?.data?.results || monthlyCategoriesData?.data || []
  
  // Sort classes by grade_level, section, name to ensure correct ordering
  const sortedClassList = useMemo(() => {
    return [...classList].sort((a, b) => {
      if (a.grade_level !== b.grade_level) {
        return (a.grade_level || 0) - (b.grade_level || 0)
      }
      const sectionCompare = (a.section || '').localeCompare(b.section || '')
      if (sectionCompare !== 0) return sectionCompare
      return (a.name || '').localeCompare(b.name || '')
    })
  }, [classList])

  const filteredPayments = useMemo(() => {
    const filtered = filterPayments(allPayments, classFilter, statusFilter, sortedClassList)
    
    // Create mappings for sorting
    const classOrderMap = new Map()
    const classNameToOrderMap = new Map()
    
    sortedClassList.forEach((cls, index) => {
      classOrderMap.set(cls.id, index)
      classNameToOrderMap.set(cls.name, index)
    })
    
    return filtered.sort((a, b) => {
      // Try to get order by class_obj_id first, fallback to class_name
      let orderA = classOrderMap.get(a.class_obj_id)
      if (orderA === undefined && a.class_name) {
        orderA = classNameToOrderMap.get(a.class_name)
      }
      orderA = orderA ?? 999999
      
      let orderB = classOrderMap.get(b.class_obj_id)
      if (orderB === undefined && b.class_name) {
        orderB = classNameToOrderMap.get(b.class_name)
      }
      orderB = orderB ?? 999999
      
      if (orderA !== orderB) {
        return orderA - orderB
      }
      
      // Within same class, sort by roll_number (numeric), then name
      const rollA = parseInt(a.student_roll || a.roll_number) || 0
      const rollB = parseInt(b.student_roll || b.roll_number) || 0
      if (rollA !== rollB) {
        return rollA - rollB
      }
      
      const nameA = a.student_name || ''
      const nameB = b.student_name || ''
      return nameA.localeCompare(nameB)
    })
  }, [allPayments, classFilter, statusFilter, sortedClassList])

  const summaryData = useMemo(
    () => computeSummaryData(allPayments, apiMonth, year),
    [allPayments, apiMonth, year]
  )

  const filteredSummaryData = useMemo(() => {
    if (filteredPayments.length === 0) {
      return {
        month: apiMonth,
        year,
        total_students: 0,
        total_due: 0,
        total_collected: 0,
        total_pending: 0,
      }
    }

    const total_due = filteredPayments.reduce((sum, payment) => sum + Number(payment.amount_due || 0), 0)
    const total_collected = filteredPayments.reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0)
    
    // Balance should only count unpaid/partial entries
    const unpaidPartialPayments = filteredPayments.filter(p => p.status === 'UNPAID' || p.status === 'PARTIAL')
    const total_pending = unpaidPartialPayments.reduce((sum, payment) => {
      const due = Number(payment.amount_due || 0)
      const paid = Number(payment.amount_paid || 0)
      return sum + Math.max(0, due - paid)
    }, 0)

    return {
      month: apiMonth,
      year,
      total_students: filteredPayments.length,
      total_due,
      total_collected,
      total_pending,
    }
  }, [filteredPayments, apiMonth, year])

  return {
    // Data
    summaryData,
    filteredSummaryData,
    paymentList: filteredPayments,
    allPayments,
    isLoading,
    classList: sortedClassList,
    accountsList,
    annualCategories,
    monthlyCategories,
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
