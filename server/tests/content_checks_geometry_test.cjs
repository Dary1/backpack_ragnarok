'use strict';
// server/tests/content_checks_geometry_test.cjs -- REQ-0188 gates G1/G3/G4 (DB-free).
//
// The art-authoritative cell-geometry machinery pinned against FIXTURES, so the
// transpose that manufactured REQ-0029's fake "stale art" crisis cannot come back:
//   G1  the drift guard AGREEs when def==art and FAILs (naming BOTH sides in BOTH
//       spellings) when they disagree.
//   G3  seed (def->art) and derive (art->def) are INVERSES: derive(seed(g)) == g,
//       so the mirror is a no-op BY CONSTRUCTION on content that is already in sync.
//   G4  THE TRANSPOSE. Every fixture below is NON-SQUARE (a square proves nothing);
//       feeding the transposed spelling to the guard must FAIL. All four spellings
//       are exercised: monster {w,h} / footprint [fh,fw]; po {mask} / shape [[r,c]].
const assert = require('assert');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const cc = require(path.join(REPO, 'server', 'services', 'content_checks.cjs'));
const seed = require(path.join(REPO, 'tools', 'seed_artwork_from_def.cjs'));
const derive = require(path.join(REPO, 'tools', 'derive_def_geometry.cjs'));

