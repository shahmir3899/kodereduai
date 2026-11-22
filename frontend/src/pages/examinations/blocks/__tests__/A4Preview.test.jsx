import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import A4Preview, { A4_WIDTH_PX, a4Scale } from '../A4Preview'

describe('A4Preview', () => {
  it('shrinks an A4-wide page to fit its column and never enlarges it', () => {
    expect(a4Scale(397)).toBeCloseTo(0.5, 2)
    expect(a4Scale(1200)).toBe(1)
    expect(a4Scale(0)).toBe(1)
  })

  it('lays the page out at A4 width inside a sandboxed frame', () => {
    render(<A4Preview title="Paper preview" html="<p>hi</p>" />)
    const frame = screen.getByTitle('Paper preview')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.style.width).toBe(`${A4_WIDTH_PX}px`)
  })

  it('centres the page in a box wider than A4 (Full size window) instead of leaving grey on one side', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(A4_WIDTH_PX + 60)
    try {
      render(<A4Preview title="Wide" html="<p>hi</p>" />)
      expect(screen.getByTitle('Wide').style.marginLeft).toBe('30px')
    } finally {
      spy.mockRestore()
    }
  })

  it('selects the question clicked in the page, and only from its own frame', () => {
    const onPick = vi.fn()
    render(<A4Preview title="Pick" html="<p>hi</p>" onPick={onPick} />)
    const frame = screen.getByTitle('Pick')
    window.dispatchEvent(new MessageEvent('message', { data: { paperBlock: 'q7' }, source: window }))
    expect(onPick).not.toHaveBeenCalled()
    window.dispatchEvent(new MessageEvent('message', { data: { paperBlock: 'q7' }, source: frame.contentWindow }))
    expect(onPick).toHaveBeenCalledWith('q7')
  })
})
