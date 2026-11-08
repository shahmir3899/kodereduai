import { useCallback, useEffect, useRef, useState } from 'react'
import { assistantApi } from '../../services/assistantApi'

const CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
const MIN_SECONDS = 0.6          // shorter than this is a mis-tap, not a request
const LEVEL_EVERY_MS = 80

export function voiceInputSupported() {
  return typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof window.MediaRecorder !== 'undefined'
    && window.isSecureContext !== false
}

function pickMimeType() {
  if (typeof window.MediaRecorder?.isTypeSupported !== 'function') return ''
  return CANDIDATES.find((t) => window.MediaRecorder.isTypeSupported(t)) || ''
}

function describeError(err) {
  const name = err?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone permission was denied. Allow it in the browser settings and try again.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found on this device.'
  if (name === 'NotReadableError') return 'The microphone is being used by another app.'
  return err?.response?.data?.error || err?.message || 'Voice did not work. Please type your message.'
}

/**
 * Record, send for transcription, hand the text back. The words always go to onTranscript (the message box)
 * and are never sent by this hook: the caller decides whether a person gets to read them first.
 * Audio lives only in memory for this one recording.
 */
export default function useVoiceInput({ enabled, maxSeconds = 60, language = 'auto', onTranscript }) {
  const supported = enabled && voiceInputSupported()
  const [state, setState] = useState('idle')          // idle | recording | transcribing
  const [level, setLevel] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState(null)
  const live = useRef({})                              // recorder, stream, timers: not render state
  const callbackRef = useRef(onTranscript)
  callbackRef.current = onTranscript

  const release = useCallback(() => {
    const r = live.current
    clearInterval(r.levelTimer)
    clearInterval(r.clock)
    r.stream?.getTracks?.().forEach((t) => t.stop())
    r.audioContext?.close?.().catch?.(() => {})
    live.current = {}
    setLevel(0)
  }, [])

  useEffect(() => release, [release])

  const finish = useCallback(async (chunks, type, startedAt, cancelled) => {
    release()
    if (cancelled) { setState('idle'); return }
    const heldFor = (Date.now() - startedAt) / 1000
    const blob = new Blob(chunks, { type: type || 'audio/webm' })
    if (heldFor < MIN_SECONDS || blob.size < 800) {
      setError('That was too short. Hold the button and speak, then tap stop.')
      setState('idle')
      return
    }
    setState('transcribing')
    try {
      const { data } = await assistantApi.transcribe(blob, language)
      if (!data.text) setError('I could not hear anything. Please try again, a little closer to the microphone.')
      else callbackRef.current?.(data.text, data)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setState('idle')
    }
  }, [language, release])

  const start = useCallback(async () => {
    if (!supported || state !== 'idle') return
    setError(null)
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (err) {
      setError(describeError(err))
      return
    }
    const mimeType = pickMimeType()
    const recorder = mimeType ? new window.MediaRecorder(stream, { mimeType }) : new window.MediaRecorder(stream)
    const chunks = []
    const startedAt = Date.now()
    live.current = { recorder, stream, cancelled: false }
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
    recorder.onstop = () => finish(chunks, recorder.mimeType || mimeType, startedAt, live.current.cancelled ?? true)

    // A live level for the orb to move with. Skipped quietly where the browser has no AudioContext.
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (Ctx) {
      try {
        const audioContext = new Ctx()
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        audioContext.createMediaStreamSource(stream).connect(analyser)
        const buffer = new Uint8Array(analyser.fftSize)
        live.current.audioContext = audioContext
        live.current.levelTimer = setInterval(() => {
          analyser.getByteTimeDomainData(buffer)
          let sum = 0
          for (let i = 0; i < buffer.length; i += 1) { const v = (buffer[i] - 128) / 128; sum += v * v }
          setLevel(Math.min(1, Math.sqrt(sum / buffer.length) * 4))
        }, LEVEL_EVERY_MS)
      } catch {
        // no level meter; recording still works
      }
    }
    live.current.clock = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      setSeconds(elapsed)
      if (elapsed >= maxSeconds && recorder.state === 'recording') recorder.stop()
    }, 250)
    setSeconds(0)
    setState('recording')
    recorder.start()
  }, [supported, state, finish, maxSeconds])

  const stop = useCallback(() => {
    const r = live.current
    if (r.recorder?.state === 'recording') { r.cancelled = false; r.recorder.stop() }
  }, [])

  const cancel = useCallback(() => {
    const r = live.current
    if (r.recorder?.state === 'recording') { r.cancelled = true; r.recorder.stop() }
  }, [])

  return { supported, state, level, seconds, error, clearError: () => setError(null), start, stop, cancel }
}
