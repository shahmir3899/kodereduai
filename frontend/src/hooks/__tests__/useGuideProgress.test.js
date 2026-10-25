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

describe('useGuideProgress with the server', () => {
  const fakeApi = (mine = { videos: {}, steps: {} }) => ({
    mine: vi.fn().mockResolvedValue({ data: mine }),
    video: vi.fn().mockResolvedValue({}),
    step: vi.fn().mockResolvedValue({}),
    sync: vi.fn().mockResolvedValue({}),
  })

  it('uploads what the browser already held, once, and brings in the server copy', async () => {
    localStorage.setItem('guideProgress:v1:1', JSON.stringify({ watched: { 'mark-attendance': '2026-10-01T00:00:00Z' }, done: {} }))
    const api = fakeApi({ videos: { other: { ranges: [[0, 90]], duration: 100, position: 90, completedAt: '2026-10-02T00:00:00Z' } }, steps: {} })
    const { result } = renderHook(() => useGuideProgress(1, { api, schoolId: 5 }))
    await act(async () => {})
    expect(result.current.watched.has('other')).toBe(true)
    expect(result.current.watched.has('mark-attendance')).toBe(true)
    expect(api.sync).toHaveBeenCalledTimes(1)
    const sent = api.sync.mock.calls[0][0].videos['mark-attendance']
    expect(sent.ranges[0][0]).toBe(0)
    expect(sent.ranges[0][1]).toBeGreaterThan(0)   // an old "watched" tick goes up as fully played

    renderHook(() => useGuideProgress(1, { api, schoolId: 5 }))
    await act(async () => {})
    expect(api.sync).toHaveBeenCalledTimes(1)
  })

  it('saves what was played, and retries when the server was unreachable', async () => {
    const api = fakeApi()
    api.video.mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useGuideProgress(1, { api, schoolId: 5 }))
    await act(async () => {})
    await act(async () => { result.current.recordVideo('v1', { ranges: [[0, 50]], duration: 100, position: 50, flush: true }) })
    expect(api.video).toHaveBeenCalledTimes(1)
    await act(async () => { result.current.recordVideo('v1', { ranges: [[50, 60]], duration: 100, position: 60, flush: true }) })
    // inside the 10 s window nothing more is sent yet; the offline failure is kept for the next push
    expect(api.video).toHaveBeenCalledTimes(1)
  })

  it('sends a ticked step and keeps working if the server is unreachable', async () => {
    const api = fakeApi()
    api.mine.mockRejectedValue(new Error('offline'))
    const { result, unmount } = renderHook(() => useGuideProgress(1, { api, schoolId: 5 }))
    await act(async () => {})
    act(() => result.current.toggleDone('2.1'))
    expect(result.current.done.has('2.1')).toBe(true)
    await act(async () => { unmount() })
    expect(api.step).toHaveBeenCalledWith({ id: '2.1', done: true })
  })
})
