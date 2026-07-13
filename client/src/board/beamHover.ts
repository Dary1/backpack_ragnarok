// Ephemeral beam-hover state -- REQ-0142.
//
// Hovering a Unit core (or one of its beam segments) on the CANVAS board
// publishes WHICH Unit (and, for a beam segment, which direction) the
// player is interrogating, plus where the hovered thing sits in viewport
// pixels so an HTML panel can anchor to it. The BoardRenderer publishes;
// two consumers subscribe: the renderer itself (to dim unrelated beams and
// light up the traced ray) and the app-level BeamTracePanel (to render the
// plain-language "why not" rows).
//
// Deliberately the SAME tiny pub-sub shape as board/itemTip.ts (REQ-0119)
// and board/drag.ts's carry: ephemeral INTERACTION state, never game state.
// It never touches `state`, so hovering never churns the game store, never
// schedules an auto-save, and never re-runs the React tree that owns the
// board -- only the two subscribers above redraw.
//
// Beams are a CANVAS-only concept (REQ-0030 Unit dormancy: an inventory
// page's Units fire nothing), so an inventory board never publishes here.
export interface BeamHoverAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BeamHoverState {
  /** the Unit's BP id -- the beam ORIGIN being interrogated */
  bp: string;
  /** a single direction (0..7) when a beam SEGMENT is hovered; null when the
   * Unit core itself is hovered (the whole 8-direction fan is the subject) */
  dir: number | null;
  anchor: BeamHoverAnchor;
  /** publishing board (drag.ts's boardIdKey) -- lets a board clear only its
   * own hover on unmount, so a stale anchor can't linger. */
  boardKey: string;
}

let hover: BeamHoverState | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function getBeamHover(): BeamHoverState | null {
  return hover;
}

export function subscribeBeamHover(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Same target as the current hover? Guards the pointermove hot path: a
 * pointer moving WITHIN one Unit core fires dozens of moves, and every
 * publish costs a board re-render + a React render. */
function sameTarget(a: BeamHoverState | null, b: BeamHoverState): boolean {
  return !!a && a.bp === b.bp && a.dir === b.dir && a.boardKey === b.boardKey;
}

/** Publish (or switch to) a hover target. No-op when the target is unchanged
 * -- the anchor is recomputed by the publisher on every move, but a Unit core
 * does not MOVE under the pointer, so re-publishing an identical target would
 * be pure churn. */
export function setBeamHover(next: BeamHoverState): void {
  if (sameTarget(hover, next)) return;
  hover = next;
  notify();
}

/** Clear the hover (pointer left the target / the canvas, a drag armed, or
 * the publishing board unmounted). No-op if already clear. */
export function clearBeamHover(): void {
  if (!hover) return;
  hover = null;
  notify();
}

/** Clear only if the current hover belongs to `boardKey` -- used by a
 * BoardRenderer on destroy so a hover anchored to an unmounted board's
 * (now-detached) canvas can't linger with stale viewport coordinates. */
export function clearBeamHoverForBoard(boardKey: string): void {
  if (hover && hover.boardKey === boardKey) clearBeamHover();
}
