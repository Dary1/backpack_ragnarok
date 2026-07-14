// Canvas squad tabs (1..5, dynamic count/names) + "Squad+" button —
// REQ-0031 Phase B. Sibling of Tabs.tsx (inventory pages): same
// LongPressTabs interaction contract (click switches, ~600ms hold-no-move
// renames inline), bound instead to the engine's squad API
// (switchSquad/addSquad/renameSquad via store.ts's
// switchActiveSquad/addNewSquadAndSwitch/renameActiveSquad).
//
// Rendered INSIDE the "Canvas" title row (see App.tsx), right-aligned,
// per the task's verbatim UI change request ("Canvas title block gains
// Squad tabs (1-5, dynamic count) right-aligned in the same row + a
// 'Squad+' button").
//
// Squad switching never recreates the canvas board's PixiJS Application:
// switchActiveSquad() only mutates st.{linked,bps,pos,sis} in place (the
// SAME fields Board.tsx's canvas ops already read every render) and calls
// notifyStateChanged() -- Board.tsx's existing render(state)-on-
// stateVersion-bump effect redraws the newly-active squad's contents,
// same as any other mutation (Phase A's lesson: no setOps/Application
// churn is needed here at all, since canvas ops never carried a
// per-squad identity the way inventory pages carry a per-page one).
//
// REQ-0032 addition: drag-to-reorder (LongPressTabs' kind='squad' path)
// + trash-drop delete. reorderActiveSquad/deleteActiveSquadTab are
// forwarded straight through to LongPressTabs, which owns the full
// gesture disambiguation (click vs long-press-rename vs drag) and the
// trash-zone hit-testing -- this component only wires the store actions
// up, same "thin binding" shape as every other prop here.
// squadDeleteRefused renders as brief inline feedback next to the tabs
// when a trash-drop delete is refused (last remaining squad) -- the tab
// itself is never removed in that case (store.ts's deleteActiveSquadTab
// leaves state untouched on refusal).
import { LongPressTabs } from './LongPressTabs';
import { t } from './i18n';
import {
  addNewSquadAndSwitch,
  deleteActiveSquadTab,
  renameActiveSquad,
  reorderActiveSquad,
  switchActiveSquad,
  useGameStore,
} from './store';

export function SquadTabs() {
  const snapshot = useGameStore();
  const state = snapshot.state;
  const squads = state?.presets;
  if (!squads) return null;

  const count = squads.names.length;
  const active = squads.active;

  return (
    <div className="squad-tabs-row" title={t(snapshot.locale, "squad.starterNudge")}>
      <LongPressTabs
        count={count}
        names={squads.names}
        active={active}
        onSwitch={switchActiveSquad}
        onRename={renameActiveSquad}
        onReorder={reorderActiveSquad}
        onDeleteSquad={deleteActiveSquadTab}
        kind="squad"
        className="squad-tabs"
        tabClassName="squad-tab"
        activeClassName="squad-tab-active"
      />
      <button type="button" className="squad-add-btn" onClick={() => addNewSquadAndSwitch()} title="Add squad">
        {t(snapshot.locale, 'squad.add')}
      </button>
      {snapshot.squadDeleteRefused ? <span className="squad-delete-refused">{snapshot.squadDeleteRefused}</span> : null}
    </div>
  );
}
