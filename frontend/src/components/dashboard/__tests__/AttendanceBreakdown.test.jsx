import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AttendanceBreakdown from '../AttendanceBreakdown'

describe('AttendanceBreakdown', () => {
  it('shows all four states with their counts', () => {
    render(<AttendanceBreakdown report={{ total_students: 230, present_count: 216, leave_count: 2, absent_count: 12, not_marked_count: 0 }} />)
    expect(screen.getByText('Present: 216')).toBeTruthy()
    expect(screen.getByText('On Leave: 2')).toBeTruthy()
    expect(screen.getByText('Absent: 12')).toBeTruthy()
    expect(screen.getByText('Not marked: 0')).toBeTruthy()
    expect(screen.getByText('216/230')).toBeTruthy()
  })

  it('treats a payload without the new fields as zero, not NaN', () => {
    render(<AttendanceBreakdown report={{ total_students: 10, present_count: 10, absent_count: 0 }} />)
    expect(screen.getByText('On Leave: 0')).toBeTruthy()
    expect(screen.getByText('Not marked: 0')).toBeTruthy()
  })
})
