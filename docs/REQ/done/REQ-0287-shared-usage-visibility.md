# REQ-0287 — shared-usage visibility: ownership ribbons on Canvas & Inventory

## Status
done (merged + deployed live 2026-07-23; user-accepted). Master merge
`38b0c54`, web bundle rebuilt `f002b19` (served by backpack-web static host, no
restart needed; live bundle carries the tooltip i18n + `usageRibbonProbe` hook).
Spec ratified by the user 2026-07-22. See "## Implementation" and "## Gate
results" below.

## Origin (user directive, 2026-07-22, chat — verbatim)
「Canvasの中のPO・Unit・SIが、他のPreset(Squad)と共有されている場合の可視化が
不十分でわかりにくいです。あなたの美的センスを用いて、わかりやすい仕様を考えて、
REQに起こしてください。(以前はもっとわかりやすかったのですが、直近のセッションが
書き換えてしまった)」
Translation: sharing of a PO/Unit/SI with other Squads is under-visualized on
the Canvas; design a clear spec. (It used to be clearer; recent sessions
degraded it.)

## Why it degraded (verified, for the record)
The reference-model washes (REQ-0033) still run — `BoardRenderer.render()`
calls `engine.tintSets(state)` (BoardRenderer.ts ~L387) and `drawTintOverlay`
at three sites: BP cells -> gSkins (~L516), PO cells -> gItems (~L816), SI
cell (~L1229). But they are 0.2-alpha hatch washes (overlayPalette.ts
`OVERLAY.usage`: selfSquad=Okabe-Ito vermillion `hatch-diagonal`, otherSquad=
blue `hatch-dots`, both 0.2), and they now sit UNDER several newer layers of
visual noise: full-opacity registry item art, REQ-0273 per-PO ink+rim
outlines, and REQ-0266 bp-skin composites. Nothing was removed; the cue was
out-shouted. A wash-only signal no longer reads.

## Design — "ownership ribbons" (binding)
Keep the washes exactly as they are (they still mark the exact footprint;
zero palette changes). ADD a compact, full-opacity, corner-anchored marker
system with three channels: position, shape+color, and a tooltip listing.

1. **Shared-elsewhere ribbon (both boards).** For every uid in the board's
   "yellow" set (canvas: `tint.canvasYellow`; inventory: `tint.yellow`):
   draw a right-triangle ribbon folded into the TOP-RIGHT corner of the
   item's footprint bounding box (legs 16px along the two edges), fill
   `OVERLAY.usage.otherSquad.color` alpha 1.0, keyline `#0e0d0b` width 1.5.
   - PO: bbox of `ops.cellsOf(state, p)`. SI: its 1-cell / socket position.
   - BP: anchor on the BP's top-right-most cell; ADDITIONALLY tint the
     REQ-0042 move-handle badge ring (`badgeBg.stroke`) in the same color so
     a fully-covered BP still shows its status at the handle.
   - The BP:Unit law (terminology_unit_squad.md) welds Unit to BP: a shared
     Unit IS its shared BP — the BP ribbon speaks for the Unit; no separate
     Unit marker.
2. **Share count.** If `engine.usageOf(state, uid)` minus the current squad
   has size >= 2, render the count as a 9px `#f2fbff` Text centered in the
   ribbon (matches the ✥ badge type style, BoardRenderer.ts ~L552).
3. **In-current-squad ribbon (inventory boards only).** For uids in
   `tint.red`: same triangle but TOP-LEFT corner, `OVERLAY.usage.selfSquad`
   color. Distinct corner + distinct color = readable under all three CVD
   sims (REQ-0143 principle: never color alone; here position disambiguates).
   Canvas never shows red (everything on it is red by definition — existing
   rule, unchanged).
4. **Which squads (tooltip).** Extend the REQ-0119 item tip: when the tipped
   uid is in yellow/red sets, `FloatingItemTip.tsx` appends one row:
   `Used by: <squad names>` from `engine.usageOf(state, uid)` mapped through
   the same squad-name accessor SquadTabs.tsx uses for tab labels; the
   current squad, when present, is listed first and marked (ja mirror in
   i18n files; follow existing i18n key conventions).
5. **Layering & interactivity.** Ribbons draw into `gBadges` (above item
   art, below sockets/units — exactly where the ✥ badge already lives),
   `eventMode='none'` per the constructor hit-test doctrine. Ribbon draw
   order after the ✥ badge so a BP corner ribbon never hides the handle.

## Implementation notes (for the implementing agent)
- New module `client/src/board/usageRibbons.ts` (pure draw helpers, same
  pattern as ghosts.ts: `drawSharedRibbon(self, bboxPx, count)`,
  `drawSelfRibbon(self, bboxPx)`); call sites inside `render()` next to the
  three existing `drawTintOverlay` sites + the BP badge site. Do NOT fork
  tint-set math — `tintSets`/`usageOf` (mock-src/engine.js ~L1387-1447) are
  the only truth. No engine changes.
- Probe seam for tests (beamSegs precedent, BoardRenderer field): expose
  `usageRibbonProbe: {uid: string; corner: 'tr'|'tl'; count: number|null}[]`
  rebuilt per render.
