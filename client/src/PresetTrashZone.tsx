// Preset trash-drop-zone overlay (REQ-0032). Rendered centered over the
// Canvas board (App.tsx mounts this inside the SAME .board-wrap that
// contains <Board/>, absolutely positioned over it) ONLY for the duration
// of a preset-tab drag -- subscribes to tabDrag.ts's shared broadcast
// (set by LongPressTabs.tsx the instant a preset-kind drag crosses the
// move-threshold, cleared the instant that drag ends, drop or cancel) and
// renders nothing at all otherwise.
//
// Gating: `state?.kind === 'preset'` is the ONLY condition that shows this
// overlay -- an inventory-tab drag (kind:'inv') never satisfies it, so
// inventory tabs never show a trash zone under any circumstance, per the
// spec ("Inventory tabs must NEVER show a trash zone"). This is enforced
// structurally (by tabDrag.ts's discriminated `kind` field), not by a
// runtime check that could be forgotten at a new call site.
//
// Hit-testing: LongPressTabs.tsx's own pointerup handler is what actually
// detects a drop onto this zone (via document.elementFromPoint(...)
// .closest('[data-tab-trash-zone]')) and calls onDeletePreset -- this
// component itself has no pointer handlers of its own; it is a purely
// visual target for that hit-test plus the data attribute it keys off of.
import { useEffect, useState } from 'react';
import { subscribeTabDrag, getTabDragState, type TabDragState } from './tabDrag';

export function PresetTrashZone() {
  const [state, setState] = useState<TabDragState | null>(getTabDragState());

  useEffect(() => subscribeTabDrag(() => setState(getTabDragState())), []);

  if (!state || state.kind !== 'preset') return null;

  return (
    <div className="preset-trash-zone" data-tab-trash-zone>
      <span className="preset-trash-zone-icon" aria-hidden="true">
        🗑
      </span>
      <span className="preset-trash-zone-label">Drop to delete preset</span>
    </div>
  );
}
