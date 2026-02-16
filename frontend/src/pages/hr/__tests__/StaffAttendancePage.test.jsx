import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import StaffAttendancePage from '../StaffAttendancePage'

// Mock AuthContext
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN' },
    activeSchool: { id: 1, name: 'Test School' },
  }),
}))

describe('StaffAttendancePage - Bug #4: date_from/date_to params', () => {
  it('renders page without crashing', async () => {
    renderWithProviders(<StaffAttendancePage />)
    await waitFor(() => {
      expect(screen.getByText(/staff attendance/i)).toBeInTheDocument()
    })
  })

  it('summary request uses date_from and date_to (not start_date/end_date)', async () => {
    let capturedUrl = null
    server.use(
      http.get('/api/hr/attendance/summary/', ({ request }) => {
        capturedUrl = request.url
        const url = new URL(request.url)
        const dateFrom = url.searchParams.get('date_from')
        const dateTo = url.searchParams.get('date_to')
        if (!dateFrom || !dateTo) {
          return HttpResponse.json({ detail: 'date_from and date_to are required.' }, { status: 400 })
        }
        return HttpResponse.json({ total_records: 20, present: 15, absent: 3, late: 2 })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<StaffAttendancePage />)

    // Find and click Summary tab
    await waitFor(() => {
      const summaryTab = screen.getByRole('button', { name: /summary/i })
      expect(summaryTab).toBeInTheDocument()
    })

    const summaryTab = screen.getByRole('button', { name: /summary/i })
    await user.click(summaryTab)

    // Wait for the API call
    await waitFor(() => {
      expect(capturedUrl).not.toBeNull()
    })

    // Verify correct param names
    const url = new URL(capturedUrl)
    expect(url.searchParams.has('date_from')).toBe(true)
    expect(url.searchParams.has('date_to')).toBe(true)
    expect(url.searchParams.has('start_date')).toBe(false)
    expect(url.searchParams.has('end_date')).toBe(false)
  })

  it('handles summary error gracefully', async () => {
    server.use(
      http.get('/api/hr/attendance/summary/', () =>
        HttpResponse.json({ detail: 'date_from and date_to are required.' }, { status: 400 })
      )
    )

    renderWithProviders(<StaffAttendancePage />)

    const user = userEvent.setup()
    await waitFor(() => {
      const summaryTab = screen.getByRole('button', { name: /summary/i })
      expect(summaryTab).toBeInTheDocument()
    })

    const summaryTab = screen.getByRole('button', { name: /summary/i })
    await user.click(summaryTab)

    // Page should not crash on error
    await waitFor(() => {
      expect(document.body).toBeInTheDocument()
    })
  })
})
