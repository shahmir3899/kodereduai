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
  getFramingHint: () => ({ status: 'good', message: null }),
  estimateQualityScore: () => 0.8,
  LIVE_MOBILE_EMBEDDING_VERSION: 'faceapi_v1',
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
      // No navigator.mediaDevices at all is reported as the generic "error" camera status.
      expect(screen.getByText(/Could not start the camera/)).toBeInTheDocument()
    })
  })

  it('debounces detections (one POST per cooldown window) and shows match feedback', async () => {
    // Real setInterval/network timing (not vi.useFakeTimers, which doesn't
    // play well with MSW's request handling) — the 4s cooldown is exercised
    // with real waits, kept as short as the component's own constants allow.
    mockGetUserMedia(vi.fn(() => Promise.resolve(fakeStream)))
    mockDetectSingleFace.mockResolvedValue({
      descriptor: new Float32Array(128).fill(0.02),
      detection: { box: { x: 10, y: 10, width: 100, height: 100 } }, // the page reads this for the match thumbnail
    })

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
    // The name shows in the match banner and again in the recent-matches strip.
    await waitFor(() => {
      expect(screen.getAllByText(/Ali Hassan/).length).toBeGreaterThan(0)
    })

    // Subsequent ticks within the 4s cooldown must not re-POST.
    await new Promise((resolve) => setTimeout(resolve, 2000))
    expect(matchCalls).toBe(1)

    // Once the cooldown has elapsed, the next tick POSTs again.
    await waitFor(() => expect(matchCalls).toBe(2), { timeout: 4000 })
  }, 15000)

  it('lets the operator label a match result, which POSTs feedback for the returned event', async () => {
    mockGetUserMedia(vi.fn(() => Promise.resolve(fakeStream)))
    mockDetectSingleFace.mockResolvedValue({
      descriptor: new Float32Array(128).fill(0.02),
      detection: { box: { x: 10, y: 10, width: 100, height: 100 } }, // the page reads this for the match thumbnail
    })

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

    // The name shows in the match banner and again in the recent-matches strip.
    await waitFor(() => expect(screen.getAllByText(/Ali Hassan/).length).toBeGreaterThan(0))
    expect(screen.getByText('✓ Correct')).toBeInTheDocument()

    await user.click(screen.getByText('✓ Correct'))

    await waitFor(() => expect(feedbackBody).toEqual({ is_correct: true }))
    // The banner (and its buttons) clears immediately once labeled.
    expect(screen.queryByText('✓ Correct')).not.toBeInTheDocument()
  }, 15000)

  describe('uncertain match: "Is this <name>?" on the camera view', () => {
    const FLAGGED = {
      match_status: 'FLAGGED',
      student: { id: 9, name: 'Ali Hassan' },
      confidence: 20,
      event_id: 'evt-9',
      attendance_marked: false,
      alternatives: [{ id: 12, name: 'Sara Khan', confidence: 14 }],
    }

    async function startScanningWithFlaggedMatch({ onMatch } = {}) {
      mockGetUserMedia(vi.fn(() => Promise.resolve(fakeStream)))
      mockDetectSingleFace.mockResolvedValue({
        descriptor: new Float32Array(128).fill(0.02),
        detection: { box: { x: 10, y: 10, width: 100, height: 100 } },
      })
      server.use(
        http.post('/api/face-attendance/live/match/', () => {
          onMatch?.()
          return HttpResponse.json(FLAGGED)
        })
      )
      const user = userEvent.setup()
      renderWithProviders(<FaceLiveCapturePage />)
      await waitFor(() => expect(screen.queryByText(/Loading face recognition model/)).not.toBeInTheDocument())
      await user.click(screen.getByText('Enable Camera'))
      await waitFor(() => expect(screen.getByText('Start Scanning')).not.toBeDisabled())
      await user.click(screen.getByText('Start Scanning'))
      return user
    }

    it('mirrors the live view like a selfie camera', async () => {
      mockGetUserMedia(vi.fn(() => Promise.resolve(fakeStream)))
      renderWithProviders(<FaceLiveCapturePage />)
      expect(document.querySelector('video').style.transform).toBe('scaleX(-1)')
    })

    it('shows Yes / No with the suggested name, and Yes marks that student present', async () => {
      let confirmBody = null
      server.use(
        http.post('/api/face-attendance/live/events/evt-9/confirm/', async ({ request }) => {
          confirmBody = await request.json()
          return HttpResponse.json({ attendance_marked: true, already_marked: false, student: { id: 9, name: 'Ali Hassan' } })
        })
      )
      const user = await startScanningWithFlaggedMatch()

      const prompt = await screen.findByTestId('confirm-prompt', {}, { timeout: 4000 })
      expect(prompt).toHaveTextContent('Is this Ali Hassan?')
      expect(screen.getByText('Sara Khan')).toBeInTheDocument() // alternative shown as a button

      await user.click(screen.getByRole('button', { name: 'Yes' }))

      await waitFor(() => expect(confirmBody).toEqual({ student_id: 9 }))
      await waitFor(() => expect(screen.queryByTestId('confirm-prompt')).not.toBeInTheDocument())
      await waitFor(() => expect(screen.getByText(/confirmed and marked present/)).toBeInTheDocument())
    }, 15000)

    it('tapping an alternative confirms that student instead', async () => {
      let confirmBody = null
      server.use(
        http.post('/api/face-attendance/live/events/evt-9/confirm/', async ({ request }) => {
          confirmBody = await request.json()
          return HttpResponse.json({ attendance_marked: true, already_marked: false, student: { id: 12, name: 'Sara Khan' } })
        })
      )
      const user = await startScanningWithFlaggedMatch()
      await screen.findByTestId('confirm-prompt', {}, { timeout: 4000 })

      await user.click(screen.getByRole('button', { name: 'Sara Khan' }))

      await waitFor(() => expect(confirmBody).toEqual({ student_id: 12 }))
    }, 15000)

    it('No marks nothing, labels the suggestion wrong, and does not re-ask right away', async () => {
      let confirmCalls = 0
      let feedbackBody = null
      let matchCalls = 0
      server.use(
        http.post('/api/face-attendance/live/events/evt-9/confirm/', () => {
          confirmCalls += 1
          return HttpResponse.json({})
        }),
        http.post('/api/face-attendance/live/events/evt-9/feedback/', async ({ request }) => {
          feedbackBody = await request.json()
          return new HttpResponse(null, { status: 201 })
        }),
      )
      const user = await startScanningWithFlaggedMatch({ onMatch: () => { matchCalls += 1 } })
      await screen.findByTestId('confirm-prompt', {}, { timeout: 4000 })

      await user.click(screen.getByRole('button', { name: 'No' }))

      await waitFor(() => expect(feedbackBody).toEqual({ is_correct: false }))
      expect(confirmCalls).toBe(0)
      expect(screen.queryByTestId('confirm-prompt')).not.toBeInTheDocument()

      // Scanning resumes (a second match request goes out after the post cooldown),
      // but the same student is not asked about again within the prompt cooldown.
      await waitFor(() => expect(matchCalls).toBeGreaterThanOrEqual(2), { timeout: 7000 })
      expect(screen.queryByTestId('confirm-prompt')).not.toBeInTheDocument()
    }, 20000)

    it('holds scanning while the question is open', async () => {
      let matchCalls = 0
      await startScanningWithFlaggedMatch({ onMatch: () => { matchCalls += 1 } })
      await screen.findByTestId('confirm-prompt', {}, { timeout: 4000 })
      expect(matchCalls).toBe(1)

      await new Promise((resolve) => setTimeout(resolve, 5000)) // longer than the 4s post cooldown
      expect(matchCalls).toBe(1)
      expect(screen.getByTestId('confirm-prompt')).toBeInTheDocument()
    }, 20000)
  })
})
