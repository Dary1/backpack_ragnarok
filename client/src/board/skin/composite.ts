// client/src/board/skin/composite.ts -- REQ-0126. PURE deterministic RGBA
// compositor for the skin rendering stack (pipeline §2, spec items 1 & 5). The
// ONE truth the S3 harness rasterizes and the machine checks run against. The
// clip stage ("fill_texture clipped by cell interiors + edge-tile clip_masks")
// is morphological, via a Euclidean distance transform: SEAMLESS along any run
// (REQ-0131), ROUNDS convex (outer) corners while keeping concave (inner)
// corners sharp (BS-G4 rounded-corner blend), total over holes. corner_radius=0
// reproduces the plain square fill (neutral default = no visual change). No
// Pixi/DOM/IO; deterministic.
// REQ-0266 (D2): a RASTER fill path joins the palette-procedural one. When the
// def declares art.fill_texture AND the caller supplies the decoded pixels, the
// interior is tiled from that raster; the welt/edge treatment, the silhouette
// rounding and the LAYER assignment are untouched, so checks.ts reads a
// textured composite exactly as it reads a palette one. Absent either input the
// palette path runs UNCHANGED -- that is the byte-identity the harness golden
// pins for neutral/devornate.
// REQ-0291: the welt ring can also be CUT FROM THE ARTWORK'S AUTHORED FRAME
// instead of painted procedurally. When the caller supplies FrameStrips (two
// directional welt strips sliced from the source's padding band -- see
// bpSkinTexture.decode) AND def.art.frame_band_px > 0, the ring samples them via
// the EDT nearest-feature transform: depth (distance to the nearest outside
// pixel) picks the strip row outer->inner, the sign of the offset picks stripH
// vs stripV, and the along-edge coordinate is mirror-tiled -- the TS port of
// tools/bpskin_compose.py's welt_strips/welt_render (straights, both corner
// types and holes fall out of one transform, no autotile atlas). Absent the
// strips (or frame_band_px), the procedural welt path runs BYTE-IDENTICAL to
// today -- the pinned neutral/devornate goldens are the proof. No feather in v1
// (crisp ring/fill boundary; the tool's 2px Gaussian is deliberately dropped so
// the goldens stay deterministic -- recorded in REQ-0291).
import { resolveAutotile, type Cell } from "./autotile";
import type { BpSkinDef } from "./skinRegistry";
export interface CompositeParams { cellPx: number; margin: number; }
export const DEFAULT_PARAMS: CompositeParams = { cellPx: 48, margin: 1 };
export const LAYER = { bg: 0, welt: 1, fill: 2, override: 3 } as const;
export interface RenderedComposite { width: number; height: number; rgba: Uint8Array; layer: Uint8Array; sil: Uint8Array; rs: Uint8Array; cellPx: number; margin: number; r0: number; c0: number; }
function hexToRgb(hex: string): [number, number, number] { const h = hex.replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function edt1d(f: Float64Array): Float64Array {
  const n = f.length; const d = new Float64Array(n); const v = new Int32Array(n); const z = new Float64Array(n + 1);
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; d[q] = dq * dq + f[v[k]]; }
  return d;
}
function edtToTrue(mask: Uint8Array, W: number, H: number): Float64Array {
  const INF = 1e12; const g = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = mask[i] ? 0 : INF;
  const col = new Float64Array(H);
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) col[y] = g[y * W + x]; const dc = edt1d(col); for (let y = 0; y < H; y++) g[y * W + x] = dc[y]; }
  const row = new Float64Array(W);
  for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) row[x] = g[y * W + x]; const dr = edt1d(row); for (let x = 0; x < W; x++) g[y * W + x] = dr[x]; }
  const out = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = Math.sqrt(g[i]);
  return out;
}
// REQ-0291: the SAME Felzenszwalb 1D EDT, but it also returns which vertex (the
// nearest feature index ALONG THIS AXIS) won each output cell -- the ingredient
// scipy's distance_transform_edt(return_indices=True) threads through its two
// passes. INF is the finite 1e12 the whole module uses, chosen so the (f[q]+q^2)
// - (f[v]+v^2) subtraction cancels it exactly (no NaN) even when a whole line is
// background.
function edt1dIdx(f: Float64Array): { d: Float64Array; arg: Int32Array } {
  const n = f.length; const d = new Float64Array(n); const arg = new Int32Array(n);
  const v = new Int32Array(n); const z = new Float64Array(n + 1);
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; d[q] = dq * dq + f[v[k]]; arg[q] = v[k]; }
  return { d, arg };
}
export interface FeatureEDT { dist: Float64Array; iy: Int32Array; ix: Int32Array; }
/** REQ-0291: distance to the nearest mask==1 (feature) pixel AND the index of
 * that pixel, for every cell -- the TS port of scipy
 * distance_transform_edt(return_indices=True). Two passes: pass 1 (columns)
 * records the nearest feature-ROW per cell; pass 2 (rows) picks the winning
 * feature-COLUMN and reads that column's pass-1 feature-row. Pure, Node-runnable
 * (the offline harnesses ssr-load this file); property-checked against a
 * brute-force scan in check_bpskin.mjs. */
