// client/src/board/skin/autotile.ts -- REQ-0126. THE autotile RESOLVER
// (pipeline doc §2/§3, spec item 2). Any BP polyomino -- inner corners and
// holes included -- is decomposed by the CORNER (2-corner blob/marching-
// squares) method: each occupied cell splits into four QUADRANTS; a quadrant
// borders two sides + one diagonal, so classification is one of four local
// configs -> total over arbitrary shapes. Members: straight / outer (convex)
// corner / inner (concave) corner / interior. Orientation: BS-G5 DEFAULT --
// authored/derived at BUILD time, NO renderer rotation; `orient` (0..3) is
// DATA. Pure: no Pixi/DOM/IO.
export type Cell = readonly [number, number];
export type Quadrant = "NW" | "NE" | "SE" | "SW";
export type Side = "N" | "E" | "S" | "W";
export type TileKind = "interior" | "straight" | "outer" | "inner";
export interface QuadTile { r: number; c: number; quadrant: Quadrant; kind: TileKind; facing: Side | Quadrant | null; orient: 0 | 1 | 2 | 3; }
export function cellKey(r: number, c: number): string { return r + "," + c; }
function occ(s: Set<string>, r: number, c: number): boolean { return s.has(cellKey(r, c)); }
const SO: Record<Side, 0 | 1 | 2 | 3> = { N: 0, E: 1, S: 2, W: 3 };
const CO: Record<Quadrant, 0 | 1 | 2 | 3> = { NW: 0, NE: 1, SE: 2, SW: 3 };
function classify(r: number, c: number, q: Quadrant, a: readonly [Side, boolean], b: readonly [Side, boolean], diag: boolean): QuadTile {
  const [sa, ao] = a; const [sb, bo] = b;
  if (!ao && !bo) return { r, c, quadrant: q, kind: "outer", facing: q, orient: CO[q] };
  if (ao && bo) { if (diag) return { r, c, quadrant: q, kind: "interior", facing: null, orient: 0 }; return { r, c, quadrant: q, kind: "inner", facing: q, orient: CO[q] }; }
  const exposed: Side = ao ? sb : sa;
  return { r, c, quadrant: q, kind: "straight", facing: exposed, orient: SO[exposed] };
}
export function resolveAutotile(cells: ReadonlyArray<Cell>): QuadTile[] {
  const set = new Set<string>();
  for (const [r, c] of cells) set.add(cellKey(r, c));
  const ordered = Array.from(set).map((k) => k.split(",").map(Number) as [number, number]).sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]));
  const out: QuadTile[] = [];
  for (const [r, c] of ordered) {
    const N = occ(set, r - 1, c), S = occ(set, r + 1, c), W = occ(set, r, c - 1), E = occ(set, r, c + 1);
    const NW = occ(set, r - 1, c - 1), NE = occ(set, r - 1, c + 1), SE = occ(set, r + 1, c + 1), SW = occ(set, r + 1, c - 1);
    out.push(classify(r, c, "NW", ["N", N], ["W", W], NW));
    out.push(classify(r, c, "NE", ["N", N], ["E", E], NE));
    out.push(classify(r, c, "SE", ["S", S], ["E", E], SE));
    out.push(classify(r, c, "SW", ["S", S], ["W", W], SW));
  }
  return out;
}
export function tileHistogram(tiles: ReadonlyArray<QuadTile>): Record<TileKind, number> {
  const h: Record<TileKind, number> = { interior: 0, straight: 0, outer: 0, inner: 0 };
  for (const t of tiles) h[t.kind] += 1;
  return h;
}
