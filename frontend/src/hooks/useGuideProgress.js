import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isComplete, mergeRanges } from '../utils/guideProgressRules'
import videoData from '../data/guideVideos.json'

// What a person has watched or ticked off in the guide, kept per user. Everything goes through this hook.
// A video is watched once the seconds actually played reach the rule in utils/guideProgressRules.js.
const keyFor = (userId) => `guideProgress:v2:${userId ?? 'anonymous'}`
const COMMIT_EVERY_MS = 2000
const SERVER_EVERY_MS = 10000
const SECONDS_BY_ID = Object.fromEntries(videoData.videos.map((v) => [v.id, v.seconds?.en || 0]))
const syncedKey = (userId, schoolId) => `guideProgress:synced:${userId ?? 'anonymous'}:${schoolId ?? ''}`

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

// What the server stores for one video. A video that only remembers "watched" (old format) is sent as fully played.
function toPayload(id, v) {
  const length = v.duration || SECONDS_BY_ID[id] || 0
  const legacy = !(v.ranges || []).length && v.completedAt && length
  return { ranges: legacy ? [[0, length]] : v.ranges || [], duration: length, position: v.position || 0, language: v.language }
}

// A failed save is worth retrying only if the server never answered or broke; a rejected one would fail forever.
const retryable = (err) => !err?.response || err.response.status >= 500

function mergeServer(local, remote) {
  const videos = { ...local.videos }
  Object.entries(remote.videos || {}).forEach(([id, r]) => {
    const l = videos[id]
    if (!l) { videos[id] = { ranges: r.ranges || [], duration: r.duration || 0, position: r.position || 0, language: r.language, completedAt: r.completedAt || undefined }; return }
    videos[id] = {
      ...l,
      ranges: mergeRanges([...(l.ranges || []), ...(r.ranges || [])]),
      duration: Math.max(l.duration || 0, r.duration || 0),
      completedAt: l.completedAt || r.completedAt || undefined,
      // what this browser last did beats an older position from another device
      position: (l.ranges || []).length ? l.position : (r.position || l.position || 0),
    }
  })
  const steps = { ...local.steps }
  Object.entries(remote.steps || {}).forEach(([id, at]) => { steps[id] = steps[id] || at || new Date().toISOString() })
  return { videos, steps }
}

/**
 * `api` (optional) saves progress to the server so it follows the person across devices and admins can see it:
 * { mine(), video(body), step(body), sync(body) }. Without it everything stays in this browser.
 */
