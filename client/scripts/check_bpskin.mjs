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
    // -----------------------------------------------------------------------
    // REQ-0291 gate A -- the nearest-feature EDT (composite.ts nearestFeatureEDT,
    // the scipy distance_transform_edt(return_indices=True) port) property-checked
    // against a brute-force nearest-feature scan. Distances are exact, so we assert
    // the returned feature IS a feature and sits at the minimum squared distance
    // (a tie may pick a different equal-distance feature -- that is allowed).
    const bruteMinD2 = (mask, W, H, x, y) => {
      let best = Infinity;
      for (let fy = 0; fy < H; fy++) for (let fx = 0; fx < W; fx++) if (mask[fy * W + fx]) { const d2 = (fx - x) * (fx - x) + (fy - y) * (fy - y); if (d2 < best) best = d2; }
      return best;
    };
    const edtMasks = [
      { W: 5, H: 5, feats: [[2, 2]] },
      { W: 6, H: 4, feats: [[0, 0], [5, 3]] },
      { W: 7, H: 7, feats: [[3, 0], [0, 3], [6, 6]] },
      { W: 8, H: 5, feats: [[1, 1], [6, 1], [3, 4]] },
      { W: 9, H: 9, feats: [[4, 4], [0, 8], [8, 0]] },
    ];
    let edtOk = true, edtChecked = 0;
    for (const m of edtMasks) {
      const mask = new Uint8Array(m.W * m.H);
      for (const [fx, fy] of m.feats) mask[fy * m.W + fx] = 1;
      const r = comp.nearestFeatureEDT(mask, m.W, m.H);
      for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
        const i = y * m.W + x; edtChecked++;
        const iy = r.iy[i], ix = r.ix[i];
        const isFeat = mask[iy * m.W + ix] === 1;
        const d2 = (ix - x) * (ix - x) + (iy - y) * (iy - y);
        const want = bruteMinD2(mask, m.W, m.H, x, y);
        const distOk = Math.abs(r.dist[i] * r.dist[i] - want) < 1e-6;
        if (!isFeat || d2 !== want || !distOk) { edtOk = false; }
      }
    }
    ok(edtOk, `nearestFeatureEDT: ${edtChecked} cells return a true nearest feature at the exact min distance (brute-force parity)`);
    // -----------------------------------------------------------------------
    // REQ-0291 gate B -- the synthetic-band golden. A frame band whose strips
    // encode depth analytically (top/bottom = "H family", R ramps outer->inner;
    // left/right = "V family", B ramps outer->inner) over a green interior. Every
    // ring pixel must sample a band colour, every interior pixel the interior
    // colour, and the depth ramp must be monotone on all four straight edges.
    const BAND = 60, TILEW = 160;
    const RAMP = (d) => 40 + d * 3;                 // 40..217 over depth 0..59
    const fillRaster = { width: TILEW, height: TILEW, rgba: new Uint8ClampedArray(TILEW * TILEW * 4) };
    for (let i = 0; i < TILEW * TILEW; i++) { fillRaster.rgba[i * 4] = 0; fillRaster.rgba[i * 4 + 1] = 200; fillRaster.rgba[i * 4 + 2] = 0; fillRaster.rgba[i * 4 + 3] = 255; }
    const LH = 64, LV = 64;
    const stripH = { width: LH, height: BAND, rgba: new Uint8ClampedArray(LH * BAND * 4) };
    for (let d = 0; d < BAND; d++) for (let a = 0; a < LH; a++) { const o = (d * LH + a) * 4; stripH.rgba[o] = RAMP(d); stripH.rgba[o + 1] = 10; stripH.rgba[o + 2] = 0; stripH.rgba[o + 3] = 255; }
    const stripV = { width: BAND, height: LV, rgba: new Uint8ClampedArray(BAND * LV * 4) };
    for (let a = 0; a < LV; a++) for (let d = 0; d < BAND; d++) { const o = (a * BAND + d) * 4; stripV.rgba[o] = 0; stripV.rgba[o + 1] = 10; stripV.rgba[o + 2] = RAMP(d); stripV.rgba[o + 3] = 255; }
    const frame = { stripH, stripV, frameBandPx: BAND };
    const bandDef = { kind: 'bpskin/1', id: 'synthband', name: 'Synth Band', palette: { canvas: '#000000', fill: '#00c800', welt: '#00c800' }, corner_radius: 0, border_band: 3, art: { fill_texture: 'synthetic://band', frame_band_px: BAND } };
    ok(reg.validateSkinDef(bandDef).ok, 'synthetic band def passes validateSkinDef');
    const isH = (r, g, b) => g === 10 && b === 0 && r >= 40 && r <= 217;   // stripH family
    const isV = (r, g, b) => r === 0 && g === 10 && b >= 40 && b <= 217;   // stripV family
    const isInterior = (r, g, b) => r === 0 && g === 200 && b === 0;
    const bandShapes = [
      { n: 'square3x3', cells: [[2, 2], [2, 3], [2, 4], [3, 2], [3, 3], [3, 4], [4, 2], [4, 3], [4, 4]] },
      { n: 'L', cells: [[2, 2], [2, 3], [3, 2]] },
      { n: 'holed', cells: [[2, 2], [2, 3], [2, 4], [3, 2], [3, 4], [4, 2], [4, 3], [4, 4]] },
    ];
    for (const sh of bandShapes) {
      const c = comp.compositeSkin(sh.cells, bandDef, '#000000', { cellPx: 48, margin: 1 }, fillRaster, frame);
      const W = c.width, H = c.height;
      let ringN = 0, fillN = 0, ringBad = 0, fillBad = 0;
      for (let i = 0; i < W * H; i++) {
        const r = c.rgba[i * 4], g = c.rgba[i * 4 + 1], b = c.rgba[i * 4 + 2];
        if (c.layer[i] === comp.LAYER.welt) { ringN++; if (!(isH(r, g, b) || isV(r, g, b))) ringBad++; }
        else if (c.layer[i] === comp.LAYER.fill || c.layer[i] === comp.LAYER.override) { fillN++; if (!isInterior(r, g, b)) fillBad++; }
      }
      ok(ringN > 0 && ringBad === 0, `${sh.n}: every ring pixel samples a band strip colour (${ringN} ring, ${ringBad} bad)`);
      ok(fillN > 0 && fillBad === 0, `${sh.n}: every interior pixel samples the interior colour (${fillN} fill, ${fillBad} bad)`);
    }
    // Depth ordering outer->inner on all four straight edges of the square.
    {
      const c = comp.compositeSkin(bandShapes[0].cells, bandDef, '#000000', { cellPx: 48, margin: 1 }, fillRaster, frame);
      const W = c.width, H = c.height;
      let minX = W, maxX = 0, minY = H, maxY = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (c.rs[y * W + x]) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      const midX = (minX + maxX) >> 1, midY = (minY + maxY) >> 1;
      const at = (x, y, ch) => c.rgba[(y * W + x) * 4 + ch];
      const isWelt = (x, y) => c.layer[y * W + x] === comp.LAYER.welt;
      // collect a monotone-checked ramp along a scan; ch: 0 = R (H family), 2 = B (V family)
      const scan = (name, seq, ch, family) => {
        const vals = [];
        for (const [x, y] of seq) { if (!isWelt(x, y)) break; const r = at(x, y, 0), g = at(x, y, 1), b = at(x, y, 2); if (!family(r, g, b)) { vals.push(-1); break; } vals.push(at(x, y, ch)); }
        let mono = vals.length >= 2; for (let i = 1; i < vals.length; i++) if (vals[i] < vals[i - 1]) mono = false;
        ok(mono, `depth ramp monotone outer->inner on ${name} (${vals.length} samples: ${vals.slice(0, 6).join(',')}...)`);
      };
      const topSeq = []; for (let y = minY; y <= minY + BAND; y++) topSeq.push([midX, y]);
      const botSeq = []; for (let y = maxY; y >= maxY - BAND; y--) botSeq.push([midX, y]);
      const leftSeq = []; for (let x = minX; x <= minX + BAND; x++) leftSeq.push([x, midY]);
      const rightSeq = []; for (let x = maxX; x >= maxX - BAND; x--) rightSeq.push([x, midY]);
      scan('top edge', topSeq, 0, isH);
      scan('bottom edge', botSeq, 0, isH);
      scan('left edge', leftSeq, 2, isV);
      scan('right edge', rightSeq, 2, isV);
    }
    // Determinism of the strip path.
    {
      const a = comp.compositeSkin(bandShapes[0].cells, bandDef, '#000000', { cellPx: 48, margin: 1 }, fillRaster, frame);
      const b = comp.compositeSkin(bandShapes[0].cells, bandDef, '#000000', { cellPx: 48, margin: 1 }, fillRaster, frame);
      ok(Buffer.compare(Buffer.from(a.rgba), Buffer.from(b.rgba)) === 0, 'strip welt path is deterministic (byte-identical)');
    }
  } finally { await server.close(); }
  if (fails) { console.error(`\n${fails} assertion(s) FAILED`); process.exit(1); }
  console.log('\ncheck_bpskin: ALL GREEN');
}
main().catch((e) => { console.error(e); process.exit(1); });
