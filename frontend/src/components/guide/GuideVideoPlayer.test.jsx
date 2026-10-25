import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import GuideVideoPlayer, { formatClock } from './GuideVideoPlayer'

beforeEach(() => {
  localStorage.clear()
  // jsdom has no media engine: stand in for play/pause and give the element a length.
  Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', { get() { return this._paused !== false }, configurable: true })
  window.HTMLMediaElement.prototype.play = vi.fn(function play() { this._paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve() })
  window.HTMLMediaElement.prototype.pause = vi.fn(function pause() { this._paused = true; this.dispatchEvent(new Event('pause')) })
})

function setup(props = {}) {
  const utils = render(<GuideVideoPlayer src="/v.mp4" captionsSrc="/v.vtt" captionsLang="en" captionsLabel="English" {...props} />)
  const video = utils.container.querySelector('video')
  Object.defineProperty(video, 'duration', { value: 100, configurable: true })
  video.currentTime = 50
  fireEvent.loadedMetadata(video)
  fireEvent.timeUpdate(video)
  return { ...utils, video }
}

describe('GuideVideoPlayer', () => {
  it('formats the clock', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(75.9)).toBe('1:15')
    expect(formatClock(NaN)).toBe('0:00')
  })

  it('skips forward and back ten seconds, and stays inside the video', () => {
    const { video } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }))
    expect(video.currentTime).toBe(60)
    fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }))
    expect(video.currentTime).toBe(40)
    video.currentTime = 95
    fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }))
    expect(video.currentTime).toBe(100)
    video.currentTime = 4
    fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }))
    expect(video.currentTime).toBe(0)
  })

  it('plays and pauses from the button and from the keyboard', () => {
    const { video } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(video.play).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByLabelText(/Video player/), { key: ' ' })
    expect(video.pause).toHaveBeenCalled()
  })

  it('seeks with the bar', () => {
    const { video } = setup()
    fireEvent.change(screen.getByLabelText('Seek'), { target: { value: '12' } })
    expect(video.currentTime).toBe(12)
  })

  it('controls volume, mute and speed, and remembers them', () => {
    const { video } = setup()
    fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '0.4' } })
    expect(video.volume).toBeCloseTo(0.4)
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    expect(video.muted).toBe(true)
    fireEvent.change(screen.getByLabelText('Playback speed'), { target: { value: '1.5' } })
    expect(video.playbackRate).toBe(1.5)
    expect(JSON.parse(localStorage.getItem('guideVideoPrefs'))).toMatchObject({ volume: 0.4, speed: 1.5, muted: true })
  })

  it('starts from the remembered speed', () => {
    localStorage.setItem('guideVideoPrefs', JSON.stringify({ speed: 2, volume: 0.3 }))
    const { video } = setup()
    expect(video.playbackRate).toBe(2)
    expect(video.volume).toBeCloseTo(0.3)
  })

  it('toggles captions', () => {
    setup()
    const cc = screen.getByRole('button', { name: 'Captions' })
    expect(cc).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(cc)
    expect(cc).toHaveAttribute('aria-pressed', 'false')
  })

  it('uses J/L and M from the keyboard', () => {
    const { video } = setup()
    const box = screen.getByLabelText(/Video player/)
    fireEvent.keyDown(box, { key: 'l' })
    expect(video.currentTime).toBe(60)
    fireEvent.keyDown(box, { key: 'j' })
    expect(video.currentTime).toBe(50)
    fireEvent.keyDown(box, { key: 'm' })
    expect(video.muted).toBe(true)
  })

  it('carries the position across a language switch', () => {
    const { container, rerender } = render(<GuideVideoPlayer src="/en.mp4" startAt={0} />)
    rerender(<GuideVideoPlayer src="/ur.mp4" startAt={42} />)
    const video = container.querySelector('video')
    Object.defineProperty(video, 'duration', { value: 100, configurable: true })
    fireEvent.loadedMetadata(video)
    expect(video.currentTime).toBe(42)
  })
})

describe('GuideVideoPlayer played seconds', () => {
  const play = (video, from, to, step = 0.5) => {
    video._paused = false
    video.currentTime = from; fireEvent.timeUpdate(video)
    for (let t = from + step; t <= to + 1e-9; t += step) { video.currentTime = t; fireEvent.timeUpdate(video) }
  }

  it('reports only the seconds really played, merged', () => {
    const onPlayed = vi.fn()
    const { video } = setup({ onPlayed })
    play(video, 0, 10)
    fireEvent.pause(video)
    expect(onPlayed.mock.calls.at(-1)[0]).toMatchObject({ ranges: [[0, 10]], flush: true })
  })

  it('earns nothing for dragging the bar to the end', () => {
    const onPlayed = vi.fn()
    const { video } = setup({ onPlayed })
    video._paused = false
    video.currentTime = 1; fireEvent.timeUpdate(video)
    video.currentTime = 99; fireEvent.timeUpdate(video)   // a jump, not playback
    video.currentTime = 100; fireEvent.timeUpdate(video)
    fireEvent.pause(video)
    expect(onPlayed.mock.calls.at(-1)[0].ranges).toEqual([[99, 100]]) // only the last real second, never the gap
  })

  it('ignores time while the page is hidden and above 2x speed', () => {
    const onPlayed = vi.fn()
    const { video } = setup({ onPlayed })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    play(video, 0, 5)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    video.playbackRate = 3
    play(video, 10, 15)
    video.playbackRate = 1
    fireEvent.pause(video)
    expect(onPlayed.mock.calls.at(-1)?.[0].ranges ?? []).toEqual([])
  })

  it('does not count a pause, and allows 2x', () => {
    const onPlayed = vi.fn()
    const { video } = setup({ onPlayed })
    video.playbackRate = 2
    play(video, 20, 30, 1)
    fireEvent.pause(video)
    expect(onPlayed.mock.calls.at(-1)[0].ranges).toEqual([[20, 30]])
  })
})
