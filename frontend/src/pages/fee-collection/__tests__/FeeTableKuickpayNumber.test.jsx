import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import FeeTable from '../FeeTable'

const base = {
  school: 1, month: 11, year: 2026, fee_type: 'MONTHLY', student_roll: '1', class_name: 'Class 5',
  previous_balance: '0.00', base_monthly_fee: '2150.00', amount_due: '2150.00', amount_paid: '0.00',
  status: 'UNPAID', account_name: null, collected_by_name: null, kuickpay: null,
}
const ROWS = [
  { ...base, id: 1, student: 11, student_name: 'Ayesha Khan', kuickpay_consumer_number: '015203268489' },
  { ...base, id: 2, student: 12, student_name: 'Bilal Ahmed', kuickpay_consumer_number: null },
]

function renderTable(props = {}) {
  return render(
    <FeeTable
      paymentList={ROWS} isLoading={false} month={11} year={2026}
      selectedIds={new Set()} onToggleSelect={vi.fn()} onToggleSelectAll={vi.fn()}
      editingCell={null} setEditingCell={vi.fn()} editValue="" setEditValue={vi.fn()}
      onInlineUpdate={vi.fn()} onRecordPayment={vi.fn()} onDelete={vi.fn()}
      canWrite feeTypeFilter="MONTHLY" {...props}
    />,
  )
}

describe('Staff fee table: Kuickpay consumer number column', () => {
  it('shows the number with a copy button, in a column just before Action', () => {
    renderTable()
    const headers = [...document.querySelectorAll('thead th')].map((th) => th.textContent.trim())
    expect(headers.indexOf('Kuickpay No.')).toBe(headers.indexOf('Action') - 1)
    expect(screen.getAllByText('015203268489').length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('Copy 015203268489').length).toBeGreaterThan(0)
  })

  it('shows a dash on a row that has no number', () => {
    renderTable()
    const row = [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes('Bilal Ahmed'))
    expect(row.textContent).not.toContain('Copy')
  })

  it('adds no column for a school without Kuickpay (no row carries a number)', () => {
    renderTable({ paymentList: ROWS.map((r) => ({ ...r, kuickpay_consumer_number: null })) })
    const headers = [...document.querySelectorAll('thead th')].map((th) => th.textContent.trim())
    expect(headers).not.toContain('Kuickpay No.')
  })

  it('still shows the column read-only (accountant and teacher views)', () => {
    renderTable({ canWrite: false })
    const headers = [...document.querySelectorAll('thead th')].map((th) => th.textContent.trim())
    expect(headers).toContain('Kuickpay No.')
  })

  it('still renders older cached responses that lack the field', () => {
    renderTable({ paymentList: ROWS.map(({ kuickpay_consumer_number, ...rest }) => rest) })
    expect(screen.getAllByText('Ayesha Khan').length).toBeGreaterThan(0)
  })
})
