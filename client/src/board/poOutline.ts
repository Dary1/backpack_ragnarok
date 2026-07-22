// client/src/board/poOutline.ts -- REQ-0273 (feature): per-PO cell-footprint
// outlines.
//
// WHY: on a crowded board it is hard to read which cells belong to which item.
// Each placed PO therefore gets its footprint boundary traced and stroked --
// but 3px INSIDE the boundary, not on it. The inset is the design: two
// adjacent POs keep two separate closed loops with a dark seam between them
// (a boundary-centred line would fuse into one thick stroke), and the PO line
// can never sit on top of the BP's own boundary-centred 3px colour outline
// (BoardRenderer's BP loop), which stays the BP's signature.
//
// STROKE: two-tone "ink + rim", the cel look's own legibility trick. A 4px
// near-black ink band under a 1.5px pale-steel rim, both centred on the same
// inset path. The dark halo separates the rim from bright backgrounds (BP
// colour tints at 0.26, REQ-0266 skin rasters, REQ-0033 usage washes); the
// light rim separates it from the dark grid (#191919/#242424). One calm
// neutral for every item -- identity stays the art's job, the outline only
// answers "which cells are mine". #0e0d0b and #d7dfe6 are both established
// board colours (unit core / merged-assembly outline), nothing new is minted.
//
// GEOMETRY: pure and node-testable (client/scripts/check_po_outline.mjs).
// boundaryLoops() walks directed boundary edges with the interior kept on the
// LEFT, so insetLoop()'s inward normal is always (dy,-dx) -- the standard
// rectilinear polygon inset, exact for any 90-degree corner as long as
// 2*inset < CELL. Touching-corner vertices (two outgoing boundary edges) are
// resolved by preferring the tightest LEFT turn, which keeps each region's
// loop tight around itself. Collinear runs are merged so every remaining
// vertex is a true corner.
import type { Cell } from '../engine/engine.d.ts';
import { CELL, PAD } from './geom';

/** Structural stand-in for the slice of PixiJS's Graphics this module needs.
 * Declared here INSTEAD of importing pixi.js so the module stays pure and the
 * node gate (client/scripts/check_po_outline.mjs) can ssr-load it without a
 * renderer -- the same zero-import discipline board/skin/'s pure modules keep.
 * Pixi v8's Graphics satisfies it structurally. */
export interface OutlinePath {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  closePath(): unknown;
  stroke(style: { color: string; width: number; alpha: number; join?: 'miter'; cap?: 'butt' }): unknown;
}

/** Inset (px) of the outline path inside the footprint boundary. */
export const PO_OUTLINE_INSET = 3;
export const PO_OUTLINE_INK = { color: '#0e0d0b', width: 4, alpha: 0.85 } as const;
export const PO_OUTLINE_RIM = { color: '#d7dfe6', width: 1.5, alpha: 0.8 } as const;

/** An (x,y) point. In boundaryLoops' output the unit is CELLS (x=0 at the
 * grid's left edge, y=0 at its top edge); callers scale to px themselves. */
export type Pt = [number, number];

const keyOf = (r: number, c: number): string => r + ',' + c;

/**
 * Closed boundary loop(s) of a set of grid cells ([row,col], 1-based), as
 * grid-VERTEX points in cell units, interior on the left of the walk
 * direction. One loop per boundary contour (a disconnected footprint, or one
 * with a hole, yields several). Every returned vertex is a corner (collinear
 * points merged); the loop is implicitly closed (last -> first).
 */
