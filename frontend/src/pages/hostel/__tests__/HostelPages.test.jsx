import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import HostelRoomsPage from '../HostelRoomsPage'
import HostelAllocationsPage from '../HostelAllocationsPage'
import GatePassesPage from '../GatePassesPage'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN' },
    effectiveRole: 'SCHOOL_ADMIN',
    activeSchool: { id: 1, name: 'Test School' },
  }),
}))

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}))

vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({
    activeAcademicYear: { id: 7, name: '2026-2027' },
    academicYears: [{ id: 7, name: '2026-2027' }],
  }),
}))

const page = (results) => HttpResponse.json({ count: results.length, results })

const hostel = { id: 1, name: 'Al-Falah', hostel_type: 'BOYS', capacity: 40, is_active: true, current_occupancy: 1, rooms_count: 2 }

describe('Hostel rooms', () => {
  it('offers only the room types the API accepts and defaults to Double', async () => {
    server.use(
      http.get('/api/hostel/hostels/', () => page([hostel])),
      http.get('/api/hostel/rooms/', () => page([])),
    )
    const user = userEvent.setup()
    renderWithProviders(<HostelRoomsPage />)

    await user.click(await screen.findByRole('button', { name: 'Rooms' }))
    await user.selectOptions(await screen.findByRole('combobox'), '1')
    await user.click(await screen.findByRole('button', { name: 'Add Room' }))

    const type = await screen.findByLabelText(/room type/i)
    expect(type).toHaveValue('DOUBLE')
    expect([...type.options].map((o) => o.value)).toEqual(['SINGLE', 'DOUBLE', 'DORMITORY'])
  })

  it('labels a full room Full and an unavailable room Unavailable', async () => {
    server.use(
      http.get('/api/hostel/hostels/', () => page([hostel])),
      http.get('/api/hostel/rooms/', () => page([
        { id: 1, hostel: 1, room_number: '101', floor: 1, room_type: 'DOUBLE', capacity: 2, current_occupancy: 2, is_full: true, is_available: true },
        { id: 2, hostel: 1, room_number: '102', floor: 1, room_type: 'DOUBLE', capacity: 2, current_occupancy: 0, is_full: false, is_available: false },
      ])),
    )
    const user = userEvent.setup()
    renderWithProviders(<HostelRoomsPage />)
    await user.click(await screen.findByRole('button', { name: 'Rooms' }))
    await user.selectOptions(await screen.findByRole('combobox'), '1')

    expect(await screen.findByText('Full')).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
  })
})

describe('Hostel allocations', () => {
  const alloc = {
    id: 5, student: 11, student_name: 'Ali Hassan', student_class_name: 'Class 1 - A',
    room: 3, room_number: '101', hostel_name: 'Al-Falah', academic_year: 7,
    academic_year_name: '2026-2027', allocated_date: '2026-10-01', is_active: true,
  }

  it('shows Vacate for an active allocation and filters with is_active', async () => {
    let seen = null
    server.use(
      http.get('/api/hostel/hostels/', () => page([hostel])),
      http.get('/api/hostel/allocations/', ({ request }) => {
        seen = new URL(request.url).searchParams
        return page([alloc])
      }),
    )
    renderWithProviders(<HostelAllocationsPage />)

    expect((await screen.findAllByText('Ali Hassan')).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Vacate' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('2026-2027').length).toBeGreaterThan(0)
    await waitFor(() => expect(seen.get('is_active')).toBe('true'))
    expect(seen.get('status')).toBeNull()
  })

  it('hides Vacate for a vacated allocation', async () => {
    server.use(
      http.get('/api/hostel/hostels/', () => page([hostel])),
      http.get('/api/hostel/allocations/', () => page([{ ...alloc, is_active: false, vacated_date: '2026-10-05' }])),
    )
    renderWithProviders(<HostelAllocationsPage />)
    expect((await screen.findAllByText('Ali Hassan')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Vacate' })).not.toBeInTheDocument()
  })
})

describe('Gate passes', () => {
  const base = {
    student: 11, student_name: 'Ali Hassan', hostel_name: 'Al-Falah', room_number: '101',
    pass_type: 'DAY', reason: 'Family visit', going_to: 'Lahore',
    departure_date: '2026-10-05T08:00:00Z', expected_return: '2026-10-05T18:00:00Z',
  }

  it('offers Check Out for APPROVED and Mark Returned for USED passes', async () => {
    server.use(
      http.get('/api/hostel/gate-passes/', () => page([
        { ...base, id: 1, status: 'APPROVED' },
        { ...base, id: 2, status: 'USED', student_name: 'Usman Ahmed' },
      ])),
    )
    renderWithProviders(<GatePassesPage />)

    expect((await screen.findAllByRole('button', { name: 'Check Out' })).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Mark Returned' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Checked Out').length).toBeGreaterThan(0)
  })

  it('creates a pass from the chosen allocation, sending numeric ids', async () => {
    let body = null
    server.use(
      http.get('/api/hostel/gate-passes/', () => page([])),
      http.get('/api/hostel/allocations/', () => page([
        { id: 5, student: 11, student_name: 'Ali Hassan', hostel_name: 'Al-Falah', room_number: '101', is_active: true },
      ])),
      http.post('/api/hostel/gate-passes/', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ id: 9 }, { status: 201 })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<GatePassesPage />)

    await user.click(await screen.findByRole('button', { name: 'New Gate Pass' }))
    await user.selectOptions(await screen.findByLabelText(/^student/i), '5')
    await user.type(screen.getByLabelText(/reason/i), 'Family visit')
    await user.type(screen.getByLabelText(/going to/i), 'Lahore')
    // Both times start filled in (next hour, +8h); the admin can change them.
    expect(screen.getByLabelText(/departure date/i).value).not.toBe('')
    fireEvent.change(screen.getByLabelText(/departure date/i), { target: { value: '2027-04-04T08:00' } })
    fireEvent.change(screen.getByLabelText(/expected return/i), { target: { value: '2027-04-04T18:00' } })
    await user.click(screen.getByRole('button', { name: 'Create Gate Pass' }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body.student).toBe(11)
    expect(body.allocation).toBe(5)
  })
})
