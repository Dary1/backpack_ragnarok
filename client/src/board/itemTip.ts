// Ephemeral "floating item tooltip" selection state -- REQ-0119.
//
// A single-tap on an item icon (a placed PO, an assembled blade, a seated
// or free-placed SI) on ANY board -- the canvas board or an inventory-page
// board, both BoardRenderer instances -- floats a styleguide-anatomy
// tooltip panel (web/redesign/styleguide.html's .tooltip / .tt-* design)
// anchored to that icon. This module is the tiny framework-free pub-sub
// carrying WHICH item is currently shown and WHERE its icon sits in
// viewport (client) pixels.
//
// Same pattern as board/drag.ts's `carry`: ephemeral interaction/UI state,
// never game state, with multiple independent producers/consumers. Every
// BoardRenderer instance publishes taps into it (showItemTip); a single
// React panel mounted once at App level (FloatingItemTip.tsx) subscribes
// and renders. Keeping it here (not in store.ts's game snapshot) mirrors
// drag.ts precisely: it never touches `state`, so floating/dismissing a tip
// never churns the game store or forces a board re-render.
export interface ItemTipAnchor {
  /** Viewport (client) pixel rect of the tapped icon's footprint box --
   * produced by geom.ts's localBoxToClient (the inverse of clientToLocal),
   * so it round-trips the canvas's CSS scale + renderer resolution. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ItemTipState {
  /** 'po' covers placed POs and assembled blades (both resolve to an
   * ItemDef by content id); 'si' covers seated and free-placed SIs. */
  kind: 'po' | 'si';
  /** Content item id (PO) or SI id -- the key into ITEMS / SI_DEFS. */
  id: string;
  anchor: ItemTipAnchor;
  /** Board the tap came from (drag.ts's boardIdKey) -- lets a board clear
   * only its own tip on unmount, so a stale anchor can't linger. */
  boardKey: string;
}

let tip: ItemTipState | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function getItemTip(): ItemTipState | null {
  return tip;
}

export function subscribeItemTip(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Show (or switch to) the tip for a tapped item. Always publishes a fresh
 * object reference so useSyncExternalStore consumers re-read. Switching
 * items (tapping another icon while one is shown) is just a second call --
 * no explicit close needed. */
export function showItemTip(next: ItemTipState): void {
  tip = next;
  notify();
}

/** Hide the tip (outside/empty tap, Esc, or the shown item's board
 * unmounting). No-op if already hidden. */
export function clearItemTip(): void {
  if (!tip) return;
  tip = null;
  notify();
}

/** Clear only if the current tip belongs to `boardKey` -- used by a
 * BoardRenderer on destroy so a tip anchored to an unmounted board's
 * (now-detached) canvas can't linger with stale viewport coordinates. */
export function clearItemTipForBoard(boardKey: string): void {
  if (tip && tip.boardKey === boardKey) clearItemTip();
}