export function nearestFeatureEDT(mask: Uint8Array, W: number, H: number): FeatureEDT {
  const INF = 1e12; const g = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = mask[i] ? 0 : INF;
  const iy1 = new Int32Array(W * H);
  const col = new Float64Array(H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) col[y] = g[y * W + x];
    const r = edt1dIdx(col);
    for (let y = 0; y < H; y++) { g[y * W + x] = r.d[y]; iy1[y * W + x] = r.arg[y]; }
  }
  const iy = new Int32Array(W * H); const ix = new Int32Array(W * H);
  const row = new Float64Array(W);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) row[x] = g[y * W + x];
    const r = edt1dIdx(row);
    for (let x = 0; x < W; x++) { g[y * W + x] = r.d[x]; const wx = r.arg[x]; ix[y * W + x] = wx; iy[y * W + x] = iy1[y * W + wx]; }
  }
  const dist = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) dist[i] = Math.sqrt(g[i]);
  return { dist, iy, ix };
}
/** REQ-0266 (D2): a decoded fill raster, handed IN by the caller. Deliberately
 * NOT an HTMLImageElement: compositeSkin() must stay callable from plain Node --
 * three offline harnesses ssr-load this module and there is no DOM there -- so
 * DECODING is the caller's job and this module only ever sees pixels. */
export interface FillRaster { width: number; height: number; rgba: Uint8ClampedArray; }
/** REQ-0291: the authored frame band, sliced once by bpSkinTexture.decode into
 * two DIRECTIONAL welt strips (outer->inner order preserved) plus the native
 * band thickness in source px. stripH: a horizontal run (rows 0..band x a mid
 * column slice); stripV: the vertical transpose. frameBandPx is the strip's own
 * depth resolution AND the reference the board band B is resampled from. */
export interface FrameStrips { stripH: FillRaster; stripV: FillRaster; frameBandPx: number; }
/** The raster path is taken only when the def DECLARES a texture AND a usable
 * raster was actually supplied. Either one missing = today's palette-procedural
 * path, byte for byte -- which is what `neutral` and `devornate` render through
 * and what the bpskin harness golden pins. Missing art never blocks a draw. */
/** Does this def declare REAL ART? THE predicate, exported because the board's
 * paint guard (skin/bpSkinTexture.ts's bpSkinSprite) and this compositor's own
 * raster path must never disagree about what "has a texture" means. It lives
 * here, in the pure Node-loadable module the renderer, the gates and the offline
 * harnesses can all reach. Note the two different right answers it drives: a def
 * that declares no texture renders palette-procedural HERE (an offline PNG wants
 * a solid body) and renders NOTHING AT ALL on the board (where an opaque body
 * would cover the per-BP colour tint). */
export function declaresFillTexture(def: BpSkinDef): boolean {
  return !!def.art && typeof def.art.fill_texture === "string" && def.art.fill_texture.length > 0;
}
function fillTile(def: BpSkinDef, raster?: FillRaster | null): FillRaster | null {
  if (!declaresFillTexture(def) || !raster) return null;
  if (!(raster.width > 0) || !(raster.height > 0)) return null;
  if (!raster.rgba || raster.rgba.length < raster.width * raster.height * 4) return null;
  return raster;
}
/** Tiles the raster in COMPOSITE space (not per cell), so a multi-cell BP wears
 * ONE continuous texture and a run of cells has no seam at its internal cell
 * borders (REQ-0131's seamless-along-any-run law, now for real pixels). Alpha is
 * composited over the palette fill, so a texture with holes reads as the skin's
 * own colour instead of punching through to the board. */
function sampleTile(t: FillRaster, x: number, y: number, base: [number, number, number]): [number, number, number] {
  const sx = ((x % t.width) + t.width) % t.width;
  const sy = ((y % t.height) + t.height) % t.height;
  const o = (sy * t.width + sx) * 4;
  const a = t.rgba[o + 3] / 255;
  if (a >= 1) return [t.rgba[o], t.rgba[o + 1], t.rgba[o + 2]];
  return [
    Math.round(t.rgba[o] * a + base[0] * (1 - a)),
    Math.round(t.rgba[o + 1] * a + base[1] * (1 - a)),
    Math.round(t.rgba[o + 2] * a + base[2] * (1 - a)),
  ];
}
/** REQ-0291: reflect an index into [0, L) -- mirror-tiling, so a repeated welt
 * run has no hard seam where it wraps (the port of bpskin_compose.py's _mirror). */
