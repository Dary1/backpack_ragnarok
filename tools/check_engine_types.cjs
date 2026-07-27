'use strict';
// tools/check_engine_types.cjs -- REQ-0047 (e): engine type-surface drift
// detector. client/src/engine/engine.d.ts hand-declares two runtime-
// checkable surfaces for shared/engine.js (consumed AS-IS by design):
//   - EngineModule  (the UMD factory's 5 exports)
//   - EngineInstance (the object Engine.create(...) returns)
// The d.ts is deliberately partial-by-coverage but must never DRIFT:
// everything it declares must exist at runtime with the declared kind and
// required-parameter count (REQ-0027 once caught such a drift by manual
// re-reading; this makes the re-read mechanical, in CI).
const fs = require('fs');
const path = require('path');
const Engine = require(path.join(__dirname, '..', 'shared', 'engine.js'));
const src = fs.readFileSync(path.join(__dirname, '..', 'shared', 'engine.d.ts'), 'utf8');

function interfaceBody(name) {
  const start = src.indexOf('export interface ' + name + ' {');
  if (start < 0) throw new Error('interface ' + name + ' not found in engine.d.ts');
  let i = src.indexOf('{', start), depth = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (!depth) break; } }
  return src.slice(i + 1, j);
}
// Depth-aware member scanner (regex breaks on ';' inside brace/paren
// types, e.g. params like (container: { pos: PO[]; sis?: SI[] })).
function members(body) {
  const out = [];
  let depth = 0, cur = '', prev = '';
  for (const ch of body) {
    if ('<{[('.includes(ch)) depth++;
    else if ('>}])'.includes(ch) && !(ch === '>' && prev === '=')) depth--;
    prev = ch;
    if (ch === ';' && depth === 0) {
      const t = cur.trim();
      cur = '';
      const cm = /^(\w+)(\??):\s*([\s\S]+)$/.exec(t);
      if (!cm) continue;
      const val = cm[3].trim();
      const fn = val.startsWith('(');
      let params = null;
      if (fn) {
        let d = 0, j = 0;
        for (; j < val.length; j++) { if (val[j] === '(') d++; else if (val[j] === ')') { d--; if (!d) break; } }
        params = val.slice(1, j);
      }
      out.push({ name: cm[1], optional: cm[2] === '?', fn, params });
    } else cur += ch;
  }
  return out;
}
function paramCounts(s) {
  s = (s || '').trim(); if (!s) return { required: 0, total: 0 };
  let depth = 0, parts = [], cur = '', prev = '';
  for (const ch of s) {
    if ('<{[('.includes(ch)) depth++; else if ('>}])'.includes(ch) && !(ch === '>' && prev === '=')) depth--;
    prev = ch;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  const named = parts.map((p) => p.trim()).filter((t) => t && !t.startsWith('...'));
  return { required: named.filter((t) => !/^\w+\?\s*:/.test(t)).length, total: named.length };
}
const problems = [];
let checked = 0;
// 1) EngineModule vs runtime exports
for (const mm of members(interfaceBody('EngineModule'))) {
  const rt = Engine[mm.name];
  if (rt === undefined && !mm.optional) { problems.push('EngineModule.' + mm.name + ' missing from runtime exports'); continue; }
  if (mm.fn && typeof rt !== 'function') { problems.push('EngineModule.' + mm.name + ' declared function, runtime ' + typeof rt); continue; }
  checked++;
}
// 2) EngineInstance vs a real created instance (same call shape as
// server/services/core.cjs makeEngine()).
const inst = Engine.create({}, {}, { ROWS: 8, COLS: 8 }, { po: {}, socket: {} });
for (const mm of members(interfaceBody('EngineInstance'))) {
  const rt = inst[mm.name];
  if (rt === undefined && !mm.optional) { problems.push('EngineInstance.' + mm.name + ' missing from created instance'); continue; }
  if (mm.fn) {
    if (typeof rt !== 'function') { problems.push('EngineInstance.' + mm.name + ' declared function, runtime ' + typeof rt); continue; }
    const { required, total } = paramCounts(mm.params);
    // runtime .length counts params before the first default/rest -- it
    // must sit within [required, total] of the declared signature.
    if (rt.length < required || rt.length > total) problems.push('EngineInstance.' + mm.name + ': d.ts declares ' + required + '..' + total + ' param(s), runtime .length is ' + rt.length);
  }
  checked++;
}
if (problems.length) {
  console.log('ENGINE TYPE DRIFT (' + problems.length + '):');
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
console.log('engine type surface OK (' + checked + ' declared members verified against runtime)');
