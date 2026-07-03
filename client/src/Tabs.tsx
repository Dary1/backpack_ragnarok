// Inventory page tabs (1..5) — REQ-0030 Phase 2.
// Plain React buttons above the inventory board; active-tab state lives in
// the module store (store.ts's activeInvPage), NOT localStorage, per the
// task spec ("active-tab state persisted in localStorage is NOT
// available -- keep in module store"). Switching tabs re-renders the
// inventory board only (see InventoryBoard.tsx's remount-on-page-change
// effect) -- the canvas board is entirely unaffected.
//
// Drop-target no-op (task spec): "dropping on a tab button is a no-op,
// document it". Tab buttons are plain DOM buttons with NO pointerdown
// carry-start wiring and are NOT registered in drag.ts's board registry --
// so a pointerup while a carry is armed and the pointer sits over a tab
// button resolves to `carry.drop === null` (neither board's stage is under
// the pointer there), which the centralized pointerup handler
// (drag.ts's ensurePointerUpWired) already treats as "unresolved drop: no
// engine call, item stays where it was". No special-case code is needed
// here to enforce that -- it falls out of the tab bar simply not being a
// drop target at all. Cross-page mid-drag (switching tabs while carrying
// an item) is explicitly OUT of scope per the task spec; clicking a tab
// while a drag is armed does not cancel the drag (the carry is unaffected
// by a click on a non-board element), so the drag continues normally.
import { setActiveInvPage, useGameStore } from './store';

export function Tabs() {
  const snapshot = useGameStore();
  const pageCount = snapshot.engine?.PAGE_COUNT ?? 5;
  const active = snapshot.activeInvPage;

  return (
    <div className="inv-tabs" role="tablist">
      {Array.from({ length: pageCount }, (_, i) => (
        <button
          key={i}
          type="button"
          role="tab"
          aria-selected={i === active}
          className={`inv-tab${i === active ? ' inv-tab-active' : ''}`}
          onClick={() => setActiveInvPage(i)}
        >
          {i + 1}
        </button>
      ))}
    </div>
  );
}
