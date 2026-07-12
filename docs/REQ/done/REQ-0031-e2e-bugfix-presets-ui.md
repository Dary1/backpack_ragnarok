# REQ-0031 — E2E Infra (server Chromium), Inventory Bugs, Auto-save, Presets, 8×8, UI polish

- **Status**: IN PROGRESS
- **Date**: 2026-07-04 (orchestrator gen2)
- **User feedback on REQ-0030**: "全体的に非常に良好" + bugs & change requests below.

## Bugs (user-reported, Phase A)
1. A BP in the Inventory cannot be placed onto the Canvas (even when empty).
2. Clicking an Inventory tab doesn't switch pages — the inventory board disappears,
   nothing renders, the BROWSER FREEZES and the server becomes very heavy
   (suspect: remount loop / Pixi app leak / refetch storm).

## Testing adoption (user proposals a+b — ADOPTED, Phase A)
- Headless Chromium ON THE SERVER (Playwright) as the standing UI verification rig —
  replaces dependence on the orchestrator's Chrome extension.
- Drag & drop verified via input emulation (Playwright mouse down/move/up = trusted
  CDP input). E2E suite becomes a standing gate: `client/e2e/`.
- If Playwright's chromium needs missing system libs (no sudo), report the exact
  apt command for the user to run.

## Auto-save (user, Phase B)
Canvas/Inventory changes auto-save in the background (debounced PUT after every
mutation; Save/Load buttons retired; subtle "saved" indicator; load stays automatic
at boot).

## UI change requests (user, Phase B)
Inventory: grid 8×8; tabs share the "Inventory" label row, right-aligned;
"items parked here take no effect" moves BELOW the inventory container, left-aligned;
LONG-PRESS a tab to rename it.
Canvas: title block gains Preset tabs (1–5) same style (label row, right-aligned);
a "Preset+" button; long-press rename; grid 8×8.

## Preset model (orchestrator decision, flag to user)
- st.{linked,bps,pos,sis} stays the ACTIVE preset (mock & old tests untouched);
  new st.presets = {active, names[], store[]} where store holds inactive presets'
  {linked,bps,pos,sis}; engine switchPreset()/addPreset() swap atomically.
- Physicality: one uid lives in exactly ONE place across inventory + all presets
  (items enter a preset only by dragging from inventory/another preset's canvas via
  the shared inventory). Multi-preset item sharing deferred to deployment design
  (glossary forbids sharing only for DEPLOYED presets; edit-time sharing postponed).
- New presets start empty (BPs are physical too). "Preset+" appends a preset
  (soft cap raised later; tabs render dynamically).
- Names for inventory pages + presets live in state (persisted via save).

## Grid change
Canvas layout AND inventory pages → 8×8 (scenario/layout data + engine page dims;
existing placements remain valid).

## Gate
E2E suite green on server chromium (incl. input-emulated drags: BP inv→canvas with
and without contents, tab switching stability, auto-save round-trip, preset switch,
rename via long-press); engine tests all green (31+); API tests; tsc/build;
pages 200; user visual confirmation.
