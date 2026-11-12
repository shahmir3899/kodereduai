import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/utils'
import StudentDashboard, { lastExamPct } from '../student/StudentDashboard'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'STUDENT', username: 'ali' } }),
}))
vi.mock('../../components/dashboard/NotificationsFeed', () => ({ default: () => null }))

// Payload shapes pinned by backend/students/views.py (StudentDashboardView, portal_exam_results).
const dashboard = (over = {}) => ({
  student: { id: 5, name: 'Ali Hassan', class_obj: 1, class_name: 'Class 1A' },
  attendance: { total_days: 20, present: 18, absent: 2, leave: 0, rate: 90 },
  fees: { total_due: '5000.00', total_paid: '3500.00', outstanding: '1500.00' },
  upcoming_assignments: [],
  today_timetable: [],
  ...over,
})

const exam = (subjects) => ({ exam_id: 1, exam_name: 'Mid', subjects })

function serve({ dash = dashboard(), results = [], offDay = false } = {}) {
  server.use(
    http.get('*/api/students/portal/dashboard/', () => HttpResponse.json(dash)),
    http.get('*/api/students/portal/results/', () => HttpResponse.json(results)),
    http.get('*/api/sessions/calendar-entries/day-status/', () => HttpResponse.json({
      days: offDay ? { [new Date().toLocaleDateString('en-CA')]: { is_off_day: true, off_day_types: ['HOLIDAY'] } } : {},
    })),
  )
}

describe('lastExamPct', () => {
  it('skips absent/unmarked subjects and unmarked exams', () => {
    const unmarked = exam([{ marks_obtained: null, total_marks: 100, is_absent: false }])
    const marked = exam([
      { marks_obtained: 40, total_marks: 50, is_absent: false },
      { marks_obtained: 0, total_marks: 50, is_absent: true },
    ])
    expect(lastExamPct([unmarked, marked])).toBe(80)
    expect(lastExamPct([unmarked])).toBeNull()
    expect(lastExamPct(undefined)).toBeNull()
  })
})

describe('StudentDashboard tiles', () => {
  it('shows real attendance, fee due and last exam from the real payload', async () => {
    serve({ results: [exam([{ marks_obtained: 40, total_marks: 50, is_absent: false }])] })
    renderWithProviders(<StudentDashboard />)
    expect(await screen.findByText('90%')).toBeInTheDocument()
    expect(screen.getByText('PKR 1,500')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('80%')).toBeInTheDocument())
    expect(screen.queryByText('N/A')).not.toBeInTheDocument()
  })

  it('shows N/A for a student with no attendance days, no published exams and no fees block', async () => {
    serve({ dash: dashboard({ attendance: { total_days: 0, present: 0, absent: 0, leave: 0, rate: 0 }, fees: undefined }) })
    renderWithProviders(<StudentDashboard />)
    await screen.findByText(/Welcome, Ali Hassan/)
    await waitFor(() => expect(screen.getAllByText('N/A')).toHaveLength(3))
  })

  it('shows N/A attendance on an off day', async () => {
    serve({ offDay: true })
    renderWithProviders(<StudentDashboard />)
    expect(await screen.findByText(/OFF day/)).toBeInTheDocument()
    expect(screen.queryByText('90%')).not.toBeInTheDocument()
  })
})
