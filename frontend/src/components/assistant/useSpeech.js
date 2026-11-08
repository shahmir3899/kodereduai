import { useCallback, useEffect, useRef, useState } from 'react'

const URDU_SCRIPT = /[؀-ۿ]/
const PREFERRED = { ur: ['ur-PK', 'ur-IN', 'ur'], en: ['en-PK', 'en-IN', 'en-GB', 'en-US', 'en'] }

export function speechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined'
}

/** 'ur' for Arabic-script text, otherwise 'en'. Roman Urdu is turned into Urdu script by the server before it gets here. */
export function scriptOf(text) {
  return URDU_SCRIPT.test(text) ? 'ur' : 'en'
}

export function pickVoice(voices, script) {
  for (const code of PREFERRED[script]) {
    const exact = voices.find((v) => v.lang?.toLowerCase() === code.toLowerCase())
    if (exact) return exact
  }
  return voices.find((v) => v.lang?.toLowerCase().startsWith(script)) || null
}

/**
 * Read short replies aloud with the voices already on the device: free, and nothing leaves it.
 * Which voices exist depends on the device, so an Urdu reply on a device with no Urdu voice is
 * reported (`notice`) instead of being read badly by an English voice.
 */
export default function useSpeech() {
  const supported = speechSupported()
  const [voices, setVoices] = useState([])
  const [speaking, setSpeaking] = useState(false)
  const [caption, setCaption] = useState('')
  const [notice, setNotice] = useState(null)
  const currentRef = useRef(null)

  useEffect(() => {
    if (!supported) return undefined
    const load = () => setVoices(window.speechSynthesis.getVoices() || [])
    load()
    window.speechSynthesis.addEventListener?.('voiceschanged', load)   // voices arrive late in some browsers
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', load)
      window.speechSynthesis.cancel()
    }
  }, [supported])

  const stop = useCallback(() => {
    if (supported) window.speechSynthesis.cancel()
    currentRef.current = null
    setSpeaking(false)
    setCaption('')
  }, [supported])

  const speak = useCallback((text) => {
    const words = (text || '').trim()
    if (!supported || !words) return false
    const script = scriptOf(words)
    const voice = pickVoice(window.speechSynthesis.getVoices?.() || voices, script)
    window.speechSynthesis.cancel()
    if (!voice) {
      setNotice(script === 'ur'
        ? 'This device has no Urdu voice, so the reply is shown as text. You can still read it on screen.'
        : 'This device has no English voice for spoken replies.')
      return false
    }
    setNotice(null)
    const utterance = new window.SpeechSynthesisUtterance(words)
    utterance.voice = voice
    utterance.lang = voice.lang
    utterance.onend = () => { if (currentRef.current === utterance) { currentRef.current = null; setSpeaking(false); setCaption('') } }
    utterance.onerror = utterance.onend
    currentRef.current = utterance
    setCaption(words)
    setSpeaking(true)
    window.speechSynthesis.speak(utterance)
    return true
  }, [supported, voices])

  return { supported, speaking, caption, notice, clearNotice: () => setNotice(null), speak, stop, voices }
}
