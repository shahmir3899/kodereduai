import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DateStepper, { shiftDate, toLocalISODate } from './DateStepper'

describe('DateStepper helpers', () => {
  it('steps across month and year boundaries', () => {
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('formats local date without UTC shift', () => {
    expect(toLocalISODate(new Date(2026, 9, 23, 0, 30))).toBe('2026-10-23')
  })
})

describe('DateStepper', () => {
  it('disables forward at today and steps back', () => {
    const onChange = vi.fn()
    render(<DateStepper date="2026-10-23" today="2026-10-23" onChange={onChange} />)
    expect(screen.getByText('Today')).toBeTruthy()
    expect(screen.getByLabelText('Next day').disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Previous day'))
    expect(onChange).toHaveBeenCalledWith('2026-10-22')
  })

  it('enables forward on a past date', () => {
    const onChange = vi.fn()
    render(<DateStepper date="2026-10-20" today="2026-10-23" onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Next day'))
    expect(onChange).toHaveBeenCalledWith('2026-10-21')
  })
})
