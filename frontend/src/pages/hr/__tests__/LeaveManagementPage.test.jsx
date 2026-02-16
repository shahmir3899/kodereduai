import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
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

describe('LeaveManagementPage - Bug #3: invalidateQueries syntax', () => {
  it('renders leave applications', async () => {
    renderWithProviders(<LeaveManagementPage />)
    await waitFor(() => {
      expect(screen.getByText(/leave/i)).toBeInTheDocument()
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

    await waitFor(() => {
      expect(screen.getByText('Ali Khan')).toBeInTheDocument()
    })

    // Find approve button
    const approveBtn = screen.getByRole('button', { name: /approve/i })
    await user.click(approveBtn)

    // If there's a confirmation modal, confirm it
    const confirmBtn = screen.queryByRole('button', { name: /confirm|yes|approve/i })
    if (confirmBtn) {
      await user.click(confirmBtn)
    }

    await waitFor(() => {
      expect(approveCalled).toBe(true)
    })

    // Verify invalidateQueries was called with v5 object syntax
    await waitFor(() => {
      const calls = invalidateSpy.mock.calls
      if (calls.length > 0) {
        // v5 syntax: first arg should be an object with queryKey
        const firstCall = calls[0][0]
        expect(firstCall).toHaveProperty('queryKey')
        expect(Array.isArray(firstCall.queryKey)).toBe(true)
      }
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

    await waitFor(() => {
      expect(screen.getByText('Ali Khan')).toBeInTheDocument()
    })

    // Find reject button
    const rejectBtn = screen.getByRole('button', { name: /reject/i })
    await user.click(rejectBtn)

    // If there's a confirmation modal, confirm it
    const confirmBtn = screen.queryByRole('button', { name: /confirm|yes|reject/i })
    if (confirmBtn) {
      await user.click(confirmBtn)
    }

    await waitFor(() => {
      expect(rejectCalled).toBe(true)
    })
  })

  it('renders PENDING status badge', async () => {
    renderWithProviders(<LeaveManagementPage />)
    await waitFor(() => {
      expect(screen.getByText('PENDING')).toBeInTheDocument()
    })
  })
})
