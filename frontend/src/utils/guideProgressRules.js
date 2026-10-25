// What counts as having watched a tutorial video. The server applies the same rules (backend/guide_progress/rules.py),
// so a person's progress is the same wherever it is worked out.
//
// A video is COMPLETE once the seconds actually played reach COMPLETE_AT of its length. Position does not count:
// dragging the seek bar to the end plays nothing, so it earns nothing. Ranges are [start, end] seconds of the video
// that were really played, kept merged so rewatching the same part never counts twice.

export const COMPLETE_AT = 0.85
export const MAX_PLAYBACK_RATE = 2
// Between two timeupdate events a real play advances by well under this; anything bigger was a jump, not viewing.
export const MAX_STEP_SECONDS = 2.5

/** Merge overlapping or touching ranges into a sorted list. Bad entries are dropped. */
export function mergeRanges(ranges) {
  const clean = (ranges || [])
    .filter((r) => Array.isArray(r) && r.length === 2 && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > r[0])
    .map(([a, b]) => [Math.max(0, a), b])
    .sort((x, y) => x[0] - y[0])
  const merged = []
  clean.forEach(([a, b]) => {
    const last = merged[merged.length - 1]
    if (last && a <= last[1] + 0.5) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  })
  return merged
}

/** Total seconds covered by the ranges, never more than the video's length. */
export function rangesTotal(ranges, duration) {
  const total = mergeRanges(ranges).reduce((sum, [a, b]) => sum + (b - a), 0)
  return duration > 0 ? Math.min(total, duration) : total
}

export function isComplete(ranges, duration) {
  return duration > 0 && rangesTotal(ranges, duration) / duration >= COMPLETE_AT
}

/** Percent played, 0 to 100, for a progress display. */
export function percentPlayed(ranges, duration) {
  return duration > 0 ? Math.round((rangesTotal(ranges, duration) / duration) * 100) : 0
}

/**
 * Whether the time since the last update was real viewing. `prev` and `now` are the video's currentTime values;
 * the page must be visible and the speed no more than MAX_PLAYBACK_RATE.
 */
export function countsAsViewing({ prev, now, paused, seeking, rate, visible }) {
  if (paused || seeking || !visible || rate > MAX_PLAYBACK_RATE) return false
  if (prev == null || now <= prev) return false
  return now - prev <= MAX_STEP_SECONDS
}
