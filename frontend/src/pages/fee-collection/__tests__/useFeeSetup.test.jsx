import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const invalidateQueries = vi.fn()
const capturedBackgroundTaskOptions = []

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
  useMutation: vi.fn(() => ({ isPending: false })),
  useQueryClient: vi.fn(() => ({ invalidateQueries })),
}))

vi.mock('../../../services/api', () => ({
  financeApi: {
    getFeeStructures: vi.fn(() => Promise.resolve({ data: [] })),
    bulkSetFeeStructures: vi.fn(),
    bulkSetStudentFeeStructures: vi.fn(),
    generateMonthly: vi.fn(),
    generateOnetimeFees: vi.fn(),
    generateAnnualFees: vi.fn(),
  },
  classesApi: {
    getClasses: vi.fn(() => Promise.resolve({ data: [] })),
  },
  studentsApi: {
    getStudents: vi.fn(() => Promise.resolve({ data: [] })),
  },
}))

vi.mock('../../../hooks/useBackgroundTask', () => ({
  useBackgroundTask: (options) => {
    capturedBackgroundTaskOptions.push(options)
    return { isPending: false, mutate: vi.fn() }
  },
}))

import { useFeeSetup } from '../useFeeSetup'

describe('useFeeSetup generation invalidation parity', () => {
  beforeEach(() => {
    invalidateQueries.mockClear()
    capturedBackgroundTaskOptions.length = 0
  })

  it('invalidates fee queries after monthly generation success', () => {
    renderHook(() => useFeeSetup({
      academicYearId: 1,
      feeType: 'MONTHLY',
      studentClassId: null,
      structureMode: 'class',
      month: 4,
      year: 2026,
    }))

    const monthlyTaskConfig = capturedBackgroundTaskOptions.find(
      (config) => config.title === 'Generating fees for 4/2026'
    )

    expect(monthlyTaskConfig).toBeTruthy()
    expect(typeof monthlyTaskConfig.onSuccess).toBe('function')

    monthlyTaskConfig.onSuccess()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['feePayments'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['feeSummary'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['generate-preview'] })
  })

  it('invalidates fee queries after annual generation success', () => {
    renderHook(() => useFeeSetup({
      academicYearId: 1,
      feeType: 'MONTHLY',
      studentClassId: null,
      structureMode: 'class',
      month: 4,
      year: 2026,
    }))

    const annualTaskConfig = capturedBackgroundTaskOptions.find(
      (config) => config.title === 'Generating annual fees for 2026'
    )

    expect(annualTaskConfig).toBeTruthy()
    expect(typeof annualTaskConfig.onSuccess).toBe('function')

    annualTaskConfig.onSuccess()

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['feePayments'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['feeSummary'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['generate-preview'] })
  })
})
