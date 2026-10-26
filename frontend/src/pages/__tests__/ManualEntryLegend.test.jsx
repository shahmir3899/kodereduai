import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../test/utils'
import ManualEntryPage from '../ManualEntryPage'

vi.mock('../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 1, name: '2025-2026' } }),
}))
vi.mock('../../hooks/useSessionClasses', () => ({
  useSessionClasses: () => ({ sessionClasses: [{ id: 5, class_obj: 1, display_name: 'Class 1 - A' }], isLoading: false }),
}))
vi.mock('../../hooks/useTeacherScopedClasses', () => ({
  default: () => ({ isTeacher: false, showAllOption: false, classOptions: undefined, isLoadingTeacherClasses: false }),
}))
vi.mock('../../components/ClassSelector', () => ({ default: () => <select aria-label="class" /> }))
vi.mock('../../services/api', () => ({
  sessionsApi: {
    getCalendarDayStatus: () => Promise.resolve({ data: { days: {} } }),
    getEnrollments: () => Promise.resolve({ data: { results: [{ student: 1, student_name: 'Ali Hassan', roll_number: '1' }] } }),
  },
  attendanceApi: { getRecords: () => Promise.resolve({ data: { results: [] } }), bulkEntryAttendance: vi.fn() },
}))

describe('Manual Entry page', () => {
  it('explains the P / A / L letters on the phone card list', async () => {
    renderWithProviders(<ManualEntryPage />, { route: '/?class=5' })
    const legend = await screen.findByTestId('status-legend')
    expect(legend.textContent).toContain('P Present')
    expect(legend.textContent).toContain('A Absent')
    expect(legend.textContent).toContain('L Leave')
  })
})
