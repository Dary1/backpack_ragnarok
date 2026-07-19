#!/usr/bin/env node
// client/scripts/board_skin_preview.mjs -- REQ-0266 VISUAL PROOF (not a gate).
//
// No gate covers BOARD APPEARANCE, which is how REQ-0266's first BoardRenderer
// binding shipped a regression that every green gate missed: `neutral` is always
// registered, so the 5-rung chain lands on a def for EVERY BP, and an art-less
// def painted an opaque #2b3240 body in gSkins directly over the per-BP colour
// tint in gBase -- the one cue that tells one BP from another. This script is
// what shows that with pixels.
//
// It reproduces BoardRenderer.render()'s stacking for the BP body, in the exact
// order that file draws it:
//     gBase   grid cells        (canvas: bp.color @0.26 + a 1px bp.color stroke)
//     gBase   BP outline        (3px bp.color on the footprint boundary)
//     gSkins  skin composite    (opaque wherever LAYER != bg)   <-- the guard
//     gSkins  BP usage tint     (REQ-0033 state wash, moved out of gBase so a
//                                textured skin cannot swallow it)
// and renders each scene TWICE: with the pre-fix behaviour (paint whatever the
// resolver returned; usage tint in gBase) and with the shipped behaviour (paint
// only a skin with real decoded art; usage tint in gSkins).
//
// Everything is hermetic and byte-deterministic: the modules are the REAL ones
// via vite ssrLoadModule, the "texture" is synthesised procedurally (no asset,
// no fetch, no DOM), and the PNG encoder is Node zlib only.
//
//   node scripts/board_skin_preview.mjs [--out <dir>]
//
// Output: <dir>/req0266_board_noskin.png  and  <dir>/req0266_board_skinned.png
// (default dir: web/preview/req0266-board/).
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(__dirname, '..');
const REPO = path.resolve(CLIENT, '..');
const outArg = process.argv.indexOf('--out');
const OUTDIR = outArg >= 0 ? process.argv[outArg + 1] : path.join(REPO, 'web', 'preview', 'req0266-board');

// ---------------------------------------------------------------------------
// Board geometry. Parsed OUT of board/geom.ts rather than copied, so this
// preview can never silently drift from the renderer it claims to model.
// ---------------------------------------------------------------------------
const geom = fs.readFileSync(path.join(CLIENT, 'src', 'board', 'geom.ts'), 'utf8');
const constOf = (name) => {
  const m = geom.match(new RegExp('export const ' + name + '\\s*=\\s*(\\d+)'));
  if (!m) throw new Error('geom.ts no longer declares ' + name + ' -- fix this parser, not the assertion');
  return Number(m[1]);
};
const CELL = constOf('CELL'), PAD = constOf('PAD');
const MARGIN = 1; // bpSkinTexture.ts's composite margin
const ROWS = 5, COLS = 10;

// ---------------------------------------------------------------------------
// A tiny RGBA canvas. Alpha-composites onto an opaque buffer, which is exactly
// what Pixi does over the board background.
// ---------------------------------------------------------------------------
function makeBuf(W, H, rgb) {
  const b = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { b[i * 4] = rgb[0]; b[i * 4 + 1] = rgb[1]; b[i * 4 + 2] = rgb[2]; b[i * 4 + 3] = 255; }
  return b;
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function px(buf, W, H, x, y, rgb, a) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 4;
  buf[o] = Math.round(rgb[0] * a + buf[o] * (1 - a));
  buf[o + 1] = Math.round(rgb[1] * a + buf[o + 1] * (1 - a));
  buf[o + 2] = Math.round(rgb[2] * a + buf[o + 2] * (1 - a));
}
function rect(buf, W, H, x, y, w, h, rgb, a) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) px(buf, W, H, i, j, rgb, a);
}
function frame(buf, W, H, x, y, w, h, rgb, a) { // 1px stroke, inside the rect
  rect(buf, W, H, x, y, w, 1, rgb, a); rect(buf, W, H, x, y + h - 1, w, 1, rgb, a);
  rect(buf, W, H, x, y, 1, h, rgb, a); rect(buf, W, H, x + w - 1, y, 1, h, rgb, a);
}

