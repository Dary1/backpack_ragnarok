#!/usr/bin/env node
// client/scripts/bpskin_harness.mjs -- REQ-0126 S3 VALIDATION HARNESS (pipeline
// doc S3, spec item 5). A MACHINE GATE (UGC-ready, Nightmare Forge validator
// discipline): composites the FULL skin stack over the validation shape suite
// (1x1, I, L, T, S, Z, inner-corner, holed) on contrasting canvas backgrounds
// for both dev skins, runs the machine checks (seams, leakage, coverage,
// rounded-corner blend, hole integrity), emits a screenshot grid (fit-report
// pattern) + verdict, and proves DETERMINISM two ways: every composite is
// rendered twice and must be byte-identical, and a stored golden hash pins the
// whole grid so a re-run on the same input is byte-stable.
//
// REQ-0266 (item 34): the suite gained a THIRD skin, `devraster` -- `devornate`
// with a fill_texture declared, composited against a raster this file BUILDS
// procedurally (no asset on disk, no fetch, no DOM: the harness stays hermetic
// and byte-deterministic). Until now both dev skins declared no fill_texture, so
// the golden did NOT move when REQ-0266 added the raster path to composite.ts.
// That was a correct proof that the palette path was untouched -- and it also
// meant the raster path had ZERO coverage here. It now gets the same 8 shapes x
// 3 backgrounds the palette path gets: 72 composites, up from 48. The golden
// moved from
//   6b024c0722319cc900b7ef59dc97a2521957bd992299ba99ab8604d5b8d3e048   (48, palette only)
// to
//   0944dbd9cefc866f7ebec1cd3f8710a8c26a95bf65de9c4d64517ecd888855a0   (72, palette + raster)
//   node scripts/bpskin_harness.mjs            # gate (strict compare to golden)
//   node scripts/bpskin_harness.mjs --update   # (re)write the golden hash
// vite ssrLoadModule (as check_bpskin.mjs); PNG via Node zlib only (no deps).
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(__dirname, '..');
const REPO = path.resolve(CLIENT, '..');
const UPDATE = process.argv.includes('--update');
const GOLDEN = path.join(CLIENT, 'scripts', 'bpskin_harness.golden.json');
const GOLDEN_NOTE = 'REQ-0126 bpskin harness golden -- regenerate with --update.'
  + ' REQ-0266 (item 34) added the synthetic textured skin `devraster`, taking the grid from 48 to 72'
  + ' composites and giving composite.ts\'s raster path its first coverage here; the pre-REQ-0266'
  + ' palette-only hash was 6b024c0722319cc900b7ef59dc97a2521957bd992299ba99ab8604d5b8d3e048.';
const OUTDIR = path.join(REPO, 'web', 'preview', 'bpskins-req0126');
const SUITE = [
  { n: '1x1', cells: [[2, 2]], comps: 1 },
  { n: 'I', cells: [[2, 2], [2, 3], [2, 4]], comps: 1 },
  { n: 'L', cells: [[2, 2], [3, 2], [4, 2], [4, 3]], comps: 1 },
  { n: 'T', cells: [[2, 2], [2, 3], [2, 4], [3, 3]], comps: 1 },
  { n: 'S', cells: [[3, 2], [3, 3], [2, 3], [2, 4]], comps: 1 },
  { n: 'Z', cells: [[2, 2], [2, 3], [3, 3], [3, 4]], comps: 1 },
  { n: 'inner_corner', cells: [[2, 2], [2, 3], [3, 2]], comps: 1 },
  { n: 'holed', cells: [[2, 2], [2, 3], [2, 4], [3, 2], [3, 4], [4, 2], [4, 3], [4, 4]], comps: 1 },
];
const BGS = ['#14181f', '#e8e2d0', '#7a8a99'];
const SYNTH_SKIN = 'devraster';
const SKINS = ['neutral', 'devornate', SYNTH_SKIN];
/** REQ-0266 (item 34). 32px period, deliberately NOT the 48px cell size:
 * composite.ts tiles in COMPOSITE space so a multi-cell BP wears ONE continuous
 * texture, and a compositor that regressed to per-CELL tiling would break the
 * diagonal stripe at every cell border -- visibly in grid.png, and mechanically
 * in the tiling-continuity assertion below. Pure integer math, so the tile is
 * byte-identical on every run and on every machine. */
