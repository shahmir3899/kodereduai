import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import FeeTable from '../FeeTable'

const base = {
  school: 1, month: 1, year: 2026, fee_type: 'MONTHLY', student_roll: '1', class_name: 'Class A',
  previous_balance: '0.00', base_monthly_fee: '6500.00', amount_due: '6500.00', account_name: null, collected_by_name: null,
}
const ROWS = [
  { ...base, id: 1, student: 11, student_name: 'Ayesha Khan', amount_paid: '6500.00', status: 'PAID',
    kuickpay: { gateway: 'Kuickpay', received: '6500.00', coverage: 'FULL', label: 'PKR 6,500 received via Kuickpay (paid in full)',
      reference_text: 'Ref 550727', payments: [{ reference: '550727', receipt: '00000000000000000226', date: '2026-01-12', amount: '6500.00' }] } },
  { ...base, id: 2, student: 12, student_name: 'Bilal Ahmed', amount_paid: '2000.00', status: 'PARTIAL', kuickpay: null },
  { ...base, id: 3, student: 13, student_name: 'Chand Ali', amount_paid: '2000.00', status: 'PARTIAL',
    kuickpay: { gateway: 'Kuickpay', received: '2000.00', coverage: 'PARTIAL', label: 'PKR 2,000 received via Kuickpay (partial payment)',
      reference_text: 'Ref 600001', payments: [{ reference: '600001', receipt: '00000000000000000301', date: '2026-01-10', amount: '2000.00' }] } },
]

function renderTable(props = {}) {
  return render(
    <FeeTable
      paymentList={ROWS} isLoading={false} month={1} year={2026}
      selectedIds={new Set()} onToggleSelect={vi.fn()} onToggleSelectAll={vi.fn()}
      editingCell={null} setEditingCell={vi.fn()} editValue="" setEditValue={vi.fn()}
      onInlineUpdate={vi.fn()} onRecordPayment={vi.fn()} onDelete={vi.fn()}
      canWrite feeTypeFilter="MONTHLY" {...props}
    />,
  )
}

describe('Staff fee table: received via Kuickpay', () => {
  it('shows the label with amount, gateway and reference on the records paid through Kuickpay', () => {
    renderTable()
    expect(screen.getAllByText('PKR 6,500 received via Kuickpay (paid in full)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('PKR 2,000 received via Kuickpay (partial payment)').length).toBeGreaterThan(0)
    expect(document.body.textContent).toContain('Ref 550727')
    expect(document.body.textContent).toContain('Ref 600001')
  })

  it('does not label a record that was paid another way', () => {
    renderTable()
    const labels = [...document.querySelectorAll('[data-testid="kuickpay-received"]')].map((el) => el.textContent)
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.every((t) => t.includes('Kuickpay'))).toBe(true)
    expect(document.body.textContent).not.toContain('Bilal Ahmed received via Kuickpay')
  })

  it('shows the label read-only too (finance manager and teacher views)', () => {
    renderTable({ canWrite: false })
    expect(screen.getAllByText('PKR 6,500 received via Kuickpay (paid in full)').length).toBeGreaterThan(0)
  })

  it('still renders records with no kuickpay field at all (older cached responses)', () => {
    renderTable({ paymentList: ROWS.map(({ kuickpay, ...rest }) => rest) })
    expect(screen.queryByTestId('kuickpay-received')).toBeNull()
    expect(screen.getAllByText('Ayesha Khan').length).toBeGreaterThan(0)
  })
})
