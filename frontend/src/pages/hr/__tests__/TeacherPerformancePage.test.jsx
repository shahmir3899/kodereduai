import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import TeacherPerformancePage from '../TeacherPerformancePage'
import { weightTotal } from '../teacherPerformance/TeacherPerformanceSettings'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'SCHOOL_ADMIN' }, activeSchool: { id: 1, name: 'Test School' } }),
}))
const showSuccess = vi.fn()
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showSuccess, showError: vi.fn() }),
}))

const WEIGHTS = {
  attendance_marking: 20, lesson_plans: 15, marks_entry: 15, own_attendance: 10, homework: 10,
  grading: 10, messages_answered: 5, question_papers: 5, book_content: 5, login_days: 5,
}

function measure(key, label, extra = {}) {
  return {
    key, label, applicable: true, score: 80, weight: 10, effective_weight: 50,
    due: 10, done: 8, on_time: 8, missed: [], ...extra,
  }
}

const REPORT = {
  period: { start: '2026-11-01', end: '2026-11-30', counted_until: '2026-11-16' },
  out_of: 2,
  teachers: [
    {
      staff_id: 7, name: 'Sara Ahmed', employee_id: 'T2', overall_score: 91.2, rank: 1,
      band: { key: 'EXCELLENT', label: 'Excellent' },
      quickest_wins: [{ key: 'grading', label: 'Homework grading', points_available: 3 }],
      measures: {},
    },
    {
      staff_id: 9, name: 'Ali Khan', employee_id: 'T1', overall_score: 55, rank: 2,
      band: { key: 'NEEDS_ATTENTION', label: 'Needs attention' },
      quickest_wins: [{ key: 'attendance_marking', label: 'Class attendance marked', points_available: 12 }],
      measures: {},
    },
  ],
}

const DETAIL = {
  period: REPORT.period,
  out_of: 2,
  teacher: {
    ...REPORT.teachers[1],
    measures: {
      attendance_marking: measure('attendance_marking', 'Class attendance marked', {
        score: 40, missed: [{ date: '2026-11-03', section: 'Class 4 - A', reason: 'not marked' }],
      }),
      own_attendance: measure('own_attendance', 'Own attendance'),
      lesson_plans: { ...measure('lesson_plans', 'Lesson plans'), applicable: false, score: null },
    },
  },
}

const EXPLAINER = {
  general: ['Holidays and your approved leave never count against you.'],
  measures: [
    { key: 'attendance_marking', label: 'Class attendance marked', weight: 20, rule: 'Mark class attendance before 10:30 am.' },
    { key: 'marks_entry', label: 'Exam marks entered', weight: 15, rule: 'Enter exam marks within 5 days of the paper.' },
  ],
  bands: [{ key: 'EXCELLENT', label: 'Excellent', min: 90 }],
  show_rank_to_teachers: true,
}

const CONFIG = {
  weights: WEIGHTS, attendance_cutoff_time: '11:00', marks_deadline_days: 7, grading_deadline_days: 3,
  message_reply_hours: 24, homework_per_week: 2, papers_per_month: 1, content_blocks_per_month: 10,
  bands: [
    { key: 'EXCELLENT', label: 'Excellent', min: 90 }, { key: 'GOOD', label: 'Good', min: 75 },
    { key: 'FAIR', label: 'Fair', min: 60 }, { key: 'NEEDS_ATTENTION', label: 'Needs attention', min: 0 },
  ],
  show_rank_to_teachers: true, enabled: true,
}

beforeEach(() => {
  try { localStorage.setItem('viewPref:teacher-performance', 'table') } catch { /* ignore */ }
  server.use(
    http.get('/api/hr/teacher-performance/', () => HttpResponse.json(REPORT)),
    http.get('/api/hr/teacher-performance/explainer/', () => HttpResponse.json(EXPLAINER)),
    http.get('/api/hr/teacher-performance/config/', () => HttpResponse.json(CONFIG)),
    http.get('/api/hr/teacher-performance/:id/', () => HttpResponse.json(DETAIL)),
  )
})

