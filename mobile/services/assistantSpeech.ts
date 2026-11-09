// Pure helpers for reading replies aloud. Which voices exist depends on the phone, so an Urdu reply on a
// phone with no Urdu voice is reported instead of being read badly by an English voice.
const URDU_SCRIPT = /[؀-ۿ]/;
const PREFERRED: Record<'ur' | 'en', string[]> = { ur: ['ur-PK', 'ur-IN', 'ur'], en: ['en-PK', 'en-IN', 'en-GB', 'en-US', 'en'] };

/** 'ur' for Arabic-script text, otherwise 'en'. Roman Urdu is turned into Urdu script by the server first. */
export function scriptOf(text: string): 'ur' | 'en' {
  return URDU_SCRIPT.test(text) ? 'ur' : 'en';
}

export interface VoiceLike { identifier: string; language: string }

const norm = (s: string) => s.toLowerCase().replace('_', '-');

export function pickVoice<T extends VoiceLike>(voices: T[], script: 'ur' | 'en'): T | null {
  for (const code of PREFERRED[script]) {
    const exact = voices.find((v) => norm(v.language) === code.toLowerCase());
    if (exact) return exact;
  }
  return voices.find((v) => norm(v.language).startsWith(script)) || null;
}

/** Used when the server's short spoken version is unavailable: the first plain line, never a table row. */
export function fallbackSpoken(text: string): string {
  return text.split('\n').find((l) => l.trim() && !l.trim().startsWith('|'))?.slice(0, 300) ?? '';
}
