import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import MyPerformanceCard from '../MyPerformanceCard'
import MyPerformancePage from '../../../pages/teacher/MyPerformancePage'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 3, role: 'TEACHER' }, activeSchool: { id: 1, name: 'Test School' } }),
}))

const MINE = {
  enabled: true,
  period: { start: '2026-11-01', end: '2026-11-30', counted_until: '2026-11-17' },
  out_of: 22,
  snapshot: false,
  teacher: {
    staff_id: 5, name: 'Sara Ahmed', overall_score: 82.4, rank: 5,
    band: { key: 'GOOD', label: 'Good' },
    quickest_wins: [{ key: 'grading', label: 'Homework grading', points_available: 4.5 }],
    measures: {
      grading: {
        key: 'grading', label: 'Homework grading', applicable: true, score: 55, weight: 10,
        effective_weight: 12, due: 20, done: 11, on_time: 11, missed: [],
      },
    },
  },
}

function useMine(body, statusCode = 200) {
  server.use(http.get('/api/hr/teacher-performance/my/', () => HttpResponse.json(body, { status: statusCode })))
}

beforeEach(() => useMine(MINE))

describe('MyPerformanceCard', () => {
  it('shows score, band, own position and quickest wins', async () => {
    renderWithProviders(<MyPerformanceCard />)
    expect(await screen.findByText('82.4')).toBeInTheDocument()
    expect(screen.getByText('Good')).toBeInTheDocument()
    expect(screen.getByText('5th of 22 this month')).toBeInTheDocument()
    expect(screen.getByText('Homework grading')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Details' })).toHaveAttribute('href', '/my-performance')
  })

  it('leaves out the position when the school hides it', async () => {
    useMine({ ...MINE, out_of: null, teacher: { ...MINE.teacher, rank: null } })
    renderWithProviders(<MyPerformanceCard />)
    expect(await screen.findByText('82.4')).toBeInTheDocument()
    expect(screen.queryByText(/this month/)).not.toBeInTheDocument()
  })

  it('renders nothing when the school has not turned it on for teachers', async () => {
    let called = false
    server.use(http.get('/api/hr/teacher-performance/my/', () => { called = true; return HttpResponse.json({ enabled: false }) }))
    const { container } = renderWithProviders(<MyPerformanceCard />)
    await waitFor(() => expect(called).toBe(true))
    await waitFor(() => expect(container.querySelector('section')).toBeNull())
  })

  it('renders nothing for someone not on the report', async () => {
    useMine({ detail: 'You are not on the teacher performance report.' }, 404)
    const { container } = renderWithProviders(<MyPerformanceCard />)
    await waitFor(() => expect(container.querySelector('section')).toBeNull())
  })
})

describe('MyPerformancePage', () => {
  it('shows the own breakdown without the admin back button', async () => {
    renderWithProviders(<MyPerformancePage />)
    expect(await screen.findByText('Sara Ahmed')).toBeInTheDocument()
    expect(screen.getByText('5th of 22')).toBeInTheDocument()
    expect(screen.getByText(/Due 20 · Done 11/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /All teachers/ })).not.toBeInTheDocument()
  })

  it('notes a frozen month', async () => {
    useMine({ ...MINE, snapshot: true, frozen_at: '2026-11-01T03:15:00+05:00' })
    renderWithProviders(<MyPerformancePage />)
    expect(await screen.findByText(/Frozen on/)).toBeInTheDocument()
  })

  it('explains when the teacher is not on the report', async () => {
    useMine({ detail: 'no' }, 404)
    renderWithProviders(<MyPerformancePage />)
    expect(await screen.findByText(/not on the teacher performance report/)).toBeInTheDocument()
  })
})
