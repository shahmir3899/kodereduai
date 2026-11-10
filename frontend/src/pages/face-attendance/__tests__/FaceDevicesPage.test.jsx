import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import FaceDevicesPage from '../FaceDevicesPage'

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

const onlineDevice = {
  id: 1,
  name: 'Front Gate Camera',
  device_id: 'aaaa-bbbb',
  scope_type: 'SCHOOL',
  class_obj: null,
  class_obj_detail: null,
  embedding_version: 'dlib_v1',
  is_active: true,
  last_seen_at: new Date().toISOString(),
  created_at: '2026-07-01T00:00:00Z',
}

const offlineDevice = {
  id: 2,
  name: 'Class 1A Camera',
  device_id: 'cccc-dddd',
  scope_type: 'CLASS',
  class_obj: 1,
  class_obj_detail: { id: 1, name: 'Class 1A', section: 'A' },
  embedding_version: 'dlib_v1',
  is_active: true,
  last_seen_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
  created_at: '2026-07-01T00:00:00Z',
}

const neverConnectedDevice = {
  id: 3,
  name: 'New Camera',
  device_id: 'eeee-ffff',
  scope_type: 'SCHOOL',
  class_obj: null,
  class_obj_detail: null,
  embedding_version: 'dlib_v1',
  is_active: true,
  last_seen_at: null,
  created_at: '2026-07-01T00:00:00Z',
}

function mockDevices(devices) {
  server.use(
    http.get('/api/face-attendance/devices/', () =>
      HttpResponse.json({ count: devices.length, results: devices })
    )
  )
}

beforeEach(() => {
  mockNavigate.mockClear()
  window.localStorage.clear()
})

