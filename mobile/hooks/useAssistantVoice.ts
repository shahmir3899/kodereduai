import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState,
} from 'expo-audio';
import { assistantApi } from '../services/assistantApi';
import { newTracker, nextSilenceAction, SPEECH_LEVEL, type SilenceTracker } from '../services/assistantTalk';

const MIN_SECONDS = 0.6; // shorter than this is a mis-tap, not a request

// Metering is in decibels (about -60 quiet to 0 loud); the orb wants 0 to 1.
export function levelFromDb(db?: number): number {
  if (typeof db !== 'number' || !Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

export function describeVoiceError(err: any): string {
  const response = err?.response;
  if (response?.data?.error) return response.data.error; // written for people by our server
  if (response?.data?.detail) return `${response.data.detail} (HTTP ${response.status})`;
  if (response) return `Voice did not work (HTTP ${response.status}). Please type your message.`;
  if (err?.request) return 'Could not reach the server. Check your connection, then try again.';
  return err?.message || 'Voice did not work. Please type your message.';
}

/**
 * Record, send for transcription, hand the text back. The words always go to onTranscript (the message box)
 * and are never sent by this hook: the person reads and corrects them first. The recording stays in the app's
 * cache for this one request and is not kept.
 */
export default function useAssistantVoice({ enabled, maxSeconds = 60, language = 'auto', onTranscript, silenceStopMs = 0, speechLevel = SPEECH_LEVEL }: {
  enabled: boolean; maxSeconds?: number; language?: string; onTranscript: (text: string) => void;
  // Talk mode: end the recording by itself after a pause (0 = only when the person taps stop).
  silenceStopMs?: number; speechLevel?: number;
}) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recState = useAudioRecorderState(recorder, 100);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);
  const tracker = useRef<SilenceTracker>(newTracker(0));
  const callbackRef = useRef(onTranscript);
  callbackRef.current = onTranscript;

  const finish = useCallback(async (cancelled: boolean) => {
    try { await recorder.stop(); } catch { /* already stopped */ }
    setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    if (cancelled) { setPhase('idle'); return; }
    const heldFor = (Date.now() - startedAt.current) / 1000;
    const uri = recorder.uri;
    if (heldFor < MIN_SECONDS || !uri) {
      setError('That was too short. Tap the microphone, speak, then tap stop.');
      setPhase('idle');
      return;
    }
    setPhase('transcribing');
    try {
      const { data } = await assistantApi.transcribe({ uri, name: 'speech.m4a', type: 'audio/mp4' }, language);
      if (!data.text) setError('I could not hear anything. Please try again, a little closer to the microphone.');
      else callbackRef.current(data.text);
    } catch (err) {
      setError(describeVoiceError(err));
    } finally {
      setPhase('idle');
    }
  }, [recorder, language]);

  const start = useCallback(async () => {
    if (!enabled || phase !== 'idle') return;
    setError(null);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError('Microphone permission was denied. Allow it in the phone settings and try again.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      startedAt.current = Date.now();
      tracker.current = newTracker(startedAt.current);
      recorder.record();
      setPhase('recording');
    } catch (err: any) {
      setError(err?.message || 'The microphone could not start.');
      setPhase('idle');
    }
  }, [enabled, phase, recorder]);

  const stop = useCallback(() => { if (phase === 'recording') finish(false); }, [phase, finish]);
  const cancel = useCallback(() => { if (phase === 'recording') finish(true); }, [phase, finish]);

  const seconds = phase === 'recording' ? Math.floor((recState.durationMillis ?? 0) / 1000) : 0;
  useEffect(() => {
    if (phase === 'recording' && seconds >= maxSeconds) finish(false);
  }, [phase, seconds, maxSeconds, finish]);

  // Talk mode: they spoke then paused = send it; nobody spoke = drop it, never upload silence.
  useEffect(() => {
    if (phase !== 'recording' || !silenceStopMs) return;
    const action = nextSilenceAction(tracker.current, Date.now(), levelFromDb(recState.metering), { silenceStopMs, speechLevel });
    if (action === 'stop') finish(false);
    else if (action === 'cancel') { finish(true); setError('I did not hear anything. Tap the orb and try again.'); }
  }, [phase, recState.metering, recState.durationMillis, silenceStopMs, speechLevel, finish]);

  // Leaving the screen mid-recording must release the microphone.
  useEffect(() => () => { recorder.stop().catch(() => {}); }, [recorder]);

  return { supported: enabled, phase, level: phase === 'recording' ? levelFromDb(recState.metering) : 0, seconds, error, clearError: () => setError(null), start, stop, cancel };
}
