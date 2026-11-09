import { clock, newTracker, nextSilenceAction, talkPhase, SPEECH_LEVEL } from '../services/assistantTalk';

const o = { silenceStopMs: 1500 };

describe('talk phase', () => {
  const base = { recording: false, transcribing: false, heard: false, working: false, speaking: false };
  it('is ready when nothing is going on', () => expect(talkPhase(base)).toBe('ready'));
  it('lets what the person is doing win over what is still playing', () => {
    expect(talkPhase({ ...base, speaking: true, recording: true })).toBe('listening');
    expect(talkPhase({ ...base, speaking: true, working: true })).toBe('thinking');
    expect(talkPhase({ ...base, heard: true, working: true })).toBe('heard');
    expect(talkPhase({ ...base, transcribing: true, heard: true })).toBe('transcribing');
    expect(talkPhase({ ...base, speaking: true })).toBe('speaking');
  });
});

describe('pause detection', () => {
  const run = (steps: Array<[number, number]>) => {
    const t = newTracker(0);
    let last: string = 'continue';
    for (const [now, level] of steps) last = nextSilenceAction(t, now, level, o);
    return last;
  };
  const loud = SPEECH_LEVEL + 0.2;

  it('keeps listening while they talk', () => {
    expect(run([[100, loud], [200, loud], [300, loud], [400, loud]])).toBe('continue');
  });
  it('stops after speech then 1.5 s of quiet', () => {
    expect(run([[100, loud], [200, loud], [300, loud], [400, loud], [1800, 0.05]])).toBe('continue');
    expect(run([[100, loud], [200, loud], [300, loud], [400, loud], [1950, 0.05]])).toBe('stop');
  });
  it('does not stop on quiet before any speech, but drops it after 8 s', () => {
    expect(run([[1000, 0], [3000, 0], [7900, 0]])).toBe('continue');
    expect(run([[1000, 0], [8100, 0]])).toBe('cancel');
  });
  it('ignores a click shorter than the minimum speech', () => {
    expect(run([[100, 0], [200, loud], [300, 0], [2500, 0], [8100, 0]])).toBe('cancel');
  });
});

describe('clock', () => {
  it('formats seconds', () => { expect(clock(0)).toBe('0:00'); expect(clock(75)).toBe('1:15'); });
});
