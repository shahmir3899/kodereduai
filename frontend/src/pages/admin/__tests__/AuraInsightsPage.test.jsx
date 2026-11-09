import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AuraInsightsPage from '../AuraInsightsPage'
import { assistantApi } from '../../../services/assistantApi'

let superAdmin = false
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ isSuperAdmin: superAdmin }) }))
vi.mock('recharts', () => ({ ResponsiveContainer: ({ children }) => <div>{children}</div>, LineChart: () => null, Line: () => null }))
vi.mock('../../../services/assistantApi', () => ({ assistantApi: { getInsights: vi.fn(), updateInsightGroup: vi.fn() } }))

const group = {
  id: 5, label: 'Scholarship list', description: '', status: 'planned', note: 'next sprint', baseline_question_id: null,
  total: 4, last_7_days: 3, last_30_days: 4, roles: [{ key: 'SCHOOL_ADMIN', count: 4 }], agents: [], languages: [], kinds: [{ key: 'missing_tool', count: 4 }],
  trend: [], examples: ['list <student> scholarship'], schools: [{ school_id: 1, count: 4 }],
}
const payload = (groups) => ({ data: { days: 30, groups, satisfaction: { up: 1, down: 2 }, filters: { kinds: [], statuses: [], days: [7, 30, 90] }, schools: [{ id: 1, name: 'Alpha' }] } })

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><AuraInsightsPage /></QueryClientProvider>)
}

describe('AuraInsightsPage', () => {
  beforeEach(() => { vi.clearAllMocks(); superAdmin = false })

  it('shows the empty state', async () => {
    assistantApi.getInsights.mockResolvedValue(payload([]))
    renderPage()
    expect(await screen.findByText('No gaps recorded yet.')).toBeInTheDocument()
  })

  it('lists groups and shows examples; a school admin cannot change the decision', async () => {
    assistantApi.getInsights.mockResolvedValue(payload([group]))
    renderPage()
    await userEvent.click(await screen.findByText('Scholarship list'))
    expect(screen.getByText('list <student> scholarship')).toBeInTheDocument()
    expect(screen.getByText(/Note: next sprint/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByLabelText('School')).toBeNull()
  })

  it('lets the super admin save a decision and filter by school', async () => {
    superAdmin = true
    assistantApi.getInsights.mockResolvedValue(payload([group]))
    assistantApi.updateInsightGroup.mockResolvedValue({})
    renderPage()
    await userEvent.click(await screen.findByText('Scholarship list'))
    expect(screen.getByLabelText('School')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Decision'), 'built')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(assistantApi.updateInsightGroup).toHaveBeenCalledWith(5, { status: 'built', note: 'next sprint' })
  })

  it('tells other roles they are not allowed', async () => {
    assistantApi.getInsights.mockRejectedValue({ response: { status: 403 } })
    renderPage()
    expect(await screen.findByText(/Only admins/)).toBeInTheDocument()
  })
})
