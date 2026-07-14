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
const SKINS = ['neutral', 'devornate'];
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
    for (const id of SKINS) if (!defs[id]) failures.push(`missing skin def: ${id}`);
    const params = { cellPx: 48, margin: 1 };
    const grid = []; const hashParts = [];
    for (const shape of SUITE) {
      const rowCells = [];
      for (const skinId of SKINS) for (const bg of BGS) {
        const def = defs[skinId];
        const c1 = comp.compositeSkin(shape.cells, def, bg, params);
        const c2 = comp.compositeSkin(shape.cells, def, bg, params);
        if (sha(c1.rgba) !== sha(c2.rgba)) failures.push(`determinism ${shape.n}/${skinId}/${bg}`);
        const rep = chk.checkComposite(c1, shape.cells, def, shape.comps);
        if (!rep.pass) for (const f of rep.findings) if (!f.ok) failures.push(`${shape.n}/${skinId}/${bg} ${f.check}: ${f.detail}`);
        hashParts.push(sha(c1.rgba));
        rowCells.push({ rgba: c1.rgba, W: c1.width, H: c1.height });
      }
      grid.push(rowCells);
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
    if (UPDATE) { fs.writeFileSync(GOLDEN, JSON.stringify({ gridHash, note: 'REQ-0126 bpskin harness golden -- regenerate with --update' }, null, 2) + '\n'); console.log('golden updated:', gridHash); }
    else if (fs.existsSync(GOLDEN)) { const g = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')); if (g.gridHash !== gridHash) failures.push(`golden mismatch: got ${gridHash} want ${g.gridHash}`); else console.log('golden match:', gridHash); }
    else { fs.writeFileSync(GOLDEN, JSON.stringify({ gridHash, note: 'REQ-0126 bpskin harness golden -- regenerate with --update' }, null, 2) + '\n'); console.log('golden bootstrapped:', gridHash); }
    console.log(`harness: ${SUITE.length} shapes x ${SKINS.length} skins x ${BGS.length} bgs = ${SUITE.length * cols} composites; grid ${GW}x${GH}`);
  } finally { await server.close(); }
  if (failures.length) { console.error('\nHARNESS FAIL:'); failures.forEach((f) => console.error('  -', f)); process.exit(1); }
  console.log('\nbpskin_harness: ALL GREEN');
}
main().catch((e) => { console.error(e); process.exit(1); });
