import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import FaceBulkEnrollmentPage from '../FaceBulkEnrollmentPage'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN' },
    activeSchool: { id: 1, name: 'Test School' },
    isTeacher: false,
  }),
}))

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}))

// Same pre-existing infra gap noted in FaceEnrollmentPage.test.jsx:
// renderWithProviders doesn't wrap children in an AcademicYearProvider.
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

async function selectClass(user) {
  await waitFor(() => {
    const classSelect = screen.getByDisplayValue('All Classes')
    expect(classSelect.querySelectorAll('option').length).toBeGreaterThan(1)
  })
  await user.selectOptions(screen.getByDisplayValue('All Classes'), '1')
}

// Default mock roster (see test/mocks/handlers.js): Ali Hassan (#1), Sara
// Khan (#2), Usman Ahmed (#3), all in Class 1A (class_obj: 1). Default
// enrollments mock has both Ali and Sara enrolled under dlib_v1 only, so
// with no override, all three count as "not enrolled" for faceapi_v1.

beforeEach(() => {
  mockNavigate.mockClear()
  mockDetectSingleFace.mockReset()
  mockDetectSingleFace.mockResolvedValue({ descriptor: new Float32Array(128).fill(0.01) })
  mockGetUserMedia(vi.fn(() => Promise.resolve({ getTracks: () => [] })))
})

describe('FaceBulkEnrollmentPage', () => {
  it('renders the roster with all students "Not enrolled" by default (dlib_v1 rows do not count)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FaceBulkEnrollmentPage />)
    await selectClass(user)

    await waitFor(() => {
      expect(screen.getAllByText('Not enrolled')).toHaveLength(3)
    })
    expect(screen.getByText(/3 of 3 students will be captured/)).toBeInTheDocument()
  })

  it('detects an existing faceapi_v1 enrollment and excludes it from the pending count', async () => {
    server.use(
      http.get('/api/face-attendance/enrollments/', () =>
        HttpResponse.json({
          count: 1,
          results: [
            { id: 9, student: 1, student_name: 'Ali Hassan', student_roll: '1', class_name: 'Class 1A', quality_score: 0.9, embedding_version: 'faceapi_v1', created_at: '2026-02-19' },
          ],
        })
      )
    )

    const user = userEvent.setup()
    renderWithProviders(<FaceBulkEnrollmentPage />)
    await selectClass(user)

    await waitFor(() => {
      expect(screen.getByText(/2 of 3 students will be captured/)).toBeInTheDocument()
    })
    expect(screen.getByText('Already enrolled')).toBeInTheDocument()
    expect(screen.getAllByText('Not enrolled')).toHaveLength(2)
  })

  it('"Re-capture anyway" override brings an already-enrolled student back into the pending queue', async () => {
    server.use(
      http.get('/api/face-attendance/enrollments/', () =>
        HttpResponse.json({
          count: 1,
          results: [
            { id: 9, student: 1, student_name: 'Ali Hassan', student_roll: '1', class_name: 'Class 1A', quality_score: 0.9, embedding_version: 'faceapi_v1', created_at: '2026-02-19' },
          ],
        })
      )
    )

    const user = userEvent.setup()
    renderWithProviders(<FaceBulkEnrollmentPage />)
    await selectClass(user)

    await waitFor(() => expect(screen.getByText(/2 of 3 students will be captured/)).toBeInTheDocument())

    await user.click(screen.getByRole('checkbox'))

    expect(screen.getByText(/3 of 3 students will be captured/)).toBeInTheDocument()
  })

  it('advances the queue through every student on successful capture, then shows the summary', async () => {
    const postedStudentIds = []
    server.use(
      http.post('/api/face-attendance/enroll/', async ({ request }) => {
        const body = await request.json()
        postedStudentIds.push(body.student_id)
        return HttpResponse.json({ id: postedStudentIds.length, embedding_version: 'faceapi_v1' }, { status: 201 })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<FaceBulkEnrollmentPage />)
    await selectClass(user)

    await waitFor(() => expect(screen.getByText(/3 of 3 students will be captured/)).toBeInTheDocument())
    await user.click(screen.getByText('Start Bulk Capture'))

    // Student 1: camera needs to be enabled once.
    expect(screen.getByText('1 of 3 students captured')).toBeInTheDocument()
    await user.click(screen.getByText('Enable Camera'))
    await waitFor(() => expect(screen.getByText('Capture Face')).not.toBeDisabled())
    await user.click(screen.getByText('Capture Face'))
    await waitFor(() => expect(screen.getByText('Confirm & Enroll')).toBeInTheDocument())
    await user.click(screen.getByText('Confirm & Enroll'))

    // Student 2: camera stays granted (same LiveEnrollCapture instance) — no
    // "Enable Camera" button reappears, straight to capturing.
    await waitFor(() => expect(screen.getByText('2 of 3 students captured')).toBeInTheDocument())
    expect(screen.queryByText('Enable Camera')).not.toBeInTheDocument()
    await user.click(screen.getByText('Capture Face'))
    await waitFor(() => expect(screen.getByText('Confirm & Enroll')).toBeInTheDocument())
    await user.click(screen.getByText('Confirm & Enroll'))

    // Student 3
    await waitFor(() => expect(screen.getByText('3 of 3 students captured')).toBeInTheDocument())
    await user.click(screen.getByText('Capture Face'))
    await waitFor(() => expect(screen.getByText('Confirm & Enroll')).toBeInTheDocument())
    await user.click(screen.getByText('Confirm & Enroll'))

    await waitFor(() => expect(screen.getByText('Bulk Capture Summary')).toBeInTheDocument())
    expect(postedStudentIds).toEqual([1, 2, 3])
    expect(screen.getByText('3')).toBeInTheDocument() // captured count tile
    expect(screen.queryByText(/Skipped \(needs follow-up\)/)).not.toBeInTheDocument()
  })

  it('skipping a student advances the queue without submitting, and lists them in the summary', async () => {
    let enrollCalls = 0
    server.use(
      http.post('/api/face-attendance/enroll/', () => {
        enrollCalls += 1
        return HttpResponse.json({ id: 1, embedding_version: 'faceapi_v1' }, { status: 201 })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<FaceBulkEnrollmentPage />)
    await selectClass(user)

    await waitFor(() => expect(screen.getByText(/3 of 3 students will be captured/)).toBeInTheDocument())
    await user.click(screen.getByText('Start Bulk Capture'))

    expect(screen.getByText('1 of 3 students captured')).toBeInTheDocument()
    await user.click(screen.getByText('Skip this student'))

    await waitFor(() => expect(screen.getByText('2 of 3 students captured')).toBeInTheDocument())
    await user.click(screen.getByText('Stop & view summary'))

    await waitFor(() => expect(screen.getByText('Bulk Capture Summary')).toBeInTheDocument())
    expect(enrollCalls).toBe(0)
    expect(screen.getByText(/Skipped \(needs follow-up\)/)).toBeInTheDocument()
    expect(screen.getByText('Ali Hassan')).toBeInTheDocument()
  })
})
