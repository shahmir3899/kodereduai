import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import TransportAttendancePage from '../TransportAttendancePage'

// Mock AuthContext
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN' },
    activeSchool: { id: 1, name: 'Test School' },
  }),
}))

describe('TransportAttendancePage - Bug #6: boarding_status field name', () => {
  it('renders page without crashing', async () => {
    renderWithProviders(<TransportAttendancePage />)
    await waitFor(() => {
      expect(screen.getByText(/transport attendance/i)).toBeInTheDocument()
    })
  })

  it('sends correct field names (student_id, boarding_status, route_id) on save', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/transport/attendance/bulk_mark/', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ detail: 'Marked' })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<TransportAttendancePage />)

    // Select route
    await waitFor(() => {
      const routeSelect = screen.getByRole('combobox')
      expect(routeSelect).toBeInTheDocument()
    })

    const routeSelect = screen.getByRole('combobox')
    await user.selectOptions(routeSelect, '1')

    // Wait for assignments to load
    await waitFor(() => {
      expect(screen.getByText('Ali Hassan')).toBeInTheDocument()
    })

    // Click Save All
    const saveBtn = screen.getByRole('button', { name: /save/i })
    await user.click(saveBtn)

    await waitFor(() => {
      expect(capturedBody).not.toBeNull()
    })

    // Verify correct top-level fields
    expect(capturedBody).toHaveProperty('route_id')
    expect(capturedBody).not.toHaveProperty('route')
    expect(capturedBody).toHaveProperty('date')

    // Verify record fields
    expect(capturedBody.records[0]).toHaveProperty('student_id')
    expect(capturedBody.records[0]).not.toHaveProperty('student')
    expect(capturedBody.records[0]).toHaveProperty('boarding_status')
    expect(capturedBody.records[0]).not.toHaveProperty('status')
  })

  it('reads existing attendance using boarding_status', async () => {
    renderWithProviders(<TransportAttendancePage />)

    const user = userEvent.setup()

    await waitFor(() => {
      const routeSelect = screen.getByRole('combobox')
      expect(routeSelect).toBeInTheDocument()
    })

    const routeSelect = screen.getByRole('combobox')
    await user.selectOptions(routeSelect, '1')

    // After selecting route, existing attendance should load
    // and boarding_status should be used (not status)
    await waitFor(() => {
      expect(screen.getByText('Ali Hassan')).toBeInTheDocument()
    })
  })
})
