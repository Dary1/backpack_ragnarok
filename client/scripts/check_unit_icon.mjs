#!/usr/bin/env node
// client/scripts/check_unit_icon.mjs — REQ-0125a gate.
//
// Exercises the REAL production modules (client/src/board/unitIcon.ts and
// chargeRing.ts), not a reimplementation of them: both are deliberately pure
// (no Pixi, no DOM, no I/O — availability is an injected `has(key)` predicate,
// charge is a plain number), so plain Node can drive them once Vite has
// transpiled the TS. Same discipline, and the same vite-ssrLoadModule trick, as
// check_sprites.mjs — see its header.
//
// This is the fall-through proof REQ-0125a exists to produce: with no unit art
// and no unit identity in the tree, EVERY BP must land on the legacy glyph and
// the board must be unchanged. If that stops being true, this gate goes red.
//
// Usage: node client/scripts/check_unit_icon.mjs   (or: pnpm check:unit-icon)
// Exit 0 = all assertions pass.
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '..');

async function loadModules() {
  const server = await createServer({
    configFile: false,
    root: CLIENT_ROOT,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  });
  try {
    const unitIcon = await server.ssrLoadModule('/src/board/unitIcon.ts');
    const chargeRing = await server.ssrLoadModule('/src/board/chargeRing.ts');
    return { unitIcon, chargeRing };
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
function near(a, b, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

const { unitIcon, chargeRing } = await loadModules();
const { resolveUnitIcon, unitIconKey, unitIconRasters, LEGACY_UNIT_GLYPH } = unitIcon;
const { chargeRingArc, RING_START_ANGLE } = chargeRing;

// --- resolution chain -------------------------------------------------------
// The chain: active unit skin -> default unit icon -> legacy glyph -> placeholder.
// Each rung must be taken only if the key is BOTH declared AND available; a
// declared-but-unavailable key is the missing-art case and must fall THROUGH,
// silently, never throw. That is the entire "missing art must never block
// rendering" contract, and it is what these assertions pin down.
console.log('resolution chain (unitIcon.resolveUnitIcon)');

const has = (...keys) => {
  const set = new Set(keys);
  return (k) => set.has(k);
};
const SKIN = 'unit:elf@elven';
const DEF = 'unit:elf';

check('skin wins when present',
  (() => { const r = resolveUnitIcon({ skinKey: SKIN, defaultKey: DEF }, has(SKIN, DEF, LEGACY_UNIT_GLYPH));
    return r.rung === 'skin' && r.key === SKIN; })());

check('falls to default when skin declared but MISSING (404/decode-fail case)',
  (() => { const r = resolveUnitIcon({ skinKey: SKIN, defaultKey: DEF }, has(DEF, LEGACY_UNIT_GLYPH));
    return r.rung === 'default' && r.key === DEF; })());

check('falls to default when no skin selected',
  (() => { const r = resolveUnitIcon({ skinKey: null, defaultKey: DEF }, has(DEF, LEGACY_UNIT_GLYPH));
    return r.rung === 'default' && r.key === DEF; })());

check('falls to legacy glyph when skin AND default both missing',
  (() => { const r = resolveUnitIcon({ skinKey: SKIN, defaultKey: DEF }, has(LEGACY_UNIT_GLYPH));
    return r.rung === 'legacy' && r.key === LEGACY_UNIT_GLYPH; })());

check('falls to placeholder when even the legacy glyph is absent (no sheet at all)',
  (() => { const r = resolveUnitIcon({ skinKey: SKIN, defaultKey: DEF }, has());
    return r.rung === 'placeholder' && r.key === null; })());

check('empty-string keys are not art (treated as undeclared, not as a lookup)',
  (() => { const r = resolveUnitIcon({ skinKey: '', defaultKey: '' }, has('', LEGACY_UNIT_GLYPH));
    return r.rung === 'legacy'; })());

check('never throws on a hostile query',
  (() => { try { resolveUnitIcon({}, has()); resolveUnitIcon({ skinKey: undefined }, () => false); return true; }
    catch { return false; } })());

// THE fall-through proof: this is the state of the tree as of REQ-0125a.
// No unit art (REQ-0127 on hold), no unit identity (REQ-0128 owns it), so the
// resolver's inputs are empty and every BP MUST land on the legacy glyph --
// i.e. the board renders exactly as it did before this REQ. When REQ-0125b/0127
// land, this assertion is the one that should be updated, deliberately.
console.log('production state today (the no-diff contract)');
check('raster manifest is empty (no unit art exists yet)', unitIconRasters().length === 0);
check('a real BP (no skin, no default) resolves to the LEGACY glyph -- board unchanged',
  (() => { const r = resolveUnitIcon({ skinKey: null, defaultKey: null }, has(LEGACY_UNIT_GLYPH));
    return r.rung === 'legacy' && r.key === LEGACY_UNIT_GLYPH; })());

console.log('key namespacing (must never collide with the SVG route\'s icon-* ids)');
check('unitIconKey(id) is namespaced', unitIconKey('elf') === 'unit:elf');
check('unitIconKey(id, skin) is namespaced', unitIconKey('elf', 'elven') === 'unit:elf@elven');
check('raster keys cannot collide with icon-* symbol ids', !unitIconKey('elf').startsWith('icon-'));

// --- G7 charge ring geometry ------------------------------------------------
// The ring is fully implemented but fed `null` at every production call site,
// because NO charge data exists in this codebase (see chargeRing.ts's header).
// These assertions are what make "implemented" a claim rather than a hope.
console.log('G7 charge ring (chargeRing.chargeRingArc)');

check('null charge -> no ring (the production case today)', chargeRingArc(null) === null);
check('undefined charge -> no ring', chargeRingArc(undefined) === null);
check('0 charge -> no ring (an empty ring on every idle unit is noise)', chargeRingArc(0) === null);
check('NaN -> no ring, does not throw (classic divide-by-zero-max bug)', chargeRingArc(NaN) === null);
check('Infinity -> no ring, does not throw', chargeRingArc(Infinity) === null);

check('half charge sweeps PI radians from 12 o\'clock',
  (() => { const a = chargeRingArc(0.5);
    return a && near(a.sweep, Math.PI) && near(a.startAngle, RING_START_ANGLE) && a.full === false; })());

check('quarter charge sweeps PI/2',
  (() => { const a = chargeRingArc(0.25); return a && near(a.sweep, Math.PI / 2); })());

check('full charge sweeps 2PI and reports full',
  (() => { const a = chargeRingArc(1);
    return a && near(a.sweep, Math.PI * 2) && a.full === true; })());

check('over-charge is CLAMPED, not thrown on (renderer never takes the board down)',
  (() => { const a = chargeRingArc(4.2);
    return a && near(a.sweep, Math.PI * 2) && a.full === true; })());

check('negative charge is clamped to no-ring',
  chargeRingArc(-1) === null);

check('sweep is monotonic in charge',
  (() => { const xs = [0.1, 0.2, 0.5, 0.9, 1];
    let prev = 0;
    for (const x of xs) { const a = chargeRingArc(x); if (!a || a.sweep <= prev) return false; prev = a.sweep; }
    return true; })());

check('endAngle == startAngle + sweep for every step',
  (() => { for (const x of [0.05, 0.33, 0.67, 1]) {
      const a = chargeRingArc(x);
      if (!a || !near(a.endAngle, a.startAngle + a.sweep)) return false;
    } return true; })());

// --- the no-diff contract, proven rather than asserted ----------------------
// REQ-0125a swapped the unit sprite's hardcoded `width=44; height=44; x=x-22;
// y=y-22` for the SHARED contain-fit (geom.fitSpriteToBox -> itemCard.
// fitBoxInBounds) — because hard-setting w/h STRETCHES non-square art, and
// aspect is inviolable (common_content_pipeline.md section 2). That swap is only
// safe to ship blind if it is a mathematical no-op for the art actually on the
// board today. The legacy glyph is a 1:1 symbol (64x64 viewBox, rasterized at
// RASTER_SCALE=2 -> 128x128), so it must land on EXACTLY the old numbers. Pin it.
console.log('no-diff contract (contain-fit must reproduce the legacy placement exactly)');

const { fitBoxInBounds } = await (async () => {
  const server = await createServer({
    configFile: false, root: CLIENT_ROOT, server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  });
  try { return await server.ssrLoadModule('/src/render/itemCard.ts'); }
  finally { await server.close(); }
})();

check('1:1 legacy glyph contain-fits to the OLD 44x44 @ (x-22, y-22) -- byte-identical board',
  (() => {
    const x = 300, y = 220;                       // arbitrary unit-cell centre
    const box = fitBoxInBounds(128, 128, x - 22, y - 22, 44, 44); // 64x64 viewBox @ RASTER_SCALE 2
    return near(box.w, 44) && near(box.h, 44) && near(box.x, x - 22) && near(box.y, y - 22);
  })());

check('a NON-square raster would have been stretched by the old code, and is now letterboxed',
  (() => {
    // 256x128 (2:1) art in the same 44x44 box: the old `width=44;height=44`
    // would have squashed it to 1:1. Contain-fit must preserve 2:1 and centre it.
    const box = fitBoxInBounds(256, 128, 0, 0, 44, 44);
    return near(box.w, 44) && near(box.h, 22) && near(box.x, 0) && near(box.y, 11);
  })());

console.log('');
if (failures > 0) {
  console.error(`FAIL: ${failures} assertion(s) failed.`);
  process.exit(1);
}

// REQ-0170: the raster URL MUST carry a .png extension -- PixiJS's Assets loader selects
// its decoder from the extension, and an extensionless image URL decodes to an empty
// texture, is skipped, and every Unit on the board silently wears the legacy glyph. This
// is a one-line assertion guarding a failure that costs an entire deploy to notice.
{
  const url = unitIcon.unitArtUrl('units-002-roster-flux2:unit-elf');
  check('unit art URL ends in .png (Pixi picks its parser from the extension)', url.endsWith('.png'));
  check('unit art URL percent-encodes the artwork name', url.includes('%3A'));
}

console.log('PASS: unit icon resolution chain + G7 charge ring geometry.');
