import { useCallback, useEffect, useRef, useState } from 'react'
import { assistantApi } from '../../services/assistantApi'

const CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
const MIN_SECONDS = 0.6          // shorter than this is a mis-tap, not a request
const LEVEL_EVERY_MS = 80
const SPEECH_SECONDS = 0.32      // loud for this long counts as someone speaking, not a bump on the desk

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
  const response = err?.response
  if (response?.data?.error) return response.data.error                     // written for people by our server
  if (response?.data?.detail) return `${response.data.detail} (HTTP ${response.status})`
  if (response) return `Voice did not work (HTTP ${response.status}). Please type your message.`
  if (err?.request) return 'Could not reach the server. Check that the backend is running, then try again.'
  return err?.message || 'Voice did not work. Please type your message.'
}

/**
 * Record, send for transcription, hand the text back. The words always go to onTranscript (the message box)
 * and are never sent by this hook: the caller decides whether a person gets to read them first.
 * Audio lives only in memory for this one recording.
 */
export default function useVoiceInput({
  enabled, maxSeconds = 60, language = 'auto', onTranscript,
  // Talk mode: stop by itself after a pause. 0 = never (the person taps stop).
  silenceStopMs = 0, speechThreshold = 0.07, noSpeechTimeoutMs = 8000,
}) {
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
      console.error('assistant voice: transcription failed', err?.response?.status, err?.response?.data || err)
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
        const r = live.current
        r.loudSeconds = 0
        r.lastLoud = startedAt
        r.levelTimer = setInterval(() => {
          analyser.getByteTimeDomainData(buffer)
          let sum = 0
          for (let i = 0; i < buffer.length; i += 1) { const v = (buffer[i] - 128) / 128; sum += v * v }
          const level = Math.min(1, Math.sqrt(sum / buffer.length) * 4)
          setLevel(level)
          if (!silenceStopMs || recorder.state !== 'recording') return
          const now = Date.now()
          if (level > speechThreshold) { r.loudSeconds += LEVEL_EVERY_MS / 1000; r.lastLoud = now }
          if (r.loudSeconds >= SPEECH_SECONDS && now - r.lastLoud >= silenceStopMs) {
            recorder.stop()                                              // they spoke, then paused: that is the end of the request
          } else if (r.loudSeconds < SPEECH_SECONDS && now - startedAt >= noSpeechTimeoutMs) {
            r.cancelled = true                                           // nobody spoke: do not send silence for transcription
            setError('I could not hear anything. Tap the orb and try again, a little closer to the microphone.')
            recorder.stop()
          }
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
  }, [supported, state, finish, maxSeconds, silenceStopMs, speechThreshold, noSpeechTimeoutMs])

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
