import { useCallback, useEffect, useRef, useState } from 'react'
import { videoCrossOrigin } from '../../utils/guideAssets'
import { countsAsViewing, mergeRanges } from '../../utils/guideProgressRules'

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]
const SKIP_SECONDS = 10
const PREFS_KEY = 'guideVideoPrefs'

// Volume, speed and captions are a per-viewer convenience: remembered when storage works, ignored when it does not.
function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
    return {
      volume: typeof saved.volume === 'number' ? Math.min(1, Math.max(0, saved.volume)) : 1,
      muted: !!saved.muted,
      speed: SPEEDS.includes(saved.speed) ? saved.speed : 1,
      captions: saved.captions !== false,
    }
  } catch {
    return { volume: 1, muted: false, speed: 1, captions: true }
  }
}
function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* private window or blocked storage */ }
}

export function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const Icon = ({ children }) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">{children}</svg>
)
const PlayIcon = () => <Icon><path d="M8 5v14l11-7z" /></Icon>
const PauseIcon = () => <Icon><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></Icon>
const VolumeIcon = ({ muted }) => (
  <Icon>
    <path d="M3 9v6h4l5 5V4L7 9H3z" />
    {muted
      ? <path d="M16.5 8.5l5 5m0-5l-5 5" stroke="currentColor" strokeWidth="2" fill="none" />
      : <path d="M15 8.5a5 5 0 010 7M17.5 6a8.5 8.5 0 010 12" stroke="currentColor" strokeWidth="2" fill="none" />}
  </Icon>
)
const FullscreenIcon = () => <Icon><path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z" /></Icon>

const btn = 'flex h-10 min-w-10 items-center justify-center rounded-md px-2 text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white'

/**
 * Video player with its own controls: play/pause, 10-second skips, a seek bar, volume and mute, speed,
 * captions and fullscreen, plus keyboard shortcuts while it has focus (Space/K, J/L, arrows, M, C, F).
 * `src`, `captionsSrc` and `poster` belong to one language; switching language remounts the video, and
 * `startAt` lets the caller carry the position across so the viewer does not lose their place.
 */