// ---------------------------------------------------------------------------
// A 3x5 pixel font, so each panel says what it is without a caption elsewhere.
// ---------------------------------------------------------------------------
const FONT = {
  A: '111101111101101', B: '110101110101110', C: '111100100100111', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '111100101101111', H: '101101111101101',
  I: '111010010010111', K: '101101110101101', L: '100100100100111', M: '101111111101101',
  N: '101111111111101', O: '111101101101111', P: '111101111100100', R: '111101110101101',
  S: '111100111001111', T: '111010010010010', U: '101101101101111', V: '101101101101010',
  W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111',
  4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001001001',
  8: '111101111101111', 9: '111101111001111',
  '-': '000000111000000', '(': '010100100100010', ')': '010001001001010',
  '.': '000000000000010', ':': '000010000010000', '/': '001001010100100',
  '+': '000010111010000', ' ': '000000000000000',
};
function text(buf, W, H, s, x, y, scale, rgb) {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const g = FONT[ch] || FONT[' '];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      if (g[r * 3 + c] === '1') rect(buf, W, H, cx + c * scale, y + r * scale, scale, scale, rgb, 1);
    }
    cx += 4 * scale;
  }
  return cx;
}

// ---------------------------------------------------------------------------
// PNG (Node zlib only), same encoder shape as bpskin_harness.mjs.
// ---------------------------------------------------------------------------
let CRC;
function crc32(b) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}
const u32 = (n) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
function chunk(t, d) { const body = Buffer.concat([Buffer.from(t, 'ascii'), d]); return Buffer.concat([u32(d.length), body, u32(crc32(body))]); }
function encodePNG(W, H, rgba) {
  const stride = W * 4, raw = Buffer.alloc((stride + 1) * H);
  for (let y = 0; y < H; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', Buffer.concat([u32(W), u32(H), Buffer.from([8, 6, 0, 0, 0])])),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** A synthetic 64px "material" tile. Procedural so this script needs no asset on
 * disk and no network, and is byte-identical on every machine. */
const TILE = 64;
function synthTile() {
  const rgba = new Uint8ClampedArray(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const o = (y * TILE + x) * 4;
    const weave = ((x >> 3) + (y >> 3)) & 1;
    const grain = ((x * 7 + y * 3) % 11) * 4;
    const c = weave ? [156, 122, 74] : [96, 72, 46];
    if ((x + y) % TILE < 4) { c[0] = 232; c[1] = 208; c[2] = 150; } // a visible weft, so tiling is legible
    rgba[o] = Math.min(255, c[0] + grain); rgba[o + 1] = Math.min(255, c[1] + grain);
    rgba[o + 2] = Math.min(255, c[2] + grain); rgba[o + 3] = 255;
  }
  return { width: TILE, height: TILE, rgba };
}

const BOARD_W = PAD * 2 + COLS * CELL, BOARD_H = PAD * 2 + ROWS * CELL;
const CAP = 34; // caption strip height

/**
 * One board panel. `guard` selects the SHIPPED behaviour (true: only a skin with
 * real decoded art paints, usage tint in gSkins) or the PRE-FIX one (false:
 * paint whatever the resolver returned, usage tint in gBase).
 */
function panel(comp, bps, guard) {
  const W = BOARD_W, H = BOARD_H + CAP;
  const buf = makeBuf(W, H, hex('#0f1115'));
  const occ = new Map();
  for (const bp of bps) for (const [r, c] of bp.cells) occ.set(r + ',' + c, bp);
  // --- gBase: the grid. Canvas board: an occupied cell is washed in the BP's
  // own colour; a dead cell is flat dark. This IS the per-BP identity cue.
  for (let r = 1; r <= ROWS; r++) for (let c = 1; c <= COLS; c++) {
    const x = PAD + (c - 1) * CELL, y = CAP + PAD + (r - 1) * CELL, bp = occ.get(r + ',' + c);
    if (bp) { rect(buf, W, H, x, y, CELL, CELL, hex(bp.color), 0.26); frame(buf, W, H, x, y, CELL, CELL, hex(bp.color), 0.35); }
    else { rect(buf, W, H, x, y, CELL, CELL, hex('#191919'), 1); frame(buf, W, H, x, y, CELL, CELL, hex('#242424'), 1); }
  }
  // --- gBase: the 3px BP outline on the footprint boundary (centred on the
  // edge, as a Pixi stroke is), then the pre-fix usage tint location.
  for (const bp of bps) {
    const set = new Set(bp.cells.map(([r, c]) => r + ',' + c));
    for (const [r, c] of bp.cells) {
      const x = PAD + (c - 1) * CELL, y = CAP + PAD + (r - 1) * CELL, col = hex(bp.color);
      if (!set.has((r - 1) + ',' + c)) rect(buf, W, H, x, y - 1, CELL, 3, col, 1);
      if (!set.has((r + 1) + ',' + c)) rect(buf, W, H, x, y + CELL - 2, CELL, 3, col, 1);
      if (!set.has(r + ',' + (c - 1))) rect(buf, W, H, x - 1, y, 3, CELL, col, 1);
      if (!set.has(r + ',' + (c + 1))) rect(buf, W, H, x + CELL - 2, y, 3, CELL, col, 1);
    }
    if (!guard && bp.usage) for (const [r, c] of bp.cells) rect(buf, W, H, PAD + (c - 1) * CELL, CAP + PAD + (r - 1) * CELL, CELL, CELL, hex(bp.usage), 0.34);
  }
  // --- gSkins: the composite. THE GUARD is composite.ts's declaresFillTexture()
  // plus "the raster is actually in hand" -- exactly bpSkinSprite()'s two tests.
  for (const bp of bps) {
    if (!bp.def) continue;
    const paints = guard ? (comp.declaresFillTexture(bp.def) && !!bp.raster) : true;
    if (!paints) continue;
    const c = comp.compositeSkin(bp.cells, bp.def, bp.def.palette.canvas || '#000000', { cellPx: CELL, margin: MARGIN }, bp.raster || null);
    const ox = PAD + (c.c0 - MARGIN - 1) * CELL, oy = CAP + PAD + (c.r0 - MARGIN - 1) * CELL;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = y * c.width + x;
      if (c.layer[i] === comp.LAYER.bg) continue; // transparent outside the silhouette
      px(buf, W, H, ox + x, oy + y, [c.rgba[i * 4], c.rgba[i * 4 + 1], c.rgba[i * 4 + 2]], 1);
    }
  }
  // --- gSkins: the usage tint, post-fix location (over the skin).
  if (guard) for (const bp of bps) {
    if (!bp.usage) continue;
    for (const [r, c] of bp.cells) rect(buf, W, H, PAD + (c - 1) * CELL, CAP + PAD + (r - 1) * CELL, CELL, CELL, hex(bp.usage), 0.34);
  }
  return { buf, W, H };
}

function compose(panels, captions) {
  const GAP = 10;
  const W = panels.reduce((a, p) => a + p.W, 0) + GAP * (panels.length + 1);
  const H = panels[0].H + GAP * 2;
  const out = makeBuf(W, H, [16, 16, 20]);
  let ox = GAP;
  panels.forEach((p, n) => {
    for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) {
      const s = (y * p.W + x) * 4, d = ((GAP + y) * W + ox + x) * 4;
      out[d] = p.buf[s]; out[d + 1] = p.buf[s + 1]; out[d + 2] = p.buf[s + 2];
    }
    text(out, W, H, captions[n], ox + 14, GAP + 8, 3, hex(n === 0 ? '#ff6b6b' : '#6bff9a'));
    ox += p.W + GAP;
  });
  return { out, W, H };
}

