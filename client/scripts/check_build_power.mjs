#!/usr/bin/env node
// client/scripts/check_build_power.mjs -- REQ-0371 gate.
//
// Exercises the REAL production module (client/src/lib/buildPower.ts) against
// the REAL engine (shared/engine.js), same vite-ssrLoadModule rig as
// check_link_trace.mjs / check_unit_icon.mjs (see their headers).
//
// Gates pinned here (REQ-0371):
//   1. chip HP == engine-summed HP for a fixture canvas: buildPower().hp
//      must equal the sum of engine.bpHpMax() over the fixture's BPs (with
//      the sim's own 100 fallback for an absent hpMax -- sim/lib/compile.cjs).
//   2. the documented magnitude arithmetic: [lo,hi] -> mean, scalar as-is,
//      multi_strike x hits, no-n verbs 0, inv-parked items excluded, seated
//      SIs counted.
//   3. locale coverage: the chip/card i18n keys exist in BOTH the en and ja
//      maps ("power number present ... both locales" gate).
//
// Usage: node client/scripts/check_build_power.mjs
// Exit 0 = all assertions pass.
import { createServer } from 'vite';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const EngineFactory = require(path.resolve(CLIENT_ROOT, '..', 'shared', 'engine.js'));

async function loadModules() {
  const server = await createServer({
    configFile: false,
    root: CLIENT_ROOT,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  });
  try {
    return {
      bp: await server.ssrLoadModule('/src/lib/buildPower.ts'),
      canvasI18n: await server.ssrLoadModule('/src/i18n/canvas.ts'),
      sortieI18n: await server.ssrLoadModule('/src/i18n/sortie.ts'),
    };
  } finally {
    await server.close();
  }
}

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log('  ok   ', name);
  else { failures++; console.log('  FAIL ', name, detail ? `-- ${detail}` : ''); }
}

const { bp, canvasI18n, sortieI18n } = await loadModules();
const { buildPower, effectMagnitude, DEFAULT_BP_HP } = bp;

// ---------------------------------------------------------------------------
// Fixture: two BPs (one authored hpMax 120, one legacy BP without the field),
// three grid POs + one inv-parked PO, one seated SI + one unseated SI. Effect
// numerics cover every documented arithmetic case.
const LAYOUT = { ROWS: 8, COLS: 8 };
const SHAPES = { none: { kind: 'none', dirs: [] } };
const UNITS = { u_none: { name: 'none', rarity: 'Common', icon: '', connection_shape: 'none' } };
const ITEMS = {
  sword: { name: 'Sword', tags: [], rarity: 'Common', shape: [[0, 0]], icon: '',
    effects: [{ trigger: { t: 'every_secs', s: [1.8, 2.2] }, verb: { t: 'strike', n: [22, 38] } }] }, // mean 30
  flail: { name: 'Flail', tags: [], rarity: 'Common', shape: [[0, 0]], icon: '',
    effects: [{ trigger: { t: 'every_secs', s: [2.0, 2.0] }, verb: { t: 'multi_strike', n: [3, 5], hits: 3 } }] }, // 4x3 = 12
  charm: { name: 'Charm', tags: [], rarity: 'Common', shape: [[0, 0]], icon: '',
    effects: [{ trigger: { t: 'passive' }, verb: { t: 'pulse' } }] }, // no n -> 0
  relic: { name: 'Relic', tags: [], rarity: 'Common', shape: [[0, 0]], icon: '',
    effects: [{ trigger: { t: 'battle_start' }, verb: { t: 'block', n: 10 } }] }, // legacy scalar 10
};
const SI_DEFS = {
  gem: { name: 'Gem', tags: [], rarity: 'Common', icon: '',
    effects: [{ trigger: { t: 'passive' }, verb: { t: 'buff_host', n: [2, 4], stat: 'damage' } }] }, // mean 3
};
const state = {
  linked: false,
  bps: [
    { id: 'b1', name: 'B1', color: '#888', shape: [[0, 0]], origin: [1, 1], unit: { id: 'u_none', off: [0, 0] }, hpMax: 120 },
    { id: 'b2', name: 'B2', color: '#888', shape: [[0, 0]], origin: [3, 3], unit: { id: 'u_none', off: [0, 0] } }, // no hpMax -> 100
  ],
  pos: [
    { uid: 'p1', id: 'sword', loc: 'grid', cell: [1, 2], rot: 0 },
    { uid: 'p2', id: 'flail', loc: 'grid', cell: [1, 3], rot: 0 },
    { uid: 'p3', id: 'relic', loc: 'grid', cell: [1, 4], rot: 0 },
    { uid: 'p4', id: 'sword', loc: 'inv', cell: null, rot: 0 }, // parked -> excluded
  ],
  sis: [
    { uid: 's1', id: 'gem', host: { po: 'p1', si: 0 } }, // seated on a grid PO -> counted
    { uid: 's2', id: 'gem', host: 'inv' },               // unseated -> excluded
  ],
};
const engine = EngineFactory.create(ITEMS, SI_DEFS, LAYOUT, undefined, UNITS, SHAPES);

