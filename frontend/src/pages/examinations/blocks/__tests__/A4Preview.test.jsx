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

describe('A4Preview fitWindow', () => {
  it('is no taller than the window below its top, and never under 320 px', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 500, bottom: 0, left: 0, right: 0, width: 0, height: 0 })
    window.innerHeight = 1080
    const { container, unmount } = render(<A4Preview html="<p>x</p>" title="Fitted" fitWindow />)
    // 1080 - 500 - 16 = 564, under 78vh (842)
    expect(container.firstChild.style.height).toBe('564px')
    unmount()
    spy.mockReturnValue({ top: 950, bottom: 0, left: 0, right: 0, width: 0, height: 0 })
    const again = render(<A4Preview html="<p>x</p>" title="Fitted" fitWindow />)
    expect(again.container.firstChild.style.height).toBe('320px')
    spy.mockRestore()
  })

  it('keeps the given height without fitWindow (Full size window)', () => {
    const { container } = render(<A4Preview html="<p>x</p>" title="Plain" height="80vh" />)
    expect(container.firstChild.style.height).toBe('80vh')
  })
})
