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

  const isAllTypes = !feeTypeFilter
  const isMonthlyType = feeTypeFilter === 'MONTHLY'
  const isAnnualType = feeTypeFilter === 'ANNUAL'

  // Single query when a specific fee type is selected
  const { data: payments, isLoading: singleLoading } = useQuery({
    queryKey: ['feePayments', feeTypeFilter, isMonthlyType ? month : 0, year, annualCategoryFilter, monthlyCategoryFilter, academicYearId],
    queryFn: () => financeApi.getFeePayments({
      month: isMonthlyType ? month : 0, year,
      fee_type: feeTypeFilter,
      ...(annualCategoryFilter && { annual_category: annualCategoryFilter }),
      ...(monthlyCategoryFilter && { monthly_category: monthlyCategoryFilter }),
      ...(academicYearId && { academic_year: academicYearId }),
      page_size: 9999,
    }),
    enabled: !isAllTypes,
  })

  // "All Types" mode: two parallel queries — monthly (month=N) + annual (month=0)
  const { data: monthlyPayments, isLoading: monthlyLoading } = useQuery({
    queryKey: ['feePayments', 'MONTHLY', month, year, monthlyCategoryFilter, academicYearId],
    queryFn: () => financeApi.getFeePayments({
      month, year, fee_type: 'MONTHLY',
      ...(monthlyCategoryFilter && { monthly_category: monthlyCategoryFilter }),
      ...(academicYearId && { academic_year: academicYearId }),
      page_size: 9999,
    }),
    enabled: isAllTypes,
  })

  const { data: annualPayments, isLoading: annualLoading } = useQuery({
    queryKey: ['feePayments', 'ANNUAL', 0, year, annualCategoryFilter, academicYearId],
    queryFn: () => financeApi.getFeePayments({
      month: 0, year, fee_type: 'ANNUAL',
      ...(annualCategoryFilter && { annual_category: annualCategoryFilter }),
      ...(academicYearId && { academic_year: academicYearId }),
      page_size: 9999,
    }),
    enabled: isAllTypes,
  })

  const isLoading = isAllTypes ? (monthlyLoading || annualLoading) : singleLoading

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

  // Derived data — merge from dual queries in "All Types" mode
  const allPayments = useMemo(() => {
    if (isAllTypes) {
      const monthly = monthlyPayments?.data?.results || monthlyPayments?.data || []
      const annual = annualPayments?.data?.results || annualPayments?.data || []
      return [...monthly, ...annual]
    }
    return payments?.data?.results || payments?.data || []
  }, [isAllTypes, monthlyPayments, annualPayments, payments])
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
      
      // Within same class, sort by roll_number (numeric), then student ID (group same student), then fee_type
      const rollA = parseInt(a.student_roll || a.roll_number) || 0
      const rollB = parseInt(b.student_roll || b.roll_number) || 0
      if (rollA !== rollB) {
        return rollA - rollB
      }
      
      // Group same student's records together
      const studentA = a.student || a.student_id || 0
      const studentB = b.student || b.student_id || 0
      if (studentA !== studentB) {
        const nameA = a.student_name || ''
        const nameB = b.student_name || ''
        return nameA.localeCompare(nameB)
      }

      // Within same student: MONTHLY first, then ANNUAL, then others
      const typeOrder = { MONTHLY: 0, ANNUAL: 1, ADMISSION: 2, BOOKS: 3, FINE: 4 }
      return (typeOrder[a.fee_type] ?? 9) - (typeOrder[b.fee_type] ?? 9)
    })
  }, [allPayments, classFilter, statusFilter, sortedClassList])

  const summaryData = useMemo(
    () => computeSummaryData(allPayments, month, year),
    [allPayments, month, year]
  )

  const filteredSummaryData = useMemo(() => {
    if (filteredPayments.length === 0) {
      return {
        month,
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

    // Count unique students, not records
    const uniqueStudents = new Set(filteredPayments.map(p => p.student || p.student_id))

    return {
      month,
      year,
      total_students: uniqueStudents.size,
      total_due,
      total_collected,
      total_pending,
    }
  }, [filteredPayments, month, year])

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
