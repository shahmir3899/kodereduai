import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import FaceLiveCapturePage from '../FaceLiveCapturePage'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN' },
    activeSchool: { id: 1, name: 'Test School' },
    isTeacher: false,
  }),
}))

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

const mockLoadFaceApiModels = vi.fn()
const mockDetectSingleFace = vi.fn()
vi.mock('../../../utils/faceApiLoader', () => ({
  loadFaceApiModels: (...args) => mockLoadFaceApiModels(...args),
  detectSingleFace: (...args) => mockDetectSingleFace(...args),
  estimateQualityScore: () => 0.8,
  TIER_A_EMBEDDING_VERSION: 'faceapi_v1',
}))

function mockGetUserMedia(implementation) {
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: implementation ? { getUserMedia: implementation } : undefined,
  })
}

const fakeStream = { getTracks: () => [{ stop: vi.fn() }] }

beforeEach(() => {
  mockNavigate.mockClear()
  mockLoadFaceApiModels.mockReset().mockResolvedValue(undefined)
  mockDetectSingleFace.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: undefined })
})

describe('FaceLiveCapturePage', () => {
  it('shows a loading state while the model downloads, then clears it', async () => {
    let resolveModels
    mockLoadFaceApiModels.mockReturnValue(new Promise((resolve) => { resolveModels = resolve }))
    renderWithProviders(<FaceLiveCapturePage />)

    expect(screen.getByText(/Loading face recognition model/)).toBeInTheDocument()
    resolveModels()
    await waitFor(() => {
      expect(screen.queryByText(/Loading face recognition model/)).not.toBeInTheDocument()
    })
  })

  it('shows an error state with retry if the model fails to load', async () => {
    mockLoadFaceApiModels.mockRejectedValueOnce(new Error('network down'))
    renderWithProviders(<FaceLiveCapturePage />)

    await waitFor(() => {
      expect(screen.getByText(/Failed to load the face recognition model/)).toBeInTheDocument()
    })
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('shows a denied message when camera permission is rejected', async () => {
    mockGetUserMedia(vi.fn(() => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))))
    const user = userEvent.setup()
    renderWithProviders(<FaceLiveCapturePage />)

    await user.click(screen.getByText('Enable Camera'))
    await waitFor(() => {
      expect(screen.getByText(/Camera access was denied/)).toBeInTheDocument()
    })
    expect(screen.getByText('Retry Camera Access')).toBeInTheDocument()
  })

  it('shows an unavailable message when no camera device exists', async () => {
    mockGetUserMedia(undefined) // no navigator.mediaDevices at all
    const user = userEvent.setup()
    renderWithProviders(<FaceLiveCapturePage />)

    await user.click(screen.getByText('Enable Camera'))
    await waitFor(() => {
      expect(screen.getByText(/No camera is available/)).toBeInTheDocument()
    })
  })

  it('debounces detections (one POST per cooldown window) and shows match feedback', async () => {
    // Real setInterval/network timing (not vi.useFakeTimers, which doesn't
    // play well with MSW's request handling) — the 4s cooldown is exercised
    // with real waits, kept as short as the component's own constants allow.
    mockGetUserMedia(vi.fn(() => Promise.resolve(fakeStream)))
    mockDetectSingleFace.mockResolvedValue({ descriptor: new Float32Array(128).fill(0.02) })

    let matchCalls = 0
    server.use(
      http.post('/api/face-attendance/live/match/', () => {
        matchCalls += 1
        return HttpResponse.json({
          match_status: 'AUTO_MATCHED',
          student: { id: 9, name: 'Ali Hassan' },
          confidence: 91.2,
          event_id: 'evt-1',
          attendance_marked: true,
        })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<FaceLiveCapturePage />)

    await waitFor(() => expect(screen.queryByText(/Loading face recognition model/)).not.toBeInTheDocument())
    await user.click(screen.getByText('Enable Camera'))
    await waitFor(() => expect(screen.getByText('Start Scanning')).not.toBeDisabled())
    await user.click(screen.getByText('Start Scanning'))

    // First detection tick (~1s in) posts and shows feedback.
    await waitFor(() => expect(matchCalls).toBe(1), { timeout: 3000 })
    await waitFor(() => {
      expect(screen.getByText(/Ali Hassan/)).toBeInTheDocument()
    })

    // Subsequent ticks within the 4s cooldown must not re-POST.
    await new Promise((resolve) => setTimeout(resolve, 2000))
    expect(matchCalls).toBe(1)

    // Once the cooldown has elapsed, the next tick POSTs again.
    await waitFor(() => expect(matchCalls).toBe(2), { timeout: 4000 })
  }, 15000)

  it('lets the operator label a match result, which POSTs feedback for the returned event', async () => {
    mockGetUserMedia(vi.fn(() => Promise.resolve(fakeStream)))
    mockDetectSingleFace.mockResolvedValue({ descriptor: new Float32Array(128).fill(0.02) })

    server.use(
      http.post('/api/face-attendance/live/match/', () => HttpResponse.json({
        match_status: 'AUTO_MATCHED',
        student: { id: 9, name: 'Ali Hassan' },
        confidence: 91.2,
        event_id: 'evt-1',
        attendance_marked: true,
      }))
    )

    let feedbackBody = null
    server.use(
      http.post('/api/face-attendance/live/events/evt-1/feedback/', async ({ request }) => {
        feedbackBody = await request.json()
        return new HttpResponse(null, { status: 201 })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<FaceLiveCapturePage />)

    await waitFor(() => expect(screen.queryByText(/Loading face recognition model/)).not.toBeInTheDocument())
    await user.click(screen.getByText('Enable Camera'))
    await waitFor(() => expect(screen.getByText('Start Scanning')).not.toBeDisabled())
    await user.click(screen.getByText('Start Scanning'))

    await waitFor(() => expect(screen.getByText(/Ali Hassan/)).toBeInTheDocument())
    expect(screen.getByText('✓ Correct')).toBeInTheDocument()

    await user.click(screen.getByText('✓ Correct'))

    await waitFor(() => expect(feedbackBody).toEqual({ is_correct: true }))
    // The banner (and its buttons) clears immediately once labeled.
    expect(screen.queryByText('✓ Correct')).not.toBeInTheDocument()
  }, 15000)
})