const TILE = 32;
function synthTile() {
  const rgba = new Uint8ClampedArray(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const o = (y * TILE + x) * 4;
    const checker = ((((x >> 3) + (y >> 3)) & 1) === 1);
    const ramp = (((x + y) * 255) / (2 * TILE - 2)) | 0;
    let c = checker ? [168, 128, 79] : [92, 68, 48];
    if ((x + y) % TILE < 3) c = [245, 226, 160]; // seam-detector stripe
    rgba[o] = Math.min(255, c[0] + (ramp >> 3));
    rgba[o + 1] = Math.min(255, c[1] + (ramp >> 3));
    rgba[o + 2] = Math.min(255, c[2] + (ramp >> 3));
    rgba[o + 3] = 255;
  }
  return { width: TILE, height: TILE, rgba };
}
const RASTERS = { [SYNTH_SKIN]: synthTile() };
let CRC;
function crc32(buf) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}
function u32(n) { return Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }
function pngChunk(type, data) { const t = Buffer.from(type, 'ascii'); const body = Buffer.concat([t, data]); return Buffer.concat([u32(data.length), body, u32(crc32(body))]); }
function encodePNG(W, H, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.concat([u32(W), u32(H), Buffer.from([8, 6, 0, 0, 0])]);
  const stride = W * 4; const raw = Buffer.alloc((stride + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (stride + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}
function sha(buf) { return crypto.createHash('sha256').update(Buffer.from(buf)).digest('hex'); }
async function main() {
  const server = await createServer({ root: CLIENT, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  let failures = [];
  try {
    const comp = await server.ssrLoadModule('/src/board/skin/composite.ts');
    const chk = await server.ssrLoadModule('/src/board/skin/checks.ts');
    const reg = await server.ssrLoadModule('/src/board/skin/skinRegistry.ts');
    const defs = reg.loadSkinDefs(JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_bpskins.json'), 'utf8')));
    // REQ-0266 (item 34): derive the textured skin FROM `devornate`, so the only
    // difference between the two is the fill -- same corner_radius, same
    // border_band, same welt colour. That is what makes the side-by-side columns
    // in grid.png a real comparison, and it is how the welt/edge treatment gets
    // proven to survive the raster path. It still goes through validateSkinDef:
    // a def this harness invents faces the same machine gate a UGC def would.
    if (defs['devornate']) {
      defs[SYNTH_SKIN] = { ...defs['devornate'], id: SYNTH_SKIN, name: 'Dev Raster', neutral: false, set: 'dev', art: { fill_texture: 'synthetic://devraster' } };
      if (!reg.validateSkinDef(defs[SYNTH_SKIN]).ok) failures.push('synthetic textured skin failed validateSkinDef');
    }
    for (const id of SKINS) if (!defs[id]) failures.push(`missing skin def: ${id}`);
    const params = { cellPx: 48, margin: 1 };
    const grid = []; const hashParts = [];
    for (const shape of SUITE) {
      const rowCells = [];
      for (const skinId of SKINS) for (const bg of BGS) {
        const def = defs[skinId];
        const raster = RASTERS[skinId] || null;
        const c1 = comp.compositeSkin(shape.cells, def, bg, params, raster);
        const c2 = comp.compositeSkin(shape.cells, def, bg, params, raster);
        if (sha(c1.rgba) !== sha(c2.rgba)) failures.push(`determinism ${shape.n}/${skinId}/${bg}`);
        const rep = chk.checkComposite(c1, shape.cells, def, shape.comps);
        if (!rep.pass) for (const f of rep.findings) if (!f.ok) failures.push(`${shape.n}/${skinId}/${bg} ${f.check}: ${f.detail}`);
        hashParts.push(sha(c1.rgba));
        rowCells.push({ rgba: c1.rgba, W: c1.width, H: c1.height });
      }
      grid.push(rowCells);
    }
    // REQ-0266 (item 34): prove the RASTER path actually ran, and that it is
    // gated on the DEF rather than on the argument. Without this, a regression
    // that silently fell back to the palette path would merely move the golden
    // hash -- and moving the golden is exactly what a REQ like this one does, so
    // the golden alone cannot catch it.
    {
      const cells = SUITE[1].cells; // the I-tromino: a 3-cell horizontal run
      const tex = comp.compositeSkin(cells, defs[SYNTH_SKIN], BGS[0], params, RASTERS[SYNTH_SKIN]);
      const pal = comp.compositeSkin(cells, defs[SYNTH_SKIN], BGS[0], params, null);
      if (sha(tex.rgba) === sha(pal.rgba)) failures.push('raster path did not run: textured composite is byte-identical to the palette one');
      const a = comp.compositeSkin(cells, defs['devornate'], BGS[0], params, null);
      const b = comp.compositeSkin(cells, defs['devornate'], BGS[0], params, RASTERS[SYNTH_SKIN]);
      if (sha(a.rgba) !== sha(b.rgba)) failures.push('a def with no fill_texture must IGNORE a supplied raster (palette path unchanged)');
      // Tiling continuity across an INTERNAL cell border. The I-tromino spans 3
      // cell columns with margin 1, so composite x=96 is the border between its
      // 1st and 2nd cell. x=80 and x=112 are exactly one TILE period apart and
      // straddle that border, both well inside the fill band (away from the welt
      // and the corner rounding) -- under composite-space tiling they MUST be the
      // same pixel; under per-cell tiling they are not.
      const px = (c, x, y) => [c.rgba[(y * c.width + x) * 4], c.rgba[(y * c.width + x) * 4 + 1], c.rgba[(y * c.width + x) * 4 + 2]].join(',');
      const Y = 72, X1 = 80, X2 = X1 + TILE, BORDER = 96;
      if (!(X1 < BORDER && X2 >= BORDER)) failures.push('tiling probe no longer straddles the internal cell border');
      else if (tex.layer[Y * tex.width + X1] !== comp.LAYER.fill || tex.layer[Y * tex.width + X2] !== comp.LAYER.fill) failures.push('tiling probe points are not on the fill layer -- fix the probe, not the assertion');
      else if (px(tex, X1, Y) !== px(tex, X2, Y)) failures.push(`tiling is not continuous across a cell border: (${X1},${Y})=${px(tex, X1, Y)} vs (${X2},${Y})=${px(tex, X2, Y)}`);
      // The welt must survive the raster path: the fill is replaced, the edge
      // treatment is not. Same welt pixel count as the palette twin.
      const weltOf = (c) => { let n = 0; for (let i = 0; i < c.layer.length; i++) if (c.layer[i] === comp.LAYER.welt) n++; return n; };
      if (weltOf(tex) === 0) failures.push('textured skin drew no welt at all');
      if (weltOf(tex) !== weltOf(a)) failures.push(`welt band changed under the raster path: ${weltOf(tex)} px vs ${weltOf(a)} px on the palette twin`);
    }
    let maxW = 0, maxH = 0;
    for (const row of grid) for (const t of row) { maxW = Math.max(maxW, t.W); maxH = Math.max(maxH, t.H); }
    const PAD = 6, boxW = maxW + PAD, boxH = maxH + PAD, cols = SKINS.length * BGS.length;
    const GW = cols * boxW + PAD, GH = grid.length * boxH + PAD;
    const gbuf = new Uint8Array(GW * GH * 4);
    for (let i = 0; i < GW * GH; i++) { gbuf[i * 4] = 24; gbuf[i * 4 + 1] = 24; gbuf[i * 4 + 2] = 28; gbuf[i * 4 + 3] = 255; }
    for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[r].length; c++) {
      const t = grid[r][c], ox = PAD + c * boxW, oy = PAD + r * boxH;
      for (let y = 0; y < t.H; y++) for (let x = 0; x < t.W; x++) { const si = (y * t.W + x) * 4, di = ((oy + y) * GW + (ox + x)) * 4; gbuf[di] = t.rgba[si]; gbuf[di + 1] = t.rgba[si + 1]; gbuf[di + 2] = t.rgba[si + 2]; gbuf[di + 3] = 255; }
    }
    fs.mkdirSync(OUTDIR, { recursive: true });
    fs.writeFileSync(path.join(OUTDIR, 'grid.png'), encodePNG(GW, GH, gbuf));
    const gridHash = sha(Buffer.from(hashParts.join('|')));
    fs.writeFileSync(path.join(OUTDIR, 'verdict.json'), JSON.stringify({ req: 'REQ-0126', shapes: SUITE.map((s) => s.n), backgrounds: BGS, skins: SKINS, gridHash, pass: failures.length === 0, failures }, null, 2));
    if (UPDATE) { fs.writeFileSync(GOLDEN, JSON.stringify({ gridHash, note: GOLDEN_NOTE }, null, 2) + '\n'); console.log('golden updated:', gridHash); }
    else if (fs.existsSync(GOLDEN)) { const g = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')); if (g.gridHash !== gridHash) failures.push(`golden mismatch: got ${gridHash} want ${g.gridHash}`); else console.log('golden match:', gridHash); }
    else { fs.writeFileSync(GOLDEN, JSON.stringify({ gridHash, note: GOLDEN_NOTE }, null, 2) + '\n'); console.log('golden bootstrapped:', gridHash); }
    console.log(`harness: ${SUITE.length} shapes x ${SKINS.length} skins x ${BGS.length} bgs = ${SUITE.length * cols} composites; grid ${GW}x${GH}`);
  } finally { await server.close(); }
  if (failures.length) { console.error('\nHARNESS FAIL:'); failures.forEach((f) => console.error('  -', f)); process.exit(1); }
  console.log('\nbpskin_harness: ALL GREEN');
}
main().catch((e) => { console.error(e); process.exit(1); });
