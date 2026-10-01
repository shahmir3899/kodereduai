import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DashboardShell from '../DashboardShell'
import SectionCard from '../SectionCard'
import HeroCard from '../HeroCard'
import useOffDay from '../../../hooks/useOffDay'

vi.mock('../../../services/api', () => ({
  sessionsApi: { getCalendarDayStatus: vi.fn() },
}))
import { sessionsApi } from '../../../services/api'

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('DashboardShell', () => {
  it('shows title, subtitle and off-day pill only when given', () => {
    const { rerender } = wrap(<DashboardShell title="Hello" subtitle="School X" />)
    expect(screen.getByText('Hello')).toBeTruthy()
    expect(screen.getByText('School X')).toBeTruthy()
    expect(screen.queryByText(/OFF day/)).toBeNull()
    rerender(<MemoryRouter><DashboardShell offDayLabel="OFF day: Holiday" /></MemoryRouter>)
    expect(screen.getByText('OFF day: Holiday')).toBeTruthy()
  })
})

describe('SectionCard', () => {
  it('prefers loading over error over empty over children', () => {
    const { rerender } = wrap(<SectionCard title="T" loading error empty>kids</SectionCard>)
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
    rerender(<MemoryRouter><SectionCard title="T" error empty>kids</SectionCard></MemoryRouter>)
    expect(screen.getByRole('alert')).toBeTruthy()
    rerender(<MemoryRouter><SectionCard title="T" empty emptyText="none here">kids</SectionCard></MemoryRouter>)
    expect(screen.getByText('none here')).toBeTruthy()
    rerender(<MemoryRouter><SectionCard title="T">kids</SectionCard></MemoryRouter>)
    expect(screen.getByText('kids')).toBeTruthy()
  })

  it('renders the action link', () => {
    wrap(<SectionCard title="T" action={{ label: 'View all', href: '/x' }}>k</SectionCard>)
    expect(screen.getByRole('link', { name: 'View all' }).getAttribute('href')).toBe('/x')
  })
})

describe('HeroCard', () => {
  it('renders title and both actions', () => {
    wrap(<HeroCard eyebrow="Now" title="Maths" primaryAction={{ label: 'Go', href: '/a' }} secondaryAction={{ label: 'Alt', href: '/b' }} />)
    expect(screen.getByText('Maths')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go' }).getAttribute('href')).toBe('/a')
    expect(screen.getByRole('link', { name: 'Alt' }).getAttribute('href')).toBe('/b')
  })

  it('renders no action area without actions', () => {
    wrap(<HeroCard title="Done" />)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})

describe('useOffDay', () => {
  beforeEach(() => vi.clearAllMocks())

  function Probe(props) {
    const r = useOffDay(props)
    return <p data-testid="out">{`${r.isOffDay}|${r.label}`}</p>
  }
  const renderProbe = (props) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={qc}><Probe {...props} /></QueryClientProvider>)
  }

  it('reports an off day with its types', async () => {
    sessionsApi.getCalendarDayStatus.mockImplementation(({ date_from }) =>
      Promise.resolve({ data: { days: { [date_from]: { is_off_day: true, off_day_types: ['HOLIDAY'] } } } }))
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('true|OFF day: HOLIDAY'))
  })

  it('is not off when the day is missing from the response', async () => {
    sessionsApi.getCalendarDayStatus.mockResolvedValue({ data: { days: {} } })
    renderProbe()
    await waitFor(() => expect(sessionsApi.getCalendarDayStatus).toHaveBeenCalled())
    expect(screen.getByTestId('out').textContent).toBe('false|null')
  })

  it('does not call the API when disabled', () => {
    renderProbe({ enabled: false })
    expect(sessionsApi.getCalendarDayStatus).not.toHaveBeenCalled()
  })
})
