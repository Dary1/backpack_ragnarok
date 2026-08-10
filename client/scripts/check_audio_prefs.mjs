#!/usr/bin/env node
// client/scripts/check_audio_prefs.mjs -- REQ-0370 gate.
//
// Exercises the REAL production mixer-prefs module
// (client/src/audio/audioPrefs.ts). It is deliberately pure (no
// AudioContext, no DOM at module scope), so plain Node drives it once Vite
// has transpiled the TS -- same vite-ssrLoadModule rig, same discipline,
// as check_chime_mapping.mjs.
//
// What this proves: the defaults keep every pre-REQ-0370 sound untouched
// (master/sfx unity) while BGM lands as a subtle layer, and the normaliser
// never lets a malformed localStorage value poison the gain graph.
//
// Usage: node client/scripts/check_audio_prefs.mjs   (exit 0 = pass).
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '..');

async function loadModule() {
  const server = await createServer({
    configFile: false,
    root: CLIENT_ROOT,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  });
  try {
    return await server.ssrLoadModule('/src/audio/audioPrefs.ts');
  } finally {
    await server.close();
  }
}

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log('  ok   ', name);
  } else {
    failures++;
    console.log('  FAIL ', name, detail ? `-- ${detail}` : '');
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const { defaultAudioPrefs, normalizeAudioPrefs, STORAGE_KEY, AUDIO_PREFS_EVENT } = await loadModule();

console.log('defaults');
const d = defaultAudioPrefs();
check('master defaults to unity (no audible change for existing sounds)', d.master === 1);
check('sfx defaults to unity (chimes/claim/button FX untouched)', d.sfx === 1);
check('bgm defaults below unity but audible', d.bgm > 0 && d.bgm < 1);
check('muted defaults off', d.muted === false);
check('storage key is namespaced like bp.chimes.prefs', STORAGE_KEY === 'bp.audio.prefs');
check('event name is stable', AUDIO_PREFS_EVENT === 'bp-audio-prefs-changed');

console.log('normaliser: garbage in, defaults out');
check('null -> defaults', eq(normalizeAudioPrefs(null), d));
check('undefined -> defaults', eq(normalizeAudioPrefs(undefined), d));
check('string -> defaults', eq(normalizeAudioPrefs('loud'), d));
check('number -> defaults', eq(normalizeAudioPrefs(11), d));
check('array -> defaults (typeof [] is object; field-wise fill)', eq(normalizeAudioPrefs([]), d));
check('empty object -> defaults', eq(normalizeAudioPrefs({}), d));

console.log('normaliser: field-wise merge + clamp');
check('valid full object passes through',
  eq(normalizeAudioPrefs({ master: 0.4, bgm: 0.25, sfx: 0.55, muted: true }),
     { master: 0.4, bgm: 0.25, sfx: 0.55, muted: true }));
check('partial object fills the rest from defaults',
  eq(normalizeAudioPrefs({ bgm: 0.1 }), { ...d, bgm: 0.1 }));
check('out-of-range clamps to [0,1]',
  eq(normalizeAudioPrefs({ master: 7, bgm: -3, sfx: 0.5, muted: false }),
     { master: 1, bgm: 0, sfx: 0.5, muted: false }));
check('NaN/Infinity clamp to 0 (never a NaN gain)',
  eq(normalizeAudioPrefs({ master: NaN, bgm: Infinity, sfx: -Infinity, muted: false }),
     { master: 0, bgm: 0, sfx: 0, muted: false }));
check('wrong types fall back field-wise',
  eq(normalizeAudioPrefs({ master: 'loud', bgm: true, sfx: {}, muted: 1 }), d));

if (failures) {
  console.log(`check_audio_prefs: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('check_audio_prefs: all assertions pass');
