#!/usr/bin/env node
// client/scripts/req0291_frame_preview.mjs -- REQ-0291 visual evidence.
// Renders the SAME skinned BP two ways through the real compositeSkin:
//   before.png -- the pre-REQ path: procedural palette welt (flat welt colour +
//                 the (x+y)%12 notch), the "palette plastic" frame the REQ fixes.
//   after.png  -- the strip path: the welt CUT FROM the authored frame band
//                 (dark keyline -> stitch -> leather, outer->inner), fed by
//                 edge_padding -> frame_band_px.
// Same interior fill, same shapes; the RING is the whole difference. Board scale
// (cellPx=80). PNG via Node zlib (no deps), same encoder as bpskin_harness.mjs.
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(__dirname, '..');
const REPO = path.resolve(CLIENT, '..');
const OUTDIR = path.join(REPO, 'web', 'preview', 'req-0291');

let CRC;
function crc32(buf) { if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } } let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function u32(n) { return Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }
function pngChunk(type, data) { const t = Buffer.from(type, 'ascii'); const body = Buffer.concat([t, data]); return Buffer.concat([u32(data.length), body, u32(crc32(body))]); }
function encodePNG(W, H, rgba) { const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); const ihdr = Buffer.concat([u32(W), u32(H), Buffer.from([8, 6, 0, 0, 0])]); const stride = W * 4; const raw = Buffer.alloc((stride + 1) * H); for (let y = 0; y < H; y++) { raw[y * (stride + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1); } const idat = zlib.deflateSync(raw, { level: 9 }); return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]); }

const BAND = 60, TILEW = 160, LH = 96, LV = 96;
function leatherAt(f) { // f: 0 outer -> 1 inner across the band
  if (f < 0.12) return [34, 25, 18];                       // dark keyline
  if (f < 0.20) return [150, 112, 74];                     // welt shoulder
  if (f < 0.30) return [206, 176, 116];                    // stitch thread (bright)
  const g = (f - 0.30) / 0.70; return [118 + (28 * g) | 0, 84 + (22 * g) | 0, 52 + (16 * g) | 0]; // leather, lightening inward
}
function buildFill() { const r = new Uint8ClampedArray(TILEW * TILEW * 4); for (let y = 0; y < TILEW; y++) for (let x = 0; x < TILEW; x++) { const o = (y * TILEW + x) * 4; const grain = (((x >> 3) + (y >> 3)) & 1) ? 8 : -8; r[o] = 110 + grain; r[o + 1] = 80 + grain; r[o + 2] = 52 + grain; r[o + 3] = 255; } return { width: TILEW, height: TILEW, rgba: r }; }
function buildStrips() {
  const h = new Uint8ClampedArray(LH * BAND * 4);
  for (let d = 0; d < BAND; d++) { const c = leatherAt(d / (BAND - 1)); for (let a = 0; a < LH; a++) { const o = (d * LH + a) * 4; const j = ((a >> 2) & 1) ? 4 : -4; h[o] = Math.max(0, c[0] + j); h[o + 1] = Math.max(0, c[1] + j); h[o + 2] = Math.max(0, c[2] + j); h[o + 3] = 255; } }
  const v = new Uint8ClampedArray(BAND * LV * 4);
  for (let a = 0; a < LV; a++) for (let d = 0; d < BAND; d++) { const c = leatherAt(d / (BAND - 1)); const o = (a * BAND + d) * 4; const j = ((a >> 2) & 1) ? 4 : -4; v[o] = Math.max(0, c[0] + j); v[o + 1] = Math.max(0, c[1] + j); v[o + 2] = Math.max(0, c[2] + j); v[o + 3] = 255; }
  return { stripH: { width: LH, height: BAND, rgba: h }, stripV: { width: BAND, height: LV, rgba: v }, frameBandPx: BAND };
}
const SHAPES = [
  { n: 'square3x3', cells: [[2, 2], [2, 3], [2, 4], [3, 2], [3, 3], [3, 4], [4, 2], [4, 3], [4, 4]] },
  { n: 'L', cells: [[2, 2], [2, 3], [2, 4], [3, 2], [4, 2]] },
];
const CANVAS = '#14181f';
function toPng(comp) { const out = new Uint8ClampedArray(comp.width * comp.height * 4); for (let i = 0; i < comp.width * comp.height; i++) { const o = i * 4; out[o] = comp.rgba[o]; out[o + 1] = comp.rgba[o + 1]; out[o + 2] = comp.rgba[o + 2]; out[o + 3] = 255; } return encodePNG(comp.width, comp.height, out); }
function pasteInto(g, GW, comp, ox, oy) { for (let y = 0; y < comp.height; y++) for (let x = 0; x < comp.width; x++) { const si = (y * comp.width + x) * 4, di = ((oy + y) * GW + (ox + x)) * 4; g[di] = comp.rgba[si]; g[di + 1] = comp.rgba[si + 1]; g[di + 2] = comp.rgba[si + 2]; g[di + 3] = 255; } }

