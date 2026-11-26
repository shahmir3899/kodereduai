import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import FeeTable from '../FeeTable'

// Monthly view with two monthly fees (Tuition + an optional course): a student's rows group under
// one name with a Category column and a sub-total, like the Annual view.
const base = {
  school: 1, month: 11, year: 2026, fee_type: 'MONTHLY', class_name: 'Class 1 - A',
  previous_balance: '0.00', amount_paid: '0.00', status: 'UNPAID', account_name: null, collected_by_name: null,
}
const tuition = (id, student, name, roll) => ({
  ...base, id, student, student_name: name, student_roll: roll, monthly_category: 1, monthly_category_name: 'Tuition Fee',
  base_monthly_fee: '3000.00', amount_due: '3000.00',
})
const koder = (id, student, name, roll) => ({
  ...base, id, student, student_name: name, student_roll: roll, monthly_category: 2, monthly_category_name: 'Koder Kids',
  base_monthly_fee: '1500.00', amount_due: '1500.00',
})

function renderTable(rows) {
  return render(
    <FeeTable
      paymentList={rows} isLoading={false} month={11} year={2026}
      selectedIds={new Set()} onToggleSelect={vi.fn()} onToggleSelectAll={vi.fn()}
      editingCell={null} setEditingCell={vi.fn()} editValue="" setEditValue={vi.fn()}
      onInlineUpdate={vi.fn()} onRecordPayment={vi.fn()} onDelete={vi.fn()}
      canWrite feeTypeFilter="MONTHLY"
    />,
  )
}

const table = () => document.querySelector('table')

describe('Collect Payments, Monthly view', () => {
  it('groups a student with two monthly fees and names each fee', () => {
    renderTable([tuition(1, 10, 'Ali Hassan', '1'), koder(2, 10, 'Ali Hassan', '1'), tuition(3, 11, 'Fatima Noor', '4')])
    const t = table()
    expect(within(t).getByText('Category')).toBeInTheDocument()
    expect(within(t).getAllByText('Ali Hassan')).toHaveLength(1)
    expect(within(t).getAllByText('Tuition Fee')).toHaveLength(2)
    expect(within(t).getByText('Koder Kids')).toBeInTheDocument()
    // Sub-total only for the student with more than one fee.
    expect(within(t).getByText('Sub Total (Ali Hassan)')).toBeInTheDocument()
    expect(within(t).queryByText('Sub Total (Fatima Noor)')).not.toBeInTheDocument()
  })

  it('keeps the plain list when the month has only one monthly fee', () => {
    renderTable([tuition(1, 10, 'Ali Hassan', '1'), tuition(3, 11, 'Fatima Noor', '4')])
    const t = table()
    expect(within(t).queryByText('Category')).not.toBeInTheDocument()
    expect(within(t).queryByText(/Sub Total/)).not.toBeInTheDocument()
    expect(screen.getAllByText('Ali Hassan').length).toBeGreaterThan(0)
  })
})
