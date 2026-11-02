import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../services/api', () => ({
  parentsApi: { getChildFees: vi.fn(), getPaymentGateways: vi.fn(), initiatePayment: vi.fn() },
}))
import { parentsApi } from '../../../services/api'
import ChildFees from '../ChildFees'

const year = new Date().getFullYear()
const ROWS = [
  { id: 1, month: 2, year, month_name: 'February', fee_type_name: 'Monthly', amount_due: '2000.00', amount_paid: '1000.00', status: 'PARTIAL',
    payment_date: `${year}-02-10`, payment_method: 'ONLINE',
    kuickpay: { gateway: 'Kuickpay', received: '1000.00', coverage: 'PARTIAL', label: 'PKR 1,000 received via Kuickpay (partial payment)',
      reference_text: 'Ref 600001', payments: [{ reference: '600001', receipt: '00000000000000000301', date: `${year}-02-10`, amount: '1000.00' }] } },
  { id: 2, month: 1, year, month_name: 'January', fee_type_name: 'Monthly', amount_due: '6500.00', amount_paid: '6500.00', status: 'PAID',
    payment_date: `${year}-01-12`, payment_method: 'CASH', kuickpay: null },
  { id: 3, month: 3, year, month_name: 'March', fee_type_name: 'Monthly', amount_due: '1000.00', amount_paid: '1000.00', status: 'PAID',
    payment_date: `${year}-03-05`, payment_method: 'ONLINE',
    kuickpay: { gateway: 'Kuickpay', received: '1000.00', coverage: 'FULL', label: 'PKR 1,000 received via Kuickpay (paid in full)',
      reference_text: 'Ref 550727', payments: [{ reference: '550727', receipt: '00000000000000000226', date: `${year}-03-05`, amount: '1000.00' }] } },
]

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/parent/children/7/fees']}>
        <Routes><Route path="/parent/children/:studentId/fees" element={<ChildFees />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Parent fee screen: received via Kuickpay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    parentsApi.getPaymentGateways.mockResolvedValue({ data: { gateways: [] } })
    parentsApi.getChildFees.mockResolvedValue({ data: ROWS })
  })

  it('labels a partly paid record and a fully paid record, with their references', async () => {
    renderPage()
    expect((await screen.findAllByText('PKR 1,000 received via Kuickpay (partial payment)')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('PKR 1,000 received via Kuickpay (paid in full)').length).toBeGreaterThan(0)
    expect(document.body.textContent).toContain('Ref 600001')
    expect(document.body.textContent).toContain('Ref 550727')
  })

  it('shows no Kuickpay label on a record paid another way', async () => {
    renderPage()
    await screen.findAllByText('PKR 1,000 received via Kuickpay (partial payment)')
    // Two of the three records carry a label, in table and/or card form; the cash one never does.
    const labelled = document.querySelectorAll('[data-testid="kuickpay-received"]')
    expect(labelled.length).toBeGreaterThan(0)
    for (const el of labelled) expect(el.textContent).not.toContain('6,500')
  })
})
