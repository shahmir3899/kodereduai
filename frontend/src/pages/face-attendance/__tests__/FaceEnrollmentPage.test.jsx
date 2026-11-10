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
const mockDetectSingleFaceLandmarks = vi.fn()
const mockDetectAllFacesQuick = vi.fn()
const mockGetFramingHint = vi.fn()
const mockDetectAllFacesWithDescriptors = vi.fn()
let mockQualityScore = 0.82
vi.mock('../../../utils/faceApiLoader', () => ({
  loadFaceApiModels: vi.fn(() => Promise.resolve()),
  detectSingleFace: (...args) => mockDetectSingleFace(...args),
  detectSingleFaceLandmarks: (...args) => mockDetectSingleFaceLandmarks(...args),
  detectAllFacesQuick: (...args) => mockDetectAllFacesQuick(...args),
  getFramingHint: (...args) => mockGetFramingHint(...args),
  detectAllFacesWithDescriptors: (...args) => mockDetectAllFacesWithDescriptors(...args),
  estimateQualityScore: () => mockQualityScore,
  MIN_ENROLL_QUALITY_SCORE: 0.55,
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
  mockDetectSingleFaceLandmarks.mockReset().mockResolvedValue(null)
  mockQualityScore = 0.82
  // Default: no faces in the continuous tick scan, so the live "good
  // framing"/multi-face UI stays inert and tests drive capture manually via
  // the mocked detectSingleFace above — deliberately not 'good', which
  // would race the auto-capture behavior tested explicitly below.
  mockDetectAllFacesQuick.mockReset().mockResolvedValue([])
  mockGetFramingHint.mockReset().mockReturnValue({ status: 'none', message: null })
  mockDetectAllFacesWithDescriptors.mockReset().mockResolvedValue([])
})

describe('FaceEnrollmentPage', () => {
  it('renders page title and class selector', async () => {
    renderWithProviders(<FaceEnrollmentPage />)

    expect(screen.getByText('Face Enrollment')).toBeInTheDocument()
    // For a non-teacher the selector's empty value reads "All Classes" (showAllOption)
    // once the class list has loaded.
    await waitFor(() => expect(screen.getByDisplayValue('All Classes')).toBeInTheDocument())
  })

  it('loads classes in dropdown', async () => {
    renderWithProviders(<FaceEnrollmentPage />)

    // Classes load via MSW — check option elements inside the class select
    await waitFor(() => {
      const classSelect = screen.getByDisplayValue('All Classes')
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

    const user = userEvent.setup()
    renderWithProviders(<FaceEnrollmentPage />)

    // Wait for enrollments to load
    await waitFor(() => {
      expect(screen.getByText('Ali Hassan')).toBeInTheDocument()
    })

    // Removing asks for confirmation in the app's own modal (not window.confirm).
    const rowButtons = screen.getAllByText('Remove')
    await user.click(rowButtons[0])
    await waitFor(() => expect(screen.getAllByText('Remove').length).toBe(rowButtons.length + 1))
    const withModal = screen.getAllByText('Remove')
    await user.click(withModal[withModal.length - 1]) // the modal renders last

    await waitFor(() => {
      expect(deleteCalled).toBe(true)
    })
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
      const classSelect = screen.getByDisplayValue('All Classes')
      const options = classSelect.querySelectorAll('option')
      expect(options.length).toBeGreaterThan(1)
    })

    // Select a class to trigger student and enrollment loading
    const classSelect = screen.getByDisplayValue('All Classes')
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
      // Default is 3 poses per student; this test covers the single-capture path.
      await user.selectOptions(screen.getByLabelText('Poses per student'), '1')

      // LiveEnrollCapture now auto-requests the camera on mount (no manual
      // "Enable Camera" click needed) — just wait for it to grant and for
      // Capture Face to become enabled.
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

    // Shared setup for the tests below — same three steps as the capture
    // test above (Live Capture tab, class, student) so the panel is ready
    // for a face to come into frame.
    async function selectClassAndStudent(user) {
      await user.click(await screen.findByText('Live Capture'))
      await waitFor(() => {
        const classSelect = screen.getByDisplayValue('All Classes')
        expect(classSelect.querySelectorAll('option').length).toBeGreaterThan(1)
      })
      await user.selectOptions(screen.getByDisplayValue('All Classes'), '1')
      await waitFor(() => {
        expect(screen.getByDisplayValue('Select student...').querySelectorAll('option').length).toBeGreaterThan(1)
      })
      const studentSelect = screen.getByDisplayValue('Select student...')
      await user.selectOptions(studentSelect, studentSelect.querySelectorAll('option')[1].value)
      // Default is 3 poses per student; the tests using this helper cover the single-capture path.
      await user.selectOptions(screen.getByLabelText('Poses per student'), '1')
    }

    it('mirrors the live view, freezes on the captured frame, and warns when the head angle is wrong', async () => {
      const videoWidth = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoWidth')
      const videoHeight = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoHeight')
      Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 })
      Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 })
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() })
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA')

      try {
        // Pose 1 asks for a straight face; nose at 68% of the jaw width = turned to the student's left.
        const positions = Array.from({ length: 68 }, () => ({ x: 50, y: 50 }))
        positions[0] = { x: 0, y: 50 }
        positions[16] = { x: 100, y: 50 }
        positions[30] = { x: 68, y: 50 }
        mockGetUserMedia(vi.fn(() => Promise.resolve({ getTracks: () => [] })))
        mockDetectSingleFace.mockResolvedValue({ descriptor: new Float32Array(128).fill(0.01), landmarks: { positions } })

        const user = userEvent.setup()
        renderWithProviders(<FaceEnrollmentPage />)
        await selectClassAndStudent(user)
        await user.selectOptions(screen.getByLabelText('Poses per student'), '3')

        const video = document.querySelector('video')
        expect(video.style.transform).toBe('scaleX(-1)') // selfie-style mirror
        expect(screen.queryByTestId('captured-still')).not.toBeInTheDocument()

        await waitFor(() => expect(screen.getByText('Capture Face')).not.toBeDisabled())
        await user.click(screen.getByText('Capture Face'))

        const still = await screen.findByTestId('captured-still')
        expect(still).toHaveAttribute('src', 'data:image/jpeg;base64,AAAA')
        expect(still.style.transform).toBe('scaleX(-1)')
        expect(screen.getByTestId('pose-mismatch')).toHaveTextContent(/doesn't look like the pose/i)

        await user.click(screen.getByText('Retake'))
        await waitFor(() => expect(screen.queryByTestId('captured-still')).not.toBeInTheDocument())
      } finally {
        vi.restoreAllMocks()
        if (videoWidth) Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', videoWidth)
        if (videoHeight) Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', videoHeight)
      }
    })

    it('shows capture tips and a pose picture before the first pose', async () => {
      mockGetUserMedia(vi.fn(() => Promise.resolve({ getTracks: () => [] })))
      const user = userEvent.setup()
      renderWithProviders(<FaceEnrollmentPage />)
      await selectClassAndStudent(user)
      await user.selectOptions(screen.getByLabelText('Poses per student'), '3')

      expect(screen.getByTestId('capture-tips')).toHaveTextContent(/glasses/i)
      expect(screen.getByRole('img', { name: 'front pose' })).toBeInTheDocument()
      expect(screen.getByTestId('sample-progress')).toHaveTextContent('Look straight at the camera')
    })

    it('guides three poses by default and enrolls each as its own sample', async () => {
      const posted = []
      server.use(
        http.post('/api/face-attendance/enroll/', async ({ request }) => {
          posted.push(await request.json())
          return HttpResponse.json({ id: posted.length, embedding_version: 'faceapi_v1' }, { status: 201 })
        })
      )
      mockGetUserMedia(vi.fn(() => Promise.resolve({ getTracks: () => [] })))
      mockDetectSingleFace.mockResolvedValue({ descriptor: new Float32Array(128).fill(0.01) })

      const user = userEvent.setup()
      renderWithProviders(<FaceEnrollmentPage />)
      // Same steps as selectClassAndStudent, minus its switch to 1 pose.
      await user.click(await screen.findByText('Live Capture'))
      await waitFor(() => {
        expect(screen.getByDisplayValue('All Classes').querySelectorAll('option').length).toBeGreaterThan(1)
      })
      await user.selectOptions(screen.getByDisplayValue('All Classes'), '1')
      await waitFor(() => {
        expect(screen.getByDisplayValue('Select student...').querySelectorAll('option').length).toBeGreaterThan(1)
      })
      const studentSelect = screen.getByDisplayValue('Select student...')
      await user.selectOptions(studentSelect, studentSelect.querySelectorAll('option')[1].value)

      expect(screen.getByTestId('sample-progress')).toHaveTextContent('Pose 1 of 3')
      expect(screen.getByTestId('sample-progress')).toHaveTextContent('Look straight at the camera')

      for (let pose = 1; pose <= 3; pose += 1) {
        await waitFor(() => expect(screen.getByText('Capture Face')).not.toBeDisabled())
        await user.click(screen.getByText('Capture Face'))
        await user.click(await screen.findByText(pose < 3 ? 'Confirm & next pose' : 'Confirm & Enroll'))
        if (pose < 3) {
          await waitFor(() => expect(screen.getByTestId('sample-progress')).toHaveTextContent(`Pose ${pose + 1} of 3`))
          expect(posted).toHaveLength(0) // nothing is sent until the last pose
        }
      }

      await waitFor(() => expect(posted).toHaveLength(3))
      expect(new Set(posted.map((p) => p.student_id)).size).toBe(1)
    })

    it('auto-captures once framing is sustained "good", with no manual click', async () => {
      mockGetUserMedia(vi.fn(() => Promise.resolve({ getTracks: () => [] })))
      mockDetectAllFacesQuick.mockResolvedValue([{ box: { x: 0, y: 0, width: 10, height: 10 } }])
      mockGetFramingHint.mockReturnValue({ status: 'good', message: null })
      mockDetectSingleFace.mockResolvedValue({ descriptor: new Float32Array(128).fill(0.02) })

      const user = userEvent.setup()
      renderWithProviders(<FaceEnrollmentPage />)
      await selectClassAndStudent(user)

      // No "Capture Face" click here — two ticks of sustained good framing
      // (AUTO_CAPTURE_GOOD_STREAK) should fire it automatically.
      await waitFor(() => {
        expect(screen.getByText('Confirm & Enroll')).toBeInTheDocument()
      }, { timeout: 3000 })
    })

    it('shows a soft low-quality warning without disabling Confirm', async () => {
      mockGetUserMedia(vi.fn(() => Promise.resolve({ getTracks: () => [] })))
      mockDetectSingleFace.mockResolvedValue({ descriptor: new Float32Array(128).fill(0.01) })
      mockQualityScore = 0.2 // below MIN_ENROLL_QUALITY_SCORE (0.55)

      const user = userEvent.setup()
      renderWithProviders(<FaceEnrollmentPage />)
      await selectClassAndStudent(user)

      await waitFor(() => expect(screen.getByText('Capture Face')).not.toBeDisabled())
      await user.click(screen.getByText('Capture Face'))

      await waitFor(() => expect(screen.getByText(/Quality is low/)).toBeInTheDocument())
      expect(screen.getByText('Confirm & Enroll')).not.toBeDisabled()
    })
  })
})
