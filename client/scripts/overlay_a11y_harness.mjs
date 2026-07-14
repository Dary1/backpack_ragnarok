#!/usr/bin/env node
// client/scripts/overlay_a11y_harness.mjs -- REQ-0143 (overlay-accessibility).
// THE measurement harness that (1) proves the renderer overlay palette is
// colourblind-safe and never encodes meaning in hue alone, and (2) extends G4
// contrast discipline to overlays -- emitting the numeric recommendation that
// settles BS-G2's two OPEN numbers (border band width @256/cell, fill contrast
// budget). Builds on REQ-0126's deterministic skin compositor: overlays wash
// over the SAME validation shape suite at board scale (64 px/cell). Deterministic
// two ways (numbers computed twice -> identical; a golden hash pins the result).
//   node scripts/overlay_a11y_harness.mjs           # gate (strict vs golden)
//   node scripts/overlay_a11y_harness.mjs --update  # (re)write the golden
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
const GOLDEN = path.join(CLIENT, 'scripts', 'overlay_a11y_harness.golden.json');
const OUTDIR = path.join(REPO, 'web', 'preview', 'overlay-a11y-req0143');
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
const BOARD_CELL_PX = 64;
const AUTHOR_CELL_PX = 256;
const U2A = AUTHOR_CELL_PX / BOARD_CELL_PX;
const ITEM_DARK = '#0e0d0b';
const ITEM_LIGHT = '#f2fbff';
const NONTEXT_MIN = 3.0;
const CVD = {
  deuteranopia: [[0.625, 0.375, 0.0], [0.700, 0.300, 0.0], [0.0, 0.300, 0.700]],
  protanopia: [[0.567, 0.433, 0.0], [0.558, 0.442, 0.0], [0.0, 0.242, 0.758]],
  tritanopia: [[0.950, 0.050, 0.0], [0.0, 0.433, 0.567], [0.0, 0.475, 0.525]],
};
function simulate(rgb, M) {
  const r = rgb[0], g = rgb[1], b = rgb[2];
  const out = [M[0][0] * r + M[0][1] * g + M[0][2] * b, M[1][0] * r + M[1][1] * g + M[1][2] * b, M[2][0] * r + M[2][1] * g + M[2][2] * b];
  return out.map((v) => Math.max(0, Math.min(255, Math.round(v))));
}
function srgbLin(c) { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
function rgbToXyz(rgb) {
  const r = srgbLin(rgb[0]), g = srgbLin(rgb[1]), b = srgbLin(rgb[2]);
  return [r * 0.4124 + g * 0.3576 + b * 0.1805, r * 0.2126 + g * 0.7152 + b * 0.0722, r * 0.0193 + g * 0.1192 + b * 0.9505];
}
function xyzToLab(xyz) {
  const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(xyz[0] / Xn), fy = f(xyz[1] / Yn), fz = f(xyz[2] / Zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function lab(rgb) { return xyzToLab(rgbToXyz(rgb)); }
function deltaE76(a, b) { const la = lab(a), lb = lab(b); return Math.sqrt((la[0] - lb[0]) ** 2 + (la[1] - lb[1]) ** 2 + (la[2] - lb[2]) ** 2); }
const DE_SEPARABLE = 11;
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
function comps(mask, W, H) {
  const seen = new Uint8Array(W * H); const st = []; let c = 0;
  for (let s = 0; s < W * H; s++) { if (!mask[s] || seen[s]) continue; c++; st.push(s); seen[s] = 1; while (st.length) { const p = st.pop(); const px = p % W, py = (p - px) / W; const nb = [px > 0 ? p - 1 : -1, px < W - 1 ? p + 1 : -1, py > 0 ? p - W : -1, py < H - 1 ? p + W : -1]; for (const q of nb) if (q >= 0 && mask[q] && !seen[q]) { seen[q] = 1; st.push(q); } } }
  return c;
}
function holes(rs, W, H) {
  const bg = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) bg[i] = rs[i] ? 0 : 1;
  const seen = new Uint8Array(W * H); const st = [];
  for (let x = 0; x < W; x++) { st.push(x); st.push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { st.push(y * W); st.push(y * W + W - 1); }
  while (st.length) { const p = st.pop(); if (p < 0 || p >= W * H || seen[p] || !bg[p]) continue; seen[p] = 1; const px = p % W, py = (p - px) / W; if (px > 0) st.push(p - 1); if (px < W - 1) st.push(p + 1); if (py > 0) st.push(p - W); if (py < H - 1) st.push(p + W); }
  let h = 0; const s2 = new Uint8Array(W * H);
  for (let s = 0; s < W * H; s++) { if (!bg[s] || seen[s] || s2[s]) continue; h++; const q2 = [s]; s2[s] = 1; while (q2.length) { const p = q2.pop(); const px = p % W, py = (p - px) / W; const nb = [px > 0 ? p - 1 : -1, px < W - 1 ? p + 1 : -1, py > 0 ? p - W : -1, py < H - 1 ? p + W : -1]; for (const q of nb) if (q >= 0 && bg[q] && !seen[q] && !s2[q]) { s2[q] = 1; q2.push(q); } } }
  return h;
}
function round4(n) { return Math.round(n * 10000) / 10000; }
async function main() {
  const server = await createServer({ root: CLIENT, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  const failures = [];
  let result;
  try {
    const pal = await server.ssrLoadModule('/src/board/overlayPalette.ts');
    const comp = await server.ssrLoadModule('/src/board/skin/composite.ts');
    const reg = await server.ssrLoadModule('/src/board/skin/skinRegistry.ts');
    const defs = reg.loadSkinDefs(JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_bpskins.json'), 'utf8')));
    const skinFills = { neutral: pal.hexToRgb(defs.neutral.palette.fill), devornate: pal.hexToRgb(defs.devornate.palette.fill) };
    const groups = pal.overlayGroups();
    const cvdReport = [];
    for (const { group, states } of groups) {
      const pairs = [];
      for (let i = 0; i < states.length; i++) for (let j = i + 1; j < states.length; j++) {
        const a = states[i], b = states[j];
        const perCvd = {};
        let colorSeparableAll = true;
        for (const [cvdName, M] of Object.entries(CVD)) {
          let minDe = Infinity;
          for (const fill of Object.values(skinFills)) {
            const ca = simulate(pal.over(pal.hexToRgb(a.signal.hex), fill, a.signal.alpha), M);
            const cb = simulate(pal.over(pal.hexToRgb(b.signal.hex), fill, b.signal.alpha), M);
            minDe = Math.min(minDe, deltaE76(ca, cb));
          }
          perCvd[cvdName] = round4(minDe);
          if (minDe < DE_SEPARABLE) colorSeparableAll = false;
        }
        const cuesDiffer = a.signal.cue !== b.signal.cue;
        const pass = colorSeparableAll || cuesDiffer;
        if (!pass) failures.push(`CVD ${group}: ${a.label} vs ${b.label} not separable by colour or cue`);
        pairs.push({ a: a.label, b: b.label, cvdDeltaE: perCvd, colorSeparableAllCvd: colorSeparableAll, cuesDiffer, cueReliedOn: !colorSeparableAll, cueA: a.signal.cue, cueB: b.signal.cue, pass });
      }
      cvdReport.push({ group, pairs });
    }
    const bandDef = (bandBoardPx) => ({ ...defs.devornate, border_band: bandBoardPx });
    const params = { cellPx: BOARD_CELL_PX, margin: 1 };
    let bandMinBoard = null;
    const bandSweep = [];
    for (let wq = 1; wq <= 16; wq++) {
      const wBoard = wq * 0.5;
      let allOk = true; let minWeltContrast = Infinity;
      for (const shape of SUITE) {
        const c = comp.compositeSkin(shape.cells, bandDef(wBoard), defs.devornate.palette.canvas, params);
        const W = c.width, H = c.height;
        const welt = new Uint8Array(W * H); const rs = c.rs;
        for (let i = 0; i < W * H; i++) welt[i] = c.layer[i] === comp.LAYER.welt ? 1 : 0;
        const wc = comps(welt, W, H);
        const expected = shape.comps + holes(rs, W, H);
        const weltRgb = pal.hexToRgb(defs.devornate.palette.welt);
        const fillRgb = pal.hexToRgb(defs.devornate.palette.fill);
        const cr = pal.contrastRatio(pal.relLuminance(weltRgb), pal.relLuminance(fillRgb));
        minWeltContrast = Math.min(minWeltContrast, cr);
        let weltPx = 0; for (let i = 0; i < W * H; i++) if (welt[i]) weltPx++;
        if (wc !== expected || weltPx === 0) allOk = false;
      }
      const pass = allOk && minWeltContrast >= NONTEXT_MIN;
      bandSweep.push({ boardPx: wBoard, px256: round4(wBoard * U2A), ringOk: allOk, weltFillContrast: round4(minWeltContrast), pass });
      if (pass && bandMinBoard === null) bandMinBoard = wBoard;
    }
    if (bandMinBoard === null) failures.push('band sweep: no width produced a clean welt ring at floor contrast');
    const bandRecBoard = bandMinBoard === null ? null : Math.ceil(bandMinBoard) + 1;
    const borderBand = {
      floor_contrast: NONTEXT_MIN,
      measured_min_board_px: bandMinBoard,
      measured_min_px_at_256: bandMinBoard === null ? null : round4(bandMinBoard * U2A),
      recommended_board_px: bandRecBoard,
      recommended_px_at_256: bandRecBoard === null ? null : round4(bandRecBoard * U2A),
      note: 'min = smallest board-px band that renders a clean welt ring on all suite shapes at >=3:1 welt/fill; recommended adds 1 board-px anti-alias headroom (G4 64px rule).',
    };
    const Ldark = pal.relLuminance(pal.hexToRgb(ITEM_DARK));
    const Llight = pal.relLuminance(pal.hexToRgb(ITEM_LIGHT));
    const fillLo = round4(NONTEXT_MIN * (Ldark + 0.05) - 0.05);
    const fillHi = round4((Llight + 0.05) / NONTEXT_MIN - 0.05);
    const perSkin = {};
    for (const id of ['neutral', 'devornate']) {
      const Lf = pal.relLuminance(pal.hexToRgb(defs[id].palette.fill));
      perSkin[id] = { fill: defs[id].palette.fill, fillLuminance: round4(Lf), vsItemDark: round4(pal.contrastRatio(Lf, Ldark)), vsItemLight: round4(pal.contrastRatio(Lf, Llight)), inBudget: Lf >= fillLo && Lf <= fillHi };
    }
    const fillBudget = { standard: 'WCAG 1.4.11 non-text contrast', min_ratio: NONTEXT_MIN, item_dark_ref: ITEM_DARK, item_light_ref: ITEM_LIGHT, fill_luminance_band: [fillLo, fillHi], per_skin: perSkin };
    const emit = { borderBand, fillBudget, cvd: cvdReport };
    const emit2 = JSON.parse(JSON.stringify(emit));
    if (JSON.stringify(emit) !== JSON.stringify(emit2)) failures.push('non-deterministic emission');
    const SW = 40, PADP = 6;
    let rows = 0; for (const g of groups) rows += g.states.length;
    const cols = 1 + 3;
    const GW = PADP + cols * (SW + PADP);
    const GH = PADP + rows * (SW + PADP);
    const gbuf = new Uint8Array(GW * GH * 4);
    for (let i = 0; i < GW * GH; i++) { gbuf[i * 4] = 24; gbuf[i * 4 + 1] = 24; gbuf[i * 4 + 2] = 28; gbuf[i * 4 + 3] = 255; }
    const fillRef = skinFills.devornate;
    let ri = 0;
    for (const g of groups) for (const st of g.states) {
      const trueRgb = pal.over(pal.hexToRgb(st.signal.hex), fillRef, st.signal.alpha);
      const cells = [trueRgb, simulate(trueRgb, CVD.deuteranopia), simulate(trueRgb, CVD.protanopia), simulate(trueRgb, CVD.tritanopia)];
      for (let ci = 0; ci < cols; ci++) {
        const ox = PADP + ci * (SW + PADP), oy = PADP + ri * (SW + PADP), col = cells[ci];
        for (let y = 0; y < SW; y++) for (let x = 0; x < SW; x++) { const di = ((oy + y) * GW + (ox + x)) * 4; gbuf[di] = col[0]; gbuf[di + 1] = col[1]; gbuf[di + 2] = col[2]; gbuf[di + 3] = 255; }
      }
      ri++;
    }
    fs.mkdirSync(OUTDIR, { recursive: true });
    const galleryPng = encodePNG(GW, GH, gbuf);
    fs.writeFileSync(path.join(OUTDIR, 'overlay_gallery.png'), galleryPng);
    const galleryHash = sha(galleryPng);
    const numbersHash = sha(Buffer.from(JSON.stringify({ borderBand, fillBudget, cvd: cvdReport, bandSweep })));
    result = { req: 'REQ-0143', emit, bandSweep, galleryHash, numbersHash, pass: failures.length === 0, failures };
    fs.writeFileSync(path.join(OUTDIR, 'verdict.json'), JSON.stringify(result, null, 2));
    console.log('--- BS-G2 numeric recommendation (harness-emitted; user ratifies) ---');
    console.log('  border band width  :', borderBand.recommended_px_at_256, 'px @256/cell', `(min measured ${borderBand.measured_min_px_at_256}; = ${borderBand.recommended_board_px} board px @64/cell)`);
    console.log('  fill contrast budget:', `>= ${fillBudget.min_ratio}:1 (WCAG 1.4.11); fill luminance band [${fillBudget.fill_luminance_band[0]}, ${fillBudget.fill_luminance_band[1]}]`);
    console.log('  per-skin fill:', JSON.stringify(perSkin));
    console.log('  numbersHash:', numbersHash);
    if (UPDATE) { fs.writeFileSync(GOLDEN, JSON.stringify({ numbersHash, galleryHash, note: 'REQ-0143 overlay a11y harness golden -- regenerate with --update' }, null, 2) + '\n'); console.log('golden updated'); }
    else if (fs.existsSync(GOLDEN)) { const g = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')); if (g.numbersHash !== numbersHash) failures.push(`golden numbersHash mismatch: got ${numbersHash} want ${g.numbersHash}`); else if (g.galleryHash !== galleryHash) failures.push('golden galleryHash mismatch'); else console.log('golden match:', numbersHash); }
    else { fs.writeFileSync(GOLDEN, JSON.stringify({ numbersHash, galleryHash, note: 'REQ-0143 overlay a11y harness golden -- regenerate with --update' }, null, 2) + '\n'); console.log('golden bootstrapped:', numbersHash); }
  } finally { await server.close(); }
  if (failures.length) { console.error('\nHARNESS FAIL:'); failures.forEach((f) => console.error('  -', f)); process.exit(1); }
  console.log('\noverlay_a11y_harness: ALL GREEN');
}
main().catch((e) => { console.error(e); process.exit(1); });
