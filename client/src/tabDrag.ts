// Shared tab-drag broadcast (REQ-0032). Tiny module-level pub-sub, same
// shape as board/drag.ts's carry state -- exists so App.tsx can show/hide
// the preset trash-drop-zone overlay (rendered centered over the Canvas
// board, OUTSIDE LongPressTabs/PresetTabs' own DOM subtree) without prop-
// drilling a callback through Tabs.tsx/PresetTabs.tsx/LongPressTabs.tsx.
//
// LongPressTabs.tsx (the ONE place that owns the pointerdown/move/up
// gesture disambiguation for BOTH tab kinds) calls setTabDragState() the
// instant a gesture crosses the move-threshold and becomes a drag, and
// clears it (setTabDragState(null)) the instant the drag ends (drop OR
// cancel) -- so the trash overlay's visible lifetime is EXACTLY the
// duration of one drag gesture, never longer, and only ever appears at
// all when `kind==='preset'` (inventory tabs never set this to a preset
// kind, so the overlay's subscriber -- App.tsx -- can gate on
// `state?.kind==='preset'` and inventory drags will never show it).
export interface TabDragState {
  kind: 'preset' | 'inv';
  /** 0-based index of the tab currently being dragged. */
  from: number;
}

let dragState: TabDragState | null = null;
const listeners = new Set<() => void>();

export function getTabDragState(): TabDragState | null {
  return dragState;
}

export function setTabDragState(next: TabDragState | null): void {
  if (dragState === next) return;
  if (dragState && next && dragState.kind === next.kind && dragState.from === next.from) return;
  dragState = next;
  for (const l of listeners) l();
}

export function subscribeTabDrag(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
