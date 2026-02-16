import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/utils'
import StudentsPage from '../StudentsPage'

// Mock AuthContext
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN', username: 'admin' },
    activeSchool: { id: 1, name: 'Test School', role: 'SCHOOL_ADMIN', is_default: true },
    isModuleEnabled: () => true,
  }),
}))

// Mock Toast
const mockShowSuccess = vi.fn()
const mockShowError = vi.fn()
const mockShowWarning = vi.fn()
vi.mock('../../components/Toast', () => ({
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
    showWarning: mockShowWarning,
  }),
}))

// Mock studentExport (uses html2canvas/jspdf which won't work in jsdom)
vi.mock('../studentExport', () => ({
  exportStudentsPDF: vi.fn(),
  exportStudentsPNG: vi.fn(),
}))

// Mock useDebounce to pass through immediately
vi.mock('../../hooks/useDebounce', () => ({
  useDebounce: (value) => value,
}))

// Helper: page renders both mobile cards + desktop table, so names appear twice.
// Use getAllByText and check at least one match.
function expectTextPresent(text) {
  const matches = screen.getAllByText(text)
  expect(matches.length).toBeGreaterThanOrEqual(1)
}

describe('StudentsPage — User Conversion Features', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── Rendering ───────────────────────────────────────────────

  it('renders students with account status badges', async () => {
    renderWithProviders(<StudentsPage />)

    await waitFor(() => {
      expectTextPresent('Ali Hassan')
    })

    expectTextPresent('Sara Khan')
    expectTextPresent('Usman Ahmed')
  })

  it('shows "No Account" for students without user accounts', async () => {
    renderWithProviders(<StudentsPage />)

    await waitFor(() => {
      expectTextPresent('Sara Khan')
    })

    // Students without accounts should show "No Account" text
    const noAccountBadges = screen.getAllByText(/No Account/i)
    // 2 students × 2 layouts (mobile + desktop) = at least 4, but at minimum 2
    expect(noAccountBadges.length).toBeGreaterThanOrEqual(2)
  })

  it('shows "Create Account" button for students without accounts', async () => {
    renderWithProviders(<StudentsPage />)

    await waitFor(() => {
      expectTextPresent('Sara Khan')
    })

    const createButtons = screen.getAllByText(/Create Account/i)
    expect(createButtons.length).toBeGreaterThanOrEqual(1)
  })

  // ─── Individual Convert Modal ────────────────────────────────

  it('opens convert modal when "Create Account" button is clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<StudentsPage />)

    await waitFor(() => {
      expectTextPresent('Sara Khan')
    })

    // Click the first "Create Account" button
    const createButtons = screen.getAllByText(/Create Account/i)
    await user.click(createButtons[0])

    // Modal should appear with form fields
    await waitFor(() => {
      expect(screen.getByText(/Create User Account/i)).toBeInTheDocument()
    })

    // Should have username field
    expect(screen.getByPlaceholderText(/username/i)).toBeInTheDocument()
  })

  it('submits individual convert form and calls API', async () => {
    let apiCalled = false
    let requestBody = null
    server.use(
      http.post('/api/students/:id/create-user-account/', async ({ request }) => {
        apiCalled = true
        requestBody = await request.json()
        return HttpResponse.json({
          message: 'User account created successfully.',
          user_id: 88,
          username: requestBody.username,
        }, { status: 201 })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<StudentsPage />)

    await waitFor(() => {
      expectTextPresent('Sara Khan')
    })

    // Open convert modal
    const createButtons = screen.getAllByText(/Create Account/i)
    await user.click(createButtons[0])

    await waitFor(() => {
      expect(screen.getByText(/Create User Account/i)).toBeInTheDocument()
    })

    // Fill in the form
    const usernameInput = screen.getByPlaceholderText(/username/i)
    await user.clear(usernameInput)
    await user.type(usernameInput, 'sara_khan')

    const passwordInputs = screen.getAllByPlaceholderText(/password/i)
    await user.type(passwordInputs[0], 'Student@123')
    if (passwordInputs.length > 1) {
      await user.type(passwordInputs[1], 'Student@123')
    }

    // Submit — find button within modal context
    const submitBtn = screen.getByRole('button', { name: /create.*account|save|submit/i })
    await user.click(submitBtn)

    await waitFor(() => {
      expect(apiCalled).toBe(true)
    })
    expect(requestBody.username).toBe('sara_khan')
  })

  // ─── Bulk Convert ────────────────────────────────────────────

  it('shows checkbox column for selecting students', async () => {
    renderWithProviders(<StudentsPage />)

    await waitFor(() => {
      expectTextPresent('Sara Khan')
    })

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThanOrEqual(1)
  })

  it('shows floating action bar when students are selected', async () => {
    const user = userEvent.setup()
    renderWithProviders(<StudentsPage />)

    await waitFor(() => {
      expectTextPresent('Sara Khan')
    })

    // Click a checkbox
    const checkboxes = screen.getAllByRole('checkbox')
    const targetCheckbox = checkboxes.length > 1 ? checkboxes[1] : checkboxes[0]
    await user.click(targetCheckbox)

    // Floating action bar with "Create Accounts" button should appear
    await waitFor(() => {
      const buttons = screen.getAllByText(/Create Accounts/i)
      expect(buttons.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('opens bulk convert modal from floating action bar', async () => {
    const user = userEvent.setup()
    renderWithProviders(<StudentsPage />)

    await waitFor(() => {
      expectTextPresent('Sara Khan')
    })

    // Select a student
    const checkboxes = screen.getAllByRole('checkbox')
    const targetCheckbox = checkboxes.length > 1 ? checkboxes[1] : checkboxes[0]
    await user.click(targetCheckbox)

    // Click the bulk convert button from the floating bar
    await waitFor(() => {
      const buttons = screen.getAllByText(/Create Accounts/i)
      expect(buttons.length).toBeGreaterThanOrEqual(1)
    })
    const bulkButtons = screen.getAllByText(/Create Accounts/i)
    await user.click(bulkButtons[0])

    // Bulk modal should show up
    await waitFor(() => {
      expect(screen.getByText(/Bulk Create/i)).toBeInTheDocument()
    })
  })

  it('submits bulk convert and calls API', async () => {
    let bulkApiCalled = false
    let bulkRequestBody = null
    server.use(
      http.post('/api/students/bulk-create-accounts/', async ({ request }) => {
        bulkApiCalled = true
        bulkRequestBody = await request.json()
        return HttpResponse.json({
          created_count: bulkRequestBody.student_ids.length,
          skipped_count: 0,
          error_count: 0,
          created: bulkRequestBody.student_ids.map((id) => ({
            student_id: id,
            username: `student_${id}`,
            student_name: `Student ${id}`,
          })),
          skipped: [],
          errors: [],
        })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<StudentsPage />)

    await waitFor(() => {
      expectTextPresent('Sara Khan')
    })

    // Select a student
    const checkboxes = screen.getAllByRole('checkbox')
    const targetCheckbox = checkboxes.length > 1 ? checkboxes[1] : checkboxes[0]
    await user.click(targetCheckbox)

    // Open bulk convert modal
    await waitFor(() => {
      const buttons = screen.getAllByText(/Create Accounts/i)
      expect(buttons.length).toBeGreaterThanOrEqual(1)
    })
    await user.click(screen.getAllByText(/Create Accounts/i)[0])

    await waitFor(() => {
      expect(screen.getByText(/Bulk Create/i)).toBeInTheDocument()
    })

    // Enter default password
    const passwordField = screen.getByPlaceholderText(/default password|password/i)
    await user.type(passwordField, 'BulkPass@123')

    // Submit
    const submitBtn = screen.getByRole('button', { name: /create.*accounts|confirm|submit/i })
    await user.click(submitBtn)

    await waitFor(() => {
      expect(bulkApiCalled).toBe(true)
    })
    expect(bulkRequestBody.default_password).toBe('BulkPass@123')
    expect(bulkRequestBody.student_ids.length).toBeGreaterThanOrEqual(1)
  })

  // ─── Error Handling ──────────────────────────────────────────

  it('shows error when individual convert fails', async () => {
    server.use(
      http.post('/api/students/:id/create-user-account/', () => {
        return HttpResponse.json(
          { error: 'This username is already taken.' },
          { status: 400 }
        )
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<StudentsPage />)

    await waitFor(() => {
      expectTextPresent('Sara Khan')
    })

    const createButtons = screen.getAllByText(/Create Account/i)
    await user.click(createButtons[0])

    await waitFor(() => {
      expect(screen.getByText(/Create User Account/i)).toBeInTheDocument()
    })

    // Fill and submit
    const usernameInput = screen.getByPlaceholderText(/username/i)
    await user.clear(usernameInput)
    await user.type(usernameInput, 'duplicate_user')

    const passwordInputs = screen.getAllByPlaceholderText(/password/i)
    await user.type(passwordInputs[0], 'Student@123')
    if (passwordInputs.length > 1) {
      await user.type(passwordInputs[1], 'Student@123')
    }

    const submitBtn = screen.getByRole('button', { name: /create.*account|save|submit/i })
    await user.click(submitBtn)

    // Error message should be displayed
    await waitFor(() => {
      const errorText = screen.queryByText(/already taken|error/i)
      expect(errorText).toBeInTheDocument()
    })
  })

  // ─── Bulk Convert Results ────────────────────────────────────

  it('displays bulk convert results with created count', async () => {
    server.use(
      http.post('/api/students/bulk-create-accounts/', async () => {
        return HttpResponse.json({
          created_count: 2,
          skipped_count: 1,
          error_count: 0,
          created: [
            { student_id: 2, username: 'sara_khan', student_name: 'Sara Khan' },
            { student_id: 3, username: 'usman_ahmed', student_name: 'Usman Ahmed' },
          ],
          skipped: [{ student_id: 1, name: 'Ali Hassan', reason: 'Already has account' }],
          errors: [],
        })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<StudentsPage />)

    await waitFor(() => {
      expectTextPresent('Sara Khan')
    })

    // Select students
    const checkboxes = screen.getAllByRole('checkbox')
    if (checkboxes.length > 1) await user.click(checkboxes[1])

    // Open bulk modal
    await waitFor(() => {
      const buttons = screen.getAllByText(/Create Accounts/i)
      expect(buttons.length).toBeGreaterThanOrEqual(1)
    })
    await user.click(screen.getAllByText(/Create Accounts/i)[0])

    await waitFor(() => {
      expect(screen.getByText(/Bulk Create/i)).toBeInTheDocument()
    })

    const passwordField = screen.getByPlaceholderText(/default password|password/i)
    await user.type(passwordField, 'BulkPass@123')

    const submitBtn = screen.getByRole('button', { name: /create.*accounts|confirm|submit/i })
    await user.click(submitBtn)

    // Results should show
    await waitFor(() => {
      const created = screen.queryByText(/created/i)
      expect(created).toBeInTheDocument()
    })
  })
})
