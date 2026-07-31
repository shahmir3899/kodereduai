import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import FaceLiveEventsPage from '../FaceLiveEventsPage'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN' },
    activeSchool: { id: 1, name: 'Test School' },
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

beforeEach(() => {
  mockNavigate.mockClear()
})

describe('FaceLiveEventsPage', () => {
  it('renders empty state when no events exist', async () => {
    renderWithProviders(<FaceLiveEventsPage />)
    await waitFor(() => {
      expect(screen.getByText('No live events for this filter.')).toBeInTheDocument()
    })
  })

  it('renders a matched event row', async () => {
    server.use(
      http.get('/api/face-attendance/live/events/', () =>
        HttpResponse.json({
          count: 1,
          results: [{
            id: 'evt-1',
            source_tier: 'TIER_B',
            device: 1,
            device_name: 'Front Gate Camera',
            class_obj: null,
            embedding_version: 'dlib_v1',
            client_timestamp: '2026-07-28T08:00:00Z',
            matched_student: { id: 1, name: 'Ali Hassan', roll_number: '1' },
            confidence: 92.5,
            distance: 0.28,
            match_status: 'AUTO_MATCHED',
            resulted_in_attendance: true,
          }],
        })
      )
    )

    renderWithProviders(<FaceLiveEventsPage />)

    await waitFor(() => {
      expect(screen.getByText('Ali Hassan')).toBeInTheDocument()
    })
    expect(screen.getByText('Front Gate Camera')).toBeInTheDocument()
    expect(screen.getByText('Marked present')).toBeInTheDocument()
  })

  it('renders an unmatched event row', async () => {
    server.use(
      http.get('/api/face-attendance/live/events/', () =>
        HttpResponse.json({
          count: 1,
          results: [{
            id: 'evt-2',
            source_tier: 'TIER_B',
            device: 1,
            device_name: 'Front Gate Camera',
            class_obj: null,
            embedding_version: 'dlib_v1',
            client_timestamp: '2026-07-28T08:05:00Z',
            matched_student: null,
            confidence: 0,
            distance: null,
            match_status: 'IGNORED',
            resulted_in_attendance: false,
          }],
        })
      )
    )

    renderWithProviders(<FaceLiveEventsPage />)

    await waitFor(() => {
      expect(screen.getByText('No match')).toBeInTheDocument()
    })
  })
})
