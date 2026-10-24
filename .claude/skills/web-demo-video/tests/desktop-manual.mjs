// Manual check of the desktop recorder (it opens a real window for about 12 seconds, so it is not part of the automatic tests).
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunner } from '../scripts/lib/actor.mjs';
import { startRecording } from '../scripts/lib/recorder.mjs';
import { loadScenario } from '../scripts/lib/scenario.mjs';
import { openSession } from '../scripts/lib/session.mjs';

const html = readFileSync(new URL('./fixtures/app.html', import.meta.url), 'utf8');
const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const dir = mkdtempSync(join(tmpdir(), 'wdv-desk-'));
const file = join(dir, 's.json');
writeFileSync(file, JSON.stringify({ version: 1, name: 'desk', languages: ['en'], target: { url: base, viewport: { width: 1000, height: 600 } }, intro: false, steps: [{ id: 'a', caption: { en: 'Desktop recording works' }, do: [{ hover: 'Reports', for: 0.8 }, { type: 'Hello', into: { label: 'Full name' } }] }] }));
const scenario = loadScenario(file);
const session = await openSession({ scenario, lang: 'en', headed: true });
const runner = createRunner({ scenario, lang: 'en', session, outDir: dir });
await runner.setup();
const rec = await startRecording({ driver: 'desktop', session, outFile: join(dir, 'desk.mp4'), viewport: scenario.target.viewport, log: console.log });
await runner.run();
const res = await rec.stop();
console.log(JSON.stringify({ file: res.file, width: res.width, height: res.height, duration: +res.duration.toFixed(2), wall: +(res.endWall - res.startWall).toFixed(2) }));
await session.close();
server.close();
process.exit(0);
