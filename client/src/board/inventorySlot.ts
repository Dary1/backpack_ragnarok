// Inventory-board portal slot -- REQ-0041 (Warehouse tab embed decision).
//
// THE PIXI-INSTANCE DECISION (documented per the REQ's own requirement to
// make this a deliberate, stated choice): the Warehouse tab needs to show
// the SAME InventoryBoard (canvas board of PixiJS-rendered inventory
// pages + its Tabs) the Backpacks page already renders, with IDENTICAL
// behavior (same drag/drop, same rotate, same seat/unseat -- "Canvas-
// equivalent" per the REQ). Two honest options existed:
//   (a) REUSE the existing InventoryBoard/Tabs instance -- move its DOM
//       location depending on which "surface" (Backpacks vs Warehouse
//       tab) should currently show it.
//   (b) Stand up a SECOND, independent, persistent Pixi Application
//       dedicated to the Warehouse tab.
//
// (b) was ruled out after auditing client/src/board/drag.ts's BoardId
// union ({loc:'canvas'} | {loc:'inv', page:N}) and BoardRenderer.ts's
// ~20 call sites that branch on exactly those two `loc` kinds (cross-
// board transfer/preview logic assumes any non-canvas board IS an
// inventory page with a valid state.inv.pages[N] container). A second
// Pixi board would either (i) collide by registering under the SAME
// BoardId as whichever page the Backpacks page's own InventoryBoard is
// currently showing (registerBoard()'s registry is a Map keyed by
// boardIdKey -- last-registered instance wins, silently breaking drops
// committed against the OTHER instance), or (ii) require extending
// BoardId to a third kind, which ripples through drag.ts/boardOps.ts/
// BoardRenderer.ts's transfer-preview branches -- a genuinely invasive
// change for a "Round 1" REQ, and exactly the kind of Pixi-recreation-
// adjacent risk this REQ's own bug #4 investigation (REQ-0031 Phase A's
// confirmed WebGL-context-teardown freeze on this box's swiftshader
// software renderer) says to avoid.
//
// So: option (a), implemented via a React portal (NOT raw DOM appendChild
// -- React 19's createPortal preserves component identity/state across a
// portal TARGET change; it does not unmount/remount the portaled subtree,
// so the underlying <canvas> element, its PixiJS Application, and its
// BoardId registration in drag.ts's registry are NEVER torn down or
// recreated by switching where they render). App.tsx's inventory column
// (Tabs + the InventoryBoard's board-wrap) portals into whichever DOM
// node is currently registered here via setInventorySlot() -- null (the
// default) means "render in App.tsx's own normal Backpacks-page
// position", matching this app's pre-existing "backpacks-view stays
// mounted, only CSS-hidden" discipline exactly (this is the SAME
// discipline, just with a portal target swap instead of a display:none
// toggle, since the visual destination genuinely changes page/layout
// rather than merely hiding).
import { useSyncExternalStore } from 'react';

let currentSlot: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** Registers (or clears, via null) the DOM node the inventory column
 * should currently portal into. Called by WarehouseTab.tsx on mount
 * (registers its own slot div) and on unmount (clears back to null, i.e.
 * "resume rendering in App.tsx's normal position"). Only ONE slot can be
 * active at a time by construction (the inventory column is a single
 * physical DOM subtree -- it can only be in one place at once), which is
 * exactly right: the Warehouse tab and the Backpacks page are never both
 * "the current route" simultaneously. */
export function setInventorySlot(el: HTMLElement | null): void {
  if (currentSlot === el) return;
  currentSlot = el;
  for (const l of listeners) l();
}

export function getInventorySlot(): HTMLElement | null {
  return currentSlot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: re-renders the calling component (App.tsx) whenever the
 * portal target changes, so it can decide whether to render the
 * inventory column in place or via createPortal(..., slot). */
export function useInventorySlot(): HTMLElement | null {
  return useSyncExternalStore(subscribe, getInventorySlot);
}
