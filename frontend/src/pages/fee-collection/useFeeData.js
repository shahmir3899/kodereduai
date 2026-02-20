import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi, classesApi } from '../../services/api'
import { useBackgroundTask } from '../../hooks/useBackgroundTask'

export function useFeeData({ month, year, classFilter, statusFilter, feeTypeFilter, academicYearId, feeStructureModalOpen }) {
  const queryClient = useQueryClient()

  // Bulk fee structure state
  const [bulkFees, setBulkFees] = useState({})
  const [bulkEffectiveFrom, setBulkEffectiveFrom] = useState(new Date().toISOString().split('T')[0])

  // Queries — reference data with longer staleTime (rarely changes mid-session)
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

  const { data: feeStructures } = useQuery({
    queryKey: ['feeStructures', academicYearId, feeTypeFilter],
    queryFn: () => financeApi.getFeeStructures({
      page_size: 9999,
      ...(academicYearId && { academic_year: academicYearId }),
      ...(feeTypeFilter && { fee_type: feeTypeFilter }),
    }),
    enabled: !!feeStructureModalOpen,
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
  }, [feeStructures, classes, feeTypeFilter])

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
    },
  })

  const bulkUpdateMutation = useMutation({
    mutationFn: (data) => financeApi.bulkUpdatePayments(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feePayments'] })
    },
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: (data) => financeApi.bulkDeletePayments(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feePayments'] })
    },
  })

  const generateOnetimeMutation = useMutation({
    mutationFn: (data) => financeApi.generateOnetimeFees(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feePayments'] })
    },
  })

  const createFeePaymentMutation = useMutation({
    mutationFn: (data) => financeApi.createPayment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feePayments'] })
    },
  })

  // All payments for the period (unfiltered)
  const allPayments = payments?.data?.results || payments?.data || []

  const classList = classes?.data?.results || classes?.data || []

  // Client-side filtering by class and status (instant, no API call)
  const filteredPayments = useMemo(() => {
    let list = allPayments
    if (classFilter) {
      const cid = Number(classFilter)
      // Match by class_obj_id (preferred), fall back to class name
      const selectedClass = classList.find(c => c.id === cid)
      list = list.filter(p => {
        if (p.class_obj_id != null) return p.class_obj_id === cid
        return selectedClass && p.class_name === selectedClass.name
      })
    }
    if (statusFilter) {
      list = list.filter(p => p.status === statusFilter)
    }
    return list
  }, [allPayments, classFilter, statusFilter, classList])

  // Client-side summary from ALL payments (month-wide totals regardless of table filter)
  const summaryData = useMemo(() => {
    if (allPayments.length === 0) return null
    const total_due = allPayments.reduce((s, p) => s + Number(p.amount_due), 0)
    const total_collected = allPayments.reduce((s, p) => s + Number(p.amount_paid), 0)
    let paid_count = 0, partial_count = 0, unpaid_count = 0, advance_count = 0
    const classMap = {}
    allPayments.forEach(p => {
      if (p.status === 'PAID') paid_count++
      else if (p.status === 'PARTIAL') partial_count++
      else if (p.status === 'UNPAID') unpaid_count++
      else if (p.status === 'ADVANCE') advance_count++
      const key = p.class_obj_id || p.class_name || 'unknown'
      if (!classMap[key]) {
        classMap[key] = { class_id: p.class_obj_id, class_name: p.class_name || 'Unknown', total_due: 0, total_collected: 0, count: 0 }
      }
      classMap[key].total_due += Number(p.amount_due)
      classMap[key].total_collected += Number(p.amount_paid)
      classMap[key].count++
    })
    return {
      month: apiMonth, year,
      total_due, total_collected,
      total_pending: Math.max(0, total_due - total_collected),
      paid_count, partial_count, unpaid_count, advance_count,
      by_class: Object.values(classMap).sort((a, b) => (a.class_name || '').localeCompare(b.class_name || '')),
    }
  }, [allPayments, apiMonth, year])

  // Derived data
  const paymentList = filteredPayments
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
    generateOnetimeMutation,
    createFeePaymentMutation,
  }
}
