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
// REQ-0266 (item 32) updated this gate DELIBERATELY, exactly as the comment at
// the `unitIconRasters().length === 0` assertion instructed. REQ-0125a's proof
// was a NO-DIFF one: no unit art and no unit identity in the tree, so every BP
// had to land on the legacy glyph and the board had to be unchanged. REQ-0170
// landed identity + default art and REQ-0266 lands cosmetic skins, so the proof
// is now a BEHAVIOURAL one, and strictly stronger: the raster manifest is a pure
// function of the data handed to setUnitDefs/setUnitSkins, the skinned key form
// `unit:<id>@<skinId>` is emitted exactly when a skin resolves AND its artwork is
// adopted, and all four rungs still fire for the right reasons. Missing art still
// never blocks a draw -- that half was never negotiable and is pinned harder now.
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

// REQ-0266 (item 32). The assertion that used to sit here -- `unitIconRasters()
// .length === 0` -- was REQ-0125a's no-diff proof and its own comment named this
// REQ's predecessors as the ones that should retire it. Retired, deliberately.
// The load-bearing half of it survives and is asserted first below: the manifest
// is a pure function of the DATA, so with nothing set it is still empty and
// nothing is ever invented. Everything after that drives the REAL module-global
// registries the client fills at boot (store/boot.ts:193) and pins what
// BoardRenderer.ts now actually asks for at its single draw site.
console.log('raster manifest (REQ-0266: art arrives as DATA)');

const { setUnitDefs, setUnitSkins, activeUnitSkinKey, activeSkinId, pickedSkinId, defaultSkinId, skinArtUrl } = unitIcon;

// unit_skin/1 fixture. `slot` discriminates (ruling D1): a `bpskin` entry is a
// BACKPACK skin and must never reach the unit-portrait manifest.
const SKIN_DEFS = {
  elf_royal: { id: 'elf_royal', name: 'Royal', slot: 'unit', art_ref: 'aw-royal', units: ['elf'], default: true },
  elf_shadow: { id: 'elf_shadow', name: 'Shadow', slot: 'unit', art_ref: 'aw-shadow', units: ['elf'] },
  orc_unadopted: { id: 'orc_unadopted', name: 'Unadopted', slot: 'unit', art_ref: 'aw-none', units: ['orc'], default: true },
  elf_bag: { id: 'elf_bag', name: 'Bag', slot: 'bpskin', art_ref: 'aw-bag', units: ['elf'], default: true },
};
// art_urls is keyed by SKIN id, never by unit id (ruling D-A). `orc_unadopted`
// is deliberately ABSENT: its artwork was never adopted, which is the documented
// degrade -- no raster, no 404, fall through.
const SKIN_URLS = {
  elf_royal: '/api/art/skin-elf-royal.png',
  elf_shadow: '/api/art/skin-elf-shadow.png',
  elf_bag: '/api/art/skin-elf-bag.png',
};
const UNITS = { elf: { icon: 'units-002:unit-elf' }, orc: { icon: 'units-002:unit-orc' }, ghost: {} };
const keysOf = () => unitIconRasters().map((e) => e.key).sort();

setUnitDefs(null); setUnitSkins(null, null, null);
check('nothing set -> manifest is EMPTY (the surviving half of the old assertion: nothing is invented)',
  unitIconRasters().length === 0);

setUnitDefs(UNITS); setUnitSkins(null, null, null);
check('a unit def with an icon emits its DEFAULT raster key',
  JSON.stringify(keysOf()) === JSON.stringify(['unit:elf', 'unit:orc']));
check('a unit def with NO icon emits nothing (ghost)', !keysOf().includes('unit:ghost'));

setUnitSkins(SKIN_DEFS, SKIN_URLS, null);
check('the SKINNED key form unit:<id>@<skinId> IS emitted for a def-default skin whose art is adopted',
  keysOf().includes('unit:elf@elf_royal'));
check('a skin id absent from art_urls emits NO raster (unadopted artwork degrades, never 404s)',
  !keysOf().some((k) => k.includes('orc_unadopted')));
check('the unit whose only skin is unadopted still emits its own default raster',
  keysOf().includes('unit:orc'));
