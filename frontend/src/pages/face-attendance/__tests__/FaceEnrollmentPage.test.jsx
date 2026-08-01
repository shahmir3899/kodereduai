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

// Pre-existing infra gap (flagged, not fixed, in the Phase 2.5 summary):
// renderWithProviders doesn't wrap children in an AcademicYearProvider, so
// every face-attendance page calling useAcademicYear() crashes without this
// per-file mock — same convention already used for AuthContext/Toast above.
vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 1, name: '2025-2026' } }),
}))

// Same pre-existing gap, second context this page needs that renderWithProviders doesn't supply.
vi.mock('../../../contexts/BackgroundTaskContext', () => ({
  useBackgroundTasks: () => ({ addTask: vi.fn() }),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

const mockDetectSingleFace = vi.fn()
vi.mock('../../../utils/faceApiLoader', () => ({
  loadFaceApiModels: vi.fn(() => Promise.resolve()),
  detectSingleFace: (...args) => mockDetectSingleFace(...args),
  estimateQualityScore: () => 0.82,
  LIVE_MOBILE_EMBEDDING_VERSION: 'faceapi_v1',
}))

function mockGetUserMedia(implementation) {
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: implementation },
  })
}

beforeEach(() => {
  mockNavigate.mockClear()
  mockDetectSingleFace.mockReset()
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

  describe('Live Mobile guided capture', () => {
    it('always shows the Live Capture toggle (no enable/disable gate)', async () => {
      renderWithProviders(<FaceEnrollmentPage />)
      await waitFor(() => {
        expect(screen.getByText('Face Enrollment')).toBeInTheDocument()
      })
      expect(screen.getByText('Live Capture')).toBeInTheDocument()
    })

    it('shows a version badge distinguishing dlib_v1 and faceapi_v1 rows for the same student', async () => {
      server.use(
        http.get('/api/face-attendance/enrollments/', () =>
          HttpResponse.json({
            count: 2,
            results: [
              { id: 1, student: 1, student_name: 'Ali Hassan', student_roll: '1', class_name: 'Class 1A', quality_score: 0.85, embedding_version: 'dlib_v1', created_at: '2026-02-18' },
              { id: 3, student: 1, student_name: 'Ali Hassan', student_roll: '1', class_name: 'Class 1A', quality_score: 0.9, embedding_version: 'faceapi_v1', created_at: '2026-02-19' },
            ],
          })
        )
      )
      renderWithProviders(<FaceEnrollmentPage />)
      await waitFor(() => {
        expect(screen.getAllByText('Ali Hassan')).toHaveLength(2)
      })
      expect(screen.getByText('dlib_v1')).toBeInTheDocument()
      expect(screen.getByText('faceapi_v1')).toBeInTheDocument()
    })

    it('captures a face client-side and submits via the embedding-shaped enroll payload', async () => {
      let postedBody = null
      server.use(
        http.post('/api/face-attendance/enroll/', async ({ request }) => {
          postedBody = await request.json()
          return HttpResponse.json(
            { id: 5, student: 1, embedding_version: 'faceapi_v1', quality_score: postedBody.quality_score },
            { status: 201 },
          )
        })
      )
      mockGetUserMedia(vi.fn(() => Promise.resolve({ getTracks: () => [] })))
      mockDetectSingleFace.mockResolvedValue({ descriptor: new Float32Array(128).fill(0.01) })

      const user = userEvent.setup()
      renderWithProviders(<FaceEnrollmentPage />)

      await user.click(await screen.findByText('Live Capture'))

      // Select class then student (shared selectors above the capture panel).
      // Note: for a non-teacher role, ClassSelector's placeholder is
      // "All Classes" (showAllOption=true), not "Select class..." — the
      // pre-existing baseline tests in this file assert the latter and are
      // consequently broken independent of Live Mobile capture (confirmed via git stash
      // against the unmodified component); this test uses the real label.
      await waitFor(() => {
        const classSelect = screen.getByDisplayValue('All Classes')
        expect(classSelect.querySelectorAll('option').length).toBeGreaterThan(1)
      })
      await user.selectOptions(screen.getByDisplayValue('All Classes'), '1')
      await waitFor(() => {
        expect(screen.getByDisplayValue('Select student...').querySelectorAll('option').length).toBeGreaterThan(1)
      })
      const studentSelect = screen.getByDisplayValue('Select student...')
      const studentOptionValue = studentSelect.querySelectorAll('option')[1].value
      await user.selectOptions(studentSelect, studentOptionValue)

      await user.click(screen.getByText('Enable Camera'))
      await waitFor(() => expect(screen.getByText('Capture Face')).not.toBeDisabled())
      await user.click(screen.getByText('Capture Face'))

      await waitFor(() => {
        expect(screen.getByText('Confirm & Enroll')).toBeInTheDocument()
      })
      await user.click(screen.getByText('Confirm & Enroll'))

      await waitFor(() => {
        expect(postedBody).toMatchObject({ embedding_version: 'faceapi_v1' })
      })
      expect(postedBody.embedding).toHaveLength(128)
    })
  })
})
