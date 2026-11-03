import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import KuickpayBillCard from '../KuickpayBillCard'

// Shape sent by GET /api/parents/children/<id>/kuickpay-bill/ (finance/kuickpay/parent_summary.py).
const active = (over = {}) => ({
  consumer_number: '015203268489', biller_name: 'Kuickpay', cycle: { year: 2026, month: 11 },
  status: 'ACTIVE', payable: true, payable_amount: '2150.00', processing_amount: '0.00',
  scope_note: 'This bill covers monthly fees only.', message: '', breakdown: [], transactions: [], ...over,
})
const summary = (bill) => ({ enabled: true, active_bill: bill, history: [] })

afterEach(() => { vi.restoreAllMocks(); delete navigator.clipboard })

describe('KuickpayBillCard', () => {
  it('renders nothing for a school without Kuickpay, or a child with no open bill', () => {
    const { container, rerender } = render(<KuickpayBillCard summary={{ enabled: false, active_bill: null, history: [] }} />)
    expect(container.firstChild).toBeNull()
    rerender(<KuickpayBillCard summary={summary(null)} />)
    expect(container.firstChild).toBeNull()
    rerender(<KuickpayBillCard summary={undefined} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the consumer number, the amount to pay and the bill month', () => {
    render(<KuickpayBillCard summary={summary(active())} />)
    expect(screen.getByText('015203268489')).toBeTruthy()
    const text = screen.getByTestId('kuickpay-bill-card').textContent
    expect(text).toContain('PKR 2,150')
    expect(text).toContain('November 2026')
  })

  it('copies the number to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<KuickpayBillCard summary={summary(active())} />)
    fireEvent.click(screen.getByLabelText('Copy 015203268489'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('015203268489'))
    expect(await screen.findByText('Copied')).toBeTruthy()
  })

  it('shows only the neutral message, never a number, when the bill is suspended', () => {
    render(<KuickpayBillCard summary={summary(active({ status: 'SUSPENDED', payable: false, message: 'Online payment is temporarily unavailable for this child. Please contact the school office.' }))} />)
    const text = screen.getByTestId('kuickpay-bill-card').textContent
    expect(text).toContain('temporarily unavailable')
    expect(text).not.toContain('015203268489')
  })

  it('says nothing is due, with no number, once the bill is fully paid', () => {
    render(<KuickpayBillCard summary={summary(active({ payable: false, payable_amount: '0.00' }))} />)
    const text = screen.getByTestId('kuickpay-bill-card').textContent
    expect(text).toContain('Nothing is due')
    expect(text).not.toContain('015203268489')
  })
})
