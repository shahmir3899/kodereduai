import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectPage, launchChrome, navigate, setViewport } from '../scripts/lib/cdp.mjs';
import { runChecks } from '../scripts/lib/check.mjs';
import { assertUrlAllowed, compileForbidden, expandEnv, findForbidden, hostMatches, redact, secretValues } from '../scripts/lib/safety.mjs';

test('only this machine is allowed unless the scenario lists the host', () => {
  assert.doesNotThrow(() => assertUrlAllowed('http://localhost:3000/login'));
  assert.doesNotThrow(() => assertUrlAllowed('http://clinic.localhost:3000/'));
  assert.doesNotThrow(() => assertUrlAllowed('http://127.0.0.1:8080/'));
  assert.throws(() => assertUrlAllowed('https://app.example.com/'), /Refusing to record app\.example\.com/);
  assert.doesNotThrow(() => assertUrlAllowed('https://demo.example.test/', ['demo.example.test']));
  assert.doesNotThrow(() => assertUrlAllowed('https://a.stage.example.test/', ['*.stage.example.test']));
  assert.throws(() => assertUrlAllowed('file:///etc/passwd'), /not allowed/);
  assert.throws(() => assertUrlAllowed('not a url'), /not a valid address/);
});

test('"localhost.evil.com" is not mistaken for localhost', () => {
  assert.equal(hostMatches('localhost.evil.com', 'localhost'), false);
  assert.equal(hostMatches('evil-localhost', '*.localhost'), false);
  assert.equal(hostMatches('a.localhost', '*.localhost'), true);
});

test('secrets come from the environment, are never empty, and are redacted', () => {
  const env = { OWNER_PASSWORD: 's3cret!' };
  assert.equal(expandEnv('pw=${ENV:OWNER_PASSWORD}', env), 'pw=s3cret!');
  assert.throws(() => expandEnv('${ENV:MISSING_ONE}', env), /MISSING_ONE is not set/);
  assert.deepEqual(secretValues('${ENV:OWNER_PASSWORD}', env), ['s3cret!']);
  assert.equal(redact('typed s3cret! here', ['s3cret!']), 'typed *** here');
});

test('forbidden text is found, and a bad pattern is explained', () => {
  const compiled = compileForbidden(['[a-z]+@gmail\\.com', 'real patient']);
  assert.equal(findForbidden('contact: nobody', compiled), null);
  assert.equal(findForbidden('mail bob@gmail.com today', compiled).match, 'bob@gmail.com');
  assert.throws(() => compileForbidden(['(']), /not a valid regular expression/);
});

test('the prerequisite check reports each item with a fix when missing', () => {
  const results = runChecks();
  assert.ok(results.length >= 10);
  for (const r of results) {
    assert.equal(typeof r.name, 'string');
    if (!r.ok) assert.ok(r.fix.length > 0, `${r.name} needs a fix text`);
  }
  assert.ok(results.find((r) => r.name.startsWith('Node.js')).ok);
});

test('Chrome starts without a window, takes an exact size, and runs page code', { timeout: 60000 }, async () => {
  const chrome = await launchChrome({ headless: true });
  try {
    const page = await connectPage(chrome.port);
    await setViewport(page, { width: 1000, height: 600, scale: 1.5 });
    await navigate(page, 'data:text/html,<title>hi</title><body style="margin:0"><div id=x>hello</div></body>');
    assert.equal(await page.evaluate('document.getElementById("x").textContent'), 'hello');
    assert.deepEqual(await page.evaluate('[innerWidth, innerHeight, devicePixelRatio]'), [1000, 600, 1.5]);
    await assert.rejects(() => page.evaluate('throw new Error("boom")'), /boom/);
    page.close();
  } finally {
    await chrome.close();
  }
});
