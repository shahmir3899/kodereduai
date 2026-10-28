import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../../test/utils'
import StaffAttendancePage from '../StaffAttendancePage'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 2, role: 'ACCOUNTANT' },
    activeSchool: { id: 1, name: 'Test School' },
    isStaffLevel: true, isTeacher: false, isStaffMember: false, isManager: false,
  }),
}))

describe('StaffAttendancePage for an accountant', () => {
  it('shows the read-only My Attendance view, not the marking grid', async () => {
    renderWithProviders(<StaffAttendancePage />)
    await waitFor(() => expect(screen.getByText('My Attendance')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Save All' })).not.toBeInTheDocument()
  })
})
