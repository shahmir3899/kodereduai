#!/usr/bin/env node
// Read-only: lists StyleSheet keys a file defines but never uses as `styles.<key>`.
//   node scripts/unused_styles.js file1.tsx file2.tsx ...
const fs = require('fs');
for (const f of process.argv.slice(2)) {
  const s = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  const m = s.match(/const styles = StyleSheet\.create\(\{([\s\S]*?)\n\}\);/);
  if (!m) continue;
  const keys = [...m[1].matchAll(/^ {2}([A-Za-z0-9_]+):/gm)].map((x) => x[1]);
  const body = s.replace(m[0], '');
  const unused = keys.filter((k) => !new RegExp('styles\\.' + k + '\\b').test(body));
  if (unused.length) console.log(`${f}: ${unused.join(', ')}`);
}
