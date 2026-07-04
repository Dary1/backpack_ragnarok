// Canvas preset tabs (1..5, dynamic count/names) + "Preset+" button —
// REQ-0031 Phase B. Sibling of Tabs.tsx (inventory pages): same
// LongPressTabs interaction contract (click switches, ~600ms hold-no-move
// renames inline), bound instead to the engine's preset API
// (switchPreset/addPreset/renamePreset via store.ts's
// switchActivePreset/addNewPresetAndSwitch/renameActivePreset).
//
// Rendered INSIDE the "Canvas" title row (see App.tsx), right-aligned,
// per the task's verbatim UI change request ("Canvas title block gains
// Preset tabs (1-5, dynamic count) right-aligned in the same row + a
// 'Preset+' button").
//
// Preset switching never recreates the canvas board's PixiJS Application:
// switchActivePreset() only mutates st.{linked,bps,pos,sis} in place (the
// SAME fields Board.tsx's canvas ops already read every render) and calls
// notifyStateChanged() -- Board.tsx's existing render(state)-on-
// stateVersion-bump effect redraws the newly-active preset's contents,
// same as any other mutation (Phase A's lesson: no setOps/Application
// churn is needed here at all, since canvas ops never carried a
// per-preset identity the way inventory pages carry a per-page one).
import { LongPressTabs } from './LongPressTabs';
import { t } from './i18n';
import { addNewPresetAndSwitch, renameActivePreset, switchActivePreset, useGameStore } from './store';

export function PresetTabs() {
  const snapshot = useGameStore();
  const state = snapshot.state;
  const presets = state?.presets;
  if (!presets) return null;

  const count = presets.names.length;
  const active = presets.active;

  return (
    <div className="preset-tabs-row">
      <LongPressTabs
        count={count}
        names={presets.names}
        active={active}
        onSwitch={switchActivePreset}
        onRename={renameActivePreset}
        className="preset-tabs"
        tabClassName="preset-tab"
        activeClassName="preset-tab-active"
      />
      <button type="button" className="preset-add-btn" onClick={() => addNewPresetAndSwitch()} title="Add preset">
        {t(snapshot.locale, 'preset.add')}
      </button>
    </div>
  );
}