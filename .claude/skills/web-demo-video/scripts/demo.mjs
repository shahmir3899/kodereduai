#!/usr/bin/env node
// web-demo-video command line.  node demo.mjs <command> [scenario.json] [options]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRunner } from './lib/actor.mjs';
import { formatChecks, listWindowsVoices, pythonInfo, runChecks } from './lib/check.mjs';
import { runHooks, stopBackground } from './lib/hooks.mjs';
import { BUILT_IN, USER_DIR, builtInPath, generateTrack, listTracks } from './lib/music.mjs';
import { PRESETS } from './lib/package.mjs';
import { recordLanguage, renderLanguage } from './lib/pipeline.mjs';
import { loadScenario } from './lib/scenario.mjs';
import { openSession } from './lib/session.mjs';
import { ConsentError, narrationScript } from './lib/tts.mjs';

const HELP = `web-demo-video: record a human-like walkthrough video of a web app.

  check                              what is installed, what is missing
  init <name> [--url URL]            write a starter scenario file
  validate <scenario>                find mistakes in a scenario, without opening a browser
  rehearse <scenario>                run every step quickly with no recording (fix the scenario here)
  script <scenario> [--lang en|ur]   print the narration to read and approve before recording
  voices                             which voices can be used
  music list | build [name|all]      the background tracks you can choose from
  record <scenario>                  record, add voice and music, package, and check quality
  render <scenario>                  redo sound, packaging and checks from the last recording (no new take)

Options:
  --lang en|ur|all        which language(s); default is every language in the scenario
  --preset web|hd|whatsapp   (default web)
  --music calm|warm|bright|minimal|none|<file>   overrides the scenario
  --voice sapi|edge|files|none                  overrides the scenario
  --allow-online-tts      the user agreed that narration text may be sent to Microsoft (edge voice)
  --driver page|desktop   page (default) needs no window; desktop records the screen
  --retries N             take again after a failed step (default 1)
  --out DIR               where results go (default: the scenario's output.dir, else ./demo-videos)
  --headed  --no-hooks  --speed calm|normal|brisk
`;

export function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args.flags[key] = true;
      else {
        args.flags[key] = next;
        i++;
      }
    } else args._.push(a);
  }
  return args;
}

const TEMPLATE = (name, url) => `{
  // A scenario describes one video. Only this file changes from app to app.
  "version": 1,
  "name": "${name}",
  "languages": ["en"],                       // add "ur" for an Urdu version

  "meta": {
    "app": "My App",
    "title":    { "en": "What this video is about" },
    "subtitle": { "en": "One sentence that tells the viewer why they should watch" },
    "learn":    { "en": ["First thing you will learn", "Second thing", "Third thing"] }
  },

  "target": {
    "url": "${url}",                         // only this machine is allowed unless you list hosts in "allowHosts"
    "viewport": { "width": 1280, "height": 720 },
    "hide": []                               // CSS selectors to hide while recording, e.g. dev badges or cookie banners
  },

  "setup": {
    "before": [],                            // commands to start the app and seed demo data
    "login": [],                             // actions done BEFORE recording, e.g. sign in. Use "\${ENV:APP_PASSWORD}" for secrets
    "reset": [],                             // commands run before every take, to restore the starting state
    "after": []                              // commands that clean up
  },

  "style": { "speed": "normal", "theme": "teal", "keys": "shortcuts" },
  "voice": { "engine": "sapi" },             // sapi (offline) | edge (online, asks first) | files | none
  "music": { "track": "calm" },              // calm | warm | bright | minimal | a file path | none
  "intro": { "say": { "en": "In this video you will learn how to do the thing." } },
  "outro": { "headline": { "en": "That is all" }, "say": { "en": "That is all. Thank you for watching." } },

  "steps": [
    {
      "id": "open-page",
      "caption": { "en": "Step 1: Open the page" },
      "say":     { "en": "First, open the page." },
      "do": [ { "click": "Some visible text" } ],
      "expect": { "text": "Something that should appear" }
    }
  ]
}
`;

