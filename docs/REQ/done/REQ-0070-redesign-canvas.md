# REQ-0070 — Redesign port: Canvas screen (#/backpacks)

- **Status**: DONE (2026-07-07, merged+deployed). Mock NORMATIVE:
  `web/redesign/canvas.html` (+ styleguide). Foundation: REQ-0069.
  Delivered: bgart layer, stagehead (live counts chip), ornate board stages +
  coord rails (Pixi untouched except backgroundAlpha:0), PresetTabs moved into
  boardfoot + SaveSeal, icard item panel + detail card (sprite system kept),
  EmbarkDock CTA. ZERO spec selector changes; E2E 99/2-preexisting of 101
  (+canvas-chrome.spec.ts ×3); tsc/build/engine green. Mock-fiction widgets
  (HUD squad tabs, currency/season chips, filter chips, unit-stats panel…)
  omitted — notes server-side. ⚠Incident: live pg backend + non-pg-aware E2E
  teardown ⇒ dev warehouse debris accumulates to 200-cap (~3 full runs);
  debris pruned manually; standalone fix branch ordered (fix-e2e-pg-teardown).

## Scope
Re-skin the Canvas edit screen (#/backpacks) to the mock: page chrome, panel
framing, board surrounds, item panel, preset tabs, save indicator — all visual
structure follows the mock. Behavior (drag-drop, dblclick rotate, presets 1–5 +
Preset+, long-press rename, auto-save, tintSets, BP move handle) is UNCHANGED
and must survive visually intact on the new chrome.

## Rules
- Mock wins on visuals; current code wins on interactions/data flow.
- Where the mock shows UI with no backing data field, UI is truth: implement by
  inference, document the inference in the commit + this REQ's log section.
- Item icons: keep sprite system (mock `ic_*.png` = placeholder only).
- Pixi lifecycle guards per REQ-0069.

## Test plan
E2E: existing canvas suite green (drags, rotate, presets, autosave) on the new
chrome + screenshot sanity of the new layout. tsc/build/dist commit.

## Log
- (fill at completion)
