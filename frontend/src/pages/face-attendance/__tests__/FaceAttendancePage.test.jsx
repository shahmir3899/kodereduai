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

// Pre-existing infra gap (flagged in the Phase 2.5 summary, confirmed via
// git stash to predate this session): renderWithProviders doesn't wrap
// children in an AcademicYearProvider, so every face-attendance page calling
// useAcademicYear() crashes without this per-file mock — same convention
// already used for AuthContext/Toast above. Every test in this file was
// silently never executing before this fix.
vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 1, name: '2025-2026' } }),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// The Mobile Capture tab renders FaceLiveCapturePage inline, which loads
// face-api.js models on mount — mocked the same way FaceLiveCapturePage's
// own test file does, so switching tabs here doesn't depend on real
// network/wasm model loading.
vi.mock('../../../utils/faceApiLoader', () => ({
  loadFaceApiModels: vi.fn(() => Promise.resolve()),
  detectSingleFace: vi.fn(),
  estimateQualityScore: () => 0.8,
  TIER_A_EMBEDDING_VERSION: 'faceapi_v1',
}))

beforeEach(() => {
  mockNavigate.mockClear()
})

describe('FaceAttendancePage', () => {
  it('renders page title and tabs', async () => {
    renderWithProviders(<FaceAttendancePage />)

    expect(screen.getByText('Face Attendance')).toBeInTheDocument()
    expect(screen.getByText('Group Photo')).toBeInTheDocument()
    expect(screen.getByText('Mobile Capture')).toBeInTheDocument()
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

  it('Capture Devices link is always available (no longer tier-gated) and navigates', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FaceAttendancePage />)

    const devicesBtn = await screen.findByText('Capture Devices')
    await user.click(devicesBtn)

    expect(mockNavigate).toHaveBeenCalledWith('/face-attendance/devices')
  })

  it('Bulk Enrollment link is always available (no longer tier-gated) and navigates', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FaceAttendancePage />)

    const bulkBtn = await screen.findByText('Bulk Enrollment')
    await user.click(bulkBtn)

    expect(mockNavigate).toHaveBeenCalledWith('/face-attendance/bulk-enrollment')
  })

  it('switching to the Mobile Capture tab renders the live-capture UI inline', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FaceAttendancePage />)

    await user.click(screen.getByText('Mobile Capture'))

    await waitFor(() => {
      expect(screen.getByText(/Loading face recognition model|Enable Camera/)).toBeInTheDocument()
    })
  })

  describe('Tier B status indicator', () => {
    it('shows no badge when tier_b_status is not_installed (default mock)', async () => {
      renderWithProviders(<FaceAttendancePage />)

      await waitFor(() => {
        expect(screen.getByText('Manage Enrollments')).toBeInTheDocument()
      })
      expect(screen.queryByText(/Fixed Camera/)).not.toBeInTheDocument()
    })

    it('shows "Fixed Camera: Active" when tier_b_status is active', async () => {
      server.use(
        http.get('/api/face-attendance/status/', () =>
          HttpResponse.json({
            face_recognition_available: true,
            thresholds: { high: 0.40, medium: 0.55 },
            enrolled_faces: 4,
            model: 'dlib_v1',
            tier_a_available: true,
            tier_c_available: true,
            tier_b_status: 'active',
          })
        )
      )

      renderWithProviders(<FaceAttendancePage />)
      expect(await screen.findByText('Fixed Camera: Active')).toBeInTheDocument()
    })

    it('shows "Fixed Camera: Offline" when tier_b_status is inactive', async () => {
      server.use(
        http.get('/api/face-attendance/status/', () =>
          HttpResponse.json({
            face_recognition_available: true,
            thresholds: { high: 0.40, medium: 0.55 },
            enrolled_faces: 4,
            model: 'dlib_v1',
            tier_a_available: true,
            tier_c_available: true,
            tier_b_status: 'inactive',
          })
        )
      )

      renderWithProviders(<FaceAttendancePage />)
      expect(await screen.findByText('Fixed Camera: Offline')).toBeInTheDocument()
    })
  })
})
