# REQ-0371 — Build power readout on canvas + sortie attack-level prefill

## Status
todo — spec by Cowork session 2026-08-10 (gamer-lens UI gap analysis batch);
ratified by user 2026-08-10, chat: 「では、それらを全て、TODOのREQとして書き出してください」.

## Origin
UI gap analysis 2026-08-10 (Cowork). Finding P1-1, plus the "attack level
starts at 1 every visit" clarity note (same bridge).

## Problem (gamer-facing)
Nothing in the game tells the player how strong a build is. The canvas stats
chip shows COUNTS only (`canvas.statBp/statItems/statLinks`). The sortie page
then demands a bare number — attack level — initialized to 1 on every visit
(`client/src/sortie/SortiePage.tsx`: `useState(1)`), with a below-band warning
but no opposite signal ("what can I survive?"). The old ray-forecast overlay
was retired (REQ-0308) and nothing replaced it. The loop "build → judge →
depart" is missing its middle.

## Evidence (verified 2026-08-10)
As cited; plus client-wide grep: no power/strength readout anywhere. A
power-level notion already exists in the deploy pipeline
(`predeploy_recalibrate_powerlevel.cjs`), i.e. the project has a comparable
metric — it is just never shown to the player.

## Spec
1. CanvasStatsChip grows: total HP (sum of placed BP hp from the engine
   snapshot) + a REFERENCE power number. Power formula decision at build time,
   recorded in this file: prefer reusing the content-pipeline power-level
   formula if expressible from the client-side snapshot; otherwise a simple
   documented aggregate (HP + summed weapon effect magnitudes). Label it as
   reference, not prediction — the honesty convention of
   `ragnarok.order.forecastTip`.
2. Same number on each squad card in the sortie shelf
   (`deriveSquadCard.ts` already derives BP×n / charge — extend it).
3. Attack-level prefill: persist the last-used attackLv (client-only field in
   the persisted canvas state, the REQ-0141 state.guide precedent) and seed
   LevelStepper with it. Show the dungeon band note as today.
4. NO engine change (rule 1): all sums read the existing snapshot.

## Gates
- Unit: chip HP equals engine-summed HP for a fixture canvas.
- e2e: place a BP → chip updates; set attackLv 7, depart, revisit sortie →
  stepper shows 7.
- Power number present on canvas chip + sortie squad cards, both locales.
- CI green.

## Out of scope
DPS simulation, win-rate prediction, per-dungeon success forecast (a future
REQ may revive a calibrated forecast; this one is display-only).

## Cross-refs
REQ-0372 (if landed, sortie may also show "highest recent clear: Lv N" from
run history — degrade gracefully without it).
