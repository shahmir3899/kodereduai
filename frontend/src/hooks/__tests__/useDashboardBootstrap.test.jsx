import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const auth = { activeSchool: { id: 5 }, isModuleEnabled: () => true, effectiveRole: 'SCHOOL_ADMIN' }
const year = { activeAcademicYear: { id: 7 }, loading: false }
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../../contexts/AcademicYearContext', () => ({ useAcademicYear: () => year }))

const api = {
  getAdminDashboard: vi.fn(),
  getStats: vi.fn(),
  getDashboard: vi.fn(),
  getDashboardStats: vi.fn(),
  getEnquiries: vi.fn(),
}
vi.mock('../../services/api', () => ({
  bootstrapApi: { getAdminDashboard: (...a) => api.getAdminDashboard(...a) },
  libraryApi: { getStats: (...a) => api.getStats(...a) },
  hostelApi: { getDashboard: (...a) => api.getDashboard(...a) },
  inventoryApi: { getDashboard: (...a) => api.getDashboard(...a) },
  transportApi: { getDashboardStats: (...a) => api.getDashboardStats(...a) },
  admissionsApi: { getEnquiries: (...a) => api.getEnquiries(...a) },
}))

// Short timeout so the "slow bootstrap" case does not need fake timers.
vi.mock('../../utils/dashboardBootstrap', async (importOriginal) => ({
  ...(await importOriginal()),
  DASHBOARD_BOOTSTRAP_TIMEOUT_MS: 30,
}))

import { useDashboardBootstrap } from '../useDashboardBootstrap'

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const withClient = (client) => ({ children }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

const full = {
  attendance: { total_students: 10 },
  hr: { total_staff: 3 },
  finance: { total_due: 1 },
  transport: { total_routes: 2 },
  library: { total_books: 4 },
  hostel: { total_hostels: 1 },
  inventory: { total_items: 9 },
  admissions_new_count: 6,
}

describe('useDashboardBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.effectiveRole = 'SCHOOL_ADMIN'
    auth.isModuleEnabled = () => true
    year.loading = false
  })

  it('holds the tiles back until the combined call has seeded their query keys', async () => {
    let release
    api.getAdminDashboard.mockReturnValue(new Promise((r) => { release = r }))
    const client = makeClient()
    const { result } = renderHook(() => useDashboardBootstrap(), { wrapper: withClient(client) })

    expect(result.current).toEqual({ settled: false, waiting: true })

    release({ data: full })
    await waitFor(() => expect(result.current.settled).toBe(true))

    const today = new Date().toISOString().split('T')[0]
    // Seeded under the academic-year id the tiles use (7), not a different one.
    expect(client.getQueryData(['dailyReport', today, 5, 7])).toEqual({ data: full.attendance })
    expect(client.getQueryData(['hrDashboardStats'])).toEqual({ data: full.hr })
    expect(client.getQueryData(['transportDashboard'])).toEqual({ data: full.transport })
    expect(client.getQueryData(['libraryStats'])).toEqual({ data: full.library })
    expect(client.getQueryData(['hostelDashboard'])).toEqual({ data: full.hostel })
    expect(client.getQueryData(['inventoryDashboard'])).toEqual({ data: full.inventory })
    expect(client.getQueryData(['admissionsNewCount'])).toEqual({ data: { count: 6 } })
    expect(api.getAdminDashboard).toHaveBeenCalledTimes(1)
    expect(api.getAdminDashboard).toHaveBeenCalledWith(expect.objectContaining({ academic_year: 7 }))
  })

  it('a section the server nulls falls back to that module\'s own endpoint', async () => {
    api.getAdminDashboard.mockResolvedValue({ data: { ...full, library: null } })
    api.getStats.mockResolvedValue({ data: { total_books: 99 } })
    const client = makeClient()
    const { result } = renderHook(() => useDashboardBootstrap(), { wrapper: withClient(client) })
    await waitFor(() => expect(result.current.settled).toBe(true))
    await waitFor(() => expect(api.getStats).toHaveBeenCalledTimes(1))
    expect(api.getDashboard).not.toHaveBeenCalledWith(expect.anything())
  })

  it('does not leave the tiles blank when the combined call fails', async () => {
    api.getAdminDashboard.mockRejectedValue(new Error('500'))
    const client = makeClient()
    const { result } = renderHook(() => useDashboardBootstrap(), { wrapper: withClient(client) })
    await waitFor(() => expect(result.current.settled).toBe(true))
    expect(result.current.waiting).toBe(false)
    expect(client.getQueryData(['hrDashboardStats'])).toBeUndefined()
  })

  it('stops waiting after the timeout when the combined call is slow', async () => {
    api.getAdminDashboard.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useDashboardBootstrap(), { wrapper: withClient(makeClient()) })
    expect(result.current.settled).toBe(false)
    await waitFor(() => expect(result.current.settled).toBe(true))
  })

  it('waits for the academic year so the seeded keys match the tiles', async () => {
    year.loading = true
    api.getAdminDashboard.mockResolvedValue({ data: full })
    const { result } = renderHook(() => useDashboardBootstrap(), { wrapper: withClient(makeClient()) })
    await new Promise((r) => setTimeout(r, 20))
    expect(api.getAdminDashboard).not.toHaveBeenCalled()
    expect(result.current.settled).toBe(false)
  })

  it.each(['TEACHER', 'ACCOUNTANT', 'STAFF', 'MANAGER'])('is a no-op for %s', async (role) => {
    auth.effectiveRole = role
    const { result } = renderHook(() => useDashboardBootstrap(), { wrapper: withClient(makeClient()) })
    expect(result.current).toEqual({ settled: true, waiting: false })
    expect(api.getAdminDashboard).not.toHaveBeenCalled()
  })

  it('also serves the principal', async () => {
    auth.effectiveRole = 'PRINCIPAL'
    api.getAdminDashboard.mockResolvedValue({ data: full })
    const { result } = renderHook(() => useDashboardBootstrap(), { wrapper: withClient(makeClient()) })
    await waitFor(() => expect(result.current.settled).toBe(true))
    expect(api.getAdminDashboard).toHaveBeenCalledTimes(1)
  })
})

describe('VITE_DASHBOARD_BOOTSTRAP=false', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

  it('turns the hook into a no-op so tiles fetch on their own again', async () => {
    vi.stubEnv('VITE_DASHBOARD_BOOTSTRAP', 'false')
    vi.doUnmock('../../utils/dashboardBootstrap')
    vi.resetModules()
    const mod = await import('../useDashboardBootstrap')
    const { result } = renderHook(() => mod.useDashboardBootstrap(), { wrapper: withClient(makeClient()) })
    expect(result.current).toEqual({ settled: true, waiting: false })
    expect(api.getAdminDashboard).not.toHaveBeenCalled()
  })
})