export function boundaryLoops(cells: Cell[]): Pt[][] {
  const set = new Set(cells.map(([r, c]) => keyOf(r, c)));
  // Directed boundary edges, interior on the LEFT. Vertex (x,y) = (col,row)
  // in cell units: cell (r,c) owns vertices x in {c-1,c}, y in {r-1,r}.
  const edges = new Map<string, Pt[][]>(); // startKey -> [start,end][]
  const addEdge = (x0: number, y0: number, x1: number, y1: number): void => {
    const k = x0 + ',' + y0;
    const list = edges.get(k) ?? [];
    list.push([[x0, y0], [x1, y1]]);
    edges.set(k, list);
  };
  for (const [r, c] of cells) {
    if (!set.has(keyOf(r - 1, c))) addEdge(c, r - 1, c - 1, r - 1); // top: walk west
    if (!set.has(keyOf(r + 1, c))) addEdge(c - 1, r, c, r); // bottom: walk east
    if (!set.has(keyOf(r, c - 1))) addEdge(c - 1, r - 1, c - 1, r); // left: walk south
    if (!set.has(keyOf(r, c + 1))) addEdge(c, r, c, r - 1); // right: walk north
  }
  const loops: Pt[][] = [];
  // REQ-0284 (hotfix hardening): each takeFrom() consumes exactly one directed
  // boundary edge, so a well-formed walk is bounded by the initial edge count. A
  // generous HARD budget makes a malformed / degenerate cell set (the walk's
  // "never happens for a real footprint" assumption) bail with a warning + a
  // partial result rather than ever spinning the main thread.
  let stepBudget = 16;
  for (const list of edges.values()) stepBudget += 2 * list.length;
  const takeFrom = (k: string, prefer: Pt | null): Pt[] | null => {
    const list = edges.get(k);
    if (!list || list.length === 0) return null;
    let idx = 0;
    if (prefer && list.length > 1) {
      // Touching corner: two outgoing edges. Prefer the tightest LEFT turn
      // relative to the incoming direction `prefer` -- left, then straight,
      // then right -- so each region's loop closes around itself.
      const score = (e: Pt[]): number => {
        const dx = e[1][0] - e[0][0];
        const dy = e[1][1] - e[0][1];
        if (dx === prefer[1] && dy === -prefer[0]) return 0; // left turn
        if (dx === prefer[0] && dy === prefer[1]) return 1; // straight
        return 2; // right turn
      };
      idx = list.map((e, i) => [score(e), i] as const).sort((a, b) => a[0] - b[0])[0][1];
    }
    const [e] = list.splice(idx, 1);
    if (list.length === 0) edges.delete(k);
    return e;
  };
  for (;;) {
    if (stepBudget-- <= 0) {
      console.warn('poOutline.boundaryLoops: step budget exhausted; returning partial outline');
      return loops;
    }
    const firstKey = edges.keys().next();
    if (firstKey.done) break;
    const first = takeFrom(firstKey.value, null)!;
    const pts: Pt[] = [first[0], first[1]];
    let dir: Pt = [first[1][0] - first[0][0], first[1][1] - first[0][1]];
    for (;;) {
      if (stepBudget-- <= 0) {
        console.warn('poOutline.boundaryLoops: step budget exhausted; returning partial outline');
        return loops;
      }
      const cur = pts[pts.length - 1];
      if (cur[0] === pts[0][0] && cur[1] === pts[0][1]) break; // closed
      const next = takeFrom(cur[0] + ',' + cur[1], dir);
      if (!next) break; // malformed input; never happens for a real footprint
      dir = [next[1][0] - next[0][0], next[1][1] - next[0][1]];
      pts.push(next[1]);
    }
    pts.pop(); // drop the duplicated closing vertex
    // merge collinear runs (including across the loop seam)
    const merged: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const collinear = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) === 0;
      if (!collinear) merged.push(b);
    }
    if (merged.length >= 4) loops.push(merged);
  }
  return loops;
}

/**
 * Insets a rectilinear loop (interior on the left, corners only) by `d`
 * toward its interior. Exact for 90-degree corners: each vertex shifts by
 * d along BOTH adjacent edges' inward normals ((dy,-dx) for direction
 * (dx,dy)). Units are whatever the input is in (px at the draw site).
 */
export function insetLoop(loop: Pt[], d: number): Pt[] {
  const n = loop.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = loop[i];
    const prev = loop[(i + n - 1) % n];
    const next = loop[(i + 1) % n];
    const inDir: Pt = [Math.sign(p[0] - prev[0]), Math.sign(p[1] - prev[1])];
    const outDir: Pt = [Math.sign(next[0] - p[0]), Math.sign(next[1] - p[1])];
    out.push([
      p[0] + d * (inDir[1] + outDir[1]),
      p[1] + d * (-inDir[0] - outDir[0]),
    ]);
  }
  return out;
}

/** Draws the two-tone footprint outline for `cells` into `g` (board px). */
export function drawPOOutline(g: OutlinePath, cells: Cell[]): void {
  const loops = boundaryLoops(cells).map((loop) =>
    insetLoop(loop.map(([x, y]) => [PAD + x * CELL, PAD + y * CELL] as Pt), PO_OUTLINE_INSET)
  );
  const trace = (): void => {
    for (const loop of loops) {
      g.moveTo(loop[0][0], loop[0][1]);
      for (let i = 1; i < loop.length; i++) g.lineTo(loop[i][0], loop[i][1]);
      g.closePath();
    }
  };
  trace();
  g.stroke({ color: PO_OUTLINE_INK.color, width: PO_OUTLINE_INK.width, alpha: PO_OUTLINE_INK.alpha, join: 'miter', cap: 'butt' });
  trace();
  g.stroke({ color: PO_OUTLINE_RIM.color, width: PO_OUTLINE_RIM.width, alpha: PO_OUTLINE_RIM.alpha, join: 'miter', cap: 'butt' });
}
