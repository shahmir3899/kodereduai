import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import ResetPasswordModal from '../ResetPasswordModal'

const toast = { showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(), addToast: vi.fn() }
vi.mock('../../../components/Toast', () => ({ useToast: () => toast }))

const teacher = { id: 7, username: 'ayesha_teacher', first_name: 'Ayesha', last_name: 'Khan', email: 'ayesha@example.com' }

describe('ResetPasswordModal', () => {
  const calls = []
  beforeEach(() => {
    calls.length = 0
    Object.values(toast).forEach((f) => f.mockClear())
    server.use(http.post('/api/users/7/reset_password/', async ({ request }) => {
      calls.push(await request.json())
      return HttpResponse.json({ message: 'Password reset for ayesha_teacher.' })
    }))
  })

  it('refuses mismatched passwords without calling the API', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ResetPasswordModal user={teacher} onClose={() => {}} />)
    await user.type(screen.getByPlaceholderText('Min 8 characters'), 'Abcd1234')
    await user.type(screen.getByPlaceholderText('Confirm'), 'Different1')
    await user.click(screen.getByRole('button', { name: 'Reset Password' }))
    expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('sets the new password and closes with a success toast', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<ResetPasswordModal user={teacher} onClose={onClose} />)
    await user.type(screen.getByPlaceholderText('Min 8 characters'), 'Abcd1234')
    await user.type(screen.getByPlaceholderText('Confirm'), 'Abcd1234')
    await user.click(screen.getByRole('button', { name: 'Reset Password' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(calls[0]).toEqual({ mode: 'set', new_password: 'Abcd1234', confirm_password: 'Abcd1234' })
    expect(toast.showSuccess).toHaveBeenCalledWith('Password reset for ayesha_teacher.')
  })

  it('can email a reset link instead, and only when the user has an email', async () => {
    const user = userEvent.setup()
    const { unmount } = renderWithProviders(<ResetPasswordModal user={teacher} onClose={() => {}} />)
    await user.click(screen.getByLabelText(/Email a reset link/))
    await user.click(screen.getByRole('button', { name: 'Send Email' }))
    await waitFor(() => expect(calls[0]).toEqual({ mode: 'email' }))
    unmount()

    renderWithProviders(<ResetPasswordModal user={{ ...teacher, email: '' }} onClose={() => {}} />)
    expect(screen.getByLabelText(/Email a reset link/)).toBeDisabled()
  })
})
