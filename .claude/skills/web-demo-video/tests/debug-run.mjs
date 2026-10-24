// Developer helper: run one scenario file against the test page and print each step as it happens.
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunner } from '../scripts/lib/actor.mjs';
import { loadScenario } from '../scripts/lib/scenario.mjs';
import { openSession } from '../scripts/lib/session.mjs';

const html = readFileSync(new URL('./fixtures/app.html', import.meta.url), 'utf8');
const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const dir = mkdtempSync(join(tmpdir(), 'wdv-debug-'));
const steps = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const file = join(dir, 's.json');
writeFileSync(file, JSON.stringify({ version: 1, name: 'debug', languages: ['en'], target: { url: base, viewport: { width: 1100, height: 700 } }, steps }));
const scenario = loadScenario(file);
const session = await openSession({ scenario, lang: 'en', speed: 'brisk' });
const runner = createRunner({ scenario, lang: 'en', session, outDir: dir, fast: true, log: console.log });
const watchdog = setTimeout(() => { console.log('HUNG: no finish in 60s'); process.exit(2); }, 60000);
try {
  await runner.setup();
  const r = await runner.run();
  console.log('finished', r.duration.toFixed(1), 's', r.warnings.map((w) => w.text));
} catch (e) {
  console.log('FAILED', e.message);
} finally {
  clearTimeout(watchdog);
  await session.close();
  server.close();
  process.exit(0);
}
