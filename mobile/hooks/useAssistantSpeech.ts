import { useCallback, useEffect, useState } from 'react';
import * as Speech from 'expo-speech';
import { assistantApi } from '../services/assistantApi';
import { fallbackSpoken, pickVoice, scriptOf } from '../services/assistantSpeech';

/**
 * Read short replies aloud with the voices already on the phone: free, and nothing leaves it.
 * An Urdu reply on a phone with no Urdu voice is reported (`notice`), never read by an English voice.
 */
export default function useAssistantSpeech() {
  const [voices, setVoices] = useState<Speech.Voice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [caption, setCaption] = useState(''); // what is being read, shown under the orb in Talk mode

  useEffect(() => {
    let alive = true;
    Speech.getAvailableVoicesAsync().then((v) => { if (alive) setVoices(v); }).catch(() => {});
    return () => { alive = false; Speech.stop(); };
  }, []);

  const stop = useCallback(() => { Speech.stop(); setSpeaking(false); }, []);

  const speakText = useCallback((words: string) => {
    const script = scriptOf(words);
    const voice = pickVoice(voices, script);
    if (!voice) {
      setNotice(script === 'ur'
        ? 'This phone has no Urdu voice, so the reply is shown as text only.'
        : 'This phone has no English voice for spoken replies.');
      return;
    }
    setNotice(null);
    Speech.stop();
    setSpeaking(true);
    setCaption(words);
    Speech.speak(words, { voice: voice.identifier, language: voice.language, onDone: () => setSpeaking(false), onStopped: () => setSpeaking(false), onError: () => setSpeaking(false) });
  }, [voices]);

  // The server writes a short version that reads well aloud (and turns Roman Urdu into Urdu script).
  const speakReply = useCallback(async (text: string) => {
    if (!text) return;
    let spoken = '';
    try {
      spoken = (await assistantApi.spokenVersion(text)).data.spoken;
    } catch {
      if (scriptOf(text) === 'en') spoken = fallbackSpoken(text);
    }
    if (spoken) speakText(spoken);
  }, [speakText]);

  return { speaking, caption, notice, clearNotice: () => setNotice(null), speakReply, stop };
}
