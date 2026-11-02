import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import KuickpayReceived from '../KuickpayReceived'

// Shape sent by the backend (finance/kuickpay/received.py).
const FULL = {
  gateway: 'Kuickpay', received: '6500.00', coverage: 'FULL',
  label: 'PKR 6,500 received via Kuickpay (paid in full)', reference_text: 'Ref 550727',
  payments: [{ reference: '550727', receipt: '00000000000000000226', date: '2026-01-12', amount: '6500.00' }],
}
const PARTIAL = {
  gateway: 'Kuickpay', received: '2000.00', coverage: 'PARTIAL',
  label: 'PKR 2,000 received via Kuickpay (partial payment)', reference_text: 'Refs 600001, 600002',
  payments: [
    { reference: '600001', receipt: '00000000000000000301', date: '2026-01-10', amount: '1200.00' },
    { reference: '600002', receipt: '00000000000000000302', date: '2026-01-11', amount: '800.00' },
  ],
}

describe('KuickpayReceived', () => {
  it('renders nothing when no money came in through Kuickpay', () => {
    const { container } = render(<KuickpayReceived kuickpay={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('says how much was received, by which gateway, and that it covers the fee in full', () => {
    render(<KuickpayReceived kuickpay={FULL} />)
    expect(screen.getByText('PKR 6,500 received via Kuickpay (paid in full)')).toBeTruthy()
  })

  it('shows the Kuickpay reference and the payment date for a single payment', () => {
    render(<KuickpayReceived kuickpay={FULL} />)
    const text = screen.getByTestId('kuickpay-received').textContent
    expect(text).toContain('Ref 550727')
    expect(text).toContain(new Date(2026, 0, 12).toLocaleDateString())   // 12 Jan, never shifted a day
  })

  it('says partial for a partial payment and lists every reference', () => {
    render(<KuickpayReceived kuickpay={PARTIAL} />)
    expect(screen.getByText('PKR 2,000 received via Kuickpay (partial payment)')).toBeTruthy()
    expect(screen.getByText('Refs 600001, 600002')).toBeTruthy()
  })

  it('puts every payment, with its receipt number, in the hover details', () => {
    render(<KuickpayReceived kuickpay={PARTIAL} />)
    const title = screen.getByTestId('kuickpay-received').getAttribute('title')
    expect(title).toContain('Ref 600001')
    expect(title).toContain('receipt 00000000000000000302')
    expect(title).toContain('PKR 800')
  })

  it('uses different colours for full and partial', () => {
    const { rerender } = render(<KuickpayReceived kuickpay={FULL} />)
    const fullClass = screen.getByText(FULL.label).className
    rerender(<KuickpayReceived kuickpay={PARTIAL} />)
    expect(screen.getByText(PARTIAL.label).className).not.toBe(fullClass)
  })

  it('does not trigger the click handler of the cell it sits in (cells start an inline edit)', () => {
    const onCell = vi.fn()
    render(<div onClick={onCell}><KuickpayReceived kuickpay={FULL} /></div>)
    fireEvent.click(screen.getByText(FULL.label))
    expect(onCell).not.toHaveBeenCalled()
  })
})
