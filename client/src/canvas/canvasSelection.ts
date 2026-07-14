// Canvas-screen selection channel -- REQ-0140 (canvas-side-panel-parity).
//
// A tiny framework-free pub-sub (same shape as board/itemTip.ts and
// board/drag.ts) carrying WHICH item is currently "selected" on the canvas
// screen, so the CanvasSidePanel detail card, the panel list highlight, and
// the on-board CanvasSelectionOverlay ring all read one source of truth.
// Never touches game state -- selection is pure UI. The channel is written
// BOTH ways (this is the "selection sync both directions" seam):
//   - board tap  -> board/itemTip already publishes the tapped item;
//     CanvasSidePanel mirrors that here (board -> panel highlight).
//   - panel click -> CanvasSidePanel sets it directly (panel -> board ring).
export interface CanvasSelection {
  kind: 'po' | 'si';
  /** ItemDef / SIDef key (the def id, NOT a PO/SI uid) -- selection is by
   * content id so a placed instance and its inventory entry cross-highlight. */
  id: string;
}

let selection: CanvasSelection | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function getCanvasSelection(): CanvasSelection | null {
  return selection;
}

export function subscribeCanvasSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Sets (or clears) the current selection. No-op when unchanged so
 * useSyncExternalStore consumers do not churn. */
export function setCanvasSelection(next: CanvasSelection | null): void {
  if (!selection && !next) return;
  if (selection && next && selection.kind === next.kind && selection.id === next.id) return;
  selection = next;
  notify();
}

export function clearCanvasSelection(): void {
  setCanvasSelection(null);
}
