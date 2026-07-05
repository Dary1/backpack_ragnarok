// Shared-field geometry helpers -- REQ-0036 P1-C monitor. The combat sim
// (sim/combat.cjs, docs/combat_spec_draft.md S2/S5) places ray events on
// two independent A1:Z18 planes (26 cols A-Z, 18 rows), one per side
// (`field: 'player' | 'enemy'` on ray_fire). Formation defs
// (content/batches/batch-002-dungeon-pilot/formations.json) place each of
// the 4 unit canvases (8x8 boxes) within that same A1:Z18 space using
// "TopLeft:BottomRight" box strings, e.g. "F2:M9". This module is the
// client-side mirror of sim/combat.cjs's own parseBox/colLetterToIndex --
// re-derived here (not imported) since the client has no access to
// server-only CommonJS modules; kept byte-simple and covered by the
// monitor's own visual smoke test (client/e2e/schedule.spec.ts) rather
// than a unit test file of its own (this is intentionally tiny,
// framework-free arithmetic, same spirit as render/itemCard.ts).
export const FIELD_COLS = 26; // A..Z
export const FIELD_ROWS = 18;

/** "A".."Z" -> 1..26 (1-based, matches sim/combat.cjs's colLetterToIndex). */
export function colLetterToIndex(letter: string): number {
  return letter.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0) + 1;
}

/** A field cell as sim/combat.cjs ACTUALLY emits it on the wire, for the
 * event fields this module resolves (ray_fire's `entry`, ray_bounce's
 * `at`, ray_step's `path[]` entries): a raw `[row, col]` NUMBER TUPLE
 * (both 1-based), NOT a "M9"-style string -- see sim/combat.cjs's
 * `events.push({ ev: 'ray_fire', ..., entry: entryCell.slice() })` /
 * `{ ev: 'ray_bounce', at: next.slice(), ... }` / `{ ev: 'ray_step', path:
 * pathBatch.slice() }`. A "M9"-style STRING id is only ever used for
 * entity/actor LABELS (dst/src -- sim/combat.cjs's maskLabel()), never
 * for a position -- those are unrelated to this type and never flow
 * through cellIdToColRow. `RawCell` is exported so callers (mainly
 * MonitorRenderer.ts) can type their event-field reads without an `any`. */
export type RawCell = [number, number];

/** BUG #4 FIX (REQ-0041) -- root cause: this function used to assume its
 * argument was ALWAYS a "M9"-style string and called `cellId.trim()`
 * unconditionally. sim/combat.cjs's actual ray_fire/ray_bounce/ray_step
 * events carry `entry`/`at`/`path[]` as raw `[row,col]` NUMBER TUPLES,
 * never strings (confirmed by a live repro against the running dev
 * server + a captured browser exception: "TypeError: e.trim is not a
 * function ... at cellIdToColRow ... at cellIdToXY ... at
 * MonitorRenderer.animateStep ... at MonitorRenderer.applyEvents" --
 * `path.map(id => cellIdToXY(id, ...))` threw on the very first
 * `[row,col]` array entry it tried to `.trim()`). Since Monitor.tsx's
 * poll effect only advances `lastEventIndexRef` AFTER applyEvents()
 * returns successfully, this exception fired again on EVERY subsequent
 * ~2s poll tick forever (the same un-advanced event range re-processed
 * each time), pegging the render thread in a permanent crash-loop --
 * observed directly as the browser tab's renderer becoming unresponsive
 * (CDP screenshot calls timed out) within a few poll cycles of expanding
 * the monitor. FIX: accept EITHER shape -- a raw `[row,col]` tuple used
 * directly, or (kept for forward-compat / defensive robustness, e.g. a
 * future server change that switches to string ids, or a hand-built test
 * fixture) a "M9"-style string parsed as before. Any other shape (null,
 * undefined, a malformed string, an empty/wrong-length array) falls back
 * to {col:1,row:1} -- degrades to drawing at a fixed corner rather than
 * throwing, matching this module's existing "never throw on bad input"
 * posture for a malformed string id. */
export function cellIdToColRow(cell: string | RawCell | null | undefined): { col: number; row: number } {
  if (Array.isArray(cell)) {
    const [row, col] = cell;
    if (typeof row === 'number' && typeof col === 'number' && Number.isFinite(row) && Number.isFinite(col)) {
      return { col, row };
    }
    return { col: 1, row: 1 };
  }
  if (typeof cell !== 'string') return { col: 1, row: 1 };
  const m = /^([A-Za-z]+)(\d+)$/.exec(cell.trim());
  if (!m) return { col: 1, row: 1 };
  return { col: colLetterToIndex(m[1]), row: parseInt(m[2], 10) };
}

/** Converts a cell (string id OR raw [row,col] tuple -- see
 * cellIdToColRow's doc) to pixel coordinates (top-left of the cell)
 * within a field box of `cellPx` per cell -- callers add half a cell for
 * a center point. */
export function cellIdToXY(cell: string | RawCell | null | undefined, cellPx: number): { x: number; y: number } {
  const { col, row } = cellIdToColRow(cell);
  return { x: (col - 1) * cellPx, y: (row - 1) * cellPx };
}

/** Parses a "TopLeft:BottomRight" box string (e.g. "F2:M9") into pixel
 * bounds within a field box of `cellPx` per cell -- used to draw each
 * unit's formation canvas outline/backdrop on the monitor's player-side
 * grid. Inclusive of both corners (F2:M9 is 8 cols x 8 rows, matching
 * every ratified formation def's 8x8 unit-canvas invariant). */
export function parseBoxToPixelRect(box: string, cellPx: number): { x: number; y: number; w: number; h: number } {
  const [tl, br] = box.split(':');
  const a = cellIdToColRow(tl);
  const b = cellIdToColRow(br);
  return {
    x: (a.col - 1) * cellPx,
    y: (a.row - 1) * cellPx,
    w: (b.col - a.col + 1) * cellPx,
    h: (b.row - a.row + 1) * cellPx,
  };
}
