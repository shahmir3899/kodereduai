import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/utils'
import StudentFees from '../student/StudentFees'
import { feeTotals, feeLabel, groupByBranch } from '../../utils/portalFees'
import StudentTimetable from '../student/StudentTimetable'

let mockYear = { id: 7, name: '2026-27' }
vi.mock('../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: mockYear, loading: false }),
}))

// Row shape pinned by finance.FeePaymentSerializer via students.history.fee_rows.
const row = (over) => ({
  id: 1, academic_year: 7, fee_type: 'MONTHLY', fee_type_display: 'Monthly', month: 9, year: 2026,
  previous_balance: '0.00', amount_due: '1000.00', amount_paid: '0.00', status: 'UNPAID',
  payment_date: null, payment_method: 'CASH', kuickpay: null, annual_category_name: null, ...over,
})

const rows = [
  row({ id: 1, month: 9, amount_due: '1000.00', amount_paid: '1000.00', status: 'PAID' }),
  // Carries the 500 unpaid from September, so its own fee is 1000.
  row({ id: 2, month: 10, previous_balance: '0.00', amount_due: '1000.00', amount_paid: '500.00', status: 'PARTIAL' }),
  row({ id: 3, fee_type: 'ANNUAL', month: null, annual_category_name: 'Annual Charges', amount_due: '3000.00', amount_paid: '1000.00', status: 'PARTIAL' }),
  row({ id: 4, academic_year: 6, month: 3, amount_due: '900.00', amount_paid: '900.00', status: 'PAID' }), // last year
]

describe('fee helpers', () => {
  it('labels months by name and annual rows by category', () => {
    expect(feeLabel(rows[0])).toBe('September')
    expect(feeLabel(rows[2])).toBe('Annual Charges')
  })

  it('does not double count carried monthly balances', () => {
    const monthly = [
      row({ month: 9, amount_due: '1000.00', amount_paid: '400.00' }),
      row({ month: 10, previous_balance: '600.00', amount_due: '1600.00', amount_paid: '0.00' }),
    ]
    expect(feeTotals(monthly, 'MONTHLY')).toEqual({ charged: 2000, paid: 400, balance: 1600 })
    expect(feeTotals([rows[2]], 'ANNUAL')).toEqual({ charged: 3000, paid: 1000, balance: 2000 })
  })
})

describe('branch grouping', () => {
  it('keeps the active year for the current branch and every row of an earlier branch', () => {
    const earlier = row({ id: 9, academic_year: 3, branch: 'Old Branch', read_only: true })
    const groups = groupByBranch([...rows, earlier], 7)
    expect(groups.map((g) => g.name)).toEqual([null, 'Old Branch'])
    expect(groups[0].rows.map((r) => r.id)).toEqual([1, 2, 3])
    expect(groups[1].rows.map((r) => r.id)).toEqual([9])
  })

  it('does not count a handed-over balance as owed', () => {
    const handed = [row({ month: 6, amount_due: '1000.00', amount_paid: '200.00', handed_over: true })]
    expect(feeTotals(handed, 'MONTHLY').balance).toBe(0)
    expect(feeTotals([row({ fee_type: 'ANNUAL', amount_due: '500.00', amount_paid: '0.00', handed_over: true })], 'ANNUAL').balance).toBe(0)
  })
})

describe('StudentFees', () => {
  const serve = () => server.use(http.get('*/api/students/portal/fees/', () => HttpResponse.json(rows)))

  it('shows only the active academic year, Monthly first, with month names', async () => {
    serve()
    renderWithProviders(<StudentFees />)
    expect(await screen.findByRole('tab', { name: /Monthly/ })).toHaveTextContent('(2)')
    expect(screen.getByRole('tab', { name: /Yearly/ })).toHaveTextContent('(1)')
    expect((await screen.findAllByText('September')).length).toBeGreaterThan(0)
    expect(screen.queryByText('March')).not.toBeInTheDocument() // belongs to the other year
  })

  it('switches to the Yearly tab', async () => {
    serve()
    renderWithProviders(<StudentFees />)
    await userEvent.click(await screen.findByRole('tab', { name: /Yearly/ }))
    expect((await screen.findAllByText('Annual Charges')).length).toBeGreaterThan(0)
    expect(screen.queryByText('September')).not.toBeInTheDocument()
  })

  it('gives an earlier branch its own read-only tab', async () => {
    server.use(http.get('*/api/students/portal/fees/', () => HttpResponse.json([
      ...rows,
      row({ id: 9, academic_year: 3, branch: 'Old Branch', read_only: true, month: 5, amount_due: '700.00', amount_paid: '700.00', status: 'PAID', academic_year_name: '2024-25' }),
    ])))
    renderWithProviders(<StudentFees />)
    await userEvent.click(await screen.findByRole('tab', { name: /Earlier · Old Branch/ }))
    expect((await screen.findAllByText('May')).length).toBeGreaterThan(0)
    expect(screen.getByText(/Read-only history from Old Branch/)).toBeInTheDocument()
    expect(screen.queryByText('September')).not.toBeInTheDocument()
  })

  it('shows no branch tabs when the child never moved', async () => {
    serve()
    renderWithProviders(<StudentFees />)
    await screen.findByRole('tab', { name: /Monthly/ })
    expect(screen.queryByRole('tab', { name: /Current branch/ })).not.toBeInTheDocument()
  })

  it('shows an empty state per tab for a year without fees', async () => {
    mockYear = { id: 99, name: '2027-28' }
    serve()
    renderWithProviders(<StudentFees />)
    expect(await screen.findByText(/No monthly fees for 2027-28/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Yearly/ }))
    expect(await screen.findByText(/No yearly fees for 2027-28/)).toBeInTheDocument()
    mockYear = { id: 7, name: '2026-27' }
  })
})

describe('StudentTimetable', () => {
  it('joins entries to slots so periods keep their times and sit on the right day', async () => {
    server.use(http.get('*/api/students/portal/timetable/', () => HttpResponse.json({
      slots: [
        { id: 1, name: 'P1', start_time: '08:00:00', end_time: '08:40:00', slot_type: 'PERIOD', order: 1, applicable_days: null },
        { id: 2, name: 'Break', start_time: '08:40:00', end_time: '09:00:00', slot_type: 'BREAK', order: 2, applicable_days: ['MON'] },
        { id: 3, name: 'P2', start_time: '09:00:00', end_time: '09:40:00', slot_type: 'PERIOD', order: 3, applicable_days: null },
      ],
      entries: [
        { day: 'MON', slot_id: 1, subject: 'Maths', teacher: 'Ms A', room: null },
        { day: 'MON', slot_id: 3, subject: 'English', teacher: 'Mr B', room: null },
        { day: 'TUE', slot_id: 1, subject: 'Science', teacher: 'Ms C', room: null },
      ],
    })))
    renderWithProviders(<StudentTimetable />)
    expect((await screen.findAllByText('Maths')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('English').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Science').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Break').length).toBeGreaterThan(0)
  })
})
