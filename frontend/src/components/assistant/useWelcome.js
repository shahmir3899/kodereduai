import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildWelcome, welcomeLanguage } from './welcomeText'

const LANG_KEY = 'assistant_welcome_lang'
const heardKey = (userId) => `assistant_welcome_heard_${userId ?? 'anon'}`

const read = (key) => { try { return window.localStorage.getItem(key) } catch { return null } }
const write = (key, value) => { try { window.localStorage.setItem(key, value) } catch { /* private mode: it just plays again on the button */ } }

/**
 * The spoken welcome. It plays by itself once per user, right after the panel is opened by a tap (so the
 * browser allows sound), then only when asked. `autoplay` must be false whenever a conversation already exists.
 */
export default function useWelcome({ agents, speech, userId, autoplay }) {
  const [lang, setLangState] = useState(() => welcomeLanguage(read(LANG_KEY)))
  const text = useMemo(() => buildWelcome(agents, lang), [agents, lang])
  const triedRef = useRef(false)
  const playing = Boolean(text) && speech.speaking && speech.caption === text
  const { speak, stop, supported } = speech

  const play = useCallback((quiet = false) => {
    if (!text) return false
    const ok = speak(text, { quiet })
    if (ok) write(heardKey(userId), '1')
    return ok
  }, [text, speak, userId])

  // Once per user; the attempt is spent even when no voice exists, so it never nags on every open.
  useEffect(() => {
    if (!autoplay || triedRef.current || !text || !supported) return
    triedRef.current = true
    if (read(heardKey(userId)) === '1') return
    play(true)
  }, [autoplay, text, supported, userId, play])

  // Any key or tap ends it, as the owner asked: nobody should have to wait for a greeting they know.
  useEffect(() => {
    if (!playing) return undefined
    // A tap on the welcome's own buttons is left to them: stopping on pointer-down would swap Skip for the
    // replay button under the finger and the same tap would start it again.
    const end = (e) => { if (!e.target?.closest?.('[data-testid="assistant-welcome"]')) stop() }
    window.addEventListener('keydown', end)
    window.addEventListener('pointerdown', end)
    return () => { window.removeEventListener('keydown', end); window.removeEventListener('pointerdown', end) }
  }, [playing, stop])

  const setLang = useCallback((next) => {
    setLangState(next)
    write(LANG_KEY, next)
    if (playing) stop()
  }, [playing, stop])

  return { text, lang, setLang, playing, play: () => play(false), skip: stop, canSpeak: supported }
}
