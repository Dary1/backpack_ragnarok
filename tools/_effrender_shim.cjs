#!/usr/bin/env node
// _effrender_shim.cjs -- helper invoked by tool_build_preview.py (v3) via `node`.
// Reads a JSON payload of entries from stdin: [{ id, effects: [...] }, ...]
// Writes JSON to stdout: { id: { eff_en: "...", eff_ja: "..." }, ... }
// Ensures preview HTML effect text is byte-identical to eff_render.cjs output.
'use strict';
const { render } = require('./eff_render.cjs');

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function joinRender(effects, locale) {
  return (effects || []).map((e) => render(e, locale)).join(' ');
}

(async () => {
  const raw = await readStdin();
  const entries = JSON.parse(raw);
  const out = {};
  for (const e of entries) {
    out[e.id] = {
      eff_en: joinRender(e.effects, 'en'),
      eff_ja: joinRender(e.effects, 'ja'),
    };
  }
  process.stdout.write(JSON.stringify(out));
})();
