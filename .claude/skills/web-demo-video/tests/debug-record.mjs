// Developer helper: record a short take on the test page and compare the list of frame durations with the finished video.
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunner } from '../scripts/lib/actor.mjs';
import { startRecording } from '../scripts/lib/recorder.mjs';
import { loadScenario } from '../scripts/lib/scenario.mjs';
import { openSession } from '../scripts/lib/session.mjs';

process.env.WDV_KEEP_FRAMES = '1';
const html = readFileSync(new URL('./fixtures/app.html', import.meta.url), 'utf8');
const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const dir = mkdtempSync(join(tmpdir(), 'wdv-dbg-'));
const file = join(dir, 's.json');
writeFileSync(file, JSON.stringify({ version: 1, name: 'dbg', languages: ['en'], meta: { title: { en: 'Debug' } }, target: { url: base, viewport: { width: 1100, height: 700 } }, steps: [{ id: 'a', do: [{ hover: 'Reports', for: 0.5 }] }] }));
const scenario = loadScenario(file);
const session = await openSession({ scenario, lang: 'en' });
const runner = createRunner({ scenario, lang: 'en', session, outDir: dir });
await runner.setup();
const rec = await startRecording({ driver: 'page', session, outFile: join(dir, 'o.mp4'), viewport: scenario.target.viewport });
await runner.run();
const res = await rec.stop();
console.log('wall', (res.endWall - res.startWall).toFixed(2), 'video', res.duration.toFixed(2), 'frames', res.frames);
await session.close();
server.close();
process.exit(0);
