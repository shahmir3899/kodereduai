// Pure rules for Talk mode, kept apart from React so they can be tested without a phone.

export type TalkPhase = 'ready' | 'listening' | 'transcribing' | 'heard' | 'thinking' | 'speaking';

// Same order as the web: what the person is doing now wins over what is merely still playing.
export function talkPhase(s: { recording: boolean; transcribing: boolean; heard: boolean; working: boolean; speaking: boolean }): TalkPhase {
  if (s.recording) return 'listening';
  if (s.transcribing) return 'transcribing';
  if (s.heard) return 'heard';
  if (s.working) return 'thinking';
  if (s.speaking) return 'speaking';
  return 'ready';
}

// A phone microphone in a classroom sits far above the web's 0.07, so the quiet line starts higher
// (about -45 dB on the 0..1 scale of levelFromDb). Tune on a real phone.
export const SPEECH_LEVEL = 0.25;
export const PAUSE_STOPS_MS = 1500;     // quiet this long after speech ends the recording
export const NO_SPEECH_MS = 8000;       // nobody spoke at all: drop it, never upload silence
export const MIN_SPEECH_MS = 300;       // a click or cough is not speech
export const SEND_AFTER = 3;            // seconds the words stay on screen before they are sent

export type SilenceTracker = { startedAt: number; lastTick: number; loudMs: number; lastLoud: number };
export const newTracker = (now: number): SilenceTracker => ({ startedAt: now, lastTick: now, loudMs: 0, lastLoud: 0 });

/**
 * Called on every meter reading. 'stop' = they spoke then paused (send it for transcription),
 * 'cancel' = nobody spoke within the time allowed (discard), 'continue' = keep listening.
 */
export function nextSilenceAction(
  t: SilenceTracker, now: number, level: number,
  o: { silenceStopMs: number; speechLevel?: number; noSpeechMs?: number; minSpeechMs?: number },
): 'continue' | 'stop' | 'cancel' {
  const threshold = o.speechLevel ?? SPEECH_LEVEL;
  const spoke = o.minSpeechMs ?? MIN_SPEECH_MS;
  const dt = Math.max(0, now - t.lastTick);
  t.lastTick = now;
  if (level >= threshold) { t.loudMs += dt; t.lastLoud = now; }
  if (t.loudMs >= spoke && now - t.lastLoud >= o.silenceStopMs) return 'stop';
  if (t.loudMs < spoke && now - t.startedAt >= (o.noSpeechMs ?? NO_SPEECH_MS)) return 'cancel';
  return 'continue';
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export const PHASE_HEADING: Record<TalkPhase, string> = {
  ready: 'Tap the orb and speak',
  listening: 'Listening',
  transcribing: 'Turning your voice into text…',
  heard: '',
  thinking: 'Working on it',
  speaking: 'Speaking',
};

export const ORB_LABEL: Record<TalkPhase, string> = {
  ready: 'Start talking',
  listening: 'Stop listening',
  transcribing: 'Turning your voice into text',
  heard: 'Waiting to send',
  thinking: 'Working on your request',
  speaking: 'Stop speaking and talk',
};
