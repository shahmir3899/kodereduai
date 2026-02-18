import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import FaceReviewPage from '../FaceReviewPage'

// Mock contexts and hooks
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
    useParams: () => ({ sessionId: 'uuid-session-1' }),
  }
})

beforeEach(() => {
  mockNavigate.mockClear()
})

describe('FaceReviewPage', () => {
  it('renders detected faces section', async () => {
    renderWithProviders(<FaceReviewPage />, { route: '/face-attendance/review/uuid-session-1' })

    await waitFor(() => {
      expect(screen.getByText('Detected Faces (3)')).toBeInTheDocument()
    })
  })

  it('shows auto-matched face with Auto badge', async () => {
    renderWithProviders(<FaceReviewPage />, { route: '/face-attendance/review/uuid-session-1' })

    await waitFor(() => {
      // Ali Hassan appears in both detections and class roll
      expect(screen.getAllByText('Ali Hassan').length).toBeGreaterThanOrEqual(1)
    })

    expect(screen.getByText('Auto')).toBeInTheDocument()
  })

  it('shows flagged face with Review badge', async () => {
    renderWithProviders(<FaceReviewPage />, { route: '/face-attendance/review/uuid-session-1' })

    await waitFor(() => {
      // Sara Khan appears in both detections and class roll
      expect(screen.getAllByText('Sara Khan').length).toBeGreaterThanOrEqual(1)
    })

    expect(screen.getByText('Review')).toBeInTheDocument()
  })

  it('shows class roll with all students', async () => {
    renderWithProviders(<FaceReviewPage />, { route: '/face-attendance/review/uuid-session-1' })

    await waitFor(() => {
      expect(screen.getByText('Class Roll (4 students)')).toBeInTheDocument()
    })

    // All 4 students should appear (some may appear in both detections and roll)
    expect(screen.getAllByText('Ali Hassan').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Sara Khan').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Usman Ahmed')).toBeInTheDocument()
    expect(screen.getByText('Fatima Noor')).toBeInTheDocument()
  })

  it('auto-matched students are pre-selected as present', async () => {
    renderWithProviders(<FaceReviewPage />, { route: '/face-attendance/review/uuid-session-1' })

    await waitFor(() => {
      expect(screen.getByText('Class Roll (4 students)')).toBeInTheDocument()
    })

    // Ali Hassan and Sara Khan should show "P" (present)
    // Wait for present IDs to be computed from detections
    await waitFor(() => {
      expect(screen.getByText('2 present / 2 absent')).toBeInTheDocument()
    })
  })

  it('toggle student presence changes counts', async () => {
    const user = userEvent.setup()
    renderWithProviders(<FaceReviewPage />, { route: '/face-attendance/review/uuid-session-1' })

    await waitFor(() => {
      expect(screen.getByText('2 present / 2 absent')).toBeInTheDocument()
    })

    // Find Usman Ahmed and click to toggle to present
    const usmanBtn = screen.getByText('Usman Ahmed').closest('button')
    await user.click(usmanBtn)

    await waitFor(() => {
      expect(screen.getByText('3 present / 1 absent')).toBeInTheDocument()
    })
  })

  it('confirm sends present_student_ids', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/face-attendance/sessions/:id/confirm/', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ success: true, message: 'Attendance confirmed', total_students: 4, present_count: 2, absent_count: 2 })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<FaceReviewPage />, { route: '/face-attendance/review/uuid-session-1' })

    await waitFor(() => {
      expect(screen.getByText('Confirm Attendance')).toBeInTheDocument()
    })

    const confirmBtn = screen.getByText('Confirm Attendance')
    await user.click(confirmBtn)

    await waitFor(() => {
      expect(capturedBody).not.toBeNull()
    })

    expect(capturedBody).toHaveProperty('present_student_ids')
    expect(Array.isArray(capturedBody.present_student_ids)).toBe(true)
    // Should include student 1 and 2 (auto-matched + flagged)
    expect(capturedBody.present_student_ids).toContain(1)
    expect(capturedBody.present_student_ids).toContain(2)
  })

  it('processing state shows spinner text', async () => {
    server.use(
      http.get('/api/face-attendance/sessions/:id/', () =>
        HttpResponse.json({
          id: 'uuid-session-1',
          status: 'PROCESSING',
          class_obj: { id: 1, name: 'Class 1A' },
          date: '2026-02-18',
          image_url: 'https://example.com/photo.jpg',
          total_faces_detected: 0,
          faces_matched: 0,
          faces_flagged: 0,
          faces_ignored: 0,
          detections: [],
          class_students: [],
        })
      )
    )

    renderWithProviders(<FaceReviewPage />, { route: '/face-attendance/review/uuid-session-1' })

    await waitFor(() => {
      expect(screen.getByText('Processing Faces...')).toBeInTheDocument()
    })
  })

  it('shows no face label for students without embedding', async () => {
    renderWithProviders(<FaceReviewPage />, { route: '/face-attendance/review/uuid-session-1' })

    await waitFor(() => {
      expect(screen.getByText('no face')).toBeInTheDocument()
    })
  })
})