// [1] HP parity with the engine (sim 100 fallback for absent hpMax).
const engineHp = state.bps.reduce((s, b) => {
  const v = engine.bpHpMax(state, b.id);
  return s + (typeof v === 'number' ? v : DEFAULT_BP_HP);
}, 0);
const res = buildPower(state, ITEMS, SI_DEFS);
check('chip HP equals engine-summed HP (120 + default 100)', res.hp === engineHp && res.hp === 220, `hp=${res.hp} engine=${engineHp}`);

// [2] magnitude arithmetic: 220 hp + 30 (range mean) + 12 (multi_strike) + 10 (scalar) + 3 (seated SI) = 275.
check('power = hp + summed magnitudes (documented aggregate)', res.power === 275, `power=${res.power}`);
check('effectMagnitude: [lo,hi] range -> mean', effectMagnitude(ITEMS.sword) === 30, String(effectMagnitude(ITEMS.sword)));
check('effectMagnitude: multi_strike x hits', effectMagnitude(ITEMS.flail) === 12, String(effectMagnitude(ITEMS.flail)));
check('effectMagnitude: verbs without numeric n count 0', effectMagnitude(ITEMS.charm) === 0, String(effectMagnitude(ITEMS.charm)));
check('effectMagnitude: legacy scalar n counts as-is', effectMagnitude(ITEMS.relic) === 10, String(effectMagnitude(ITEMS.relic)));
check('effectMagnitude: tolerant of a def without effects', effectMagnitude({ name: 'x' }) === 0 && effectMagnitude(undefined) === 0);
check('empty canvas -> {0, 0}', buildPower({ bps: [], pos: [], sis: [] }, ITEMS, SI_DEFS).hp === 0 && buildPower(null, null, null).power === 0);
check('content not loaded -> HP still summed, no throw', buildPower(state, null, null).hp === 220);

// [3] locale coverage: chip + card keys in BOTH maps.
const KEYS_CANVAS = ['canvas.statHp', 'canvas.statPower', 'canvas.statPowerTip'];
const KEYS_SORTIE = ['sortie.squad.power'];
for (const k of KEYS_CANVAS) {
  check(`i18n en has ${k}`, typeof canvasI18n.canvasEn[k] === 'string' && canvasI18n.canvasEn[k].length > 0);
  check(`i18n ja has ${k}`, typeof canvasI18n.canvasJa[k] === 'string' && canvasI18n.canvasJa[k].length > 0);
}
for (const k of KEYS_SORTIE) {
  check(`i18n en has ${k}`, typeof sortieI18n.sortieEn[k] === 'string' && sortieI18n.sortieEn[k].length > 0);
  check(`i18n ja has ${k}`, typeof sortieI18n.sortieJa[k] === 'string' && sortieI18n.sortieJa[k].length > 0);
}

if (failures > 0) { console.error(`check_build_power: ${failures} FAILURE(S)`); process.exit(1); }
console.log('check_build_power: all checks passed');
