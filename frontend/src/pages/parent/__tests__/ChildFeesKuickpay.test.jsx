import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../services/api', () => ({
  parentsApi: { getChildFees: vi.fn(), getChildKuickpayBill: vi.fn() },
}))
import { parentsApi } from '../../../services/api'
import ChildFees from '../ChildFees'

// The fee screens follow the selected academic year; rows below belong to year 7.
vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 7, name: '2026-27' }, loading: false }),
}))

const year = new Date().getFullYear()
const ROWS = [
  { id: 1, fee_type: 'MONTHLY', academic_year: 7, branch: null, month: 2, year, month_name: 'February', fee_type_name: 'Monthly', amount_due: '2000.00', amount_paid: '1000.00', status: 'PARTIAL',
    payment_date: `${year}-02-10`, payment_method: 'ONLINE',
    kuickpay: { gateway: 'Kuickpay', received: '1000.00', coverage: 'PARTIAL', label: 'PKR 1,000 received via Kuickpay (partial payment)',
      reference_text: 'Ref 600001', payments: [{ reference: '600001', receipt: '00000000000000000301', date: `${year}-02-10`, amount: '1000.00' }] } },
  { id: 2, fee_type: 'MONTHLY', academic_year: 7, branch: null, month: 1, year, month_name: 'January', fee_type_name: 'Monthly', amount_due: '6500.00', amount_paid: '6500.00', status: 'PAID',
    payment_date: `${year}-01-12`, payment_method: 'CASH', kuickpay: null },
  { id: 3, fee_type: 'MONTHLY', academic_year: 7, branch: null, month: 3, year, month_name: 'March', fee_type_name: 'Monthly', amount_due: '1000.00', amount_paid: '1000.00', status: 'PAID',
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
    parentsApi.getChildKuickpayBill.mockResolvedValue({ data: { enabled: false } })
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

// The old online-gateway Pay flow is gone (the server's pay-fee answers 410); the banner points
// to the Kuickpay bill when the school has it, otherwise to the school office.
const OWING = [
  { id: 9, fee_type: 'MONTHLY', academic_year: 7, branch: null, month: 4, year, month_name: 'April', fee_type_name: 'Monthly',
    amount_due: '3000.00', amount_paid: '0.00', status: 'UNPAID', payment_date: null, payment_method: null, kuickpay: null },
]

describe('Parent fee screen: outstanding balance banner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    parentsApi.getChildFees.mockResolvedValue({ data: OWING })
  })

  it('points to the school office when Kuickpay is off', async () => {
    parentsApi.getChildKuickpayBill.mockResolvedValue({ data: { enabled: false } })
    renderPage()
    expect(await screen.findByText('Please pay at the school office.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay now/i })).not.toBeInTheDocument()
  })

  it('points to the Kuickpay bill when the school has Kuickpay', async () => {
    parentsApi.getChildKuickpayBill.mockResolvedValue({ data: { enabled: true, active_bill: null } })
    renderPage()
    expect(await screen.findByText('Pay with the Kuickpay bill above, or at the school office.')).toBeInTheDocument()
  })
})
