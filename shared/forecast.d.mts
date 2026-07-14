// shared/forecast.d.mts -- REQ-0057: the typed surface of shared/forecast.mjs.
//
// Hand-written because shared/ is plain JS by the same invariant that keeps
// mock-src/engine.js hand-written (see client/src/engine/engine.d.ts): one
// source, consumed unforked by both the client (TS/Vite) and node
// (sim/tests). The client resolves `../../shared/forecast.mjs` to THIS file
// (moduleResolution: bundler maps .mjs -> .d.mts); node ignores it entirely.
//
// Drift guard: sim/tests/forecast_parity.cjs exercises every export below
// against sim/lib/{ray,entry,geometry,formation}.cjs, so a signature that
// stops matching the implementation fails CI.

export type Cell = [number, number];
export type FieldBounds = { ROWS: number; COLS: number };
export type Box = { rowMin: number; rowMax: number; colMin: number; colMax: number };

export const FIELD_ROWS: number;
export const FIELD_COLS: number;
export const RAY_STEP_BUDGET: number;
export const ENTRY_JITTER_HALF_WIDTH: number;

export const DIR_VEC: Record<string, Cell>;
export const EDGE_DIRS: Record<string, string[]>;

export function reflectDir(dirName: string, hitRow: number, hitCol: number, ROWS: number, COLS: number): string;
export function stepCell(cell: Cell, dirName: string): Cell;
export function outside(cell: Cell, ROWS: number, COLS: number): boolean;
export function mult(b: number): number;
export function chebyshevDist(a: Cell, b: Cell): number;
export function centroidRoundHalfUp(cells: Cell[]): Cell;
export function cellKey(r: number, c: number): string;

export type WalkResult = {
  /** In-field cells entered, each with the bounce multiplier in force at entry. */
  path: Array<[number, number, number]>;
  landing: Cell | null;
  bounces: number;
  aborted: boolean;
  /** True when the 5-bounce all-field terminator fired (sim: ray_hit_all). */
  allField: boolean;
  endMult: number;
  aoe: number;
};

export function walkRayPath(opts: {
  ROWS: number;
  COLS: number;
  entryCell: Cell;
  dir: string;
  penetration: number;
  aoe: number;
  isOccupied: (r: number, c: number) => boolean;
}): WalkResult;

export function jitterWeights(J: number): Array<{ offset: number; weight: number }>;

export function entryDistribution(
  centroid: Cell,
  edges: string[],
  bounds: FieldBounds,
  J: number,
): Array<{ edge: string; entryCell: Cell; dir: string; weight: number }>;

export function rangeMid(n: number[]): number;
export function expectedDamagePerFire(verb: { t: string; n?: number[]; hits?: number } | null | undefined): number;
export function ratePerSec(trigger: { t: string; s?: number[] } | null | undefined): number;

export type ForecastI18n = { en?: { name?: string }; ja?: { name?: string } };

/** One (enemy, skill) attack profile, as served by GET /api/schedule/forecast. */
export type ForecastProfile = {
  key: string;
  enemyId: string;
  skillId: string;
  /** The SKILL's display name. */
  i18n?: ForecastI18n;
  /** The ENEMY's display name (tooltip renders "<enemy> — <skill>"). */
  enemyI18n?: ForecastI18n;
  /** Attacker centroid on the ENEMY plane (sets the entry projection base). */
  centroid: Cell;
  /** P(this attacker is present in a randomly drawn battle of this dungeon). */
  weight: number;
  edges: string[];
  penetration: number;
  aoe: number;
  aoeStatuses?: boolean;
  /** Expected damage of one firing at bounce multiplier 1.0. */
  damage: number;
  /** Expected firings per second (1 / midpoint of the every_secs range). */
  rate: number;
  /** True when the verb deals no damage (apply_status / add_on_hit_status). */
  statusOnly?: boolean;
};

export type ForecastContributor = {
  key: string;
  enemyId: string;
  skillId: string;
  i18n?: ForecastI18n;
  enemyI18n?: ForecastI18n;
  amount: number;
  statusOnly: boolean;
};

export type ForecastCell = {
  row: number;
  col: number;
  /** Expected incoming ray damage per second on this cell. */
  damage: number;
  /** Expected status-applying ray hits per second on this cell. */
  statusRate: number;
  contributors: ForecastContributor[];
};

export type ForecastResult = {
  /** Keyed by cellKey(row, col). */
  perCell: Map<string, ForecastCell>;
  max: number;
  mean: number;
  total: number;
  rays: number;
};

export function forecastPressure(opts: {
  bounds?: FieldBounds;
  jitterHalfWidth?: number;
  /** cellKey()s of PLAYER-field cells already covered by a backpack. */
  occupied?: Set<string>;
  profiles: ForecastProfile[];
  /** Cells to report on (e.g. one squad's 8x8 box). Defaults to the whole field. */
  cells?: Cell[];
  topN?: number;
}): ForecastResult;

export function parseBox(boxStr: string): Box;
export function boxCells(box: Box): Cell[];
export function canvasToField(box: Box, row0: number, col0: number): Cell;
export function fieldToCanvas(box: Box, row: number, col: number): Cell | null;
