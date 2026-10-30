import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import FeeCharts from '../FeeCharts'

// The ring's own labels ran off the edge of a phone screen, so the counts live in a legend below it.
describe('FeeCharts payment status', () => {
  it('lists each status with its count in a legend', () => {
    render(<FeeCharts summaryData={{ by_class: [], paid_count: 3, partial_count: 1, unpaid_count: 2, advance_count: 0 }} />)
    const legend = screen.getByTestId('status-legend')
    expect(legend.textContent).toContain('Paid: 3')
    expect(legend.textContent).toContain('Partial: 1')
    expect(legend.textContent).toContain('Unpaid: 2')
    expect(legend.textContent).not.toContain('Advance')
  })
})
