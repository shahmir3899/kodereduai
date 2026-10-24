import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import TermRangeSlider from './TermRangeSlider'

const props = { min: '2026-04-01', max: '2026-04-30', start: '2026-04-10', end: '2026-04-20' }

describe('TermRangeSlider', () => {
  it('moves the start handle in whole days', () => {
    const onChange = vi.fn()
    render(<TermRangeSlider {...props} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Term start'), { target: { value: '5' } })
    expect(onChange).toHaveBeenCalledWith({ start_date: '2026-04-06', end_date: '2026-04-20' })
  })

  it('never lets the handles cross', () => {
    const onChange = vi.fn()
    render(<TermRangeSlider {...props} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Term start'), { target: { value: '25' } })
    expect(onChange).toHaveBeenLastCalledWith({ start_date: '2026-04-19', end_date: '2026-04-20' })
    fireEvent.change(screen.getByLabelText('Term end'), { target: { value: '2' } })
    expect(onChange).toHaveBeenLastCalledWith({ start_date: '2026-04-10', end_date: '2026-04-11' })
  })
})
