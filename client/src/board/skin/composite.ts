// client/src/board/skin/composite.ts -- REQ-0126. PURE deterministic RGBA
// compositor for the skin rendering stack (pipeline §2, spec items 1 & 5). The
// ONE truth the S3 harness rasterizes and the machine checks run against. The
// clip stage ("fill_texture clipped by cell interiors + edge-tile clip_masks")
// is morphological, via a Euclidean distance transform: SEAMLESS along any run
// (REQ-0131), ROUNDS convex (outer) corners while keeping concave (inner)
// corners sharp (BS-G4 rounded-corner blend), total over holes. corner_radius=0
// reproduces the plain square fill (neutral default = no visual change). No
// Pixi/DOM/IO; deterministic.
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
export function compositeSkin(cells: ReadonlyArray<Cell>, def: BpSkinDef, bg: string, params: CompositeParams = DEFAULT_PARAMS): RenderedComposite {
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
  const scale = cellPx / 64; const R = Math.max(0, def.corner_radius) * scale; const B = Math.max(0, def.border_band) * scale;
  const notSil = new Uint8Array(N); for (let i = 0; i < N; i++) notSil[i] = sil[i] ? 0 : 1;
  const dIn = edtToTrue(notSil, W, H);
  const eroded = new Uint8Array(N); for (let i = 0; i < N; i++) eroded[i] = sil[i] && dIn[i] >= R ? 1 : 0;
  const dErode = edtToTrue(eroded, W, H);
  const rs = new Uint8Array(N); for (let i = 0; i < N; i++) rs[i] = dErode[i] <= R ? 1 : 0;
  const notRs = new Uint8Array(N); for (let i = 0; i < N; i++) notRs[i] = rs[i] ? 0 : 1;
  const dRs = edtToTrue(notRs, W, H);
  const bgc = hexToRgb(bg), fillC = hexToRgb(def.palette.fill), fill2C = hexToRgb(def.palette.fill2 || def.palette.fill), weltC = hexToRgb(def.palette.welt || def.palette.fill);
  const weltDark: [number, number, number] = [Math.max(0, weltC[0] - 40), Math.max(0, weltC[1] - 40), Math.max(0, weltC[2] - 40)];
  const rgba = new Uint8Array(N * 4); const layer = new Uint8Array(N);
  const hasOverride = !!def.palette.fill2 && def.palette.fill2 !== def.palette.fill;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let col: [number, number, number] = bgc as [number, number, number]; let lay: number = LAYER.bg;
    if (rs[i]) {
      if (B > 0 && dRs[i] <= B) { const notch = ((x + y) % 12) < 5; col = notch ? weltDark : (weltC as [number, number, number]); lay = LAYER.welt; }
      else { const key = cellIdx[i]; const cr = Math.floor(key / 1000); const cc = key - cr * 1000; if (hasOverride && ((cr + cc) & 1)) { col = fill2C as [number, number, number]; lay = LAYER.override; } else { col = fillC as [number, number, number]; lay = LAYER.fill; } }
    }
    rgba[i * 4] = col[0]; rgba[i * 4 + 1] = col[1]; rgba[i * 4 + 2] = col[2]; rgba[i * 4 + 3] = 255; layer[i] = lay;
  }
  void resolveAutotile(cells);
  return { width: W, height: H, rgba, layer, sil, rs, cellPx, margin: params.margin, r0, c0 };
}
