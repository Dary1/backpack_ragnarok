// client/src/board/skin/checks.ts -- REQ-0126. S3 MACHINE CHECKS (pipeline
// §3/§5 + BS-G4). Pure functions over a RenderedComposite; UGC-ready, no hand
// review. leakage: no fill/welt pixel outside the clip mask. coverage: fill
// actually rendered (REQ-0138: leakage passes trivially on an EMPTY composite).
// seams: rounded silhouette + welt ring keep the shape's component/hole counts.
// roundedBlend: convex corners trimmed to background when a radius is declared,
// square when not -- tied to the autotile resolver's outer-corner selection.
import { LAYER, type RenderedComposite } from "./composite";
import { resolveAutotile, type Cell } from "./autotile";
import type { BpSkinDef } from "./skinRegistry";
export interface Finding { check: string; ok: boolean; detail: string; }
export interface CheckReport { pass: boolean; findings: Finding[]; }
function comps(mask: Uint8Array, W: number, H: number): number {
  const seen = new Uint8Array(W * H); const st: number[] = []; let c = 0;
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || seen[s]) continue; c++; st.push(s); seen[s] = 1;
    while (st.length) { const p = st.pop() as number; const px = p % W; const py = (p - px) / W; const nb = [px > 0 ? p - 1 : -1, px < W - 1 ? p + 1 : -1, py > 0 ? p - W : -1, py < H - 1 ? p + W : -1]; for (const q of nb) if (q >= 0 && mask[q] && !seen[q]) { seen[q] = 1; st.push(q); } }
  }
  return c;
}
function holes(rs: Uint8Array, W: number, H: number): number {
  const bg = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) bg[i] = rs[i] ? 0 : 1;
  const seen = new Uint8Array(W * H); const st: number[] = [];
  for (let x = 0; x < W; x++) { st.push(x); st.push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { st.push(y * W); st.push(y * W + W - 1); }
  while (st.length) { const p = st.pop() as number; if (p < 0 || p >= W * H || seen[p] || !bg[p]) continue; seen[p] = 1; const px = p % W; const py = (p - px) / W; if (px > 0) st.push(p - 1); if (px < W - 1) st.push(p + 1); if (py > 0) st.push(p - W); if (py < H - 1) st.push(p + W); }
  let h = 0; const s2 = new Uint8Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!bg[s] || seen[s] || s2[s]) continue; h++; const q2 = [s]; s2[s] = 1;
    while (q2.length) { const p = q2.pop() as number; const px = p % W; const py = (p - px) / W; const nb = [px > 0 ? p - 1 : -1, px < W - 1 ? p + 1 : -1, py > 0 ? p - W : -1, py < H - 1 ? p + W : -1]; for (const q of nb) if (q >= 0 && bg[q] && !seen[q] && !s2[q]) { s2[q] = 1; q2.push(q); } }
  }
  return h;
}
export function checkComposite(comp: RenderedComposite, cells: ReadonlyArray<Cell>, def: BpSkinDef, expectedShapeComponents = 1): CheckReport {
  const { rgba, layer, rs, sil, width: W, height: H, cellPx, r0, c0, margin } = comp;
  const findings: Finding[] = [];
  let leaks = 0; for (let i = 0; i < W * H; i++) if (layer[i] !== LAYER.bg && !rs[i]) leaks++;
  findings.push({ check: "leakage", ok: leaks === 0, detail: `${leaks} clipped pixels drew outside clip mask` });
  let filled = 0, rsCount = 0; for (let i = 0; i < W * H; i++) { if (rs[i]) rsCount++; if (layer[i] === LAYER.fill || layer[i] === LAYER.override) filled++; }
  const cov = rsCount ? filled / rsCount : 0;
  findings.push({ check: "coverage", ok: cov > 0.35, detail: `fill covers ${(cov * 100).toFixed(1)}% of clip mask` });
  const rsComp = comps(rs, W, H);
  findings.push({ check: "seams.components", ok: rsComp === expectedShapeComponents, detail: `rounded silhouette has ${rsComp} components (expected ${expectedShapeComponents})` });
  if (def.border_band > 0) { const welt = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) welt[i] = layer[i] === LAYER.welt ? 1 : 0; const wc = comps(welt, W, H); const expectedWelt = expectedShapeComponents + holes(rs, W, H); findings.push({ check: "seams.weltRing", ok: wc === expectedWelt, detail: `welt ring has ${wc} components (expected ${expectedWelt} = ${expectedShapeComponents} outer + ${holes(rs, W, H)} hole boundaries)` }); }
  const tiles = resolveAutotile(cells).filter((t) => t.kind === "outer");
  let roundedOk = true, checked = 0;
  for (const t of tiles) {
    const cx = (t.c - c0 + margin) * cellPx, cy = (t.r - r0 + margin) * cellPx; let px = cx, py = cy;
    if (t.quadrant === "NE") px = cx + cellPx - 1; else if (t.quadrant === "SW") py = cy + cellPx - 1; else if (t.quadrant === "SE") { px = cx + cellPx - 1; py = cy + cellPx - 1; }
    const isBg = layer[py * W + px] === LAYER.bg; checked++;
    if (def.corner_radius > 0 && !isBg) roundedOk = false;
    if (def.corner_radius === 0 && isBg) roundedOk = false;
  }
  findings.push({ check: "roundedBlend", ok: roundedOk, detail: def.corner_radius > 0 ? `${checked} convex corners rounded to background` : `${checked} convex corners square` });
  findings.push({ check: "holes", ok: holes(rs, W, H) >= holes(sil, W, H), detail: `silhouette holes ${holes(sil, W, H)}, rounded ${holes(rs, W, H)}` });
  void rgba;
  return { pass: findings.every((f) => f.ok), findings };
}