const langsFor = (scenario, args) => (!args.flags.lang || args.flags.lang === 'all' ? scenario.languages : [args.flags.lang]);
const optsFrom = (args) => ({
  driver: args.flags.driver,
  preset: args.flags.preset,
  music: args.flags.music,
  voice: args.flags.voice,
  allowOnline: Boolean(args.flags['allow-online-tts']),
  retries: args.flags.retries === undefined ? 1 : Number(args.flags.retries),
  headed: Boolean(args.flags.headed),
  hooks: !args.flags['no-hooks'],
});

async function cmdCheck() {
  const results = runChecks();
  console.log(formatChecks(results));
  process.exitCode = results.some((r) => !r.ok && r.required) ? 1 : 0;
}

async function cmdInit(args) {
  const name = args._[1];
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('Give a name made of lowercase letters, digits and hyphens: node demo.mjs init add-patient');
  const file = resolve(`${name}.scenario.json`);
  if (existsSync(file)) throw new Error(`${file} already exists`);
  writeFileSync(file, TEMPLATE(name, args.flags.url ?? 'http://localhost:3000/'));
  console.log(`Wrote ${file}\nEdit it, then run: node demo.mjs validate ${name}.scenario.json`);
}

async function cmdValidate(args) {
  const scenario = loadScenario(args._[1]);
  console.log(`OK: "${scenario.name}" has ${scenario.steps.length} step(s) for ${scenario.languages.join(' and ')}.`);
}

async function cmdScript(args) {
  const scenario = loadScenario(args._[1]);
  for (const lang of langsFor(scenario, args)) console.log(`${narrationScript(scenario, lang)}\n`);
}

async function cmdVoices() {
  const v = listWindowsVoices();
  console.log('Offline voices on this computer:');
  console.log(v.length ? v.map((x) => `  ${x.name} (${x.culture}, ${x.gender})`).join('\n') : '  none found');
  const py = pythonInfo();
  console.log('\nOnline Microsoft voices (the narration text is sent to Microsoft, so the user must agree first):');
  console.log(py?.edgeTts ? '  installed. Examples: en-US-AriaNeural, en-US-GuyNeural, ur-PK-UzmaNeural, ur-PK-AsadNeural' : '  not installed (python -m pip install --user edge-tts)');
  console.log('\nYour own recordings: put <step-id>.<lang>.wav files in a folder and use "voice": {"engine": "files", "dir": "audio"}');
}

async function cmdMusic(args) {
  const sub = args._[1] ?? 'list';
  if (sub === 'build') {
    const which = args._[2] ?? 'all';
    for (const name of which === 'all' ? Object.keys(BUILT_IN) : [which]) {
      console.log(`making ${name}...`);
      generateTrack(name, builtInPath(name));
    }
  }
  console.log('\nBackground music you can choose:');
  for (const t of listTracks()) console.log(`  ${t.name.padEnd(10)} ${t.kind.padEnd(9)} ${t.mood}${t.ready ? '' : '  (made on first use)'}`);
  console.log(`\nAdd your own: copy audio files into ${USER_DIR}`);
}

async function withHooks(scenario, args, body) {
  const cwd = scenario.__dir;
  try {
    if (!args.flags['no-hooks']) await runHooks(scenario.setup?.before, { cwd });
    return await body();
  } finally {
    if (!args.flags['no-hooks']) {
      try {
        await runHooks(scenario.setup?.after, { cwd });
      } catch (e) {
        console.error(`Cleanup command failed: ${e.message}`);
      }
      stopBackground();
    }
  }
}

/** --out wins, then the scenario's "output": {"dir"} (relative to the scenario file), then ./demo-videos. */
function outDirFor(scenario, args) {
  if (args.flags.out) return resolve(args.flags.out);
  return scenario.output?.dir ? resolve(scenario.__dir, scenario.output.dir) : resolve('demo-videos');
}

