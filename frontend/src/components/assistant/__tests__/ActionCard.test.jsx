import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ActionCard from '../ActionCard'
import { buildEdits } from '../cardConfig'

const feeCard = (over = {}) => ({
  id: 11, status: 'pending', can_act: true,
  preview: {
    kind: 'fee_payments', title: 'Record fee payments', summary: '2 students paid, total Rs 4,000, into Cash Box',
    columns: ['Student', 'Class', 'Period', 'Due', 'Paying'],
    rows: [
      { id: 1, student: 'Ahmad Khan', class: 'Class 5', period: 'Nov 2026', due: 2000, paying: 2000 },
      { id: 2, student: 'Sara Noor', class: 'Class 5', period: 'Nov 2026', due: 2000, paying: 2000 },
    ],
    totals: { count: 2, paying: 4000 },
    account: { name: 'Cash Box', balance_before: 1000, balance_after: 5000 },
    warnings: ['Some rows pay less than the full remaining amount.'],
  },
  ...over,
})

const attendanceCard = () => ({
  id: 12, status: 'pending', can_act: true,
  preview: {
    kind: 'attendance', title: 'Mark attendance', summary: 'Class 5A: 1 present, 1 absent', columns: ['Student', 'Now', 'Will be'],
    rows: [
      { student_id: 5, student: 'Ali Raza', was: 'NOT MARKED', status: 'ABSENT' },
      { student_id: 6, student: 'Sara Noor', was: 'NOT MARKED', status: 'PRESENT' },
    ],
    totals: { count: 2 }, warnings: ['Parents of 1 absent student(s) will be notified.'],
  },
})

const handlers = () => ({ onApprove: vi.fn(), onReject: vi.fn(), onEdit: vi.fn().mockResolvedValue() })

describe('ActionCard', () => {
  it('shows the rows, total, balance change and warnings', () => {
    render(<ActionCard action={feeCard()} {...handlers()} />)
    expect(screen.getByText('Record fee payments')).toBeInTheDocument()
    expect(screen.getByText('Ahmad Khan')).toBeInTheDocument()
    expect(screen.getByText(/Total Rs 4,000/)).toBeInTheDocument()
    expect(screen.getByText(/Cash Box: Rs 1,000 → Rs 5,000/)).toBeInTheDocument()
    expect(screen.getByText(/pay less than the full/)).toBeInTheDocument()
  })

  it('approve and reject call back with the card id', async () => {
    const h = handlers()
    render(<ActionCard action={feeCard()} {...h} />)
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(h.onApprove).toHaveBeenCalledWith(11)
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(h.onReject).toHaveBeenCalledWith(11)
  })

  it('edit: remove a row and change an amount, then send exactly those edits', async () => {
    const h = handlers()
    render(<ActionCard action={feeCard()} {...h} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.click(screen.getByLabelText('Remove row 2'))
    const amount = screen.getByLabelText('Amount for Ahmad Khan')
    await userEvent.clear(amount)
    await userEvent.type(amount, '1500')
    await userEvent.click(screen.getByRole('button', { name: 'Update card' }))
    expect(h.onEdit).toHaveBeenCalledWith(11, { remove_ids: [2], amounts: { 1: '1500' } })
  })

  it('edit with no change sends nothing', async () => {
    const h = handlers()
    render(<ActionCard action={feeCard()} {...h} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Update card' }))
    expect(h.onEdit).not.toHaveBeenCalled()
  })

  it('attendance: change one status and send it keyed by student', async () => {
    const h = handlers()
    render(<ActionCard action={attendanceCard()} {...h} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.selectOptions(screen.getByLabelText('Status for Sara Noor'), 'LEAVE')
    await userEvent.click(screen.getByRole('button', { name: 'Update card' }))
    expect(h.onEdit).toHaveBeenCalledWith(12, { statuses: { 6: 'LEAVE' } })
  })

  it('cancel leaves edit mode without calling the server', async () => {
    const h = handlers()
    render(<ActionCard action={feeCard()} {...h} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(h.onEdit).not.toHaveBeenCalled()
  })

  it('a finished card has no buttons and shows what happened', () => {
    render(<ActionCard action={feeCard({ status: 'executed', can_act: false, result: { updated: 2, total_paid: 4000, failed: 0 } })} {...handlers()} />)
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.getByText(/updated 2 · Rs 4,000/)).toBeInTheDocument()
  })

  it('shows failures, rejections and expiry clearly', () => {
    const { rerender } = render(<ActionCard action={feeCard({ status: 'failed', can_act: false, error: 'Period is closed' })} {...handlers()} />)
    expect(screen.getByText('Period is closed')).toBeInTheDocument()
    rerender(<ActionCard action={feeCard({ status: 'rejected', can_act: false })} {...handlers()} />)
    expect(screen.getByText('rejected')).toBeInTheDocument()
    rerender(<ActionCard action={feeCard({ status: 'expired', can_act: false })} {...handlers()} />)
    expect(screen.getByText(/card expired/i)).toBeInTheDocument()
  })

  it('shows a server error from an approve attempt and disables buttons while busy', () => {
    render(<ActionCard action={feeCard()} note={{ busy: true, error: 'The data changed.' }} {...handlers()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('The data changed.')
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled()
  })

  it('collapses long lists and can show all', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, student: `Student ${i + 1}`, class: 'C', period: 'P', due: 1, paying: 1 }))
    const card = feeCard()
    card.preview.rows = rows
    render(<ActionCard action={card} {...handlers()} />)
    expect(screen.queryByText('Student 12')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show all 12' }))
    expect(screen.getByText('Student 12')).toBeInTheDocument()
  })

  it('renders Urdu text with automatic direction', () => {
    const card = attendanceCard()
    card.preview.rows[0].student = 'علی رضا'
    render(<ActionCard action={card} {...handlers()} />)
    const cell = screen.getByText('علی رضا').closest('td')
    expect(cell).toHaveAttribute('dir', 'auto')
  })

  it('a card kind with nothing to edit hides the Edit button', () => {
    const card = { id: 13, status: 'pending', can_act: true, preview: { kind: 'edit_entry', title: 'Edit expense entry', summary: 's', columns: ['Field', 'Now', 'Change to'], rows: [{ field: 'amount', from: 700, to: 650 }] } }
    render(<ActionCard action={card} {...handlers()} />)
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(within(screen.getByTestId('action-card')).getByText('650')).toBeInTheDocument()
  })
})

describe('buildEdits', () => {
  const rows = [{ key: 'a', amount: 100 }, { key: 'b', amount: 200 }]
  const empty = () => ({ removed: new Set(), amounts: {}, statuses: {} })

  it('maps each kind to the server field names', () => {
    expect(buildEdits('expense_entries', rows, { ...empty(), removed: new Set(['b']), amounts: { a: '150' } }))
      .toEqual({ remove_keys: ['b'], amounts: { a: '150' } })
    expect(buildEdits('lesson_plans', rows, { ...empty(), removed: new Set(['a']) })).toEqual({ remove_keys: ['a'] })
    expect(buildEdits('delete_lesson_plans', [{ id: 1 }], { ...empty(), removed: new Set([1]) })).toEqual({ remove_ids: [1] })
  })

  it('ignores unchanged and removed rows when collecting amounts', () => {
    expect(buildEdits('expense_entries', rows, { ...empty(), amounts: { a: '100', b: '250' }, removed: new Set(['b']) })).toEqual({ remove_keys: ['b'] })
  })

  it('returns nothing for an unknown kind', () => {
    expect(buildEdits('mystery', rows, empty())).toEqual({})
  })
})
