// Guided multi-sample enrollment: the matcher scores a student by their closest
// stored sample, so a few varied captures (straight / left / right) raise the
// auto-match rate without adding wrong matches (see scripts/face_eval results).
export const DEFAULT_SAMPLES_REQUIRED = 3

// One pose per capture, in order (index wraps if samplesRequired exceeds the
// list). `needs` is the head direction the pose requires — checked from face
// landmarks — or null when the pose can't be verified that way. The preview is
// mirrored, so "left" is the student's left AND the left side of the screen.
export const SAMPLE_POSES = [
  { id: 'front', needs: 'front', prompt: 'Look straight at the camera', detail: 'Face the camera directly, relaxed face, eyes on the lens.' },
  { id: 'left', needs: 'left', prompt: 'Turn your head slightly to the left', detail: "A small turn toward the student's left (the left side of the screen). Keep the eyes near the camera." },
  { id: 'right', needs: 'right', prompt: 'Turn your head slightly to the right', detail: "A small turn toward the student's right (the right side of the screen). Keep the eyes near the camera." },
  { id: 'up', needs: null, prompt: 'Tilt your chin up a little', detail: 'Lift the chin slightly, keep the whole face in the oval.' },
  { id: 'smile', needs: null, prompt: 'Smile naturally', detail: 'A relaxed natural smile, facing the camera.' },
]
export const SAMPLE_PROMPTS = SAMPLE_POSES.map((p) => p.prompt)

export const CAPTURE_TIPS = [
  'Face a window or light — avoid a bright light behind the student.',
  'Keep the whole face inside the oval, forehead to chin; remove caps and masks.',
  'Capture with the glasses the student normally wears. If they sometimes take them off, enroll once more without them.',
  'The preview is a mirror: left on screen is the student’s left.',
]

// Head turn from the 68 face-api landmarks. Point 30 is the nose tip, points 0
// and 16 are the jaw outline's two ends. The ratio is the nose's horizontal
// position between them: ~0.5 facing the camera. It is measured on the RAW
// (unmirrored) camera image, where the subject's left appears on the image's
// right — so a turn to the subject's left raises the ratio.
const TURN_FRONT_MIN = 0.42
const TURN_FRONT_MAX = 0.58
const TURN_LEFT_MIN = 0.60
const TURN_RIGHT_MAX = 0.40

export function headTurnRatio(positions) {
  const nose = positions?.[30]
  const jawStart = positions?.[0]
  const jawEnd = positions?.[16]
  if (!nose || !jawStart || !jawEnd) return null
  const width = jawEnd.x - jawStart.x
  if (!(width > 0)) return null
  return (nose.x - jawStart.x) / width
}

/** 'front' | 'left' | 'right' | 'between' (not clearly any), or null when unknown. */
export function classifyHeadTurn(ratio) {
  if (ratio == null || Number.isNaN(ratio)) return null
  if (ratio >= TURN_LEFT_MIN) return 'left'
  if (ratio <= TURN_RIGHT_MAX) return 'right'
  if (ratio >= TURN_FRONT_MIN && ratio <= TURN_FRONT_MAX) return 'front'
  return 'between'
}

/**
 * Does the measured head turn satisfy what the pose needs?
 * Returns { ok, unknown, hint } — `unknown` means the angle couldn't be read
 * (so the caller shouldn't block a manual capture on it).
 */
export function poseVerdict(needs, turn) {
  if (!needs) return { ok: true, unknown: false, hint: null }
  if (turn == null) {
    return { ok: false, unknown: true, hint: "Can't read the head angle — improve the light, or use Capture" }
  }
  if (turn === needs) return { ok: true, unknown: false, hint: 'Good — hold still' }
  if (needs === 'front') return { ok: false, unknown: false, hint: 'Look straight at the camera' }
  const opposite = needs === 'left' ? 'right' : 'left'
  if (turn === opposite) return { ok: false, unknown: false, hint: `Turn to the ${needs}, not the ${opposite}` }
  return { ok: false, unknown: false, hint: `Turn a little more to the ${needs}` }
}

// How long auto-capture stays paused after a non-final sample is confirmed, so
// the next frame isn't grabbed before the student has changed pose.
export const POSE_CHANGE_PAUSE_MS = 2500

/**
 * Send samples one at a time. The server rejects near-identical samples with
 * `sample_too_similar` — that is not a failure (the information is already
 * stored), so it is counted as skipped. Any other error stops the run and is
 * returned; samples saved before it stay saved server-side.
 *
 * @param {Array<{embedding:number[], qualityScore:number}>} samples
 * @param {(sample) => Promise} send  performs one enroll request
 * @returns {Promise<{saved:number, skipped:number, error:any}>}
 */
export async function enrollSamplesSequentially(samples, send) {
  let saved = 0
  let skipped = 0
  for (const sample of samples) {
    try {
      await send(sample)
      saved += 1
    } catch (err) {
      if (err?.response?.data?.error === 'sample_too_similar') {
        skipped += 1
        continue
      }
      return { saved, skipped, error: err }
    }
  }
  return { saved, skipped, error: null }
}

// User-facing message for a failed enroll request.
export function enrollErrorMessage(err, fallback = 'Enrollment failed') {
  const data = err?.response?.data
  if (data?.error === 'duplicate_face') {
    return `${data.message} Tick "Override duplicate check" below and retry if these are different people.`
  }
  if (data?.error === 'inconsistent_face') {
    return `${data.message}`
  }
  return data?.message || data?.error || data?.detail || fallback
}
