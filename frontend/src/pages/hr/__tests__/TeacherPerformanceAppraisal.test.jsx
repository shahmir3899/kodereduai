import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import PerformanceAppraisalPage from '../PerformanceAppraisalPage'
import TeacherPerformanceDetail from '../teacherPerformance/TeacherPerformanceDetail'
import { appraisalPrefill, infoRows, suggestedRating } from '../teacherPerformance/shared'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'SCHOOL_ADMIN' }, activeSchool: { id: 1, name: 'Test School' } }),
}))
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}))

const TEACHER = {
  staff_id: 9, name: 'Ali Khan', overall_score: 67.6, rank: 2,
  band: { key: 'FAIR', label: 'Fair' },
  quickest_wins: [{ key: 'grading', label: 'Homework grading', points_available: 4.5 }],
  measures: {},
  info: {
    syllabus_on_schedule: { planned: 8, taught_on_time: 5 },
    questions_added: 3, class_result_average: 71.2, marks_counted: 40, leave_days: 2,
  },
}
const PERIOD = { start: '2026-10-01', end: '2026-10-31', counted_until: '2026-10-31' }

describe('appraisal helpers', () => {
  it('suggests score ÷ 20, rounded, kept between 1 and 5', () => {
    expect(suggestedRating(67.6)).toBe(3)
    expect(suggestedRating(91)).toBe(5)
    expect(suggestedRating(4)).toBe(1)
    expect(suggestedRating(null)).toBe('')
  })

  it('pre-fills teacher, period, rating and the quickest wins', () => {
    const p = appraisalPrefill(TEACHER, PERIOD)
    expect(p).toMatchObject({ staff_member: 9, review_period_start: '2026-10-01', review_period_end: '2026-10-31', rating: 3 })
    expect(p.areas_for_improvement).toContain('- Homework grading (up to 4.5 points)')
  })

  it('formats the information figures', () => {
    expect(infoRows(TEACHER.info).map((r) => r.value)).toEqual(['5 of 8', '71.2% (40 marks)', '3', '2'])
  })
})

describe('detail view', () => {
  it('shows the information panel and opens the appraisal form pre-filled', async () => {
    server.use(
      http.get('/api/hr/teacher-performance/:id/', () => HttpResponse.json({ period: PERIOD, out_of: 3, teacher: TEACHER })),
      http.get('/api/hr/appraisals/', () => HttpResponse.json({ results: [] })),
      http.get('/api/hr/staff/', () => HttpResponse.json({ results: [{ id: 9, full_name: 'Ali Khan', first_name: 'Ali', last_name: 'Khan' }] })),
    )
    const user = userEvent.setup()
    renderWithProviders(
      <Routes>
        <Route path="/" element={<TeacherPerformanceDetail staffId={9} range={PERIOD} onBack={() => {}} />} />
        <Route path="/hr/appraisals" element={<PerformanceAppraisalPage />} />
      </Routes>,
    )
    expect(await screen.findByText('For information, not scored')).toBeInTheDocument()
    expect(screen.getByText('5 of 8')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Start appraisal from this report' }))
    const improve = await screen.findByDisplayValue(/Homework grading \(up to 4\.5 points\)/)
    expect(improve).toBeInTheDocument()
    expect(screen.getByDisplayValue('2026-10-01')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByDisplayValue('2026-10-31')).toBeInTheDocument())
  })
})