describe('TeacherPerformancePage — report', () => {
  it('lists teachers in rank order with score and band', async () => {
    renderWithProviders(<TeacherPerformancePage />)
    await waitFor(() => expect(screen.getByText('Sara Ahmed')).toBeInTheDocument())
    const rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('Sara Ahmed')).toBeInTheDocument()
    expect(within(rows[0]).getByText('91.2')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Needs attention')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Class attendance marked')).toBeInTheDocument()
  })

  it('opens a teacher with per-measure bars and the missed items', async () => {
    const user = userEvent.setup()
    renderWithProviders(<TeacherPerformancePage />)
    await user.click(await screen.findByText('Ali Khan'))
    expect(await screen.findByText(/2nd of 2/)).toBeInTheDocument()
    expect(screen.getByText(/does not apply in this period/)).toBeInTheDocument()
    await user.click(screen.getByText(/1 item to fix/))
    expect(screen.getByText('2026-11-03 · Class 4 - A · not marked')).toBeInTheDocument()
  })
})

describe('PerformanceInfo popover', () => {
  it("opens on hover and shows the school's own numbers", async () => {
    const user = userEvent.setup()
    renderWithProviders(<TeacherPerformancePage />)
    const button = await screen.findByRole('button', { name: 'How the score works' })
    await user.hover(button)
    expect(await screen.findByText('Mark class attendance before 10:30 am.')).toBeInTheDocument()
    expect(screen.getByText('Enter exam marks within 5 days of the paper.')).toBeInTheDocument()
    await user.unhover(button)
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  })

  it('opens on keyboard focus', async () => {
    const user = userEvent.setup()
    renderWithProviders(<TeacherPerformancePage />)
    await screen.findByText('Sara Ahmed')
    await user.tab()
    while (document.activeElement?.getAttribute('aria-label') !== 'How the score works') await user.tab()
    expect(await screen.findByRole('tooltip')).toBeInTheDocument()
  })
})

describe('Settings — weights must total 100', () => {
  it('weightTotal adds typed values, blanks as zero', () => {
    expect(weightTotal(WEIGHTS)).toBe(100)
    expect(weightTotal({ ...WEIGHTS, login_days: '' })).toBe(95)
  })

  it('blocks saving until the total is 100, then saves', async () => {
    let saved = null
    server.use(
      http.put('/api/hr/teacher-performance/config/', async ({ request }) => {
        saved = await request.json()
        return HttpResponse.json(saved)
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<TeacherPerformancePage />)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    const login = await screen.findByLabelText('Login days weight')
    await user.clear(login)
    await user.type(login, '15')
    expect(screen.getByRole('status')).toHaveTextContent('Total: 110 — must be 100')
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()

    const lessons = screen.getByLabelText('Lesson plans weight')
    await user.clear(lessons)
    await user.type(lessons, '5')
    expect(screen.getByRole('status')).toHaveTextContent('Total: 100 ✓')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(saved).not.toBeNull())
    expect(saved.weights.login_days).toBe(15)
    expect(saved.weights.lesson_plans).toBe(5)
  })

  it('shows the server error next to the field', async () => {
    server.use(
      http.put('/api/hr/teacher-performance/config/', () =>
        HttpResponse.json({ marks_deadline_days: ['Ensure this value is greater than or equal to 0.'] }, { status: 400 }),
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(<TeacherPerformancePage />)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('button', { name: 'Save settings' }))
    expect(await screen.findByText('Ensure this value is greater than or equal to 0.')).toBeInTheDocument()
  })
})

describe('Export buttons', () => {
  it('posts the range and format and downloads the file', async () => {
    let body = null
    server.use(
      http.post('/api/hr/teacher-performance/export/', async ({ request }) => {
        body = await request.json()
        return new HttpResponse(new Blob(['%PDF-1.4']), { headers: { 'Content-Type': 'application/pdf' } })
      }),
    )
    const createUrl = vi.fn(() => 'blob:x')
    window.URL.createObjectURL = createUrl
    window.URL.revokeObjectURL = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<TeacherPerformancePage />)
    await user.click(await screen.findByRole('button', { name: 'Export Excel' }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body.format).toBe('XLSX')
    expect(body.start).toMatch(/^\d{4}-\d{2}-01$/)
    await waitFor(() => expect(createUrl).toHaveBeenCalled())
  })

  it('notes a frozen month in the list', async () => {
    server.use(
      http.get('/api/hr/teacher-performance/', () =>
        HttpResponse.json({ ...REPORT, snapshot: true, frozen_at: '2026-11-01T03:15:00+05:00' })),
    )
    renderWithProviders(<TeacherPerformancePage />)
    expect(await screen.findByText(/frozen on/)).toBeInTheDocument()
  })
})