describe('FaceDevicesPage', () => {
  it('renders empty state when no devices exist', async () => {
    mockDevices([])
    renderWithProviders(<FaceDevicesPage />)

    await waitFor(() => {
      expect(screen.getByText(/No capture devices yet/)).toBeInTheDocument()
    })
  })

  it('shows a device seen within the offline threshold as Online', async () => {
    mockDevices([onlineDevice])
    renderWithProviders(<FaceDevicesPage />)

    await waitFor(() => {
      expect(screen.getByText('Front Gate Camera')).toBeInTheDocument()
    })
    expect(screen.getByText('Online')).toBeInTheDocument()
    expect(screen.getByText(/Whole school/)).toBeInTheDocument()
  })

  it('shows a device last seen over 5 minutes ago as Offline', async () => {
    mockDevices([offlineDevice])
    renderWithProviders(<FaceDevicesPage />)

    await waitFor(() => {
      expect(screen.getByText('Class 1A Camera')).toBeInTheDocument()
    })
    expect(screen.getByText(/Offline — last seen/)).toBeInTheDocument()
    expect(screen.getByText(/Class 1A ·/)).toBeInTheDocument()
  })

  it('shows a device that has never connected as never connected', async () => {
    mockDevices([neverConnectedDevice])
    renderWithProviders(<FaceDevicesPage />)

    await waitFor(() => {
      expect(screen.getByText('Never connected')).toBeInTheDocument()
    })
  })

  it('edit form submits changes via PATCH', async () => {
    mockDevices([onlineDevice])
    let patchedBody = null
    server.use(
      http.patch('/api/face-attendance/devices/:id/', async ({ request }) => {
        patchedBody = await request.json()
        return HttpResponse.json({ ...onlineDevice, ...patchedBody })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<FaceDevicesPage />)

    await waitFor(() => {
      expect(screen.getByText('Front Gate Camera')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Edit'))
    const nameInput = screen.getByDisplayValue('Front Gate Camera')
    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed Camera')
    await user.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(patchedBody).toMatchObject({ name: 'Renamed Camera' })
    })
  })

  it('links to the live events page', async () => {
    mockDevices([])
    renderWithProviders(<FaceDevicesPage />)

    await waitFor(() => {
      expect(screen.getByText('Live Events')).toBeInTheDocument()
    })
  })

  describe('Add Device', () => {
    const browserDevice = {
      id: 7, name: 'Gate Tablet', device_id: 'g-1', scope_type: 'SCHOOL', class_obj: null, class_obj_detail: null,
      embedding_version: 'faceapi_v1', is_active: true, last_seen_at: null, created_at: '2026-07-01T00:00:00Z',
    }

    it('registers a browser device, shows its key once, and starts the auto camera on this device', async () => {
      mockDevices([])
      let postedBody = null
      server.use(
        http.post('/api/face-attendance/devices/', async ({ request }) => {
          postedBody = await request.json()
          return HttpResponse.json({ ...browserDevice, name: postedBody.name, api_key: 'SECRET-KEY-123' }, { status: 201 })
        })
      )
      const user = userEvent.setup()
      renderWithProviders(<FaceDevicesPage />)

      await user.click(await screen.findByText('Add Device'))
      await user.type(screen.getByLabelText('Name'), 'Gate Tablet')
      await user.click(screen.getByRole('button', { name: 'Add device' }))

      // Defaults: runs in this browser (faceapi_v1), whole school.
      await waitFor(() => expect(postedBody).toEqual({
        name: 'Gate Tablet', scope_type: 'SCHOOL', class_obj: null, embedding_version: 'faceapi_v1',
      }))
      expect(await screen.findByTestId('device-key')).toHaveTextContent('SECRET-KEY-123')
      expect(screen.getByText(/shown only once/i)).toBeInTheDocument()

      await user.click(screen.getByText('Start auto camera on this device'))
      expect(window.localStorage.getItem('faceAutoCamera:7')).toBe('SECRET-KEY-123')
      expect(mockNavigate).toHaveBeenCalledWith('/face-attendance/auto-camera/7')
    })

    it('for an on-prem mini PC shows setup steps instead of an auto camera button', async () => {
      mockDevices([])
      let postedBody = null
      server.use(
        http.post('/api/face-attendance/devices/', async ({ request }) => {
          postedBody = await request.json()
          return HttpResponse.json({ ...browserDevice, embedding_version: 'dlib_v1', api_key: 'K' }, { status: 201 })
        })
      )
      const user = userEvent.setup()
      renderWithProviders(<FaceDevicesPage />)

      await user.click(await screen.findByText('Add Device'))
      await user.type(screen.getByLabelText('Name'), 'Mini PC')
      await user.click(screen.getByLabelText(/An on-prem mini PC/))
      await user.click(screen.getByRole('button', { name: 'Add device' }))

      await waitFor(() => expect(postedBody.embedding_version).toBe('dlib_v1'))
      expect(await screen.findByTestId('onprem-steps')).toHaveTextContent('docker compose up')
      expect(screen.queryByText('Start auto camera on this device')).not.toBeInTheDocument()
    })

    it('needs a name, and a class when the device is for one class', async () => {
      mockDevices([])
      const user = userEvent.setup()
      renderWithProviders(<FaceDevicesPage />)

      await user.click(await screen.findByText('Add Device'))
      const submit = screen.getByRole('button', { name: 'Add device' })
      expect(submit).toBeDisabled()

      await user.type(screen.getByLabelText('Name'), 'Room 1')
      expect(submit).not.toBeDisabled()

      await user.click(screen.getByLabelText(/One class/))
      expect(submit).toBeDisabled() // a class must be picked
    })

    it('a listed browser device can be started here when this browser already has its key', async () => {
      mockDevices([browserDevice])
      window.localStorage.setItem('faceAutoCamera:7', 'KEEP')
      const user = userEvent.setup()
      renderWithProviders(<FaceDevicesPage />)

      await user.click(await screen.findByText('Start auto camera'))
      expect(mockNavigate).toHaveBeenCalledWith('/face-attendance/auto-camera/7')
    })

    it('without the key, setting this browser up generates a new one after confirmation', async () => {
      mockDevices([browserDevice])
      let rotated = false
      server.use(
        http.post('/api/face-attendance/devices/:id/rotate_key/', () => {
          rotated = true
          return HttpResponse.json({ ...browserDevice, api_key: 'NEW-KEY' })
        })
      )
      const user = userEvent.setup()
      renderWithProviders(<FaceDevicesPage />)

      await user.click(await screen.findByText('Start auto camera'))
      expect(rotated).toBe(false) // asks first — the old key would stop working
      await user.click(await screen.findByText('Generate new key'))

      await waitFor(() => expect(rotated).toBe(true))
      expect(await screen.findByTestId('device-key')).toHaveTextContent('NEW-KEY')
    })

    it('Reset key asks for confirmation, then shows the new key once', async () => {
      mockDevices([onlineDevice])
      let rotated = false
      server.use(
        http.post('/api/face-attendance/devices/:id/rotate_key/', () => {
          rotated = true
          return HttpResponse.json({ ...onlineDevice, api_key: 'ROTATED' })
        })
      )
      const user = userEvent.setup()
      renderWithProviders(<FaceDevicesPage />)

      await user.click(await screen.findByText('Reset key'))
      expect(rotated).toBe(false)
      await user.click(screen.getAllByText('Reset key').at(-1)) // the modal's confirm button

      await waitFor(() => expect(rotated).toBe(true))
      expect(await screen.findByTestId('device-key')).toHaveTextContent('ROTATED')
    })
  })
})
