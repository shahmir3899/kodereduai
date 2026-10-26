import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../services/api', () => ({
  guideProgressApi: { overview: vi.fn(), exportOverview: vi.fn(), userDetail: vi.fn() },
}))
import { guideProgressApi } from '../../services/api'
import GuideProgressPanel from './GuideProgressPanel'

const rows = [
  { user_id: 1, name: 'Ayesha Khan', username: 'ayesha', role: 'TEACHER', group: 'Science', steps_done: 6, steps_total: 6, videos_watched: 5, videos_total: 40, videos_percent: 13, percent: 100, status: 'completed', last_activity: new Date().toISOString() },
  { user_id: 2, name: 'Bilal Ahmed', username: 'bilal', role: 'STUDENT', group: 'Class 5-A', steps_done: 0, steps_total: 4, videos_watched: 0, videos_total: 9, videos_percent: 0, percent: 0, status: 'not_started', last_activity: null },
]
const response = (results, count = results.length) => ({ data: {
  summary: { tracked: 2, completed: 1, in_progress: 0, not_started: 1, inactive: 0 },
  no_account: { students: 3, staff: 1 },
  filters: { roles: ['STUDENT', 'TEACHER'], groups: ['Class 5-A', 'Science'] },
  count, page: 1, page_size: 10, results,
} })

const renderPanel = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><GuideProgressPanel /></MemoryRouter>
  </QueryClientProvider>,
)

beforeEach(() => { vi.clearAllMocks(); guideProgressApi.overview.mockResolvedValue(response(rows)) })

describe('GuideProgressPanel', () => {
  it('fetches nothing until opened, then lists people with tiles and the no-login note', async () => {
    renderPanel()
    expect(guideProgressApi.overview).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /user guide progress/i }))
    expect(await screen.findByText('Ayesha Khan')).toBeInTheDocument()
    expect(screen.getByText('Bilal Ahmed')).toBeInTheDocument()
    expect(screen.getByText(/3 students and 1 staff member/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /People tracked/ })).toHaveTextContent('2')
  })

  it('shows videos watched out of the role total and flags a finished starting course', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /user guide progress/i }))
    await screen.findByText('Ayesha Khan')
    expect(screen.getByText('5 / 40 videos')).toBeInTheDocument()
    expect(screen.getByText('0 / 9 videos')).toBeInTheDocument()
    expect(screen.getByText(/Starting course completed/)).toBeInTheDocument()
    expect(screen.getByText(/Starting course: 0 of 4 steps/)).toBeInTheDocument()
  })

  it('sends the chosen filters to the server and starts again from page 1', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /user guide progress/i }))
    await screen.findByText('Ayesha Khan')
    guideProgressApi.overview.mockResolvedValue(response([rows[1]]))
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'STUDENT')
    await userEvent.click(screen.getByRole('button', { name: /Not started/ }))
    await waitFor(() => expect(guideProgressApi.overview).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'STUDENT', status: 'not_started', page: 1 })))
    await waitFor(() => expect(screen.queryByText('Ayesha Khan')).not.toBeInTheDocument())
  })

  it('opens a person and shows each step with its video', async () => {
    guideProgressApi.userDetail.mockResolvedValue({ data: { steps: [{ section: '1.3', video: 'ch1-logging-in', done: true, percent: 100, last_activity: new Date().toISOString() }] } })
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /user guide progress/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ayesha Khan' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Video:/)).toBeInTheDocument()
    expect(guideProgressApi.userDetail).toHaveBeenCalledWith(1)
  })
})
