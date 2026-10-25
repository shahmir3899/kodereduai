import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import GuideVideoModal from './GuideVideoModal'

const video = { id: 'one', chapter: 2, title: { en: 'First', ur: 'پہلا' }, summary: 'The first video.' }
const next = { id: 'two', chapter: 2, title: { en: 'Second', ur: 'دوسرا' } }

beforeEach(() => {
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
  window.HTMLMediaElement.prototype.pause = vi.fn()
})

function setup(props = {}) {
  const handlers = { onLang: vi.fn(), onClose: vi.fn(), onNext: vi.fn(), onWatched: vi.fn() }
  const utils = render(<GuideVideoModal video={video} lang="en" nextVideo={next} {...handlers} {...props} />)
  const el = utils.container.ownerDocument.querySelector('video')
  Object.defineProperty(el, 'duration', { value: 100, configurable: true })
  return { ...handlers, el }
}

describe('GuideVideoModal', () => {
  it('marks the video watched once 90% has played, and only once', () => {
    const { el, onWatched } = setup()
    el.currentTime = 50; fireEvent.timeUpdate(el)
    expect(onWatched).not.toHaveBeenCalled()
    el.currentTime = 92; fireEvent.timeUpdate(el)
    el.currentTime = 95; fireEvent.timeUpdate(el)
    expect(onWatched).toHaveBeenCalledTimes(1)
    expect(onWatched).toHaveBeenCalledWith('one')
  })

  it('offers the next video when this one ends, and plays it', () => {
    const { el, onNext, onWatched } = setup()
    fireEvent.ended(el)
    expect(onWatched).toHaveBeenCalledWith('one')
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
