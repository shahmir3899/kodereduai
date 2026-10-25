import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import useGuideProgress, { summarizeProgress } from '../useGuideProgress'

beforeEach(() => { localStorage.clear(); vi.useRealTimers() })

describe('useGuideProgress', () => {
  it('completes a video only when enough seconds were really played, and keeps it separate per user', () => {
    const a = renderHook(() => useGuideProgress(1))
    act(() => { a.result.current.recordVideo('v1', { ranges: [[0, 40]], duration: 100, position: 40 }) })
    expect(a.result.current.watched.has('v1')).toBe(false)
    act(() => { a.result.current.recordVideo('v1', { ranges: [[40, 90]], duration: 100, position: 90, flush: true }) })
    expect(a.result.current.watched.has('v1')).toBe(true)

    const again = renderHook(() => useGuideProgress(1))
    expect(again.result.current.watched.has('v1')).toBe(true)
    expect(renderHook(() => useGuideProgress(2)).result.current.watched.size).toBe(0)
  })

  it('does not count replaying the same part twice', () => {
    const { result } = renderHook(() => useGuideProgress(1))
    act(() => { result.current.recordVideo('v1', { ranges: [[0, 50]], duration: 100, position: 50 }) })
    act(() => { result.current.recordVideo('v1', { ranges: [[0, 50]], duration: 100, position: 50, flush: true }) })
    expect(result.current.watched.has('v1')).toBe(false)
    expect(result.current.videoState('v1').ranges).toEqual([[0, 50]])
  })

  it('remembers the position for resuming, and never un-completes a video', () => {
    const { result } = renderHook(() => useGuideProgress(1))
    act(() => { result.current.recordVideo('v1', { ranges: [[0, 90]], duration: 100, position: 90, flush: true }) })
    act(() => { result.current.recordVideo('v1', { ranges: [[0, 5]], duration: 100, position: 5, flush: true }) })
    expect(result.current.watched.has('v1')).toBe(true)
    expect(result.current.videoState('v1').position).toBe(5)
  })

  it('ticks and un-ticks a step', () => {
    const { result } = renderHook(() => useGuideProgress(1))
    act(() => result.current.toggleDone('2.1'))
    expect(result.current.done.has('2.1')).toBe(true)
    act(() => result.current.toggleDone('2.1'))
    expect(result.current.done.has('2.1')).toBe(false)
  })

  it('keeps videos watched under the old format as completed', () => {
    localStorage.setItem('guideProgress:v1:1', JSON.stringify({ watched: { old: '2026-10-01T00:00:00Z' }, done: { '3.1': 'x' } }))
    const { result } = renderHook(() => useGuideProgress(1))
    expect(result.current.watched.has('old')).toBe(true)
    expect(result.current.done.has('3.1')).toBe(true)
  })

  it('works when storage is unavailable', () => {
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('blocked') }
    try {
      const { result } = renderHook(() => useGuideProgress(1))
      act(() => { result.current.recordVideo('v1', { ranges: [[0, 95]], duration: 100, position: 95, flush: true }) })
      expect(result.current.watched.has('v1')).toBe(true)
    } finally {
      Storage.prototype.setItem = real
    }
  })
})

describe('summarizeProgress', () => {
  it('counts a step with a video by the video, and a step without one by its tick', () => {
    const steps = [{ sectionId: '1.3', videoId: 'a' }, { sectionId: '2.1', videoId: 'b' }, { sectionId: '3.1', videoId: null }]
    const out = summarizeProgress({
      steps, videos: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      watched: new Set(['a']), done: new Set(['3.1', '2.1']), // ticking 2.1 does not count: it has a video
    })
    expect(out).toEqual({ stepsDone: 2, stepsTotal: 3, videosWatched: 1, videosTotal: 3 })
  })
})
