import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../services/api', () => ({ studentPortalApi: { getFees: vi.fn() } }))
import { studentPortalApi } from '../../../services/api'
import StudentFees from '../StudentFees'

const year = new Date().getFullYear()
const ROWS = [
  { id: 1, month: 1, year, month_name: 'January', fee_type_name: 'Monthly', amount_due: '6500.00', amount_paid: '6500.00', status: 'PAID',
    payment_date: `${year}-01-12`, payment_method: 'ONLINE',
    kuickpay: { gateway: 'Kuickpay', received: '6500.00', coverage: 'FULL', label: 'PKR 6,500 received via Kuickpay (paid in full)',
      reference_text: 'Ref 550727', payments: [{ reference: '550727', receipt: '00000000000000000226', date: `${year}-01-12`, amount: '6500.00' }] } },
  { id: 2, month: 2, year, month_name: 'February', fee_type_name: 'Monthly', amount_due: '6500.00', amount_paid: '0.00', status: 'UNPAID',
    payment_date: null, payment_method: 'CASH', kuickpay: null },
]

describe('Student fee screen: received via Kuickpay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    studentPortalApi.getFees.mockResolvedValue({ data: ROWS })
  })

  it('shows what was received through Kuickpay and its reference', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={qc}><MemoryRouter><StudentFees /></MemoryRouter></QueryClientProvider>)
    expect((await screen.findAllByText('PKR 6,500 received via Kuickpay (paid in full)')).length).toBeGreaterThan(0)
    expect(document.body.textContent).toContain('Ref 550727')
    expect(document.querySelectorAll('[data-testid="kuickpay-received"]').length).toBeGreaterThan(0)
  })
})