async function cmdRehearse(args) {
  const scenario = loadScenario(args._[1]);
  const outDir = outDirFor(scenario, args);
  mkdirSync(outDir, { recursive: true });
  let failed = false;
  await withHooks(scenario, args, async () => {
    for (const lang of langsFor(scenario, args)) {
      console.log(`\nRehearsing "${scenario.name}" in ${lang}`);
      if (!args.flags['no-hooks']) await runHooks(scenario.setup?.reset, { cwd: scenario.__dir });
      const session = await openSession({ scenario, lang, headed: Boolean(args.flags.headed), speed: 'brisk', factor: 0.4 });
      const runner = createRunner({ scenario, lang, session, outDir, fast: true, log: console.log });
      try {
        await runner.setup();
        const result = await runner.run();
        console.log(`  done: ${result.timeline.filter((t) => t.kind === 'step').length} steps, no failures`);
        for (const w of result.warnings) console.log(`  warning: ${w.text}`);
        const seen = new Set();
        for (const d of session.diagnostics) {
          const k = `${d.kind}:${d.text}`;
          if (!seen.has(k)) (seen.add(k), console.log(`  page problem (${d.kind}): ${d.text}`));
        }
      } catch (e) {
        failed = true;
        console.error(`\n  FAILED: ${e.message}${e.screenshot ? `\n  Screenshot: ${e.screenshot}` : ''}`);
      } finally {
        await session.close();
      }
    }
  });
  process.exitCode = failed ? 1 : 0;
}

function summary(lang, r) {
  console.log(`\n  ${lang}: ${r.out}`);
  console.log(`      captions: ${r.srt}`);
  console.log(`      poster:   ${r.poster}`);
  console.log(`      contact sheet: ${r.sheet}`);
  console.log(`      quality: ${r.qa.verdict.toUpperCase()}${r.qa.issues.length ? '' : ' (no issues)'}`);
  for (const i of r.qa.issues) console.log(`        - ${i.level}: ${i.message}`);
  const m = r.qa.metrics;
  console.log(`      ${m.width}x${m.height}, ${m.duration.toFixed(1)} s, ${m.sizeMB.toFixed(1)} MB${m.loudness !== undefined ? `, ${m.loudness.toFixed(1)} LUFS` : ', no sound'}`);
}

async function cmdRecord(args) {
  const scenario = loadScenario(args._[1]);
  const outDir = outDirFor(scenario, args);
  const opts = optsFrom(args);
  if (opts.preset && !PRESETS[opts.preset]) throw new Error(`Unknown preset "${opts.preset}". Use ${Object.keys(PRESETS).join(', ')}.`);
  mkdirSync(outDir, { recursive: true });
  let bad = false;
  await withHooks(scenario, args, async () => {
    for (const lang of langsFor(scenario, args)) {
      console.log(`\nRecording "${scenario.name}" in ${lang}`);
      try {
        const r = await recordLanguage({ scenario, lang, outDir, opts, log: console.log });
        summary(lang, r);
        if (r.qa.verdict === 'fail') bad = true;
      } catch (e) {
        if (e instanceof ConsentError) throw e;
        bad = true;
        console.error(`\n  FAILED: ${e.message}${e.screenshot ? `\n  Screenshot: ${e.screenshot}` : ''}`);
      }
    }
  });
  process.exitCode = bad ? 1 : 0;
}

async function cmdRender(args) {
  const scenario = loadScenario(args._[1]);
  const outDir = outDirFor(scenario, args);
  const opts = optsFrom(args);
  for (const lang of langsFor(scenario, args)) {
    console.log(`\nRendering "${scenario.name}" in ${lang} from the last recording`);
    summary(lang, renderLanguage({ scenario, lang, outDir, opts, log: console.log }));
  }
}

const COMMANDS = { check: cmdCheck, init: cmdInit, validate: cmdValidate, script: cmdScript, voices: cmdVoices, music: cmdMusic, rehearse: cmdRehearse, record: cmdRecord, render: cmdRender };

if (process.argv[1]?.endsWith('demo.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || args.flags.help || !COMMANDS[command]) {
    console.log(HELP);
    process.exit(command && !COMMANDS[command] ? 1 : 0);
  }
  COMMANDS[command](args)
    .catch((e) => {
      console.error(`\n${e.message}`);
      process.exitCode = e instanceof ConsentError ? 3 : 1;
    })
    .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 50));
}
