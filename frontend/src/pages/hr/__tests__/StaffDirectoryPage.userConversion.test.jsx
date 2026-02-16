import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import StaffDirectoryPage from '../StaffDirectoryPage'

// Mock AuthContext
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN', username: 'admin' },
    activeSchool: { id: 1, name: 'Test School', role: 'SCHOOL_ADMIN', is_default: true },
    isModuleEnabled: () => true,
    getAllowableRoles: () => ['PRINCIPAL', 'HR_MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF'],
  }),
}))

// Mock Toast
const mockShowSuccess = vi.fn()
const mockShowError = vi.fn()
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
  }),
}))

// Mock useDebounce
vi.mock('../../../hooks/useDebounce', () => ({
  useDebounce: (value) => value,
}))

// Helper: page renders both mobile cards + desktop table, so names appear twice.
function expectTextPresent(text) {
  const matches = screen.getAllByText(text)
  expect(matches.length).toBeGreaterThanOrEqual(1)
}

describe('StaffDirectoryPage — User Conversion Features', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── Rendering ───────────────────────────────────────────────

  it('renders staff list with account status indicators', async () => {
    renderWithProviders(<StaffDirectoryPage />)

    await waitFor(() => {
      expectTextPresent(/Ali/)
    })

    expectTextPresent(/Sara/)
    expectTextPresent(/Jane/)
  })

  it('shows "No Account" indicator for staff without user accounts', async () => {
    renderWithProviders(<StaffDirectoryPage />)

    await waitFor(() => {
      expectTextPresent(/Sara/)
    })

    const noAccountBadges = screen.getAllByText(/No Account/i)
    expect(noAccountBadges.length).toBeGreaterThanOrEqual(2) // Sara & Jane (at least 2, possibly 4 with dual layout)
  })

  it('shows "Create Account" button for staff without accounts', async () => {
    renderWithProviders(<StaffDirectoryPage />)

    await waitFor(() => {
      expectTextPresent(/Sara/)
    })

    const createButtons = screen.getAllByText(/Create Account/i)
    expect(createButtons.length).toBeGreaterThanOrEqual(1)
  })

  // ─── Individual Convert Modal ────────────────────────────────

  it('opens staff convert modal with role dropdown', async () => {
    const user = userEvent.setup()
    renderWithProviders(<StaffDirectoryPage />)

    await waitFor(() => {
      expectTextPresent(/Sara/)
    })

    const createButtons = screen.getAllByText(/Create Account/i)
    await user.click(createButtons[0])

    await waitFor(() => {
      expect(screen.getByText(/Create User Account/i)).toBeInTheDocument()
    })

    // Should have username field
    expect(screen.getByPlaceholderText(/username/i)).toBeInTheDocument()

    // Should have role dropdown/select — look for the label "Role"
    const roleText = screen.queryByText(/role/i)
    expect(roleText).toBeInTheDocument()
  })

  it('submits staff individual convert and calls API', async () => {
    let apiCalled = false
    let requestBody = null
    server.use(
      http.post('/api/hr/staff/:id/create-user-account/', async ({ request }) => {
        apiCalled = true
        requestBody = await request.json()
        return HttpResponse.json({
          message: 'User account created successfully.',
          user_id: 99,
          username: requestBody.username,
        }, { status: 201 })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<StaffDirectoryPage />)

    await waitFor(() => {
      expectTextPresent(/Sara/)
    })

    const createButtons = screen.getAllByText(/Create Account/i)
    await user.click(createButtons[0])

    await waitFor(() => {
      expect(screen.getByText(/Create User Account/i)).toBeInTheDocument()
    })

    // Fill in form
    const usernameInput = screen.getByPlaceholderText(/username/i)
    await user.clear(usernameInput)
    await user.type(usernameInput, 'sara_ahmed')

    const passwordInputs = screen.getAllByPlaceholderText(/password/i)
    await user.type(passwordInputs[0], 'Teacher@123')
    if (passwordInputs.length > 1) {
      await user.type(passwordInputs[1], 'Teacher@123')
    }

    // Submit
    const submitBtn = screen.getByRole('button', { name: /create.*account|save|submit/i })
    await user.click(submitBtn)

    await waitFor(() => {
      expect(apiCalled).toBe(true)
    })
    expect(requestBody.username).toBe('sara_ahmed')
  })

  // ─── Bulk Convert ────────────────────────────────────────────

  it('shows checkbox column for staff selection', async () => {
    renderWithProviders(<StaffDirectoryPage />)

    await waitFor(() => {
      expectTextPresent(/Sara/)
    })

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThanOrEqual(1)
  })

  it('shows floating action bar when staff are selected', async () => {
    const user = userEvent.setup()
    renderWithProviders(<StaffDirectoryPage />)

    await waitFor(() => {
      expectTextPresent(/Sara/)
    })

    const checkboxes = screen.getAllByRole('checkbox')
    const targetCheckbox = checkboxes.length > 1 ? checkboxes[1] : checkboxes[0]
    await user.click(targetCheckbox)

    await waitFor(() => {
      const buttons = screen.getAllByText(/Create Accounts/i)
      expect(buttons.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('opens bulk convert modal with password field', async () => {
    const user = userEvent.setup()
    renderWithProviders(<StaffDirectoryPage />)

    await waitFor(() => {
      expectTextPresent(/Sara/)
    })

    const checkboxes = screen.getAllByRole('checkbox')
    const targetCheckbox = checkboxes.length > 1 ? checkboxes[1] : checkboxes[0]
    await user.click(targetCheckbox)

    await waitFor(() => {
      const buttons = screen.getAllByText(/Create Accounts/i)
      expect(buttons.length).toBeGreaterThanOrEqual(1)
    })
    await user.click(screen.getAllByText(/Create Accounts/i)[0])

    await waitFor(() => {
      expect(screen.getByText(/Bulk Create/i)).toBeInTheDocument()
    })

    // Password field should be present
    expect(screen.getByPlaceholderText(/default password|password/i)).toBeInTheDocument()
  })

  it('submits bulk staff convert and calls API', async () => {
    let bulkApiCalled = false
    let bulkRequestBody = null
    server.use(
      http.post('/api/hr/staff/bulk-create-accounts/', async ({ request }) => {
        bulkApiCalled = true
        bulkRequestBody = await request.json()
        return HttpResponse.json({
          created_count: bulkRequestBody.staff_ids.length,
          skipped_count: 0,
          error_count: 0,
          created: bulkRequestBody.staff_ids.map((id) => ({
            staff_id: id,
            username: `staff_${id}`,
            name: `Staff ${id}`,
          })),
          skipped: [],
          errors: [],
        })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<StaffDirectoryPage />)

    await waitFor(() => {
      expectTextPresent(/Sara/)
    })

    // Select staff
    const checkboxes = screen.getAllByRole('checkbox')
    const targetCheckbox = checkboxes.length > 1 ? checkboxes[1] : checkboxes[0]
    await user.click(targetCheckbox)

    // Open bulk modal
    await waitFor(() => {
      const buttons = screen.getAllByText(/Create Accounts/i)
      expect(buttons.length).toBeGreaterThanOrEqual(1)
    })
    await user.click(screen.getAllByText(/Create Accounts/i)[0])

    await waitFor(() => {
      expect(screen.getByText(/Bulk Create/i)).toBeInTheDocument()
    })

    // Enter password
    const passwordField = screen.getByPlaceholderText(/default password|password/i)
    await user.type(passwordField, 'BulkStaff@123')

    // Submit
    const submitBtn = screen.getByRole('button', { name: /create.*accounts|confirm|submit/i })
    await user.click(submitBtn)

    await waitFor(() => {
      expect(bulkApiCalled).toBe(true)
    })
    expect(bulkRequestBody.default_password).toBe('BulkStaff@123')
    expect(bulkRequestBody.staff_ids.length).toBeGreaterThanOrEqual(1)
  })

  // ─── Error Handling ──────────────────────────────────────────

  it('shows error when staff convert fails', async () => {
    server.use(
      http.post('/api/hr/staff/:id/create-user-account/', () => {
        return HttpResponse.json(
          { error: 'This username is already taken.' },
          { status: 400 }
        )
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<StaffDirectoryPage />)

    await waitFor(() => {
      expectTextPresent(/Sara/)
    })

    const createButtons = screen.getAllByText(/Create Account/i)
    await user.click(createButtons[0])

    await waitFor(() => {
      expect(screen.getByText(/Create User Account/i)).toBeInTheDocument()
    })

    const usernameInput = screen.getByPlaceholderText(/username/i)
    await user.clear(usernameInput)
    await user.type(usernameInput, 'duplicate_user')

    const passwordInputs = screen.getAllByPlaceholderText(/password/i)
    await user.type(passwordInputs[0], 'Teacher@123')
    if (passwordInputs.length > 1) {
      await user.type(passwordInputs[1], 'Teacher@123')
    }

    const submitBtn = screen.getByRole('button', { name: /create.*account|save|submit/i })
    await user.click(submitBtn)

    await waitFor(() => {
      const errorText = screen.queryByText(/already taken|error/i)
      expect(errorText).toBeInTheDocument()
    })
  })

  // ─── Role Hierarchy in Convert ───────────────────────────────

  it('role dropdown respects hierarchy (no SUPER_ADMIN option)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<StaffDirectoryPage />)

    await waitFor(() => {
      expectTextPresent(/Sara/)
    })

    const createButtons = screen.getAllByText(/Create Account/i)
    await user.click(createButtons[0])

    await waitFor(() => {
      expect(screen.getByText(/Create User Account/i)).toBeInTheDocument()
    })

    // SUPER_ADMIN should NOT be in the role options
    expect(screen.queryByText('SUPER_ADMIN')).not.toBeInTheDocument()
    // Teacher should be available (as part of role options)
    expectTextPresent(/Teacher/)
  })

  // ─── Bulk results display ────────────────────────────────────

  it('displays bulk results with created and skipped counts', async () => {
    server.use(
      http.post('/api/hr/staff/bulk-create-accounts/', async () => {
        return HttpResponse.json({
          created_count: 1,
          skipped_count: 1,
          error_count: 0,
          created: [{ staff_id: 2, username: 'sara_ahmed', name: 'Sara Ahmed' }],
          skipped: [{ staff_id: 1, name: 'Ali Khan', reason: 'Already has account' }],
          errors: [],
        })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<StaffDirectoryPage />)

    await waitFor(() => {
      expectTextPresent(/Sara/)
    })

    // Select staff
    const checkboxes = screen.getAllByRole('checkbox')
    if (checkboxes.length > 1) await user.click(checkboxes[1])

    await waitFor(() => {
      const buttons = screen.getAllByText(/Create Accounts/i)
      expect(buttons.length).toBeGreaterThanOrEqual(1)
    })
    await user.click(screen.getAllByText(/Create Accounts/i)[0])

    await waitFor(() => {
      expect(screen.getByText(/Bulk Create/i)).toBeInTheDocument()
    })

    const passwordField = screen.getByPlaceholderText(/default password|password/i)
    await user.type(passwordField, 'BulkStaff@123')

    const submitBtn = screen.getByRole('button', { name: /create.*accounts|confirm|submit/i })
    await user.click(submitBtn)

    // Results should show created count
    await waitFor(() => {
      const created = screen.queryByText(/created/i)
      expect(created).toBeInTheDocument()
    })
  })
})
