import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import StaffAttendancePage from '../StaffAttendancePage'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 2, role: 'MANAGER' },
    activeSchool: { id: 1, name: 'Test School' },
    isStaffLevel: true, isTeacher: false, isStaffMember: false, isManager: false,
  }),
}))

describe('StaffAttendancePage for a finance manager', () => {
  it('shows the read-only My Attendance view, not the marking grid', async () => {
    renderWithProviders(<StaffAttendancePage />)
    await waitFor(() => expect(screen.getByText('My Attendance')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Save All' })).not.toBeInTheDocument()
  })

  it('fills the summary cards from the lowercase keys the server sends', async () => {
    // Shape of GET /api/hr/attendance/summary/ for a self-scoped user: one row per staff member.
    server.use(http.get('/api/hr/attendance/summary/', () => HttpResponse.json([{
      staff_member: 7, present: 11, absent: 2, late: 3, half_day: 4, on_leave: 5, attendance_rate: 84.6,
    }])))
    renderWithProviders(<StaffAttendancePage />)
    const card = (label) => screen.getByText(label, { selector: 'p' }).previousSibling.textContent
    await waitFor(() => expect(card('Rate')).toBe('84.6%'))
    expect(card('Present')).toBe('11')
    expect(card('Absent')).toBe('2')
    expect(card('Late')).toBe('3')
    expect(card('Half Day')).toBe('4')
    expect(card('On Leave')).toBe('5')
  })
})
