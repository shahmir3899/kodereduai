// Developer helper: render every on-screen element in English and Urdu and save pictures to look at.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sleep } from '../scripts/lib/cdp.mjs';
import { loadScenario } from '../scripts/lib/scenario.mjs';
import { openSession } from '../scripts/lib/session.mjs';

const html = readFileSync(new URL('./fixtures/app.html', import.meta.url), 'utf8');
const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const out = process.argv[2] ?? join(tmpdir(), 'wdv-visual');
mkdirSync(out, { recursive: true });
const file = join(out, 's.json');
writeFileSync(file, JSON.stringify({ version: 1, name: 'visual', languages: ['en', 'ur'], style: { theme: process.argv[3] ?? 'teal' }, target: { url: base, viewport: { width: 1280, height: 720 } }, steps: [{ id: 'a', do: [] }] }));
const scenario = loadScenario(file);

for (const lang of ['en', 'ur']) {
  const s = await openSession({ scenario, lang });
  await s.page.send('Page.navigate', { url: base });
  await sleep(800);
  const shot = async (name) => {
    await sleep(2300);
    const { data } = await s.page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, `${lang}-${name}.png`), Buffer.from(data, 'base64'));
  };
  const L = lang === 'ur';
  await s.page.evaluate(`__demo.slide(${JSON.stringify({ kind: 'intro', kicker: L ? 'میڈی ڈیسک' : 'MediDesk', headline: L ? 'کلینک میں نئی خصوصیت شامل کریں' : 'Add a specialty to your clinic', subtitle: L ? 'چند منٹ میں اپنے کلینک کی خصوصیات منتخب کریں' : 'Choose what your clinic offers in under a minute', bullets: L ? ['فہرست دیکھیں', 'نئی خصوصیت شامل کریں', 'ڈاکٹر کو دیں'] : ['See your list', 'Add a new specialty', 'Give it to a doctor'], lang })})`);
  await shot('intro');
  await s.page.evaluate('__demo.hideSlide(0)');
  await s.page.evaluate(`__demo.slide(${JSON.stringify({ kind: 'chapter', headline: L ? 'حصہ دوم: ڈاکٹر' : 'Part two: Doctors', lang })})`);
  await shot('chapter');
  await s.page.evaluate('__demo.hideSlide(0)');
  await s.page.evaluate(`__demo.caption(${JSON.stringify(L ? 'مرحلہ ۱: ترتیبات کھولیں' : 'Step 1: Open Settings')}, { pos: 'top', lang: '${lang}' }); __demo.progress(0.4)`);
  await s.page.evaluate(`(() => { const r = document.getElementById('save').getBoundingClientRect(); __demo.spotlight({x: r.left, y: r.top, w: r.width, h: r.height}); })()`);
  await shot('caption-spotlight');
  await s.page.evaluate('__demo.spotlight(null); __demo.caption("Bottom caption", { pos: "bottom", lang: "' + lang + '" })');
  await shot('caption-bottom');
  await s.close();
}
server.close();
console.log(out);
process.exit(0);
