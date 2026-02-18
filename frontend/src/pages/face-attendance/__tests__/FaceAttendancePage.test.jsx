import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import FaceAttendancePage from '../FaceAttendancePage'

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

describe('FaceAttendancePage', () => {
  it('renders page title and tabs', async () => {
    renderWithProviders(<FaceAttendancePage />)

    expect(screen.getByText('Face Attendance')).toBeInTheDocument()
    expect(screen.getByText('Capture')).toBeInTheDocument()
    expect(screen.getByText('Sessions')).toBeInTheDocument()
  })

  it('renders class selector in capture tab', async () => {
    renderWithProviders(<FaceAttendancePage />)

    await waitFor(() => {
      expect(screen.getByText('Select class...')).toBeInTheDocument()
    })

    // Classes should load from MSW mock — check options inside the select
    await waitFor(() => {
      const classSelect = screen.getByDisplayValue('Select class...')
      const options = classSelect.querySelectorAll('option')
      const optionTexts = Array.from(options).map((o) => o.textContent)
      expect(optionTexts.some((t) => t.includes('Class 1A'))).toBe(true)
    })
  })

  it('shows sessions tab with session list', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FaceAttendancePage />)

    // Switch to sessions tab
    const sessionsTab = screen.getByText('Sessions')
    await user.click(sessionsTab)

    // Should show the mock session
    await waitFor(() => {
      expect(screen.getByText(/Class 1A/)).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByText(/3 faces detected/)).toBeInTheDocument()
    })
  })

  it('shows pending reviews banner', async () => {
    renderWithProviders(<FaceAttendancePage />)

    await waitFor(() => {
      expect(screen.getByText(/1 session\(s\) ready for review/)).toBeInTheDocument()
    })

    expect(screen.getByText('Review Now')).toBeInTheDocument()
  })

  it('session click navigates to review page', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FaceAttendancePage />)

    // Switch to sessions tab
    await user.click(screen.getByText('Sessions'))

    // Wait for session to load then click it
    await waitFor(() => {
      expect(screen.getByText(/Class 1A/)).toBeInTheDocument()
    })

    const sessionRow = screen.getByText(/3 faces detected/).closest('div[class*="cursor-pointer"]')
    if (sessionRow) {
      await user.click(sessionRow)
      expect(mockNavigate).toHaveBeenCalledWith('/face-attendance/review/uuid-session-1')
    }
  })

  it('manage enrollments button navigates correctly', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FaceAttendancePage />)

    const enrollBtn = screen.getByText('Manage Enrollments')
    await user.click(enrollBtn)

    expect(mockNavigate).toHaveBeenCalledWith('/face-attendance/enrollment')
  })
})
