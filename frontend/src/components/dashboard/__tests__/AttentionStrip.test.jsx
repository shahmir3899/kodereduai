import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import AttentionStrip, { buildAttentionItems } from '../AttentionStrip'

const renderStrip = (props) => render(<MemoryRouter><AttentionStrip {...props} /></MemoryRouter>)

describe('buildAttentionItems', () => {
  it('drops zero, missing and non-numeric counts', () => {
    const items = buildAttentionItems({ pendingLeave: 0, newEnquiries: undefined, lowStock: 'x', overdueBooks: 2 })
    expect(items.map((i) => i.key)).toEqual(['lib'])
  })

  it('suppresses attendance chips on off days', () => {
    const items = buildAttentionItems({ isOffDay: true, notMarkedStudents: 30, staffUnmarked: 4, pendingLeave: 1 })
    expect(items.map((i) => i.key)).toEqual(['leave'])
  })

  it('respects disabled modules', () => {
    const items = buildAttentionItems({
      isModuleEnabled: (m) => m !== 'hr',
      pendingLeave: 3, pendingPayroll: 2, newEnquiries: 1,
    })
    expect(items.map((i) => i.key)).toEqual(['enq'])
  })

  it('orders red before amber before blue, keeping insertion order within a tone', () => {
    const items = buildAttentionItems({
      newEnquiries: 1, pendingLeave: 1, unpaidFees: 1, notMarkedStudents: 1,
    })
    expect(items.map((i) => i.key)).toEqual(['att', 'unpaid', 'leave', 'enq'])
  })
})

describe('AttentionStrip', () => {
  it('shows a skeleton, not "All clear", while loading', () => {
    renderStrip({ items: [], loading: true })
    expect(screen.queryByText(/All clear/)).toBeNull()
  })

  it('shows All clear when there are no items', () => {
    renderStrip({ items: [] })
    expect(screen.getByText(/All clear/)).toBeTruthy()
  })

  it('caps visible chips at 6 and reports the remainder', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      key: `k${i}`, count: i + 1, label: `thing ${i}`, href: '/x', tone: 'amber',
    }))
    renderStrip({ items })
    expect(screen.getAllByRole('link')).toHaveLength(6)
    expect(screen.getByText('+2 more')).toBeTruthy()
  })

  it('renders hash targets as plain anchors', () => {
    renderStrip({ items: [{ key: 'ai', count: 2, label: 'AI alerts', href: '#ai-insights', tone: 'red' }] })
    expect(screen.getByRole('link').getAttribute('href')).toBe('#ai-insights')
  })
})
