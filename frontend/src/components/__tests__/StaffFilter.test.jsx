import { screen, waitFor, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderWithProviders } from '../../test/utils'
import { server } from '../../test/mocks/server'
import StaffFilter from '../StaffFilter'

const TEACHERS = [
  { id: 1, full_name: 'Ali Khan', employee_id: 'T001', designation_name: 'Senior Teacher', user_role: 'TEACHER' },
  { id: 2, full_name: 'Sara Ahmed', employee_id: 'T002', designation_name: 'Teacher', user_role: 'TEACHER' },
]

const MIXED_STAFF = [
  ...TEACHERS,
  { id: 3, full_name: 'Bilal Admin', employee_id: 'A001', designation_name: 'Vice Principal', user_role: 'SCHOOL_ADMIN' },
]

function mockStaffEndpoint(list) {
  server.use(
    http.get('/api/hr/staff/', () => HttpResponse.json({ count: list.length, results: list })),
  )
}

/** Mimics hr/views.py: role filters on user__role, so a role param narrows the list. */
function mockStaffEndpointWithRoleFilter(list) {
  server.use(
    http.get('/api/hr/staff/', ({ request }) => {
      const role = new URL(request.url).searchParams.get('role')
      const filtered = role ? list.filter((s) => s.user_role === role) : list
      return HttpResponse.json({ count: filtered.length, results: filtered })
    }),
  )
}

afterEach(() => {
  server.resetHandlers()
})

describe('StaffFilter', () => {
  it('shows the placeholder when nothing is selected', async () => {
    mockStaffEndpoint(TEACHERS)
    renderWithProviders(<StaffFilter value="" onChange={() => {}} placeholder="Select Teacher" />)
    expect(screen.getByRole('button', { name: 'Select Teacher' })).toBeInTheDocument()
  })

  it('opens on click and lists staff with employee ID, designation and role badge', async () => {
    mockStaffEndpoint(TEACHERS)
    renderWithProviders(<StaffFilter value="" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByText('Ali Khan')).toBeInTheDocument()
    })
    expect(screen.getByText('T001 · Senior Teacher')).toBeInTheDocument()
    expect(screen.getAllByText('Teacher').length).toBeGreaterThan(0)
  })

  it('filters the list by search text (name or employee ID)', async () => {
    mockStaffEndpoint(TEACHERS)
    renderWithProviders(<StaffFilter value="" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByText('Ali Khan')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('Search by name or employee ID...'), {
      target: { value: 'T002' },
    })

    expect(screen.queryByText('Ali Khan')).not.toBeInTheDocument()
    expect(screen.getByText('Sara Ahmed')).toBeInTheDocument()
  })

  it('calls onChange with the selected staff id and closes the panel', async () => {
    mockStaffEndpoint(TEACHERS)
    let selected = ''
    const handleChange = (e) => { selected = e.target.value }
    renderWithProviders(<StaffFilter value="" onChange={handleChange} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByText('Sara Ahmed')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Sara Ahmed'))

    expect(selected).toBe('2')
    expect(screen.queryByPlaceholderText('Search by name or employee ID...')).not.toBeInTheDocument()
  })

  it('falls back to the unfiltered list when a role filter returns nothing (unlinked StaffMember rows)', async () => {
    // Regression guard for SubjectsPage's old manual fallback, now built into
    // the component itself (hr/views.py filters role via user__role, so a
    // StaffMember without a linked User never matches a role filter).
    mockStaffEndpointWithRoleFilter([
      { id: 5, full_name: 'Unlinked Teacher', employee_id: 'T099', designation_name: 'Teacher', user_role: null },
    ])
    renderWithProviders(<StaffFilter value="" onChange={() => {}} role="TEACHER" placeholder="Select Teacher" />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByText('Unlinked Teacher')).toBeInTheDocument()
    })
  })

  it('does not fall back when the role filter genuinely has matches', async () => {
    mockStaffEndpointWithRoleFilter(MIXED_STAFF)
    renderWithProviders(<StaffFilter value="" onChange={() => {}} role="TEACHER" placeholder="Select Teacher" />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(screen.getByText('Ali Khan')).toBeInTheDocument())
    expect(screen.getByText('Sara Ahmed')).toBeInTheDocument()
    expect(screen.queryByText('Bilal Admin')).not.toBeInTheDocument()
  })

  it('uses the options prop instead of fetching when provided', async () => {
    // If this ever fell through to a live fetch, the empty default handler
    // registered for this test would surface as "No staff found."
    server.use(http.get('/api/hr/staff/', () => HttpResponse.json({ count: 0, results: [] })))
    renderWithProviders(<StaffFilter value="" onChange={() => {}} options={TEACHERS} />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByText('Ali Khan')).toBeInTheDocument()
    })
    expect(screen.queryByText('No staff found.')).not.toBeInTheDocument()
  })

  it('renders the selected staff member in the trigger', async () => {
    mockStaffEndpoint(TEACHERS)
    renderWithProviders(<StaffFilter value="2" onChange={() => {}} />)
    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveTextContent('Sara Ahmed (T002)')
    })
  })

  it('shows the "all" option and lets it clear the selection', async () => {
    mockStaffEndpoint(TEACHERS)
    let selected = 'placeholder-untouched'
    const handleChange = (e) => { selected = e.target.value }
    renderWithProviders(
      <StaffFilter value="1" onChange={handleChange} showAllOption allOptionLabel="All staff" />,
    )
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByText('All staff')).toBeInTheDocument())

    fireEvent.click(screen.getByText('All staff'))

    expect(selected).toBe('')
  })
})
