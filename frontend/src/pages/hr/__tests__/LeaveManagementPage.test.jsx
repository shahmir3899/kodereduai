import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders, createTestQueryClient } from '../../../test/utils'
import LeaveManagementPage from '../LeaveManagementPage'

// Mock AuthContext
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN' },
    activeSchool: { id: 1, name: 'Test School' },
  }),
}))

// Mock Toast
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}))

// Each application renders twice (phone cards and the desktop table, one hidden by CSS), so rows
// are matched with getAllBy*. Approve and Reject open a confirm modal with its own button.
async function openAndConfirm(user, action) {
  await waitFor(() => expect(screen.getAllByText('Ali Khan').length).toBeGreaterThan(0))
  await user.click(screen.getAllByRole('button', { name: action })[0])
  const heading = await screen.findByRole('heading', { name: `${action} Leave` })
  const modal = heading.parentElement
  await user.click(within(modal).getByRole('button', { name: action }))
}

describe('LeaveManagementPage - Bug #3: invalidateQueries syntax', () => {
  it('renders leave applications', async () => {
    renderWithProviders(<LeaveManagementPage />)
    await waitFor(() => {
      expect(screen.getAllByText('Ali Khan').length).toBeGreaterThan(0)
    })
  })

  it('approve action calls API and triggers refetch', async () => {
    let approveCalled = false
    server.use(
      http.post('/api/hr/leave-applications/:id/approve/', () => {
        approveCalled = true
        return HttpResponse.json({ id: 1, status: 'APPROVED' })
      })
    )

    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const user = userEvent.setup()
    renderWithProviders(<LeaveManagementPage />, { queryClient })

    await openAndConfirm(user, 'Approve')

    await waitFor(() => {
      expect(approveCalled).toBe(true)
    })

    // Verify invalidateQueries was called with v5 object syntax
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalled()
      const firstCall = invalidateSpy.mock.calls[0][0]
      expect(firstCall).toHaveProperty('queryKey')
      expect(Array.isArray(firstCall.queryKey)).toBe(true)
    })
  })

  it('reject action calls API', async () => {
    let rejectCalled = false
    server.use(
      http.post('/api/hr/leave-applications/:id/reject/', () => {
        rejectCalled = true
        return HttpResponse.json({ id: 1, status: 'REJECTED' })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<LeaveManagementPage />)

    await openAndConfirm(user, 'Reject')

    await waitFor(() => {
      expect(rejectCalled).toBe(true)
    })
  })

  it('renders the pending status badge from status_display', async () => {
    renderWithProviders(<LeaveManagementPage />)
    await waitFor(() => {
      // Not the "Pending" option of the status filter: the badge on the row.
      const badges = screen.getAllByText('Pending').filter((el) => el.tagName !== 'OPTION')
      expect(badges.length).toBeGreaterThan(0)
    })
  })
})