export default function GuideVideoPlayer({ src, captionsSrc, captionsLang, captionsLabel, poster, portrait = false, startAt = 0, restartKey = 0, onTime, onEnded, onPlayed }) {
  const videoRef = useRef(null)
  const boxRef = useRef(null)
  const [prefs, setPrefs] = useState(loadPrefs)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)

  // What was really played in this viewing: the seconds between two timeupdates count only when the video
  // is playing, the page is visible and the speed is 2x or less. Jumps and pauses add nothing.
  const lastTimeRef = useRef(null)
  const playedRef = useRef([])
  const lastEmitRef = useRef(0)
  const onPlayedRef = useRef(onPlayed)
  onPlayedRef.current = onPlayed
  const emit = useCallback((flush = false) => {
    const v = videoRef.current
    if (!playedRef.current.length && !flush) return
    onPlayedRef.current?.({ ranges: playedRef.current, duration: v && Number.isFinite(v.duration) ? v.duration : 0, position: v ? v.currentTime : 0, flush })
    lastEmitRef.current = Date.now()
  }, [])
  // A new video (language switch) or closing the player: hand over what was played, then start clean.
  useEffect(() => () => {
    if (playedRef.current.length) emit(true)
    playedRef.current = []
    lastTimeRef.current = null
  }, [src, emit])
  useEffect(() => {
    if (restartKey > 0 && videoRef.current) {
      videoRef.current.currentTime = 0
      lastTimeRef.current = 0
      videoRef.current.play?.()?.catch?.(() => {})
    }
  }, [restartKey])

  const updatePrefs = useCallback((patch) => {
    setPrefs((current) => {
      const next = { ...current, ...patch }
      savePrefs(next)
      return next
    })
  }, [])

  // Keep the element in step with the remembered preferences (it is recreated on a language switch).
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.volume = prefs.volume
    v.muted = prefs.muted
    v.playbackRate = prefs.speed
    Array.from(v.textTracks || []).forEach((t) => { t.mode = prefs.captions ? 'showing' : 'hidden' })
  }, [prefs, src])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === boxRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggle = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play?.()?.catch?.(() => setPlaying(false))
    else v.pause?.()
  }, [])

  const seekBy = useCallback((delta) => {
    const v = videoRef.current
    if (!v) return
    const end = Number.isFinite(v.duration) ? v.duration : Infinity
    v.currentTime = Math.min(end, Math.max(0, v.currentTime + delta))
    setTime(v.currentTime)
  }, [])

  const seekTo = (value) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = value
    setTime(value)
  }

  const setVolume = (value) => updatePrefs({ volume: value, muted: value === 0 })
  const toggleMute = () => updatePrefs({ muted: !prefs.muted || prefs.volume === 0, volume: prefs.volume === 0 ? 0.5 : prefs.volume })
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else boxRef.current?.requestFullscreen?.()
  }

  const onKeyDown = (e) => {
    if (e.target.tagName === 'SELECT' || e.altKey || e.ctrlKey || e.metaKey) return
    const key = e.key.toLowerCase()
    // Range sliders keep their own arrow keys, so a focused slider is not hijacked.
    const onSlider = e.target.type === 'range'
    const handlers = {
      ' ': toggle, k: toggle,
      j: () => seekBy(-SKIP_SECONDS), l: () => seekBy(SKIP_SECONDS),
      m: toggleMute, f: toggleFullscreen,
      c: () => updatePrefs({ captions: !prefs.captions }),
      ...(onSlider ? {} : {
        arrowleft: () => seekBy(-5), arrowright: () => seekBy(5),
        arrowup: () => setVolume(Math.min(1, prefs.volume + 0.1)), arrowdown: () => setVolume(Math.max(0, prefs.volume - 0.1)),
      }),
    }
    // A button handles Space/Enter itself; letting it run too would toggle twice.
    if (e.target.tagName === 'BUTTON' && (key === ' ' || key === 'enter')) return
    if (handlers[key]) { e.preventDefault(); handlers[key]() }
  }

  return (
    <div
      ref={boxRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="group relative overflow-hidden rounded-lg bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      aria-label="Video player. Space plays or pauses, J and L skip 10 seconds, M mutes, C toggles captions, F is fullscreen."
    >
      <video
        key={src}
        ref={videoRef}
        className={`w-full bg-black ${fullscreen ? 'max-h-screen' : portrait ? 'max-h-[72vh]' : ''}`}
        autoPlay
        playsInline
        preload="metadata"
        poster={poster}
        crossOrigin={videoCrossOrigin()}
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => { setPlaying(false); emit(true) }}
        onSeeking={(e) => { lastTimeRef.current = e.currentTarget.currentTime }}
        onSeeked={(e) => { lastTimeRef.current = e.currentTarget.currentTime }}
        onEnded={() => { setPlaying(false); emit(true); onEnded?.() }}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration)
          if (startAt > 0 && startAt < e.currentTarget.duration) e.currentTarget.currentTime = startAt
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget
          const now = v.currentTime
          setTime(now)
          onTime?.(now, v.duration)
          const viewing = countsAsViewing({
            prev: lastTimeRef.current, now, paused: v.paused, seeking: v.seeking, rate: v.playbackRate, visible: document.visibilityState === 'visible',
          })
          if (viewing) {
            playedRef.current = mergeRanges([...playedRef.current, [lastTimeRef.current, now]])
            if (Date.now() - lastEmitRef.current > 1500) emit()
          }
          lastTimeRef.current = now
        }}
      >
        <source src={src} type="video/mp4" />
        {captionsSrc && <track kind="captions" src={captionsSrc} srcLang={captionsLang} label={captionsLabel} default />}
        Your browser cannot play this video.
      </video>

      <div className="bg-gradient-to-t from-black/90 to-black/40 px-2 pb-2 pt-1 sm:px-3">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(time, duration || 0)}
          onChange={(e) => seekTo(Number(e.target.value))}
          aria-label="Seek"
          aria-valuetext={`${formatClock(time)} of ${formatClock(duration)}`}
          className="h-5 w-full cursor-pointer accent-primary-500"
        />
        <div className="flex flex-wrap items-center gap-x-1">
          <button type="button" onClick={toggle} className={btn} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button type="button" onClick={() => seekBy(-SKIP_SECONDS)} className={`${btn} text-xs font-semibold`} aria-label={`Back ${SKIP_SECONDS} seconds`}>-{SKIP_SECONDS}s</button>
          <button type="button" onClick={() => seekBy(SKIP_SECONDS)} className={`${btn} text-xs font-semibold`} aria-label={`Forward ${SKIP_SECONDS} seconds`}>+{SKIP_SECONDS}s</button>
          <span className="px-1 text-xs tabular-nums text-white" aria-hidden="true">{formatClock(time)} / {formatClock(duration)}</span>

          <span className="flex-1" />

          <div className="flex items-center">
            <button type="button" onClick={toggleMute} className={btn} aria-label={prefs.muted || prefs.volume === 0 ? 'Unmute' : 'Mute'}>
              <VolumeIcon muted={prefs.muted || prefs.volume === 0} />
            </button>
            <input
              type="range" min={0} max={1} step={0.05}
              value={prefs.muted ? 0 : prefs.volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Volume"
              className="hidden h-5 w-20 cursor-pointer accent-primary-500 sm:block"
            />
          </div>
          <select
            value={prefs.speed}
            onChange={(e) => updatePrefs({ speed: Number(e.target.value) })}
            aria-label="Playback speed"
            className="h-9 rounded-md border-0 bg-white/10 px-1 text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {SPEEDS.map((s) => <option key={s} value={s} className="text-black">{s === 1 ? 'Normal' : `${s}x`}</option>)}
          </select>
          {captionsSrc && (
            <button
              type="button"
              onClick={() => updatePrefs({ captions: !prefs.captions })}
              aria-pressed={prefs.captions}
              aria-label="Captions"
              className={`${btn} text-xs font-bold ${prefs.captions ? 'bg-white/25' : ''}`}
            >CC</button>
          )}
          <button type="button" onClick={toggleFullscreen} className={btn} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}>
            <FullscreenIcon />
          </button>
        </div>
      </div>
    </div>
  )
}