- squadCompositor/monitor: OUT (editor affordance, not battle telemetry).

## Out of scope
Palette/wash changes; monitor; market in-use lock (REQ-0198); any engine or
DTO change.

## Gates
- `ci.sh` green (client typecheck/build; documented master reds excepted).
- e2e on decade **7870-7879** (PORT = 5000 + 2870 + idx, tools/e2e_ports.sh):
  extend `client/e2e/reference-model.spec.ts` (or new spec sourcing
  `e2e_harness.sh` with `e2e_harness_req 0287 …`): fixture with one PO + one
  BP shared across two squads asserts, via the probe seam: tr-ribbon on both
  boards, count only at >=2 other squads, tl-ribbon on inventory only,
  tooltip row lists both squad names; a lone-squad profile shows zero
  ribbons (no-regression).
- Screenshot pair (before/after) archived under `web/preview/req-0287/`.

## Dependencies
None. Coexists with REQ-0288/0289/0290/0291.


## Implementation (2026-07-23)
Built on branch `req-0287-shared-usage-visibility` (base
`req-canvas-inventory-ux-spec`).

Files:
- NEW `client/src/board/usageRibbons.ts` — pure draw helpers (ghosts.ts
  pattern): `drawSharedRibbon` (top-right, `OVERLAY.usage.otherSquad`, 16px
  legs, `#0e0d0b` 1.5 keyline, 9px `#f2fbff` count Text when >=2 other squads),
  `drawSelfRibbon` (top-left, `OVERLAY.usage.selfSquad`), bbox helpers
  (`cellsBBoxPx`, `topRightCellBBoxPx`, `topLeftCellBBoxPx`), and the
  `paintUsageRibbons` orchestrator. Wash untouched; `tintSets`/`usageOf` remain
  the only truth (no engine/DTO change).
- NEW `client/src/board/usageRibbonProbe.ts` — pure per-board probe registry
  (no Pixi import) so `store/boot.ts` can expose it on `__backpackDebug`.
- `BoardRenderer.ts` — ribbons drawn into `gBadges` at the three existing tint
  sites (BP/PO/SI); the BP ribbon is emitted AFTER the move-handle badge
  (top-right-most cell for tr, top-left-most for tl) so the 16px corner wedge
  never occludes the centred handle glyph; the REQ-0042 handle ring is tinted
  otherSquad when the BP is shared. `usageRibbonProbe` field rebuilt fresh per
  render and published via `publishRibbonProbe(boardIdKey(this.boardId), …)`.
- `FloatingItemTip.tsx` (+ `i18n/canvas.ts`, en/ja) — the REQ-0119 tip gains a
  "Used by: <squad names>" row from `engine.usageOf` mapped through
  `state.presets.names` (the accessor SquadTabs uses); the current squad is
  listed first and marked (`usage.currentSquadMark`). Shown only when the uid is
  in the red/yellow usage sets.
- `store/boot.ts` — `__backpackDebug.usageRibbonProbe(boardKey)` read hook.

Decisions for the record:
- A BP's tl (self) ribbon anchors on the top-left-most cell (same as the ✥
  handle); the 16px wedge stops short of the cell-centre glyph, so the handle is
  never hidden (verified in the evidence shots).
- The BP:Unit law is honoured — a shared Unit is spoken for by its BP ribbon; no
  separate Unit marker.
- "Canvas never shows red" falls out for free: on the canvas board `tintRedSet`
  is empty, so no tl ribbon is emitted there.

## Gate results (2026-07-23)
- [0/8] `check_e2e_ports.cjs`: green (all ports derived, no collisions). This REQ
  adds no new harness/config — it extends the default-suite
  `reference-model.spec.ts`, run SCOPED on decade 7870-7879 (proxy 7872, fleet
  7874) per the "rebased tree runs scoped" rule.
- Client `tsc -b`: green. `pnpm build`: green. `oxlint` (6 touched files): 0/0.
- e2e (scoped): the 4 REQ-0287 specs pass in isolation AND in the full default
  suite. Full default suite: 200 passed / 2 failed. Both failures are
  PRE-EXISTING and unrelated to this client-only change:
  - `forecast.spec.ts:206` (REQ-0057 formation picker) — PROVEN pre-existing:
    fails identically on the base tree (feature stashed + rebuilt) with the same
    `toBeVisible()` error.
  - `schedule.spec.ts:1524` (REQ-0240 monitor zones) — parallel/ordering flake:
    passes in isolation.
- Evidence: before/after pair under `web/preview/req-0287/`
  (`{before,after}-canvas.png`, `{before,after}-inventory.png`,
  `after-tooltip.png`). Before = ribbons disabled; after = ribbons on the same
  shared fixture (blue tr + count, vermillion tl, BP handle-ring tint).

## Commits
- `88ad75c` — implementation (usageRibbons + probe modules, BoardRenderer wiring,
  tooltip Used-by row + i18n, boot hook, e2e spec + fixture).
- <this log commit>, then the `todo -> built` move commit (the move IS the
  status transition).