check('a slot:"bpskin" entry never reaches the UNIT manifest (slot discriminates -- ruling D1)',
  !keysOf().some((k) => k.includes('elf_bag')));
check('exactly ONE skinned key per unit -- the RESOLVED-ACTIVE skin, never the whole corpus',
  keysOf().filter((k) => k.startsWith('unit:elf@')).length === 1);

setUnitSkins(SKIN_DEFS, SKIN_URLS, { unit: { elf: 'elf_shadow' } });
check('a PROFILE pick beats the def default in the emitted manifest',
  keysOf().includes('unit:elf@elf_shadow') && !keysOf().includes('unit:elf@elf_royal'));
check('a pick is re-validated against the defs (a pick for a unit the def never listed reads as ABSENT)',
  (() => { setUnitSkins(SKIN_DEFS, SKIN_URLS, { unit: { orc: 'elf_shadow' } });
    return pickedSkinId('orc', 'unit') === null && activeSkinId('orc', 'unit') === 'orc_unadopted'; })());
check('a pick in the WRONG slot is refused (a bpskin entry picked for the unit slot)',
  (() => { setUnitSkins(SKIN_DEFS, SKIN_URLS, { unit: { elf: 'elf_bag' } });
    return pickedSkinId('elf', 'unit') === null; })());
check('defaultSkinId reads the def-declared default per (unit, SLOT)',
  defaultSkinId('elf', 'unit') === 'elf_royal' && defaultSkinId('elf', 'bpskin') === 'elf_bag');
check('skinArtUrl is sparse -- an unadopted skin simply has no URL',
  skinArtUrl('elf_royal') === SKIN_URLS.elf_royal && skinArtUrl('orc_unadopted') === null);

// activeUnitSkinKey is what BoardRenderer.ts now feeds resolveUnitIcon's `skin`
// rung. It MUST return null -- NOT the default key -- when the unit has no skin,
// or the chain would report rung 'skin' for a unit that has none, and the whole
// point of reporting a rung is that the report is true.
check('activeUnitSkinKey returns NULL (not the default key) when the unit has no skin at all',
  activeUnitSkinKey('ghost') === null && activeUnitSkinKey(null) === null);
check('activeUnitSkinKey returns NULL when the resolved skin has no adopted artwork',
  activeUnitSkinKey('orc') === null);

// --- all four rungs, end to end through the PRODUCTION inputs ---------------
// `has` is built from the manifest the client would ACTUALLY load, so these are
// the rungs a real board takes, not hand-fed keys.
console.log('four rungs, driven end-to-end by the emitted manifest');
setUnitSkins(SKIN_DEFS, SKIN_URLS, { unit: { elf: 'elf_shadow' } });
const loaded = new Set(keysOf().concat([LEGACY_UNIT_GLYPH]));
const draw = (unitId) => resolveUnitIcon(
  { skinKey: activeUnitSkinKey(unitId), defaultKey: unitId ? unitIconKey(unitId) : null },
  (k) => loaded.has(k)
);
check('rung SKIN: a unit with a picked, adopted skin',
  (() => { const r = draw('elf'); return r.rung === 'skin' && r.key === 'unit:elf@elf_shadow'; })());
check('rung DEFAULT: a unit whose only skin is unadopted falls to its own icon',
  (() => { const r = draw('orc'); return r.rung === 'default' && r.key === 'unit:orc'; })());
check('rung LEGACY: a unit with no skin and no icon -- board unchanged, as it always was',
  (() => { const r = draw('ghost'); return r.rung === 'legacy' && r.key === LEGACY_UNIT_GLYPH; })());
check('rung PLACEHOLDER: no sprite sheet at all -- the board still renders',
  (() => { const r = resolveUnitIcon({ skinKey: activeUnitSkinKey('elf'), defaultKey: unitIconKey('elf') }, () => false);
    return r.rung === 'placeholder' && r.key === null; })());
check('every emitted raster URL ends in .png (Pixi picks its parser from the extension)',
  unitIconRasters().every((e) => e.url.endsWith('.png')));

// Leave the module globals as a client with no content would leave them.
setUnitDefs(null); setUnitSkins(null, null, null);
check('registries reset cleanly -> manifest empty again (both setters total + idempotent)',
  unitIconRasters().length === 0);

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
