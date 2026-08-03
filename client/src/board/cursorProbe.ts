// client/src/board/cursorProbe.ts -- REQ-0290 (seat-cell X; fixed-interior affordances).
//
// Per-board CURSOR probe registry: the e2e read seam for affordances.
// usageRibbonProbe.ts is the precedent this copies verbatim in shape (which
// in turn followed beamSegs) -- a per-render snapshot a spec can assert on
// instead of reverse-engineering PixiJS pixels or trying to read a CSS
// cursor off a <canvas> that only ever has ONE cursor at a time.
//
// That last point is the whole reason this file exists. A board is a single
// canvas element; `cursor` is a property of the Pixi hit object under the
// pointer, applied to the canvas as the pointer moves. There is no DOM to
// query for "what cursor would cell (4,3) show" without physically moving a
// real mouse over every cell in turn and sampling -- slow, and it cannot
// distinguish "no hit object here" from "a hit object that sets the default
// cursor", which is exactly the distinction REQ-0290 ratified (a fixed PO
// shows the DEFAULT arrow, not not-allowed). Recording what the renderer
// ASSIGNED, at assignment time, tests the actual decision.
//
// PURE DATA -- no Pixi import -- so store/boot.ts can expose it on
// __backpackDebug without dragging the renderer into that module.

/** One interactive object's assigned cursor, as of the last render().
 *
 * `uid` namespaces by the kind of thing being described, because these are
 * not all engine uids:
 *   - `'seat:<bpId>'`  the Unit's seat cell core            (REQ-0290: 'not-allowed', inert)
 *   - `'badge:<bpId>'` the BP move handle glyph             ('grab')
 *   - `'cell:<bpId>:<r>,<c>'` an empty BP cell drag handle  ('grab')
 *   - a bare PO uid                                          ('grab', or 'default' when fixed)
 *   - a bare SI uid                                          ('grab', or 'default' when locked-hosted)
 *   - `'lock:<poUid>'` the padlock glyph on a fixed PO       ('inert' -- see below)
 *
 * `cursor` is the assigned CSS cursor for every entry except `lock:`, which
 * is a decorative glyph (eventMode 'none') and so has no cursor at all. It is
 * recorded here anyway, with the non-CSS value 'inert', purely so the spec can
 * COUNT padlocks -- REQ-0290 gates "padlock exactly once per fixed PO" and a
 * duplicate entry is the only mechanical way to catch the fixed branch running
 * twice in one render.
 */
export interface CursorProbeEntry {
  uid: string;
  cursor: string;
}

const registry = new Map<string, CursorProbeEntry[]>();

/** Called by BoardRenderer at the end of every render(), keyed by boardIdKey
 * (`'canvas'` | `'inv:<page>'`). Replaces the board's previous snapshot. */
export function publishCursorProbe(boardKey: string, probe: CursorProbeEntry[]): void {
  registry.set(boardKey, probe);
}

/** e2e read: the cursors the named board assigned on its most recent render. */
export function cursorProbeFor(boardKey: string): CursorProbeEntry[] {
  return registry.get(boardKey) ?? [];
}
