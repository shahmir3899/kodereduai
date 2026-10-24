import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runHooks, stopBackground } from '../scripts/lib/hooks.mjs';

const dir = mkdtempSync(join(tmpdir(), 'wdv-hooks-'));
const q = (s) => JSON.stringify(s);

test('commands run in order, in the right folder, with the given environment', async () => {
  const sub = join(dir, 'sub dir');
  mkdirSync(sub);
  const out = join(dir, 'out.txt');
  await runHooks(
    [`node -e "require('fs').appendFileSync(${q(out).replace(/"/g, '\\"')}, 'one\\n')"`, { run: `node -e "require('fs').appendFileSync(${q(out).replace(/"/g, '\\"')}, process.cwd().split(/[\\\\/]/).pop() + ' ' + process.env.DEMO_X + '\\n')"`, cwd: 'sub dir', env: { DEMO_X: 'hello' } }],
    { cwd: dir, log: () => {} },
  );
  assert.equal(readFileSync(out, 'utf8'), 'one\nsub dir hello\n');
});

test('an absolute folder (such as D:\\project\\api) is understood', async () => {
  const out = join(dir, 'abs.txt');
  await runHooks([{ run: `node -e "require('fs').writeFileSync(${q(out).replace(/"/g, '\\"')}, 'ok')"`, cwd: dir }], { cwd: tmpdir(), log: () => {} });
  assert.equal(readFileSync(out, 'utf8'), 'ok');
});

test('a failing command stops everything with its name', async () => {
  await assert.rejects(() => runHooks(['node -e "process.exit(3)"'], { cwd: dir, log: () => {} }), /The command failed \(exit 3\)/);
});

test('a background server is waited for, and stopped afterwards', { timeout: 60000 }, async () => {
  const free = await new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const script = join(dir, 'server.mjs');
  writeFileSync(script, `import { createServer } from 'node:http'; createServer((q, r) => r.end('up')).listen(${free}, '127.0.0.1');`);
  await runHooks([{ run: `node ${q(script)}`, background: true, waitForUrl: `http://127.0.0.1:${free}/` }], { cwd: dir, log: () => {} });
  assert.equal(await fetch(`http://127.0.0.1:${free}/`).then((r) => r.text()), 'up');
  stopBackground();
  await new Promise((r) => setTimeout(r, 1500));
  await assert.rejects(() => fetch(`http://127.0.0.1:${free}/`), /fetch failed/);
});
