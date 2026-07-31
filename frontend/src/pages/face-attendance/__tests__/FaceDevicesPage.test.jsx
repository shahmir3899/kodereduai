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
})

describe('FaceDevicesPage', () => {
  it('renders empty state when no devices exist', async () => {
    mockDevices([])
    renderWithProviders(<FaceDevicesPage />)

    await waitFor(() => {
      expect(screen.getByText(/No capture devices registered yet/)).toBeInTheDocument()
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
})