async function main() {
  const server = await createServer({ root: CLIENT, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const comp = await server.ssrLoadModule('/src/board/skin/composite.ts');
    const reg = await server.ssrLoadModule('/src/board/skin/skinRegistry.ts');
    const res = await server.ssrLoadModule('/src/board/skin/bpSkinResolve.ts');
    const doc = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_bpskins.json'), 'utf8'));
    // A one-entry unit_skin corpus with its artwork ADOPTED, so loadSkinDefs
    // derives a def that really does declare a fill texture -- the shape a live
    // uskin_bp_<unit> takes once an operator has adopted its artwork.
    const unitSkins = { uskin_bp_demo: { id: 'uskin_bp_demo', name: 'Demo Bag', slot: 'bpskin', art_ref: 'bpskin_unit_demo', units: ['demo'], default: true } };
    const defs = reg.loadSkinDefs(doc, { unitSkins, artUrls: { uskin_bp_demo: '/api/art/bpskin_unit_demo.png' } });
    const has = (id) => id in defs;

    // The two BPs, resolved through the REAL 5-rung chain exactly as
    // BoardRenderer.ts calls it.
    const noskinRes = res.resolveBpSkin({ instanceSkinId: null, profileSkinId: null, unitSetSkinId: null }, has);
    const skinnedRes = res.resolveBpSkin({ instanceSkinId: null, profileSkinId: null, unitSetSkinId: 'uskin_bp_demo' }, has);
    if (noskinRes.rung !== 'neutral') throw new Error('expected the unskinned BP to report rung neutral, got ' + noskinRes.rung);
    if (skinnedRes.rung !== 'set') throw new Error('expected the skinned BP to report rung set, got ' + skinnedRes.rung);

    const noskin = [{ color: '#e0603a', cells: [[2, 2], [3, 2], [4, 2], [4, 3]], def: defs[noskinRes.skinId], raster: null },
      { color: '#c8b03a', cells: [[2, 5], [2, 6], [3, 5], [3, 6]], def: defs[noskinRes.skinId], raster: null },
      { color: '#7f6bd6', cells: [[2, 8], [3, 8], [3, 9], [4, 9]], def: defs[noskinRes.skinId], raster: null }];
    const skinned = [{ color: '#4fd0e0', cells: [[2, 2], [2, 3], [3, 2], [3, 3], [4, 3]], def: defs[skinnedRes.skinId], raster: synthTile() },
      { color: '#e0603a', cells: [[2, 6], [3, 6], [4, 6], [4, 7]], def: defs[skinnedRes.skinId], raster: synthTile(), usage: '#d55e00' }];

    fs.mkdirSync(OUTDIR, { recursive: true });
    const a = compose([panel(comp, noskin, false), panel(comp, noskin, true)],
      ['before  neutral paints  tint buried', 'after  no art no paint  tint reads']);
    fs.writeFileSync(path.join(OUTDIR, 'req0266_board_noskin.png'), encodePNG(a.W, a.H, a.out));
    const b = compose([panel(comp, skinned, false), panel(comp, skinned, true)],
      ['before  texture paints  usage wash buried', 'after  texture paints  usage wash reads']);
    fs.writeFileSync(path.join(OUTDIR, 'req0266_board_skinned.png'), encodePNG(b.W, b.H, b.out));
    console.log('rungs: unskinned=' + noskinRes.rung + '/' + noskinRes.skinId + '  skinned=' + skinnedRes.rung + '/' + skinnedRes.skinId);
    console.log('wrote ' + path.join(OUTDIR, 'req0266_board_noskin.png') + '  ' + a.W + 'x' + a.H);
    console.log('wrote ' + path.join(OUTDIR, 'req0266_board_skinned.png') + '  ' + b.W + 'x' + b.H);
  } finally { await server.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
