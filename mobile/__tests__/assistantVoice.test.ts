import { fallbackSpoken, pickVoice, scriptOf } from '../services/assistantSpeech';
import { levelFromDb, describeVoiceError } from '../hooks/useAssistantVoice';
import { whenLabel } from '../components/assistant/HistoryList';

jest.mock('expo-audio', () => ({ RecordingPresets: { HIGH_QUALITY: {} }, requestRecordingPermissionsAsync: jest.fn(), setAudioModeAsync: jest.fn(), useAudioRecorder: jest.fn(), useAudioRecorderState: jest.fn() }));
jest.mock('../services/assistantApi', () => ({ assistantApi: {} }));

describe('speech helpers', () => {
  const voices = [
    { identifier: 'a', language: 'en-US' },
    { identifier: 'b', language: 'en_GB' },
    { identifier: 'c', language: 'ur-PK' },
  ];

  it('detects Urdu script and treats Roman Urdu as English', () => {
    expect(scriptOf('آپ کی فیس')).toBe('ur');
    expect(scriptOf('aap ki fees')).toBe('en');
  });

  it('prefers the closest regional voice, and handles underscore codes', () => {
    expect(pickVoice(voices, 'en')!.identifier).toBe('b');
    expect(pickVoice(voices, 'ur')!.identifier).toBe('c');
  });

  it('never falls back to an English voice for Urdu', () => {
    expect(pickVoice(voices.slice(0, 2), 'ur')).toBeNull();
  });

  it('reads the first plain line, not a table row', () => {
    expect(fallbackSpoken('| a | b |\n|---|---|\nFive students are absent.\nmore')).toBe('Five students are absent.');
  });
});

describe('voice input helpers', () => {
  it('maps decibels to a 0..1 level', () => {
    expect(levelFromDb(-60)).toBe(0);
    expect(levelFromDb(0)).toBe(1);
    expect(levelFromDb(-30)).toBeCloseTo(0.5);
    expect(levelFromDb(undefined)).toBe(0);
  });

  it('shows server errors written for people, and adds the status to framework ones', () => {
    expect(describeVoiceError({ response: { status: 400, data: { error: 'Too long' } } })).toBe('Too long');
    expect(describeVoiceError({ response: { status: 502, data: { detail: 'Bad' } } })).toBe('Bad (HTTP 502)');
    expect(describeVoiceError({ request: {} })).toMatch(/reach the server/);
  });
});

describe('history labels', () => {
  const now = new Date('2026-11-09T12:00:00Z').getTime();
  it('labels recent days', () => {
    expect(whenLabel('2026-11-09T01:00:00Z', now)).toBe('Today');
    expect(whenLabel('2026-11-08T01:00:00Z', now)).toBe('Yesterday');
    expect(whenLabel('2026-11-05T12:00:00Z', now)).toBe('4 days ago');
    expect(whenLabel('garbage', now)).toBe('');
  });
});
