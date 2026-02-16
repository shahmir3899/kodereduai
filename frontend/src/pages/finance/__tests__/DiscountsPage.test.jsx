import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import DiscountsPage from '../DiscountsPage'

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

// Mock constants
vi.mock('../../../constants/gradePresets', () => ({
  GRADE_PRESETS: {},
  GRADE_LEVEL_LABELS: {},
}))

describe('DiscountsPage - Bug #9: discount_type field name', () => {
  it('renders discounts with discount_type field', async () => {
    renderWithProviders(<DiscountsPage />)
    await waitFor(() => {
      expect(screen.getByText('PERCENTAGE')).toBeInTheDocument()
    })
    expect(screen.getByText('FIXED')).toBeInTheDocument()
  })

  it('sends discount_type (not type) when creating a discount', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/finance/discounts/', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ id: 3, ...capturedBody }, { status: 201 })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<DiscountsPage />)

    // Wait for page to load
    await waitFor(() => {
      expect(screen.getByText('Early Bird')).toBeInTheDocument()
    })

    // Click Add Discount button
    const addBtn = screen.getByRole('button', { name: /add discount/i })
    await user.click(addBtn)

    // Fill the form
    const nameInput = screen.getByPlaceholderText(/discount name/i)
    await user.type(nameInput, 'Test Discount')

    const valueInput = screen.getByPlaceholderText(/e\.g\., 10/i)
    await user.type(valueInput, '15')

    // Submit
    const saveBtn = screen.getByRole('button', { name: /save|create/i })
    await user.click(saveBtn)

    await waitFor(() => {
      expect(capturedBody).not.toBeNull()
    })
    expect(capturedBody).toHaveProperty('discount_type')
    expect(capturedBody).not.toHaveProperty('type')
    expect(capturedBody.discount_type).toBe('PERCENTAGE')
  })

  it('populates discount_type when editing', async () => {
    const user = userEvent.setup()
    renderWithProviders(<DiscountsPage />)

    await waitFor(() => {
      expect(screen.getByText('Early Bird')).toBeInTheDocument()
    })

    // Find and click edit button on first discount
    const editButtons = screen.getAllByRole('button', { name: /edit/i })
    if (editButtons.length > 0) {
      await user.click(editButtons[0])
      await waitFor(() => {
        const typeSelect = screen.getByDisplayValue('Percentage (%)')
        expect(typeSelect).toBeInTheDocument()
      })
    }
  })
})
