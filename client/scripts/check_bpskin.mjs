#!/usr/bin/env node
// client/scripts/check_bpskin.mjs -- REQ-0126 gate. Exercises the REAL modules
// (client/src/board/skin/*.ts) from plain Node via vite ssrLoadModule (same rig
// as check_unit_icon.mjs): autotile resolver, bpskin/1 registry + validator,
// resolution chain, deterministic compositor + machine checks. Exit 0 = green.
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(__dirname, '..');
const REPO = path.resolve(CLIENT, '..');
let fails = 0;
function ok(c, m) { if (!c) { console.error('FAIL:', m); fails++; } else { console.log('ok  :', m); } }
function eq(a, b, m) { ok(a === b, `${m} (got ${a}, want ${b})`); }
async function main() {
  const server = await createServer({ root: CLIENT, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const at = await server.ssrLoadModule('/src/board/skin/autotile.ts');
    const reg = await server.ssrLoadModule('/src/board/skin/skinRegistry.ts');
    const res = await server.ssrLoadModule('/src/board/skin/bpSkinResolve.ts');
    const comp = await server.ssrLoadModule('/src/board/skin/composite.ts');
    const chk = await server.ssrLoadModule('/src/board/skin/checks.ts');
    const h1 = at.tileHistogram(at.resolveAutotile([[2, 2]]));
    eq(h1.outer, 4, '1x1 has 4 outer corners'); eq(h1.interior, 0, '1x1 has 0 interior');
    const hI = at.tileHistogram(at.resolveAutotile([[2, 2], [2, 3], [2, 4]]));
    eq(hI.outer, 4, 'I-tromino 4 outer'); eq(hI.inner, 0, 'I-tromino 0 inner');
    const hL = at.tileHistogram(at.resolveAutotile([[2, 2], [2, 3], [3, 2]]));
    eq(hL.inner, 1, 'L-tromino 1 inner (concave) corner'); eq(hL.outer, 5, 'L-tromino 5 outer');
    const hH = at.tileHistogram(at.resolveAutotile([[2, 2], [2, 3], [2, 4], [3, 2], [3, 4], [4, 2], [4, 3], [4, 4]]));
    eq(hH.inner, 4, 'holed 3x3 ring 4 inner corners (the hole)');
    ok(at.resolveAutotile([[2, 2]]).length === 4, 'resolver total: 4 quadrants/cell');
    const defsDoc = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_bpskins.json'), 'utf8'));
    const defs = reg.loadSkinDefs(defsDoc);
    ok(defs['neutral'] && reg.isNeutral(defs['neutral']), 'neutral default registered + flagged');
    ok(defs['devornate'] && !reg.isNeutral(defs['devornate']), 'dev ornate registered');
    ok(defs['devornate'].corner_radius > 0, 'dev ornate has rounded corners (mandatory)');
    ok(reg.validateSkinDef(defs['neutral']).ok, 'neutral passes validation');
    ok(!reg.validateSkinDef({ kind: 'bpskin/1', id: 'x' }).ok, 'malformed def rejected');
    ok(!reg.validateSkinDef({ kind: 'wrong/1', id: 'x', name: 'x', palette: { fill: '#112233' }, corner_radius: 0, border_band: 0 }).ok, 'wrong kind rejected');
    const has = (id) => id in defs;
    // REQ-0266 (item 33): this block pinned the OLD 4-rung chain and is updated
    // DELIBERATELY -- the REQ that inserts the rung is the one that moves the
    // gate. The chain is now FIVE rungs:
    //   instance -> profile -> set -> neutral -> plain
    // `profile` (the player's own pick, GET /api/profile/:id/skins) and `set`
    // (the def-declared default) are genuinely different questions: the server's
    // resolveSkinPrefs carries EXPLICIT picks only and never injects defaults, so
    // collapsing them would make the reported rung a lie -- and reporting WHICH
    // rung fired is the entire reason this resolver exists. One case per rung,
    // plus the fall-throughs that prove a rung is taken only when its id is both
    // DECLARED and AVAILABLE.
    eq(res.resolveBpSkin({ instanceSkinId: 'devornate' }, has).rung, 'instance', 'instance slot wins');
    eq(res.resolveBpSkin({ instanceSkinId: 'devornate', profileSkinId: 'neutral', unitSetSkinId: 'neutral' }, has).rung, 'instance', 'instance still wins with profile AND set present');
    eq(res.resolveBpSkin({ profileSkinId: 'devornate', unitSetSkinId: 'neutral' }, has).rung, 'profile', 'profile pick beats the def default');
    eq(res.resolveBpSkin({ profileSkinId: 'devornate', unitSetSkinId: 'neutral' }, has).skinId, 'devornate', 'profile rung yields the PICKED id');
    eq(res.resolveBpSkin({ unitSetSkinId: 'devornate' }, has).rung, 'set', 'set skin when the player never picked');
    eq(res.resolveBpSkin({ profileSkinId: null, unitSetSkinId: 'devornate' }, has).rung, 'set', 'a null pick (never chose) falls through to the def default');
    eq(res.resolveBpSkin({ profileSkinId: 'ghost', unitSetSkinId: 'devornate' }, has).rung, 'set', 'a pick for a skin that no longer exists falls through to the def default');
    eq(res.resolveBpSkin({ profileSkinId: '' }, has).rung, 'neutral', 'an empty-string pick is not a skin');
    eq(res.resolveBpSkin({}, has).rung, 'neutral', 'neutral default when nothing set');
    eq(res.resolveBpSkin({ instanceSkinId: 'ghost' }, has).rung, 'neutral', 'missing instance skin -> neutral (never blocks)');
    eq(res.resolveBpSkin({ profileSkinId: 'ghost', unitSetSkinId: 'ghost' }, has).rung, 'neutral', 'pick AND default both unresolvable -> neutral');
    // A BP with no `unit` has nothing to key on, so BoardRenderer.ts passes
    // neither a profile nor a set id. This IS that call, and it must land on
    // neutral -- exactly as it did before the profile rung existed.
    eq(res.resolveBpSkin({ instanceSkinId: null, profileSkinId: null, unitSetSkinId: null }, has).rung, 'neutral', 'a BP with NO UNIT (no profile id, no set id) lands on neutral');
    eq(res.resolveBpSkin({}, () => false).rung, 'plain', 'plain when even neutral absent');
    eq(res.resolveBpSkin({}, () => false).skinId, null, 'plain rung yields a null skin id');
    eq(res.resolveBpSkin({}, has).skinId, 'neutral', 'neutral rung yields neutral id');
    const RUNGS = [
      ['instance', { instanceSkinId: 'devornate' }],
      ['profile', { profileSkinId: 'devornate' }],
      ['set', { unitSetSkinId: 'devornate' }],
      ['neutral', {}],
    ];
    ok(RUNGS.every(([want, q]) => res.resolveBpSkin(q, has).rung === want) && res.resolveBpSkin({}, () => false).rung === 'plain',
      'all FIVE rungs reachable, in order: instance -> profile -> set -> neutral -> plain');
    const FIVE = new Set(['instance', 'profile', 'set', 'neutral', 'plain']);
    ok([{}, { instanceSkinId: undefined }, { profileSkinId: 0 }, { unitSetSkinId: [] }, { profileSkinId: 'ghost' }, { profileSkinId: 'devornate' }]
      .every((q) => { const r = res.resolveBpSkin(q, has); return FIVE.has(r.rung) && (r.skinId === null || typeof r.skinId === 'string'); }),
      'resolver is TOTAL: every query (hostile included) yields one of the five rungs, never throws');
    const shapes = [
      { n: '1x1', cells: [[2, 2]] },
      { n: 'L-tromino', cells: [[2, 2], [2, 3], [3, 2]] },
      { n: 'holed', cells: [[2, 2], [2, 3], [2, 4], [3, 2], [3, 4], [4, 2], [4, 3], [4, 4]] },
    ];
    for (const s of shapes) for (const skinId of ['neutral', 'devornate']) {
      const c = comp.compositeSkin(s.cells, defs[skinId], '#14181f');
      const rep = chk.checkComposite(c, s.cells, defs[skinId], 1);
      for (const f of rep.findings) if (!f.ok) console.error('  finding', f.check, f.detail);
      ok(rep.pass, `composite+checks green: ${s.n} / ${skinId}`);
    }
    const a = comp.compositeSkin([[2, 2], [2, 3]], defs['devornate'], '#14181f');
    const b = comp.compositeSkin([[2, 2], [2, 3]], defs['devornate'], '#14181f');
    ok(Buffer.compare(Buffer.from(a.rgba), Buffer.from(b.rgba)) === 0, 'compositor deterministic (byte-identical)');
    // REQ-0266 -- THE BOARD PAINT GUARD. board/skin/bpSkinTexture.ts's
    // bpSkinSprite() needs a DOM and cannot be driven from here, but the
    // predicate it is gated on is pure and lives in composite.ts, so THAT is
    // pinned here. The rule: only a skin with REAL ART paints on the board.
    // `neutral` is always registered so resolveBpSkin lands on a def for every
    // BP, every derived unit_skin def inherits neutral's palette, and a
    // composite body is opaque above gBase -- so a guard keyed on anything else
    // repaints every BP on both boards in flat #2b3240 and buries the per-BP
    // colour tint. That happened; this is the assertion that would have caught
    // it. Regression fixed 2026-07-19.
    ok(!comp.declaresFillTexture(defs['neutral']), 'neutral declares NO fill texture -> never paints on the board');
    ok(!comp.declaresFillTexture(defs['devornate']), 'an authored palette-only skin declares no fill texture either');
    const demoUnitSkins = { uskin_bp_demo: { id: 'uskin_bp_demo', name: 'Demo', slot: 'bpskin', art_ref: 'bpskin_unit_demo', units: ['demo'], default: true } };
    const derivedNoArt = reg.loadSkinDefs(defsDoc, { unitSkins: demoUnitSkins, artUrls: {} })['uskin_bp_demo'];
    const derivedArt = reg.loadSkinDefs(defsDoc, { unitSkins: demoUnitSkins, artUrls: { uskin_bp_demo: '/api/art/bpskin_unit_demo.png' } })['uskin_bp_demo'];
    ok(derivedNoArt && !comp.declaresFillTexture(derivedNoArt), 'a derived skin whose artwork is NOT adopted declares no fill texture -> never paints (D5: absence is the normal case)');
    ok(derivedArt && comp.declaresFillTexture(derivedArt), 'a derived skin WITH an adopted artwork declares its fill texture -> paints');
    // ...and the OFFLINE path is unaffected: a PNG wants a solid body, so an
    // art-less def still composites here. Only the BOARD suppresses it.
    ok(comp.compositeSkin([[2, 2]], derivedNoArt, '#14181f').rgba.length === 3 * 3 * 48 * 48 * 4, // DEFAULT_PARAMS: cellPx 48, margin 1
      'an art-less derived def still composites OFFLINE at full size -- only the board suppresses it');
    // REQ-0350 -- THE CACHE-KEY GUARD. bpSkinTexture.textureFor() keys its
    // texture cache on the cell set NORMALISED to its own origin, so every
    // translation of one shape shares a single entry. That is only sound while
    // the compositor is translation-INVARIANT, and while r0/c0 really are the
    // cell set's own mins (textureFor computes them itself, to serve both the
    // key and the sprite's board placement). Neither property is stated
    // anywhere in composite.ts's signature -- they are consequences of how it
    // happens to derive its frame -- so a future edit could quietly break the
    // cache into serving a correct-looking texture for the wrong shape. These
    // two assertions are what make that edit fail here instead.
    for (const [label, cells, shift] of [
      ['1x1', [[2, 2]], [4, 3]],
      ['1x2', [[2, 2], [2, 3]], [1, 5]],
      ['L-tromino', [[2, 2], [2, 3], [3, 2]], [3, 1]],
      ['holed', [[2, 2], [2, 3], [2, 4], [3, 2], [3, 4], [4, 2], [4, 3], [4, 4]], [2, 2]],
    ]) {
      const moved = cells.map(([r, c]) => [r + shift[0], c + shift[1]]);
      const at = comp.compositeSkin(cells, defs['devornate'], '#14181f');
      const bt = comp.compositeSkin(moved, defs['devornate'], '#14181f');
      ok(at.width === bt.width && at.height === bt.height,
        `translation-invariant extent: ${label}`);
      ok(Buffer.compare(Buffer.from(at.rgba), Buffer.from(bt.rgba)) === 0,
        `translation-invariant pixels: ${label} (this is what lets textureFor share one cache entry across positions)`);
      ok(Buffer.compare(Buffer.from(at.layer), Buffer.from(bt.layer)) === 0,
        `translation-invariant layer map: ${label}`);
      // ...and the ONLY thing that moves is the origin, which is exactly what
      // textureFor returns per call rather than reading off the cached entry.
      ok(bt.r0 === at.r0 + shift[0] && bt.c0 === at.c0 + shift[1],
        `origin tracks the translation: ${label}`);
      ok(at.r0 === Math.min(...cells.map((x) => x[0])) && at.c0 === Math.min(...cells.map((x) => x[1])),
        `r0/c0 ARE the cell set's own mins: ${label} (textureFor recomputes them and must agree)`);
    }
    // A different SHAPE with the same cell COUNT must not collide, or the
    // normalisation would be over-eager rather than merely position-blind.
    const iTrom = comp.compositeSkin([[2, 2], [2, 3], [2, 4]], defs['devornate'], '#14181f');
    const lTrom = comp.compositeSkin([[2, 2], [2, 3], [3, 2]], defs['devornate'], '#14181f');
    ok(iTrom.width !== lTrom.width || iTrom.height !== lTrom.height ||
       Buffer.compare(Buffer.from(iTrom.rgba), Buffer.from(lTrom.rgba)) !== 0,
      'same cell count, different shape -> different composite (normalisation is position-blind, not shape-blind)');
    // The key builder itself, mirrored here in one line so the canonical form is
    // pinned as DATA: two translations agree, two shapes do not.
    const keyOf = (cs) => { const r0 = Math.min(...cs.map((x) => x[0])), c0 = Math.min(...cs.map((x) => x[1])); return cs.map((x) => (x[0] - r0) + ',' + (x[1] - c0)).sort().join(';'); };
    eq(keyOf([[2, 2], [2, 3], [3, 2]]), keyOf([[5, 8], [5, 9], [6, 8]]), 'normalised key: translations collapse');
    ok(keyOf([[2, 2], [2, 3], [2, 4]]) !== keyOf([[2, 2], [2, 3], [3, 2]]), 'normalised key: distinct shapes stay distinct');
  } finally { await server.close(); }
  if (fails) { console.error(`\n${fails} assertion(s) FAILED`); process.exit(1); }
  console.log('\ncheck_bpskin: ALL GREEN');
}
main().catch((e) => { console.error(e); process.exit(1); });