export default function useGuideProgress(userId, { api = null, schoolId = null } = {}) {
  const [state, setState] = useState(() => load(userId))
  // The server's own count of this person's steps and videos: the same numbers the admin overview shows.
  const [counts, setCounts] = useState(null)
  const live = useRef(state)          // always the newest data; state is committed from it at a calm pace
  const timer = useRef(null)
  const dirty = useRef({ videos: new Set(), steps: new Map() })
  const lastPush = useRef(0)
  const pushing = useRef(false)

  const pushDirty = useCallback(async (force = false) => {
    const d = dirty.current
    if (!api || pushing.current || (!d.videos.size && !d.steps.size)) return
    if (!force && Date.now() - lastPush.current < SERVER_EVERY_MS) return
    pushing.current = true
    lastPush.current = Date.now()
    const videos = [...d.videos]
    const steps = [...d.steps]
    d.videos = new Set()
    d.steps = new Map()
    let index = 0
    let phase = 'videos'
    try {
      for (; index < videos.length; index += 1) {
        const id = videos[index]
        const v = live.current.videos[id]
        if (v) {
          // eslint-disable-next-line no-await-in-loop
          const res = await api.video({ id, ...toPayload(id, v) })
          if (res?.data?.counts) setCounts(res.data.counts)
        }
      }
      phase = 'steps'
      for (index = 0; index < steps.length; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        const res = await api.step({ id: steps[index][0], done: steps[index][1] })
        if (res?.data?.counts) setCounts(res.data.counts)
      }
    } catch (err) {
      if (retryable(err)) {
        if (phase === 'videos') {
          videos.slice(index).forEach((id) => d.videos.add(id))
          steps.forEach(([id, done]) => d.steps.set(id, done))
        } else {
          steps.slice(index).forEach(([id, done]) => d.steps.set(id, done))
        }
      }
    } finally {
      pushing.current = false
    }
  }, [api])

  const commit = useCallback(() => {
    timer.current = null
    setState({ ...live.current })
    try { localStorage.setItem(keyFor(userId), JSON.stringify(live.current)) } catch { /* storage blocked: progress lasts for this visit only */ }
    pushDirty(false)
  }, [userId, pushDirty])

  useEffect(() => {
    live.current = load(userId)
    setState(live.current)
  }, [userId])

  // Bring in what the server has (other devices), and on the first visit upload what this browser already held.
  useEffect(() => {
    if (!api || !userId) return undefined
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.mine()
        if (cancelled) return
        live.current = mergeServer(live.current, data)
        setState({ ...live.current })
        if (data.counts) setCounts(data.counts)
        try { localStorage.setItem(keyFor(userId), JSON.stringify(live.current)) } catch { /* see commit */ }
        let uploaded = false
        try { uploaded = localStorage.getItem(syncedKey(userId, schoolId)) === '1' } catch { /* treat as not uploaded */ }
        if (!uploaded) {
          const videos = Object.fromEntries(Object.entries(live.current.videos).map(([id, v]) => [id, toPayload(id, v)]))
          const synced = await api.sync({ videos, steps: live.current.steps })
          if (synced?.data?.counts) setCounts(synced.data.counts)
          try { localStorage.setItem(syncedKey(userId, schoolId), '1') } catch { /* will upload again next time, which is harmless */ }
        }
      } catch { /* offline or signed out: progress stays on this device and is sent with the next save */ }
    })()
    return () => { cancelled = true }
  }, [api, userId, schoolId])

  // Do not lose the last seconds when the page goes away.
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); commit() }
    pushDirty(true)
  }, [commit, pushDirty])
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') { if (timer.current) { clearTimeout(timer.current); commit() } pushDirty(true) } }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [commit, pushDirty])

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
    dirty.current.videos.add(videoId)
    schedule(flush || (completedAt && !before.completedAt))
    return Boolean(completedAt)
  }, [schedule])

  /** A step with no video of its own is ticked by hand. */
  const toggleDone = useCallback((sectionId) => {
    const steps = { ...live.current.steps }
    if (steps[sectionId]) delete steps[sectionId]
    else steps[sectionId] = new Date().toISOString()
    dirty.current.steps.set(sectionId, Boolean(steps[sectionId]))
    live.current = { ...live.current, steps }
    schedule(true)
  }, [schedule])

  const watched = useMemo(
    () => new Set(Object.entries(state.videos).filter(([, v]) => v.completedAt).map(([id]) => id)),
    [state.videos],
  )
  const done = useMemo(() => new Set(Object.keys(state.steps)), [state.steps])
  const videoState = useCallback((id) => state.videos[id] || null, [state.videos])

  return { watched, done, counts, videoState, recordVideo, toggleDone }
}

/**
 * Progress for the "Start here" path: a step with a video is done when that video is watched; a step without
 * one is done when ticked. `steps` is [{ sectionId, videoId }]; `videos` is the list this person can see.
 * `counts` (from the server) replaces the local count when present.
 */
export function summarizeProgress({ steps, videos, watched, done, counts = null }) {
  // The server's numbers win once it has answered, so this page and the admin overview always agree.
  if (counts) {
    return { stepsDone: counts.steps_done, stepsTotal: counts.steps_total, videosWatched: counts.videos_watched, videosTotal: counts.videos_total }
  }
  const stepsDone = steps.filter((s) => (s.videoId ? watched.has(s.videoId) : done.has(s.sectionId))).length
  const videosWatched = videos.filter((v) => watched.has(v.id)).length
  return { stepsDone, stepsTotal: steps.length, videosWatched, videosTotal: videos.length }
}
