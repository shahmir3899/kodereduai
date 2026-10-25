import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import useGuideProgress, { summarizeProgress } from '../useGuideProgress'

beforeEach(() => localStorage.clear())

describe('useGuideProgress', () => {
  it('remembers watched videos and ticked steps for each user separately', () => {
    const a = renderHook(() => useGuideProgress(1))
    act(() => { a.result.current.markWatched('v1'); a.result.current.toggleDone('2.1') })
    expect(a.result.current.watched.has('v1')).toBe(true)
    expect(a.result.current.done.has('2.1')).toBe(true)

    const again = renderHook(() => useGuideProgress(1))
    expect(again.result.current.watched.has('v1')).toBe(true)
    const other = renderHook(() => useGuideProgress(2))
    expect(other.result.current.watched.size).toBe(0)
  })

  it('un-ticks a step when toggled twice', () => {
    const { result } = renderHook(() => useGuideProgress(1))
    act(() => result.current.toggleDone('2.1'))
    act(() => result.current.toggleDone('2.1'))
    expect(result.current.done.has('2.1')).toBe(false)
  })

  it('works when storage is unavailable', () => {
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('blocked') }
    try {
      const { result } = renderHook(() => useGuideProgress(1))
      act(() => result.current.markWatched('v1'))
      expect(result.current.watched.has('v1')).toBe(true)
    } finally {
      Storage.prototype.setItem = real
    }
  })
})

describe('summarizeProgress', () => {
  it('counts a step done by its video or by a tick', () => {
    const steps = [{ sectionId: '1.3', videoId: 'a' }, { sectionId: '2.1', videoId: 'b' }, { sectionId: '3.1', videoId: null }]
    const out = summarizeProgress({
      steps, videos: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      watched: new Set(['a']), done: new Set(['3.1']),
    })
    expect(out).toEqual({ stepsDone: 2, stepsTotal: 3, videosWatched: 1, videosTotal: 3 })
  })
})
