# REQ-0287 — shared-usage visibility: ownership ribbons on Canvas & Inventory

## Status
draft (spec by orchestrator session 2026-07-22; awaiting user ratification).
Reserved 2026-07-22 on branch `req-canvas-inventory-ux-spec`.

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