async function main() {
  const server = await createServer({ root: CLIENT, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const comp = await server.ssrLoadModule('/src/board/skin/composite.ts');
    const fill = buildFill(), frame = buildStrips();
    const def = { kind: 'bpskin/1', id: 'req0291_leather', name: 'Leather (preview)', palette: { canvas: CANVAS, fill: '#6e5034', welt: '#96704a' }, corner_radius: 10, border_band: 5, art: { fill_texture: 'preview://leather', frame_band_px: BAND } };
    const params = { cellPx: 80, margin: 1 };
    fs.mkdirSync(OUTDIR, { recursive: true });
    const befs = [], afts = [];
    for (const s of SHAPES) {
      const before = comp.compositeSkin(s.cells, def, CANVAS, params, fill, null);   // procedural palette welt (pre-REQ)
      const after = comp.compositeSkin(s.cells, def, CANVAS, params, fill, frame);    // authored-frame strip welt
      fs.writeFileSync(path.join(OUTDIR, `before_${s.n}.png`), toPng(before));
      fs.writeFileSync(path.join(OUTDIR, `after_${s.n}.png`), toPng(after));
      befs.push(before); afts.push(after);
    }
    // Side-by-side grid: rows = shapes, cols = [before, after].
    let maxW = 0, maxH = 0; for (const c of [...befs, ...afts]) { maxW = Math.max(maxW, c.width); maxH = Math.max(maxH, c.height); }
    const PAD = 10, boxW = maxW + PAD, boxH = maxH + PAD, cols = 2, GW = cols * boxW + PAD, GH = SHAPES.length * boxH + PAD;
    const g = new Uint8ClampedArray(GW * GH * 4); for (let i = 0; i < GW * GH; i++) { g[i * 4] = 20; g[i * 4 + 1] = 24; g[i * 4 + 2] = 31; g[i * 4 + 3] = 255; }
    for (let r = 0; r < SHAPES.length; r++) { pasteInto(g, GW, befs[r], PAD, PAD + r * boxH); pasteInto(g, GW, afts[r], PAD + boxW, PAD + r * boxH); }
    fs.writeFileSync(path.join(OUTDIR, 'before_after_grid.png'), encodePNG(GW, GH, g));
    fs.writeFileSync(path.join(OUTDIR, 'README.txt'), 'REQ-0291 before/after: LEFT column = pre-REQ procedural palette welt (flat colour + notch);\nRIGHT column = the authored frame band composed from directional welt strips\n(edge_padding -> frame_band_px). Rendered offline through the real compositeSkin\n(cellPx=80, band=60 -> B=9px). Rows: square3x3, L.\n');
    console.log('WROTE', OUTDIR, '->', fs.readdirSync(OUTDIR).join(', '));
  } finally { await server.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
