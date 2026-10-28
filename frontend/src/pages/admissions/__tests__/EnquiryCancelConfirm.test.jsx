import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import EnquiriesPage from '../EnquiriesPage'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'SCHOOL_ADMIN' }, activeSchool: { id: 1, name: 'Test School' } }),
}))

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() }),
}))

const enquiry = {
  id: 5, name: 'Hamza Ali', father_name: 'Ali Raza', mobile: '0302-3334455', status: 'NEW',
  status_display: 'New', applying_for_grade_level: 3, source: 'WEBSITE',
}

describe('Enquiry Cancel', () => {
  it('asks before cancelling and only then sends the status change', async () => {
    const calls = []
    server.use(
      http.get('/api/admissions/enquiries/', () => HttpResponse.json({ count: 1, results: [enquiry] })),
      http.get('/api/admissions/enquiries/status-counts/', () => HttpResponse.json({ NEW: 1 })),
      http.patch('/api/admissions/enquiries/5/update-status/', async ({ request }) => {
        calls.push(await request.json())
        return HttpResponse.json({ ...enquiry, status: 'CANCELLED' })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<EnquiriesPage />)
    const [cancel] = await screen.findAllByRole('button', { name: 'Cancel' })
    await user.click(cancel)
    expect(await screen.findByText(/Mark the enquiry for Hamza Ali as cancelled/)).toBeInTheDocument()
    expect(calls).toHaveLength(0)
    // the row also has a "Confirm" action: pick the one inside the modal
    const modal = screen.getByText('Cancel Enquiry').closest('div[class*="rounded"]')
    await user.click(within(modal).getByRole('button', { name: 'Cancel enquiry' }))
    await waitFor(() => expect(calls).toEqual([{ status: 'CANCELLED' }]))
  })
})
