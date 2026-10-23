import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/utils'
import OverdueBooksPage from '../library/OverdueBooksPage'
import TransportAssignmentsPage from '../transport/TransportAssignmentsPage'
import ItemAssignmentsPage from '../inventory/ItemAssignmentsPage'

// Pages must not call endpoints their role is refused (each of these produced a 403 in the role crawl).
let role = 'SCHOOL_ADMIN'
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role, schools: [{ id: 1 }] },
    effectiveRole: role,
    activeSchool: { id: 1, name: 'Test School' },
    isStaffMember: false, isPrincipal: false, isSchoolAdmin: role === 'SCHOOL_ADMIN',
    isModuleEnabled: () => true,
  }),
}))
vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(), addToast: vi.fn() }),
}))
vi.mock('../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 1, name: '2025-2026' }, hasAcademicYear: true }),
}))

const seen = []
const track = ({ request }) => seen.push(new URL(request.url).pathname)

beforeAll(() => server.events.on('request:start', track))
afterAll(() => server.events.removeListener('request:start', track))
beforeEach(() => {
  seen.length = 0
  server.use(
    http.get('*/api/*', () => HttpResponse.json({ results: [], count: 0 })),
  )
})

const called = (path) => seen.some((p) => p.startsWith(path))
const settle = () => new Promise((r) => setTimeout(r, 600))

describe('library overdue page', () => {
  it('loads the fine config only for admins', async () => {
    role = 'TEACHER'
    renderWithProviders(<OverdueBooksPage />)
    await settle()
    expect(called('/api/library/issues/overdue')).toBe(true)
    expect(called('/api/library/config/')).toBe(false)
  })

  it('still loads it for a school admin', async () => {
    role = 'SCHOOL_ADMIN'
    renderWithProviders(<OverdueBooksPage />)
    await waitFor(() => expect(called('/api/library/config/')).toBe(true))
  })
})

describe('transport assignments page', () => {
  it('does not load the student roster for a role that cannot assign', async () => {
    role = 'DRIVER'
    renderWithProviders(<TransportAssignmentsPage />)
    await settle()
    expect(called('/api/transport/assignments')).toBe(true)
    expect(called('/api/students/')).toBe(false)
    expect(called('/api/classes/')).toBe(false)
  })

  it('loads it for a school admin', async () => {
    role = 'SCHOOL_ADMIN'
    renderWithProviders(<TransportAssignmentsPage />)
    await waitFor(() => expect(called('/api/students/')).toBe(true))
  })
})

describe('item assignments page', () => {
  it('does not load the user list for an accountant', async () => {
    role = 'ACCOUNTANT'
    renderWithProviders(<ItemAssignmentsPage />)
    await settle()
    expect(called('/api/inventory/assignments')).toBe(true)
    expect(called('/api/users/')).toBe(false)
  })

  it('loads it for a school admin', async () => {
    role = 'SCHOOL_ADMIN'
    renderWithProviders(<ItemAssignmentsPage />)
    await waitFor(() => expect(called('/api/users/')).toBe(true))
  })
})