let pass = 0, fail = 0;
function T(name, fn) { const __t0 = Date.now(); try { fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }
const normSet = (cells) => cc._normCellSet(cells);
const setEq = (a, b) => cc._setEq(a, b);
const arrEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const transposeCells = (cells) => cells.map((c) => [c[1], c[0]]);

// The artwork ROW a def geometry seeds (def->art), reused as the fixtures' authority.
const monArt = (footprint) => seed.artworkRowFromDef('monster_def', { id: 'x', name: 'X', footprint });
const poArt = (shape) => seed.artworkRowFromDef('po_def', { id: 'x', name: 'X', shape });

// ---- G1: the guard AGREEs on sync, FAILs on drift (both sides, both spellings) ----

T('G1 monster: footprint [4,3] AGREEs with art {w:3,h:4} (the transpose)', () => {
  const r = cc.checkArtworkGeometry('monster_def', { footprint: [4, 3] }, { shape: { w: 3, h: 4 } });
  assert.strictEqual(r.applicable, true); assert.strictEqual(r.ok, true, r.detail);
});
T('G1 monster: footprint [3,4] (transposed) DISAGREEs and names BOTH spellings', () => {
  const r = cc.checkArtworkGeometry('monster_def', { footprint: [3, 4] }, { shape: { w: 3, h: 4 } });
  assert.strictEqual(r.ok, false, 'must flag the transposed footprint');
  assert.ok(/footprint/.test(r.detail) && /w":3,"h":4|w,h/.test(r.detail), 'detail names def footprint AND artwork {w,h}: ' + r.detail);
});
T('G1 po: shape [[0,0],[1,0]] AGREEs with the matching mask', () => {
  const r = cc.checkArtworkGeometry('po_def', { shape: [[0, 0], [1, 0]] }, poArt([[0, 0], [1, 0]]));
  assert.strictEqual(r.ok, true, r.detail);
});
T('G1 po: horizontal shape [[0,0],[0,1]] DISAGREEs with a VERTICAL mask (transpose) naming both', () => {
  const r = cc.checkArtworkGeometry('po_def', { shape: [[0, 0], [0, 1]] }, poArt([[0, 0], [1, 0]]));
  assert.strictEqual(r.ok, false);
  assert.ok(/shape/.test(r.detail) && /mask/.test(r.detail), 'names def shape AND artwork mask: ' + r.detail);
});
T('G1 applicable:false when no artwork (nothing to be authoritative WITH -- honest n/a)', () => {
  const r = cc.checkArtworkGeometry('monster_def', { footprint: [1, 1] }, null);
  assert.strictEqual(r.applicable, false); assert.strictEqual(r.ok, true);
});
T('G1 applicable:false for a kind with no cell geometry (si_def)', () => {
  const r = cc.checkArtworkGeometry('si_def', { slot: 'edge' }, { shape: { w: 1, h: 1 } });
  assert.strictEqual(r.applicable, false);
});
T('G1 a linked artwork but an UNREADABLE def geometry FAILs (drift, not a free pass)', () => {
  const r = cc.checkArtworkGeometry('monster_def', { /* no footprint */ }, { shape: { w: 3, h: 4 } });
  assert.strictEqual(r.applicable, true); assert.strictEqual(r.ok, false);
});

// ---- G3 + G4: seed<->derive are inverses across NON-SQUARE fixtures (all 4 spellings) ----

const MON_FIXTURES = [[4, 3], [6, 4], [1, 3], [3, 1], [2, 5], [12, 1], [10, 7]];
for (const fp of MON_FIXTURES) {
  T('G3/G4 monster footprint ' + JSON.stringify(fp) + ': seed->{w,h}->derive == footprint; transpose FAILs', () => {
    const art = monArt(fp);
    // seed direction (def->art): {w,h} = {w:fw, h:fh}
    assert.deepStrictEqual([art.shape.w, art.shape.h], [fp[1], fp[0]], 'seed transpose');
    // derive direction (art->def): [h,w] == original footprint
    const back = derive.defGeomFromArtwork('monster_def', art.shape);
    assert.ok(arrEq(back, fp), 'derive(seed(fp)) must equal fp: got ' + JSON.stringify(back));
    // the guard confirms agreement...
    assert.strictEqual(cc.checkArtworkGeometry('monster_def', { footprint: fp }, art).ok, true);
    // ...and the TRANSPOSED footprint fails (non-square => really different)
    const tfp = [fp[1], fp[0]];
    const expectFail = fp[0] !== fp[1];
    assert.strictEqual(cc.checkArtworkGeometry('monster_def', { footprint: tfp }, art).ok, !expectFail,
      'transposed footprint ' + JSON.stringify(tfp) + ' agreement should be ' + !expectFail);
  });
}

const PO_FIXTURES = [
  [[0, 0], [1, 0]],                    // 2x1 vertical bar
  [[0, 0], [0, 1]],                    // 1x2 horizontal bar
  [[0, 0], [1, 0], [1, 1]],            // L (non-square bbox)
  [[0, 1], [1, 0], [1, 1]],            // beast_jaw corner
  [[0, 0], [1, 0], [2, 0]],            // 3x1 tall
  [[0, 0], [0, 1], [0, 2]],            // 1x3 wide
  [[0, 0], [1, 0], [1, 1], [2, 1]],    // S/Z tetromino
];
for (const sh of PO_FIXTURES) {
  T('G3/G4 po shape ' + JSON.stringify(sh) + ': seed->mask->derive == shape (as cell-set); transpose FAILs', () => {
    const art = poArt(sh);
    // derive direction (art->def): active mask cells (row-major, normalized)
    const back = derive.defGeomFromArtwork('po_def', art.shape);
    assert.ok(setEq(normSet(back), normSet(sh)), 'derive(seed(shape)) cell-set must equal shape: got ' + JSON.stringify(back));
    // guard agrees on the round-trip
    assert.strictEqual(cc.checkArtworkGeometry('po_def', { shape: sh }, art).ok, true);
    // the TRANSPOSED shape (swap r<->c) fails whenever the bbox is non-square
    const tsh = transposeCells(sh);
    const expectFail = !setEq(normSet(sh), normSet(tsh));
    assert.strictEqual(cc.checkArtworkGeometry('po_def', { shape: tsh }, art).ok, !expectFail,
      'transposed shape agreement should be ' + !expectFail + ' for ' + JSON.stringify(tsh));
  });
}

T('G4 the transpose is REAL: a non-square monster seeds an ASYMMETRIC {w,h}', () => {
  const art = monArt([4, 3]);
  assert.notStrictEqual(art.shape.w, art.shape.h, '{w,h} must be asymmetric for a non-square footprint');
  assert.deepStrictEqual(derive.defGeomFromArtwork('monster_def', art.shape), [4, 3]);
  assert.deepStrictEqual(derive.defGeomFromArtwork('monster_def', { w: 4, h: 3 }), [3, 4], '{w:4,h:3} -> [3,4], NOT [4,3]');
});

// ---- derive surgical write: changes ONLY the target field, preserves the rest ----

T('derive surgical replace changes only the named entity+field (neighbors untouched)', () => {
  const raw = '{ "entries": [ {"id":"a","footprint":[1, 1]}, {"id":"b","footprint":[3, 3]} ] }';
  const rep = derive.replaceGeomField(raw, 'a', 'footprint', 'monster_def', [4, 3]);
  assert.strictEqual(rep.ok, true);
  assert.ok(/"id":"a","footprint":\[4, 3\]/.test(rep.text), 'a updated: ' + rep.text);
  assert.ok(/"id":"b","footprint":\[3, 3\]/.test(rep.text), 'b untouched');
});
T('derive surgical replace on a nested po shape array captures the balanced brackets', () => {
  const raw = '{"entries":[{"id":"p","shape":[[0,0],[0,1]],"icon":"x"}]}';
  const rep = derive.replaceGeomField(raw, 'p', 'shape', 'po_def', [[0, 0], [1, 0]]);
  assert.strictEqual(rep.ok, true);
  assert.ok(/"shape":\[\[0, 0\], \[1, 0\]\],"icon":"x"/.test(rep.text), 'shape replaced, icon intact: ' + rep.text);
});

console.log('\nREQ-0188 geometry: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);


// ---- REQ-0334: per-test timing ----------------------------------------
// Hoisted on purpose: these suites call their T()/AT() at module scope, so a
// `const` binding declared down here would be in the temporal dead zone when
// the first tests run. `var` + `function` hoist to the top of the module, and
// the require is deferred to the first call so it never runs ahead of a
// harness's own os.homedir()/env setup. See tools/lib/test_clock.cjs.
var __clock;
function clk(name, t0) {
  return (__clock || (__clock = require('../../tools/lib/test_clock.cjs')(__filename))).clk(name, t0);
}
