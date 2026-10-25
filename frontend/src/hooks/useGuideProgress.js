import { useCallback, useEffect, useMemo, useState } from 'react'

// What a person has watched or ticked off in the guide. For now it lives in this browser, per user, so two people
// sharing a computer do not share progress. Everything goes through this hook, so saving it on the server later
// (for the admin overview) changes this file and nothing else.
const keyFor = (userId) => `guideProgress:v1:${userId ?? 'anonymous'}`

function load(userId) {
  try {
    const saved = JSON.parse(localStorage.getItem(keyFor(userId)) || '{}')
    return { watched: saved.watched || {}, done: saved.done || {} }
  } catch {
    return { watched: {}, done: {} }
  }
}

export default function useGuideProgress(userId) {
  const [state, setState] = useState(() => load(userId))

  useEffect(() => { setState(load(userId)) }, [userId])

  const update = useCallback((change) => {
    setState((current) => {
      const next = change(current)
      try { localStorage.setItem(keyFor(userId), JSON.stringify(next)) } catch { /* storage blocked: progress lasts for this visit only */ }
      return next
    })
  }, [userId])

  const markWatched = useCallback((videoId) => {
    update((s) => (s.watched[videoId] ? s : { ...s, watched: { ...s.watched, [videoId]: new Date().toISOString() } }))
  }, [update])

  const toggleDone = useCallback((sectionId) => {
    update((s) => {
      const done = { ...s.done }
      if (done[sectionId]) delete done[sectionId]
      else done[sectionId] = new Date().toISOString()
      return { ...s, done }
    })
  }, [update])

  const watched = useMemo(() => new Set(Object.keys(state.watched)), [state.watched])
  const done = useMemo(() => new Set(Object.keys(state.done)), [state.done])

  return { watched, done, markWatched, toggleDone }
}

/**
 * Progress for the "Start here" path: a step counts once its video is watched or the person ticked it.
 * `steps` is [{ sectionId, videoId }]; `videos` is the list of videos that person can see.
 */
export function summarizeProgress({ steps, videos, watched, done }) {
  const stepsDone = steps.filter((s) => done.has(s.sectionId) || (s.videoId && watched.has(s.videoId))).length
  const videosWatched = videos.filter((v) => watched.has(v.id)).length
  return { stepsDone, stepsTotal: steps.length, videosWatched, videosTotal: videos.length }
}