function mirror(i: number, L: number): number {
  const per = Math.max(2 * L - 2, 1);
  const m = ((i % per) + per) % per;
  return m < L ? m : per - m;
}
/** REQ-0291: sample a welt strip and alpha-composite over the skin fill exactly
 * as sampleTile does. `along` is the along-edge coordinate (mirror-tiled over
 * `alongLen`); `depth` is the outer->inner row/col (clamped to the strip). The
 * H/V split is the pixel layout: stripH indexes [depth-row, along-col], stripV
 * indexes [along-row, depth-col]. */
function sampleStripH(t: FillRaster, along: number, depth: number, base: [number, number, number]): [number, number, number] {
  const w = t.width, h = t.height;
  const sx = mirror(along, w);
  const sy = depth < 0 ? 0 : (depth >= h ? h - 1 : depth);
  return stripPixel(t, sy * w + sx, base);
}
function sampleStripV(t: FillRaster, along: number, depth: number, base: [number, number, number]): [number, number, number] {
  const w = t.width, h = t.height;
  const sy = mirror(along, h);
  const sx = depth < 0 ? 0 : (depth >= w ? w - 1 : depth);
  return stripPixel(t, sy * w + sx, base);
}
function stripPixel(t: FillRaster, idx: number, base: [number, number, number]): [number, number, number] {
  const o = idx * 4;
  const a = t.rgba[o + 3] / 255;
  if (a >= 1) return [t.rgba[o], t.rgba[o + 1], t.rgba[o + 2]];
  return [
    Math.round(t.rgba[o] * a + base[0] * (1 - a)),
    Math.round(t.rgba[o + 1] * a + base[1] * (1 - a)),
    Math.round(t.rgba[o + 2] * a + base[2] * (1 - a)),
  ];
}
function stripsUsable(f: FrameStrips | null | undefined): f is FrameStrips {
  if (!f || !(f.frameBandPx > 0)) return false;
  const h = f.stripH, v = f.stripV;
  if (!h || !v) return false;
  if (!(h.width > 0) || !(h.height > 0) || !(v.width > 0) || !(v.height > 0)) return false;
  if (!h.rgba || h.rgba.length < h.width * h.height * 4) return false;
  if (!v.rgba || v.rgba.length < v.width * v.height * 4) return false;
  return true;
}
export function compositeSkin(cells: ReadonlyArray<Cell>, def: BpSkinDef, bg: string, params: CompositeParams = DEFAULT_PARAMS, raster?: FillRaster | null, frame?: FrameStrips | null): RenderedComposite {
  const cellPx = params.cellPx;
  const rows = cells.map((c) => c[0]); const colsA = cells.map((c) => c[1]);
  const r0 = Math.min(...rows), c0 = Math.min(...colsA), r1 = Math.max(...rows), c1 = Math.max(...colsA);
  const W = (c1 - c0 + 1 + 2 * params.margin) * cellPx;
  const H = (r1 - r0 + 1 + 2 * params.margin) * cellPx;
  const N = W * H;
  const occ = new Set<string>();
  for (const [r, c] of cells) occ.add(r + "," + c);
  const sil = new Uint8Array(N); const cellIdx = new Int32Array(N).fill(-1);
  for (let y = 0; y < H; y++) {
    const cr = r0 - params.margin + Math.floor(y / cellPx);
    for (let x = 0; x < W; x++) { const cc = c0 - params.margin + Math.floor(x / cellPx); if (occ.has(cr + "," + cc)) { sil[y * W + x] = 1; cellIdx[y * W + x] = (cr - r0) * 1000 + (cc - c0); } }
  }
  const scale = cellPx / 64; const R = Math.max(0, def.corner_radius) * scale;
  const tile = fillTile(def, raster);
  // REQ-0291: the strip welt path is taken only when the def declares a frame
  // band (def.art.frame_band_px > 0), usable strips were supplied AND a fill
  // raster is in hand (both are sliced from the same source by decode, so they
  // arrive together). Otherwise B and the ring fall back to the procedural welt,
  // byte-identical to pre-REQ-0291.
  const fbp = def.art && typeof def.art.frame_band_px === "number" ? def.art.frame_band_px : 0;
  const useStrips = fbp > 0 && stripsUsable(frame) && !!tile;
  const SRC_PX = 1024; // bpskin artworks are locked 1024^2 (skinRegistry / art.cjs)
  const band = useStrips ? (frame as FrameStrips).frameBandPx : 0;
  // Board band width. On the strip path the band shares the FILL TILE's downscale
  // (tile.width px == SRC_PX source px), so frame and fill stay one material;
  // clamped to [3, cellPx]. On the procedural path it is the ratified
  // border_band * cellPx/64 -- unchanged, which is the golden byte-identity.
  const B = useStrips
    ? Math.min(cellPx, Math.max(3, Math.round(band * (tile as FillRaster).width / SRC_PX)))
    : Math.max(0, def.border_band) * scale;
  const notSil = new Uint8Array(N); for (let i = 0; i < N; i++) notSil[i] = sil[i] ? 0 : 1;
  const dIn = edtToTrue(notSil, W, H);
  const eroded = new Uint8Array(N); for (let i = 0; i < N; i++) eroded[i] = sil[i] && dIn[i] >= R ? 1 : 0;
  const dErode = edtToTrue(eroded, W, H);
  const rs = new Uint8Array(N); for (let i = 0; i < N; i++) rs[i] = dErode[i] <= R ? 1 : 0;
  const notRs = new Uint8Array(N); for (let i = 0; i < N; i++) notRs[i] = rs[i] ? 0 : 1;
  // The ring distance: dRs is the distance to the nearest OUTSIDE (not-rs) pixel.
  // On the strip path we need that pixel's INDEX too (which strip, which depth),
  // so we take the feature-index EDT; its .dist is identical to edtToTrue(notRs),
  // so the ring predicate is unchanged.
  const feat = useStrips ? nearestFeatureEDT(notRs, W, H) : null;
  const dRs = feat ? feat.dist : edtToTrue(notRs, W, H);
  const bgc = hexToRgb(bg), fillC = hexToRgb(def.palette.fill), fill2C = hexToRgb(def.palette.fill2 || def.palette.fill), weltC = hexToRgb(def.palette.welt || def.palette.fill);
  const weltDark: [number, number, number] = [Math.max(0, weltC[0] - 40), Math.max(0, weltC[1] - 40), Math.max(0, weltC[2] - 40)];
  const rgba = new Uint8Array(N * 4); const layer = new Uint8Array(N);
  const hasOverride = !!def.palette.fill2 && def.palette.fill2 !== def.palette.fill;
  const stripH = useStrips ? (frame as FrameStrips).stripH : null;
  const stripV = useStrips ? (frame as FrameStrips).stripV : null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let col: [number, number, number] = bgc as [number, number, number]; let lay: number = LAYER.bg;
    if (rs[i]) {
      if (B > 0 && dRs[i] <= B) {
        if (useStrips && feat) {
          // Offset to the nearest outside pixel: |dy|>=|dx| => the nearest edge
          // runs horizontally => sample stripH; depth resamples dRs in [0,B] onto
          // the strip's native rows [0,band-1] (outer->inner). Along-edge coord is
          // the composite pixel, mirror-tiled over the strip length.
          const dy = y - feat.iy[i], dx = x - feat.ix[i];
          let depth = Math.round((dRs[i] / B) * (band - 1)); if (depth < 0) depth = 0; else if (depth > band - 1) depth = band - 1;
          col = (Math.abs(dy) >= Math.abs(dx))
            ? sampleStripH(stripH as FillRaster, x, depth, fillC as [number, number, number])
            : sampleStripV(stripV as FillRaster, y, depth, fillC as [number, number, number]);
        } else {
          const notch = ((x + y) % 12) < 5; col = notch ? weltDark : (weltC as [number, number, number]);
        }
        lay = LAYER.welt;
      }
      else if (tile) { col = sampleTile(tile, x, y, fillC as [number, number, number]); lay = LAYER.fill; }
      else { const key = cellIdx[i]; const cr = Math.floor(key / 1000); const cc = key - cr * 1000; if (hasOverride && ((cr + cc) & 1)) { col = fill2C as [number, number, number]; lay = LAYER.override; } else { col = fillC as [number, number, number]; lay = LAYER.fill; } }
    }
    rgba[i * 4] = col[0]; rgba[i * 4 + 1] = col[1]; rgba[i * 4 + 2] = col[2]; rgba[i * 4 + 3] = 255; layer[i] = lay;
  }
  void resolveAutotile(cells);
  return { width: W, height: H, rgba, layer, sil, rs, cellPx, margin: params.margin, r0, c0 };
}
