import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSessionHealth = vi.fn()
const getSessionHealthAISummary = vi.fn()

vi.mock('../../services/api', () => ({
  sessionsApi: {
    getSessionHealth: (...a) => getSessionHealth(...a),
    getSessionHealthAISummary: (...a) => getSessionHealthAISummary(...a),
  },
}))
vi.mock('../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 33 }, hasAcademicYear: true }),
}))

import SessionHealthWidget from '../SessionHealthWidget'

const report = (extra = {}) => ({
  data: {
    success: true,
    academic_year: { name: '2026-27' },
    enrollment: { enrollment_rate: 90 },
    attendance: { average_attendance_rate: 95 },
    fee_collection: { collection_rate: 88 },
    exam_performance: { average_pass_rate: 70 },
    ai_summary: { source: 'rule_based', highlights: ['Rule based highlight'], concerns: [], action_items: [] },
    ...extra,
  },
})

const renderWidget = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <SessionHealthWidget />
  </QueryClientProvider>,
)

describe('SessionHealthWidget', () => {
  beforeEach(() => {
    getSessionHealth.mockReset()
    getSessionHealthAISummary.mockReset()
  })

  it('shows the numbers and rule-based summary without waiting for the AI summary', async () => {
    getSessionHealth.mockResolvedValue(report({ ai_summary_available: true }))
    getSessionHealthAISummary.mockReturnValue(new Promise(() => {})) // never resolves

    renderWidget()

    expect(await screen.findByText('Rule based highlight')).toBeInTheDocument()
    expect(screen.getByText('Writing AI summary…')).toBeInTheDocument()
    expect(screen.queryByText('AI Summary')).not.toBeInTheDocument()
  })

  it('swaps in the AI summary when it arrives', async () => {
    getSessionHealth.mockResolvedValue(report({ ai_summary_available: true }))
    getSessionHealthAISummary.mockResolvedValue({
      data: { ai_summary: { source: 'ai', highlights: ['AI written highlight'], concerns: [], action_items: [] } },
    })

    renderWidget()

    expect(await screen.findByText('AI written highlight')).toBeInTheDocument()
    expect(screen.getByText('AI Summary')).toBeInTheDocument()
    expect(screen.queryByText('Writing AI summary…')).not.toBeInTheDocument()
  })

  it('never asks for an AI summary when none is available', async () => {
    getSessionHealth.mockResolvedValue(report({ ai_summary_available: false }))

    renderWidget()

    expect(await screen.findByText('Rule based highlight')).toBeInTheDocument()
    await waitFor(() => expect(getSessionHealthAISummary).not.toHaveBeenCalled())
  })

  it('keeps the rule-based summary if the AI request fails', async () => {
    getSessionHealth.mockResolvedValue(report({ ai_summary_available: true }))
    getSessionHealthAISummary.mockRejectedValue(new Error('network'))

    renderWidget()

    expect(await screen.findByText('Rule based highlight')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Writing AI summary…')).not.toBeInTheDocument())
    expect(screen.getByText('Rule based highlight')).toBeInTheDocument()
  })
})
