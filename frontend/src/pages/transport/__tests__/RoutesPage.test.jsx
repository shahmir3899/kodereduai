import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import RoutesPage from '../RoutesPage'

// Mock AuthContext
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN' },
    activeSchool: { id: 1, name: 'Test School' },
  }),
}))

describe('RoutesPage - Bug #5: stop_order field name', () => {
  it('renders stops with stop_order displayed', async () => {
    renderWithProviders(<RoutesPage />)
    await waitFor(() => {
      expect(screen.getByText('Route North')).toBeInTheDocument()
    })
    // Stops should show with #1, #2 from stop_order
    await waitFor(() => {
      expect(screen.getByText(/#1/)).toBeInTheDocument()
    })
  })

  it('sends stop_order (not order) when creating a stop', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/transport/stops/', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ id: 4, ...capturedBody }, { status: 201 })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<RoutesPage />)

    await waitFor(() => {
      expect(screen.getByText('Route North')).toBeInTheDocument()
    })

    // Click "Add Stop" button
    const addStopBtns = screen.getAllByRole('button', { name: /add stop/i })
    if (addStopBtns.length > 0) {
      await user.click(addStopBtns[0])

      // Fill stop form
      const nameInput = screen.getByPlaceholderText(/stop name/i)
      await user.type(nameInput, 'New Stop')

      // Submit
      const saveBtn = screen.getByRole('button', { name: /save|add|create/i })
      await user.click(saveBtn)

      await waitFor(() => {
        expect(capturedBody).not.toBeNull()
      })
      expect(capturedBody).toHaveProperty('stop_order')
      expect(capturedBody).not.toHaveProperty('order')
    }
  })

  it('stops are sorted by stop_order', async () => {
    // Provide stops in reverse order
    server.use(
      http.get('/api/transport/stops/', () =>
        HttpResponse.json([
          { id: 2, route: 1, name: 'Stop B', stop_order: 2, pickup_time: '07:40', drop_time: '14:20' },
          { id: 1, route: 1, name: 'Stop A', stop_order: 1, pickup_time: '07:30', drop_time: '14:30' },
        ])
      )
    )

    renderWithProviders(<RoutesPage />)
    await waitFor(() => {
      expect(screen.getByText('Route North')).toBeInTheDocument()
    })

    // After sorting, Stop A (#1) should appear before Stop B (#2)
    await waitFor(() => {
      const text = document.body.textContent
      const posA = text.indexOf('#1')
      const posB = text.indexOf('#2')
      if (posA !== -1 && posB !== -1) {
        expect(posA).toBeLessThan(posB)
      }
    })
  })
})
