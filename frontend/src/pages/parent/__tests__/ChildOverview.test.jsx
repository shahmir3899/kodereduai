import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../services/api', () => ({
  parentsApi: { getChildOverview: vi.fn() },
}))
import { parentsApi } from '../../../services/api'
import ChildOverview from '../ChildOverview'

// Real ChildOverviewView shape (backend/parents/overview.py).
const OVERVIEW = {
  student_id: 7, student_name: 'Ayesha Khan', class_name: 'Grade 1 - A', roll_number: '12',
  attendance_summary: { total_days: 20, present: 17, absent: 3, leave: 0, attendance_rate: 85.0, today: 'PRESENT', recent: [] },
  fee_summary: { outstanding: '0', overdue_amount: '0', unpaid_items: 0, total_paid: '500.00' },
  latest_exam: { exam_id: 2, exam_name: 'Final', percentage: 70.0, start_date: '2025-09-15' },
  previous_exam: null,
  next_exam: null,
  today: { date: '2025-10-01', is_off_day: false, off_day_types: [] },
  pending_leave_count: 0,
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/parent/children/7']}>
        <Routes><Route path="/parent/children/:studentId" element={<ChildOverview />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ChildOverview', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the child name and the real numbers, not N/A', async () => {
    parentsApi.getChildOverview.mockResolvedValue({ data: OVERVIEW })
    renderPage()

    expect(await screen.findByText('Ayesha Khan')).toBeTruthy()
    expect(screen.getByText('85%')).toBeTruthy()
    expect(screen.getByText('17 of 20 days')).toBeTruthy()
    expect(screen.getByText('Nothing due')).toBeTruthy()
    expect(screen.getByText('70%')).toBeTruthy()
    expect(screen.getByText('3 days absent')).toBeTruthy()
    expect(screen.queryByText('N/A')).toBeNull()
  })

  it('shows N/A for attendance on a school closure', async () => {
    parentsApi.getChildOverview.mockResolvedValue({
      data: { ...OVERVIEW, today: { date: '2025-10-01', is_off_day: true, off_day_types: ['NATIONAL_HOLIDAY'] } },
    })
    renderPage()

    expect(await screen.findByText('School closed: national holiday')).toBeTruthy()
    expect(screen.getByText('N/A')).toBeTruthy()
  })
})
