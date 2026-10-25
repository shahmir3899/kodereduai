import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isComplete, mergeRanges } from '../utils/guideProgressRules'

// What a person has watched or ticked off in the guide, kept per user. Everything goes through this hook.
// A video is watched once the seconds actually played reach the rule in utils/guideProgressRules.js.
const keyFor = (userId) => `guideProgress:v2:${userId ?? 'anonymous'}`
const COMMIT_EVERY_MS = 2000

function emptyState() {
  return { videos: {}, steps: {} }
}

// Version 1 only remembered *that* a video was watched. Keep those as completed so nobody loses progress.
function loadLegacy(userId) {
  try {
    const old = JSON.parse(localStorage.getItem(`guideProgress:v1:${userId ?? 'anonymous'}`) || '{}')
    const videos = {}
    Object.entries(old.watched || {}).forEach(([id, at]) => { videos[id] = { ranges: [], duration: 0, position: 0, completedAt: at, legacy: true } })
    return { videos, steps: old.done || {} }
  } catch {
    return emptyState()
  }
}

function load(userId) {
  try {
    const raw = localStorage.getItem(keyFor(userId))
    if (raw) {
      const saved = JSON.parse(raw)
      return { videos: saved.videos || {}, steps: saved.steps || {} }
    }
  } catch { /* fall through to the old format */ }
  return loadLegacy(userId)
}

export default function useGuideProgress(userId) {
  const [state, setState] = useState(() => load(userId))
  const live = useRef(state)          // always the newest data; state is committed from it at a calm pace
  const timer = useRef(null)

  const commit = useCallback(() => {
    timer.current = null
    setState({ ...live.current })
    try { localStorage.setItem(keyFor(userId), JSON.stringify(live.current)) } catch { /* storage blocked: progress lasts for this visit only */ }
  }, [userId])

  useEffect(() => {
    live.current = load(userId)
    setState(live.current)
  }, [userId])

  // Do not lose the last seconds when the page goes away.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); commit() } }, [commit])

  const schedule = useCallback((immediately) => {
    if (immediately) {
      if (timer.current) clearTimeout(timer.current)
      commit()
    } else if (!timer.current) {
      timer.current = setTimeout(commit, COMMIT_EVERY_MS)
    }
  }, [commit])

  /** Add what was played in this session. `ranges` are [start, end] seconds really played; `flush` saves now. */
  const recordVideo = useCallback((videoId, { ranges, duration, position, language, flush = false }) => {
    const before = live.current.videos[videoId] || { ranges: [], duration: 0, position: 0 }
    const merged = mergeRanges([...(before.ranges || []), ...(ranges || [])])
    const length = duration > 0 ? duration : before.duration
    const completedAt = before.completedAt || (isComplete(merged, length) ? new Date().toISOString() : undefined)
    live.current = {
      ...live.current,
      videos: {
        ...live.current.videos,
        [videoId]: { ...before, ranges: merged, duration: length, position: position ?? before.position, language: language || before.language, completedAt },
      },
    }
    schedule(flush || (completedAt && !before.completedAt))
    return Boolean(completedAt)
  }, [schedule])

  /** A step with no video of its own is ticked by hand. */
  const toggleDone = useCallback((sectionId) => {
    const steps = { ...live.current.steps }
    if (steps[sectionId]) delete steps[sectionId]
    else steps[sectionId] = new Date().toISOString()
    live.current = { ...live.current, steps }
    schedule(true)
  }, [schedule])

  const watched = useMemo(
    () => new Set(Object.entries(state.videos).filter(([, v]) => v.completedAt).map(([id]) => id)),
    [state.videos],
  )
  const done = useMemo(() => new Set(Object.keys(state.steps)), [state.steps])
  const videoState = useCallback((id) => state.videos[id] || null, [state.videos])

  return { watched, done, videoState, recordVideo, toggleDone }
}

/**
 * Progress for the "Start here" path: a step with a video is done when that video is watched; a step without
 * one is done when ticked. `steps` is [{ sectionId, videoId }]; `videos` is the list this person can see.
 */
export function summarizeProgress({ steps, videos, watched, done }) {
  const stepsDone = steps.filter((s) => (s.videoId ? watched.has(s.videoId) : done.has(s.sectionId))).length
  const videosWatched = videos.filter((v) => watched.has(v.id)).length
  return { stepsDone, stepsTotal: steps.length, videosWatched, videosTotal: videos.length }
}
