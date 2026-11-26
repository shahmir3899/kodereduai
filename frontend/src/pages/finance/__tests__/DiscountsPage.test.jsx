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

// The page reads the active year (discounts are per year); the test has no AcademicYearProvider.
vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 1, name: '2026-27' } }),
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

// The page renders each discount twice (phone cards and the desktop table, one hidden by CSS),
// so texts are matched with getAllBy*.
describe('DiscountsPage - Bug #9: discount_type field name', () => {
  it('renders discounts with discount_type field', async () => {
    renderWithProviders(<DiscountsPage />)
    await waitFor(() => {
      expect(screen.getAllByText('PERCENTAGE').length).toBeGreaterThan(0)
    })
    expect(screen.getAllByText('FIXED').length).toBeGreaterThan(0)
  })

  it('sends discount_type (not type) when creating a discount', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/finance/discounts/', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ id: 3, ...capturedBody }, { status: 201 })
      }),
      // Per-fee discounts (2026-11-26): a discount must name the fees it cuts.
      http.get('/api/finance/monthly-categories/', () => HttpResponse.json([{ id: 7, name: 'Tuition', is_active: true }])),
      http.get('/api/finance/annual-categories/', () => HttpResponse.json([])),
    )

    const user = userEvent.setup()
    renderWithProviders(<DiscountsPage />)

    // Wait for page to load
    await waitFor(() => {
      expect(screen.getAllByText('Early Bird').length).toBeGreaterThan(0)
    })

    // Click Add Discount button
    const addBtn = screen.getByRole('button', { name: /add discount/i })
    await user.click(addBtn)

    // Fill the form
    const nameInput = screen.getByPlaceholderText(/early bird discount/i)
    await user.type(nameInput, 'Test Discount')

    const valueInput = screen.getByPlaceholderText(/e\.g\., 10/i)
    await user.type(valueInput, '15')

    await user.click(await screen.findByRole('checkbox', { name: 'Tuition' }))

    // Submit
    const saveBtn = screen.getByRole('button', { name: /save|create/i })
    await user.click(saveBtn)

    await waitFor(() => {
      expect(capturedBody).not.toBeNull()
    })
    expect(capturedBody).toHaveProperty('discount_type')
    expect(capturedBody).not.toHaveProperty('type')
    expect(capturedBody.discount_type).toBe('PERCENTAGE')
    expect(capturedBody.monthly_categories).toEqual([7])
  })

  it('populates discount_type when editing', async () => {
    const user = userEvent.setup()
    renderWithProviders(<DiscountsPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Early Bird').length).toBeGreaterThan(0)
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
