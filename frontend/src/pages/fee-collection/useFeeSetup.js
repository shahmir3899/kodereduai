import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi, classesApi, studentsApi } from '../../services/api'
import { useBackgroundTask } from '../../hooks/useBackgroundTask'

/**
 * Data hook for FeeSetupPage — fee structures + record generation.
 */
export function useFeeSetup({ academicYearId, feeType, studentClassId, structureMode, month, year }) {
  const queryClient = useQueryClient()

  const [bulkEffectiveFrom, setBulkEffectiveFrom] = useState(new Date().toISOString().split('T')[0])

  // Reference data
  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses({ page_size: 9999 }),
    staleTime: 5 * 60_000,
  })

  // All fee structures (no fee_type filter) so each tab has its own data
  const { data: allStructures } = useQuery({
    queryKey: ['feeStructures-all', academicYearId],
    queryFn: () => financeApi.getFeeStructures({
      page_size: 9999,
      ...(academicYearId && { academic_year: academicYearId }),
    }),
    staleTime: 2 * 60_000,
  })

  // Student mode queries
  const { data: classStudentsData, isLoading: studentsLoading } = useQuery({
    queryKey: ['students-for-fee-struct', studentClassId, academicYearId],
    queryFn: () => studentsApi.getStudents({
      class_id: studentClassId, is_active: true, page_size: 9999,
      ...(academicYearId && { academic_year: academicYearId }),
    }),
    enabled: structureMode === 'student' && !!studentClassId,
    staleTime: 2 * 60_000,
  })

  const { data: classFeeStructures, isLoading: structuresLoading } = useQuery({
    queryKey: ['feeStructures-class', studentClassId, feeType, academicYearId],
    queryFn: () => financeApi.getFeeStructures({
      class_id: studentClassId, fee_type: feeType, page_size: 9999,
      ...(academicYearId && { academic_year: academicYearId }),
    }),
    enabled: structureMode === 'student' && !!studentClassId,
    staleTime: 60_000,
  })

  // Mutations
  const bulkFeeMutation = useMutation({
    mutationFn: (data) => financeApi.bulkSetFeeStructures(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeStructures'] })
      queryClient.invalidateQueries({ queryKey: ['feeStructures-all'] })
      queryClient.invalidateQueries({ queryKey: ['feeStructures-class'] })
      queryClient.invalidateQueries({ queryKey: ['generate-preview'] })
    },
  })

  const bulkStudentFeeMutation = useMutation({
    mutationFn: (data) => financeApi.bulkSetStudentFeeStructures(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeStructures'] })
      queryClient.invalidateQueries({ queryKey: ['feeStructures-all'] })
      queryClient.invalidateQueries({ queryKey: ['feeStructures-class'] })
      queryClient.invalidateQueries({ queryKey: ['generate-preview'] })
    },
  })

  const generateMutation = useBackgroundTask({
    mutationFn: (data) => financeApi.generateMonthly(data),
    taskType: 'FEE_GENERATION',
    title: `Generating fees for ${month}/${year}`,
  })

  const generateOnetimeMutation = useMutation({
    mutationFn: (data) => financeApi.generateOnetimeFees(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feePayments'] })
      queryClient.invalidateQueries({ queryKey: ['generate-preview'] })
    },
  })

  // Derived data
  const classList = classes?.data?.results || classes?.data || []
  const classStudents = classStudentsData?.data?.results || classStudentsData?.data || []
  const classStructures = classFeeStructures?.data?.results || classFeeStructures?.data || []
  const allStructuresList = allStructures?.data?.results || allStructures?.data || []

  return {
    classList,
    allStructuresList,
    classStudents,
    classStructures,
    studentsLoading,
    structuresLoading,
    bulkEffectiveFrom,
    setBulkEffectiveFrom,
    bulkFeeMutation,
    bulkStudentFeeMutation,
    generateMutation,
    generateOnetimeMutation,
  }
}
