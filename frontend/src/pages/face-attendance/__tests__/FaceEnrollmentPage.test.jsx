import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import FaceEnrollmentPage from '../FaceEnrollmentPage'

// Mock contexts and hooks
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN' },
    activeSchool: { id: 1, name: 'Test School' },
  }),
}))

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

beforeEach(() => {
  mockNavigate.mockClear()
})

describe('FaceEnrollmentPage', () => {
  it('renders page title and class selector', async () => {
    renderWithProviders(<FaceEnrollmentPage />)

    expect(screen.getByText('Face Enrollment')).toBeInTheDocument()
    expect(screen.getByText('Select class...')).toBeInTheDocument()
  })

  it('loads classes in dropdown', async () => {
    renderWithProviders(<FaceEnrollmentPage />)

    // Classes load via MSW — check option elements inside the class select
    await waitFor(() => {
      const classSelect = screen.getByDisplayValue('Select class...')
      const options = classSelect.querySelectorAll('option')
      const optionTexts = Array.from(options).map((o) => o.textContent)
      expect(optionTexts.some((t) => t.includes('Class 1A'))).toBe(true)
    })
  })

  it('shows enrolled faces list', async () => {
    renderWithProviders(<FaceEnrollmentPage />)

    await waitFor(() => {
      expect(screen.getByText('Ali Hassan')).toBeInTheDocument()
    })

    expect(screen.getByText('Sara Khan')).toBeInTheDocument()
    expect(screen.getByText(/Quality: 85%/)).toBeInTheDocument()
  })

  it('delete enrollment calls API', async () => {
    let deleteCalled = false
    server.use(
      http.delete('/api/face-attendance/enrollments/:id/', () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 204 })
      })
    )

    // Mock window.confirm to return true
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    const user = userEvent.setup()
    renderWithProviders(<FaceEnrollmentPage />)

    // Wait for enrollments to load
    await waitFor(() => {
      expect(screen.getByText('Ali Hassan')).toBeInTheDocument()
    })

    // Find and click the first Remove button
    const removeButtons = screen.getAllByText('Remove')
    await user.click(removeButtons[0])

    await waitFor(() => {
      expect(deleteCalled).toBe(true)
    })

    confirmSpy.mockRestore()
  })

  it('student selector is disabled until class is selected', async () => {
    renderWithProviders(<FaceEnrollmentPage />)

    // Find the student select by its label
    const studentSelect = screen.getByDisplayValue('Select student...')
    expect(studentSelect).toBeDisabled()
  })

  it('shows enrollment summary with count after class selection', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FaceEnrollmentPage />)

    // Wait for classes to load
    await waitFor(() => {
      const classSelect = screen.getByDisplayValue('Select class...')
      const options = classSelect.querySelectorAll('option')
      expect(options.length).toBeGreaterThan(1)
    })

    // Select a class to trigger student and enrollment loading
    const classSelect = screen.getByDisplayValue('Select class...')
    await user.selectOptions(classSelect, '1')

    // Wait for enrollment summary to appear
    await waitFor(() => {
      expect(screen.getByText(/students enrolled/)).toBeInTheDocument()
    })
  })
})
