import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import GuideVideoModal from './GuideVideoModal'

const video = { id: 'one', chapter: 2, title: { en: 'First', ur: 'پہلا' }, summary: 'The first video.' }
const next = { id: 'two', chapter: 2, title: { en: 'Second', ur: 'دوسرا' } }

beforeEach(() => {
  Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', { get() { return this._paused !== false }, configurable: true })
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
  window.HTMLMediaElement.prototype.pause = vi.fn()
})

function setup(props = {}) {
  const handlers = { onLang: vi.fn(), onClose: vi.fn(), onNext: vi.fn(), onPlayed: vi.fn() }
  const utils = render(<GuideVideoModal video={video} lang="en" nextVideo={next} {...handlers} {...props} />)
  const el = utils.container.ownerDocument.querySelector('video')
  Object.defineProperty(el, 'duration', { value: 100, configurable: true })
  return { ...handlers, el }
}

describe('GuideVideoModal', () => {
  it('hands over what was played, with the language, so progress can be recorded', () => {
    const { el, onPlayed } = setup()
    el.currentTime = 10; fireEvent.timeUpdate(el)
    el._paused = false
    el.currentTime = 10.5; fireEvent.timeUpdate(el)
    fireEvent.pause(el)
    expect(onPlayed).toHaveBeenCalledWith('one', expect.objectContaining({ language: 'en', flush: true, duration: 100 }))
    expect(onPlayed.mock.calls.at(-1)[1].ranges).toEqual([[10, 10.5]])
  })

  it('offers to continue where the person left off, and can start over', () => {
    setup({ resumeAt: 42 })
    expect(screen.getByText(/Continuing where you left off/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(screen.queryByText(/Continuing where you left off/)).not.toBeInTheDocument()
  })

  it('offers the next video when this one ends, and plays it', () => {
    const { el, onNext } = setup()
    fireEvent.ended(el)
    expect(screen.getByRole('status')).toHaveTextContent('Up next: Second')
    fireEvent.click(screen.getByRole('button', { name: 'Play next' }))
    expect(onNext).toHaveBeenCalledWith('two')
  })

  it('says it was the last video, and closes, when there is no next one', () => {
    const { el, onClose } = setup({ nextVideo: null })
    fireEvent.ended(el)
    expect(screen.getByRole('status')).toHaveTextContent('last video in this group')
    expect(screen.queryByRole('button', { name: /Next video/ })).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('has a Next video button for skipping ahead', () => {
    const { onNext } = setup()
    fireEvent.click(screen.getByRole('button', { name: /Next video/ }))
    expect(onNext).toHaveBeenCalledWith('two')
  })
})
