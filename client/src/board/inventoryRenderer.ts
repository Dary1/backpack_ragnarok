// Live-InventoryBoard-renderer accessor -- REQ-0041.
//
// InventoryBoard.tsx mounts exactly ONE BoardRenderer instance for the
// entire app lifetime (see that file's own module comment). WarehouseTab
// needs to call this SAME renderer's pulseCellsSuccess() (the claim
// placement pulse -- "pikon-pikon") right after the claim's engine
// mutation commits, but WarehouseTab does not itself own/mount that
// renderer (per the REQ-0041 Pixi-instance decision, documented in
// board/inventorySlot.ts -- the SAME InventoryBoard instance is reused
// via a portal, not a second Pixi Application). This module is the tiny
// seam that exposes the live renderer instance to any caller that needs
// it, mirroring drag.ts's own tiny-module-level-registry pattern (this
// app already has several such minimal pub-sub/registry modules --
// store.ts, drag.ts, inventorySlot.ts -- rather than one big shared
// context).
let currentRenderer: { pulseCellsSuccess: (cells: Array<[number, number]> | undefined) => void } | null = null;

/** Called by InventoryBoard.tsx once its BoardRenderer is mounted (and
 * with null on unmount/teardown -- though InventoryBoard is never
 * expected to unmount in this app's lifetime, see its own module
 * comment). */
export function setInventoryRenderer(renderer: typeof currentRenderer): void {
  currentRenderer = renderer;
}

export function getInventoryRenderer(): typeof currentRenderer {
  return currentRenderer;
}
