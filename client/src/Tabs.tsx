// Inventory page tabs (1..5, dynamic display names) — REQ-0030 Phase 2,
// restructured REQ-0031 Phase B: now rendered via the shared
// LongPressTabs component (see LongPressTabs.tsx) so a long-press
// (~600ms hold, no move) renames a page inline (renameInvPage via
// store.ts's renameInventoryPage), while a plain click still switches
// pages exactly as before. Active-tab state lives in the module store
// (store.ts's activeInvPage), NOT localStorage (unchanged from Phase 2).
//
// Drop-target no-op (task spec, Phase 2): "dropping on a tab button is a
// no-op" -- unchanged; LongPressTabs' buttons are still plain DOM buttons
// with no carry-start wiring and are not registered in drag.ts's board
// registry.
//
// REQ-0031 Phase B UI restructure: this component used to render its own
// standalone row ABOVE the inventory board; it now renders INSIDE the
// "Inventory" label row (see App.tsx), right-aligned via CSS
// (.board-column-header/.inv-tabs), per the task's verbatim UI change
// request.
import { LongPressTabs } from './LongPressTabs';
import { renameInventoryPage, setActiveInvPage, useGameStore } from './store';

export function Tabs() {
  const snapshot = useGameStore();
  const engine = snapshot.engine;
  const pageCount = engine?.PAGE_COUNT ?? 5;
  const active = snapshot.activeInvPage;
  const names = snapshot.state && engine ? engine.invPageNames(snapshot.state) : Array.from({ length: pageCount }, (_, i) => String(i + 1));

  return (
    <LongPressTabs
      count={pageCount}
      names={names}
      active={active}
      onSwitch={setActiveInvPage}
      onRename={renameInventoryPage}
      className="inv-tabs"
      tabClassName="inv-tab"
      activeClassName="inv-tab-active"
    />
  );
}
