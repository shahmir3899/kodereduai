import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { first_name: 'Sana', username: 'sana' } }),
}))
vi.mock('../../../components/dashboard/NotificationsFeed', () => ({ default: () => <div>feed</div> }))
vi.mock('../../../services/api', () => ({
  parentsApi: {
    getMyChildren: vi.fn(),
    getChildOverview: vi.fn(),
  },
  messagingApi: { getThreads: vi.fn() },
}))
import { parentsApi, messagingApi } from '../../../services/api'
import ParentDashboard from '../ParentDashboard'

const LINK = { id: 101, student: 7, student_name: 'Ayesha Khan', class_name: 'Grade 1 - A', student_roll_number: '12' }

// Real ChildOverviewView shape (backend/parents/overview.py).
const OVERVIEW = {
  student_id: 7, student_name: 'Ayesha Khan', class_name: 'Grade 1 - A', roll_number: '12',
  attendance_summary: {
    total_days: 20, present: 17, absent: 3, leave: 0, attendance_rate: 85.0, today: 'ABSENT',
    recent: [{ date: '2025-09-29', status: 'PRESENT' }, { date: '2025-10-01', status: 'ABSENT' }],
  },
  fee_summary: { outstanding: '1500.00', overdue_amount: '1000.00', unpaid_items: 1, total_paid: '500.00' },
  latest_exam: { exam_id: 2, exam_name: 'Final', percentage: 70.0, start_date: '2025-09-15' },
  previous_exam: { exam_id: 1, exam_name: 'Mid Term', percentage: 60.0, start_date: '2025-08-01' },
  next_exam: null,
  today: { date: '2025-10-01', is_off_day: false, off_day_types: [] },
  pending_leave_count: 0,
}

function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><ParentDashboard /></MemoryRouter></QueryClientProvider>,
  )
}

describe('ParentDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    parentsApi.getMyChildren.mockResolvedValue({ data: [LINK] })
    parentsApi.getChildOverview.mockResolvedValue({ data: OVERVIEW })
    messagingApi.getThreads.mockResolvedValue({ data: [{ unread_count: 2 }, { unread_count: 1 }] })
  })

  it('shows the child numbers from the real API shape instead of N/A', async () => {
    renderDashboard()

    await screen.findByText('85%')
    expect(screen.getByText('17 of 20 days')).toBeTruthy()
    expect(screen.getByText('PKR 1,500')).toBeTruthy()
    expect(screen.getByText('PKR 1,000 from earlier months')).toBeTruthy()
    expect(screen.getByText(/^70%/)).toBeTruthy()
    expect(screen.getByText('Today: Absent')).toBeTruthy()
    expect(screen.queryByText('N/A')).toBeNull()
  })

  it('raises attention chips for absence, fees and unread messages, and links Messages with a badge', async () => {
    renderDashboard()

    await screen.findByText('Ayesha was marked absent today')
    expect(screen.getByText('Ayesha: PKR 1,500 fees outstanding (some overdue)')).toBeTruthy()
    expect(screen.getByText('unread messages')).toBeTruthy()
    const messages = screen.getByRole('link', { name: /Messages/ })
    expect(within(messages).getByText('3')).toBeTruthy()
  })

  it('offers a Fees quick action only when there is exactly one child', async () => {
    // One child: the card's own Fees link plus the quick action.
    renderDashboard()
    await screen.findByText('85%')
    expect(screen.getAllByRole('link', { name: 'Fees' })).toHaveLength(2)
  })

  it('has no ambiguous Fees quick action with several children', async () => {
    parentsApi.getMyChildren.mockResolvedValue({ data: [LINK, { ...LINK, id: 102, student: 8, student_name: 'Bilal Khan' }] })
    renderDashboard()
    await screen.findAllByText('85%')
    const hrefs = screen.getAllByRole('link', { name: 'Fees' }).map((a) => a.getAttribute('href'))
    expect(hrefs.sort()).toEqual(['/parent/children/7/fees', '/parent/children/8/fees'])
  })

  it('shows an error on the card, not zeros, when a child overview fails', async () => {
    parentsApi.getChildOverview.mockRejectedValue(new Error('boom'))
    renderDashboard()

    expect(await screen.findByText(/Couldn't load Ayesha Khan's summary/)).toBeTruthy()
    expect(screen.queryByText('Nothing due')).toBeNull()
  })

  it('shows the empty state when no children are linked', async () => {
    parentsApi.getMyChildren.mockResolvedValue({ data: [] })
    renderDashboard()

    await waitFor(() => expect(screen.getByText('No children linked')).toBeTruthy())
  })
})
