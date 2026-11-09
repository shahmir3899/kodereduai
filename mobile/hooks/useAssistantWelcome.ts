import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildWelcome, welcomeLanguage, type WelcomeAgent, type WelcomeLang } from '../services/assistantWelcome';

const LANG_KEY = 'aura_welcome_lang';
const heardKey = (userId?: string | number | null) => `aura_welcome_heard_${userId ?? 'anon'}`;

type Speech = { speaking: boolean; caption: string; speakText: (t: string, quiet?: boolean) => void; stop: () => void; voicesReady: boolean };

/**
 * The spoken welcome. It plays by itself once per person, right after Talk mode is opened by a tap (never on
 * app start), and afterwards only from the replay button. The words are always shown too, so it works with
 * the sound off. Built from the capabilities list on the phone: no model call, no voice allowance.
 */
export default function useAssistantWelcome({ agents, speech, userId, autoplay }: {
  agents: WelcomeAgent[]; speech: Speech; userId?: string | number | null; autoplay: boolean;
}) {
  const [lang, setLangState] = useState<WelcomeLang>(() => welcomeLanguage(null));
  const [ready, setReady] = useState(false);   // the saved choices have been read
  const [heard, setHeard] = useState(true);    // true until we know it has NOT been heard, so it never plays by mistake
  const text = useMemo(() => buildWelcome(agents, lang), [agents, lang]);
  const tried = useRef(false);

  useEffect(() => {
    let alive = true;
    Promise.all([AsyncStorage.getItem(LANG_KEY), AsyncStorage.getItem(heardKey(userId))])
      .then(([l, h]) => { if (!alive) return; setLangState(welcomeLanguage(l)); setHeard(h === '1'); setReady(true); })
      .catch(() => { if (alive) { setHeard(true); setReady(true); } }); // storage unreadable: never autoplay
    return () => { alive = false; };
  }, [userId]);

  const markHeard = useCallback(() => {
    setHeard(true);
    AsyncStorage.setItem(heardKey(userId), '1').catch(() => {});
  }, [userId]);

  const play = useCallback(() => { if (text) speech.speakText(text); }, [text, speech]);
  const skip = useCallback(() => speech.stop(), [speech]);

  const setLang = useCallback((next: WelcomeLang) => {
    speech.stop();
    setLangState(next);
    AsyncStorage.setItem(LANG_KEY, next).catch(() => {});
  }, [speech]);

  // First time only: speak it once, quietly (a missing Urdu voice is not worth an error), then remember.
  useEffect(() => {
    if (!autoplay || !ready || heard || !text || tried.current || !speech.voicesReady) return;
    tried.current = true;
    speech.speakText(text, true);
    markHeard();
  }, [autoplay, ready, heard, text, speech, markHeard]);

  const playing = speech.speaking && speech.caption === text;
  return { text, lang, setLang, playing, play, skip, available: Boolean(text) };
}
