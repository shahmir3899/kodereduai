// The whole job for one language: narration, a recorded take, soundtrack, final MP4, captions files, quality checks.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StepError, createRunner } from './actor.mjs';
import { mixTracks } from './audio.mjs';
import { runHooks } from './hooks.mjs';
import { resolveTrack } from './music.mjs';
import { finalize, makePoster } from './package.mjs';
import { analyze, contactSheet, writeReport } from './qa.mjs';
import { startRecording } from './recorder.mjs';
import { tr } from './scenario.mjs';
import { openSession } from './session.mjs';
import { prepareNarration } from './tts.mjs';

export function workDir(outDir, scenario, lang) {
  const dir = join(outDir, '.work', scenario.name, lang);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function oneTake({ scenario, lang, work, outDir, narration, opts, log }) {
  const session = await openSession({ scenario, lang, headed: opts.driver === 'desktop' || Boolean(opts.headed) });
  const runner = createRunner({ scenario, lang, session, outDir, clips: narration.clips, log });
  try {
    await runner.setup();
    const raw = join(work, 'raw.mp4');
    const recorder = await startRecording({ driver: opts.driver ?? 'page', session, outFile: raw, viewport: scenario.target.viewport, log });
    let runStart = 0;
    let result;
    try {
      result = await runner.run({ onStart: () => (runStart = Date.now() / 1000) });
    } catch (e) {
      await recorder.stop().catch(() => {});
      throw e;
    }
    const rec = await recorder.stop();
    return { rec, result, offset: runStart - rec.startWall, diagnostics: [...session.diagnostics], raw };
  } finally {
    await session.close();
  }
}

/** Sound, packaging and checks from a finished take. Can be run again without recording (the `render` command). */
export function buildOutputs({ scenario, lang, work, outDir, take, opts, log }) {
  const { timeline, offset, duration } = take;
  const title = tr(scenario.meta?.title, lang) ?? scenario.name;
  const clips = timeline.filter((t) => t.say).map((t) => ({ file: t.say.file, start: t.start + offset }));
  const musicSpec = opts.music ?? scenario.music?.track;
  const musicFile = resolveTrack(musicSpec, scenario.__dir, { log });
  let audio = null;
  if (clips.length || musicFile) {
    audio = join(work, 'mix.wav');
    mixTracks({ clips, music: musicFile ? { file: musicFile, volume: scenario.music?.volume } : null, duration, duck: scenario.music?.duck !== false, out: audio });
  }
  const out = join(outDir, `${scenario.name}.${lang}.mp4`);
  const fin = finalize({ video: join(work, 'raw.mp4'), audio, timeline, offset, duration, out, preset: opts.preset ?? 'web', title, lang });
  const intro = timeline.find((t) => t.id === 'intro');
  const poster = makePoster(out, join(outDir, `${scenario.name}.${lang}.poster.jpg`), intro ? Math.min(intro.end + offset - 0.3, intro.start + offset + 2.2) : Math.min(1.5, duration / 2));
  // One picture per step, taken near its end so the sheet shows what the step achieved.
  const stepTimes = timeline.filter((t) => t.kind === 'step' || t.kind === 'slide').map((t) => (t.kind === 'slide' ? t.start + offset + (t.end - t.start) * 0.7 : t.end + offset - 0.6)).filter((t) => t > 0.2 && t < duration - 0.1);
  const sheet = contactSheet(out, join(outDir, 'qa', `${scenario.name}.${lang}.contact.jpg`), stepTimes.slice(0, 20));
  const qa = analyze({ video: out, timeline, offset, diagnostics: take.diagnostics, warnings: take.warnings ?? [], expectAudio: Boolean(audio), expectDuration: duration });
  writeReport(join(outDir, 'qa'), scenario.name, lang, qa, { music: musicSpec ?? 'none', voiceClips: clips.length });
  return { out, poster, sheet, srt: fin.srt, vtt: fin.vtt, qa, hasAudio: Boolean(audio) };
}

/** Records one language from start to finish. */
export async function recordLanguage({ scenario, lang, outDir, opts = {}, log = console.log }) {
  const work = workDir(outDir, scenario, lang);
  if (opts.voice) scenario.voice = { ...scenario.voice, engine: opts.voice, engines: undefined };
  const narration = prepareNarration({ scenario, lang, outDir: work, allowOnline: Boolean(opts.allowOnline), log });
  if (narration.engine !== 'none') log(`  voice-over: ${narration.engine} (${narration.voice}), ${Object.keys(narration.clips).length} lines`);

  let take;
  for (let attempt = 0; ; attempt++) {
    try {
      if (opts.hooks !== false) await runHooks(scenario.setup?.reset, { cwd: scenario.__dir, log });
      log(`  recording (${opts.driver ?? 'page'} recorder)${attempt ? `, attempt ${attempt + 1}` : ''}`);
      const r = await oneTake({ scenario, lang, work, outDir, narration, opts, log });
      take = { timeline: r.result.timeline, warnings: r.result.warnings, offset: r.offset, duration: r.rec.duration, diagnostics: r.diagnostics, driver: r.rec.driver, framesPerSecond: r.rec.framesPerSecond };
      break;
    } catch (e) {
      if (e instanceof StepError && attempt < (opts.retries ?? 1)) {
        log(`  take failed (${e.message}). Trying again after the reset step.`);
        continue;
      }
      throw e;
    }
  }
  writeFileSync(join(work, 'take.json'), JSON.stringify(take, null, 2));
  return buildOutputs({ scenario, lang, work, outDir, take, opts, log });
}

/** Makes the sound, packaging and checks again from the last recording of a language (no new recording). */
export function renderLanguage({ scenario, lang, outDir, opts = {}, log = console.log }) {
  const work = workDir(outDir, scenario, lang);
  const file = join(work, 'take.json');
  if (!existsSync(file) || !existsSync(join(work, 'raw.mp4'))) throw new Error(`There is no recording of "${scenario.name}" in ${lang} to render from. Run record first.`);
  const take = JSON.parse(readFileSync(file, 'utf8'));
  return buildOutputs({ scenario, lang, work, outDir, take, opts, log });
}
