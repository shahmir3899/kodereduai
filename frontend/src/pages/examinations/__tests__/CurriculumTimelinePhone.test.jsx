import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CurriculumTimeline from '../CurriculumTimeline'

// The topic name and the date label used fixed 160 px and 96 px columns, which left
// a phone bar about 100 px wide so the month labels ran together. The rows now
// stack below md; this pins that so the fixed columns do not come back.
describe('CurriculumTimeline on phones', () => {
  const year = { start_date: '2025-04-01', end_date: '2026-03-31' }
  const topics = [{ id: 1, topic_number: 1, title: 'Counting', planned_date: null, taught_date: '2025-10-05' }]

  it('stacks each topic row on small screens', () => {
    render(<CurriculumTimeline topics={topics} academicYear={year} />)
    const row = screen.getByText('1. Counting').parentElement
    expect(row.className).toContain('flex-col')
    expect(row.className).toContain('md:flex-row')
  })

  it('keeps the month axis flush left on small screens', () => {
    const { container } = render(<CurriculumTimeline topics={topics} academicYear={year} />)
    const axis = container.querySelector('.border-b')
    expect(axis.className).toContain('md:ml-40')
    expect(axis.className).not.toMatch(/(^|\s)ml-40/)
  })

  it('shows the taught date label', () => {
    render(<CurriculumTimeline topics={topics} academicYear={year} />)
    expect(screen.getByText('taught Oct 5')).toBeTruthy()
  })
})
