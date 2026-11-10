import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ isModuleEnabled: () => true }),
}))
vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 1 } }),
}))
vi.mock('../../../utils/schoolTime', () => ({ schoolNowDate: () => new Date(2026, 10, 10) }))
vi.mock('../../../services/api', () => ({
  sessionsApi: {
    getCalendarMonthView: vi.fn(() => Promise.resolve({
      data: { days: [
        { date: '2026-11-14', is_off_day: true, events: [], entries: [{ id: 1, name: 'Iqbal Day', entry_kind: 'OFF_DAY', start_date: '2026-11-14', end_date: '2026-11-14' }] },
        { date: '2026-11-20', is_off_day: false, events: [{ id: 2 }, { id: 3 }], entries: [
          { id: 2, name: 'Sports Day', entry_kind: 'EVENT', start_date: '2026-11-20', end_date: '2026-11-20' },
          { id: 3, name: 'Parent Meeting', entry_kind: 'EVENT', start_date: '2026-11-20', end_date: '2026-11-20' },
        ] },
      ] },
    })),
  },
  examinationsApi: { getExamGroups: vi.fn(() => Promise.resolve({ data: { results: [] } })) },
}))

import AcademicCalendarWidget from '../AcademicCalendarWidget'

const renderWidget = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><AcademicCalendarWidget /></MemoryRouter>
  </QueryClientProvider>,
)

describe('AcademicCalendarWidget', () => {
  it('starts on the current month and steps back and forward', () => {
    renderWidget()
    expect(screen.getByText('November 2026')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Next month'))
    expect(screen.getByText('December 2026')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Previous month'))
    fireEvent.click(screen.getByLabelText('Previous month'))
    expect(screen.getByText('October 2026')).toBeInTheDocument()
  })

  it('rolls over the year boundary', () => {
    renderWidget()
    fireEvent.click(screen.getByLabelText('Next month'))
    fireEvent.click(screen.getByLabelText('Next month'))
    expect(screen.getByText('January 2027')).toBeInTheDocument()
  })

  it('gives each date a hover popover with one row per entry', async () => {
    renderWidget()
    const pop = await screen.findByTestId('cal-pop-2026-11-20')
    expect(pop).toHaveTextContent('Sports Day')
    expect(pop).toHaveTextContent('Parent Meeting')
    expect(pop.querySelectorAll('.flex.items-start')).toHaveLength(2)
    expect(screen.queryByTestId('cal-pop-2026-11-21')).toBeNull()
  })

  it('has no entry list under the grid and no edit controls', async () => {
    const { container } = renderWidget()
    await screen.findByTestId('cal-pop-2026-11-14')
    expect(container.querySelectorAll('.border-t')).toHaveLength(0)
    expect(screen.queryByText(/add/i)).toBeNull()
    expect(screen.getByText('Full calendar')).toHaveAttribute('href', '/academics/calendar')
  })
})
