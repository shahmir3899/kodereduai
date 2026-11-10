import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import FaceAutoCameraPage from '../FaceAutoCameraPage'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ deviceId: '7' }),
  }
})

const mockDetectSingleFace = vi.fn()
vi.mock('../../../utils/faceApiLoader', () => ({
  loadFaceApiModels: vi.fn(() => Promise.resolve()),
  detectSingleFace: (...args) => mockDetectSingleFace(...args),
  LIVE_MOBILE_EMBEDDING_VERSION: 'faceapi_v1',
}))

const fakeStream = { getTracks: () => [{ stop: vi.fn() }] }

const browserDevice = {
  id: 7, name: 'Gate Tablet', device_id: 'g-1', scope_type: 'SCHOOL', class_obj: null, class_obj_detail: null,
  embedding_version: 'faceapi_v1', is_active: true, last_seen_at: null, created_at: '2026-07-01T00:00:00Z',
}

function mockDevices(devices) {
  server.use(
    http.get('/api/face-attendance/devices/', () => HttpResponse.json({ count: devices.length, results: devices }))
  )
}

// Serves live-match answers and records each request's headers/body.
function mockLiveMatch(respond) {
  const calls = []
  server.use(
    http.post('/api/face-attendance/live/match/', async ({ request }) => {
      calls.push({ headers: Object.fromEntries(request.headers.entries()), body: await request.json() })
      return respond(calls.length)
    })
  )
  return calls
}

async function startScanning(user) {
  const start = await screen.findByText('Start')
  await waitFor(() => expect(start).not.toBeDisabled())
  await user.click(start)
}

beforeEach(() => {
  mockNavigate.mockClear()
  window.localStorage.clear()
  window.localStorage.setItem('faceAutoCamera:7', 'DEVICE-KEY-7')
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(() => Promise.resolve(fakeStream)) },
  })
  mockDetectSingleFace.mockReset().mockResolvedValue({ descriptor: new Float32Array(128).fill(0.03) })
  mockDevices([browserDevice])
})

describe('FaceAutoCameraPage', () => {
  it('explains why it cannot run when this browser has no key for the device', async () => {
    window.localStorage.clear()
    renderWithProviders(<FaceAutoCameraPage />)
    expect(await screen.findByTestId('auto-camera-blocker')).toHaveTextContent(/doesn't have the device's key/)
    expect(screen.queryByText('Start')).not.toBeInTheDocument()
  })

  it('refuses a device that runs on a mini PC rather than in a browser', async () => {
    mockDevices([{ ...browserDevice, embedding_version: 'dlib_v1' }])
    renderWithProviders(<FaceAutoCameraPage />)
    expect(await screen.findByTestId('auto-camera-blocker')).toHaveTextContent(/mini PC/)
  })

  it('refuses a switched-off device', async () => {
    mockDevices([{ ...browserDevice, is_active: false }])
    renderWithProviders(<FaceAutoCameraPage />)
    expect(await screen.findByTestId('auto-camera-blocker')).toHaveTextContent(/switched off/)
  })

  it('mirrors the preview like a selfie view', async () => {
    renderWithProviders(<FaceAutoCameraPage />)
    await screen.findByText('Start')
    expect(document.querySelector('video').style.transform).toBe('scaleX(-1)')
  })

  it('signs scans with the device key (not a user login) and flashes a confident match', async () => {
    const calls = mockLiveMatch(() => HttpResponse.json({
      match_status: 'AUTO_MATCHED', student: { id: 9, name: 'Ali Hassan' }, confidence: 93,
      event_id: 'e1', attendance_marked: true, alternatives: [],
    }))
    const user = userEvent.setup()
    renderWithProviders(<FaceAutoCameraPage />)
    await startScanning(user)

    const flash = await screen.findByTestId('match-flash', {}, { timeout: 4000 })
    expect(flash).toHaveTextContent('Ali Hassan')
    expect(flash).toHaveTextContent('Marked present')
    expect(screen.getByTestId('marked-count')).toHaveTextContent('1')

    expect(calls[0].headers['x-device-key']).toBe('DEVICE-KEY-7')
    expect(calls[0].headers.authorization).toBeUndefined()
    expect(calls[0].body.embedding_version).toBe('faceapi_v1')
    expect(calls[0].body.embedding).toHaveLength(128)
  }, 10000)

  it('says "already marked" without counting it again', async () => {
    mockLiveMatch(() => HttpResponse.json({
      match_status: 'AUTO_MATCHED', student: { id: 9, name: 'Ali Hassan' }, confidence: 93,
      event_id: 'e1', attendance_marked: false, alternatives: [],
    }))
    const user = userEvent.setup()
    renderWithProviders(<FaceAutoCameraPage />)
    await startScanning(user)

    expect(await screen.findByTestId('match-flash', {}, { timeout: 4000 })).toHaveTextContent('Already marked today')
    expect(screen.getByTestId('marked-count')).toHaveTextContent('0')
  }, 10000)

  it('ignores uncertain matches — nobody is there to answer a question', async () => {
    const calls = mockLiveMatch(() => HttpResponse.json({
      match_status: 'FLAGGED', student: { id: 9, name: 'Ali Hassan' }, confidence: 20,
      event_id: 'e2', attendance_marked: false, alternatives: [{ id: 12, name: 'Sara Khan', confidence: 15 }],
    }))
    const user = userEvent.setup()
    renderWithProviders(<FaceAutoCameraPage />)
    await startScanning(user)

    await waitFor(() => expect(calls.length).toBeGreaterThan(0), { timeout: 4000 })
    expect(screen.queryByTestId('match-flash')).not.toBeInTheDocument()
    expect(screen.queryByText('Is this Ali Hassan?')).not.toBeInTheDocument()
    expect(screen.getByTestId('marked-count')).toHaveTextContent('0')
  }, 10000)

  it('stops and explains when the server rejects the device key', async () => {
    mockLiveMatch(() => HttpResponse.json({ detail: 'Invalid or inactive device key.' }, { status: 401 }))
    const user = userEvent.setup()
    renderWithProviders(<FaceAutoCameraPage />)
    await startScanning(user)

    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent(/device key was rejected/)
    expect(await screen.findByText('Start')).toBeInTheDocument() // back to stopped
  }, 10000)

  it('keeps trying when the server cannot be reached', async () => {
    mockLiveMatch(() => HttpResponse.json({ detail: 'oops' }, { status: 500 }))
    const user = userEvent.setup()
    renderWithProviders(<FaceAutoCameraPage />)
    await startScanning(user)

    expect(await screen.findByRole('status', {}, { timeout: 4000 })).toHaveTextContent(/still trying/)
    expect(screen.queryByText('Start')).not.toBeInTheDocument() // still running
  }, 10000)
})
