const BARS = 7

const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/** What replaces the message box while recording: a live level, a timer, and the two ways out. */
export default function VoiceBar({ level, seconds, maxSeconds, onDone, onCancel }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-1 items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
      <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
      <span className="text-sm font-medium text-red-800">Listening</span>
      <span className="flex h-6 items-center gap-0.5" aria-hidden="true">
        {Array.from({ length: BARS }, (_, i) => {
          const shape = 0.35 + 0.65 * Math.abs(Math.sin((i + 1) * 1.7))     // each bar a little different
          return <span key={i} className="w-1 rounded-full bg-red-500" style={{ height: `${Math.max(4, Math.round(24 * Math.min(1, level * shape * 1.6 + 0.08)))}px` }} />
        })}
      </span>
      <span className="ml-auto text-xs tabular-nums text-red-800" aria-label={`${seconds} of ${maxSeconds} seconds`}>
        {clock(seconds)} / {clock(maxSeconds)}
      </span>
      <button type="button" onClick={onDone} className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white">Done</button>
      <button type="button" onClick={onCancel} aria-label="Cancel recording" className="rounded px-1 text-sm text-red-800 hover:bg-red-100">✕</button>
    </div>
  )
}
