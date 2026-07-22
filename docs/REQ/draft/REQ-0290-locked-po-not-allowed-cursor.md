# REQ-0290 — seat-cell X cursor; fixed-interior affordances (🔒, no grab)

## Status
todo (ratified 2026-07-22; design finalized by user rulings below).
Reserved 2026-07-22 on branch `req-canvas-inventory-ux-spec`. The slug
(`locked-po-not-allowed-cursor`) reflects the FIRST draft; the ratified
design moved the X to the seat cell — slug kept (never hand-edit REQ ids).

## Origin (user directive, 2026-07-22, chat — verbatim)
「POが固定化されているUnitの上にマウスカーソルがある場合、Xにカーソルをして
ください。動かせない、回転させられないことを明確にしてください。」

## Rulings (2026-07-22, chat — verbatim, binding)
1.「「POが固定化されているUnit」の中のPOには、Xは不要です。なぜなら回転も移動も
できないからです。固定Unit自体は、回転と移動が可能です。ですので、同様にX
カーソルは他のユニット同様、Unit Artのマスに表示してください。」
2. Option ratified: "X固定・不活性" — ALL units' seat cells show X and are
   inert; BP drag/rotate consolidates on the ✥ button + empty cells.
3. Fixed-PO presentation ratified: default arrow + persistent 🔒 glyph
   (no not-allowed cursor on POs).
Reading of record: the X on the SEAT CELL states a Unit piece can never be
moved/re-seated (its seat is stamped at mint — canvas_spec law, true for
EVERY unit); interior fixed pieces show no grab affordance at all.

## Current state (verified)
- Seat-cell core: `cursor='grab'`, pointerdown -> `handleBPPointerDown`
  (BoardRenderer.ts ~L1016-1018) — core is a BP drag handle + dblclick-
  rotate trigger today.
- Other BP handles: ✥ badge (~L552-565) and empty BP cells (~L578-588),
  both -> handleBPPointerDown. These REMAIN the handles after this REQ.
- Fixed POs: hit rect `cursor='grab'` (~L800) despite `p.fixed`; refusal
  only surfaces post-click (short-circuit + red flash, ~L1312-1315).
- Seated SIs in locked BPs: `cursor='grab'` (~L1220) though unseat is
  engine-refused (engine.js seatSI/stow guards `why:'locked unit'`).

## Design (binding)
1. **Seat cell = X, inert (ALL units, both boards).** The unit core's hit
   object keeps `eventMode='static'` solely so `cursor='not-allowed'`
   renders; its `pointerdown` wiring (drag AND the dblclick-rotate path
   through it) is REMOVED. Unit art/disc keep drawing exactly as today.
   Unit-less BPs (live walls, REQ-0284): nothing to do (no core drawn).
2. **BP drag/rotate entry points** are the ✥ badge (pointerdown-drag /
   dblclick-rotate) and empty BP cells — mechanics unchanged, minus the
   core. Order-free with REQ-0289 (the badge exists since REQ-0042; 0289
   only moves it to the seat's top-left corner).
3. **Fixed POs (`p.fixed`).** Hit rect cursor = DEFAULT (no 'grab', no
   'not-allowed' — ruling 1). Persistent 🔒 glyph: 9px Text, fill
   `#f2fbff`, alpha 0.85, inside the TOP-RIGHT corner of the footprint
   bbox, drawn into `gBadges`, `eventMode='none'`; if REQ-0287's ribbon
   occupies that corner, nudge the padlock one cell-corner inward
   (deterministic offset — whichever REQ lands second implements the
   nudge). Existing pointerdown short-circuit + red flash stays.
4. **SIs seated in locked-BP-hosted POs.** Cursor = DEFAULT; pointerdown
   short-circuits with a red flash on its cell (mirror of the fixed-PO
   guard — the refusal stops being a drop-time surprise). No glyph.
   Engine surface: export `poInLockedBP(st, po)` + the page-container twin
   (engine.js ~L164-172 / ~L939) on the engine API + shared/engine.d.ts so
   the client never re-derives lock topology.
5. **Non-goal — do NOT over-lock.** BP move/transfer and (Unit-pivot)
   rotation remain LEGAL on locked starter units (REQ-0209 design). The ✥
   badge and empty-cell handles keep `cursor='grab'` everywhere.

## Implementation notes
Client + engine-surface export only; no behavioral engine change. e2e
specs that use the CORE as a drag/rotate handle (bp-rotate/bp-transfer et
al.) must switch to the badge or an empty cell — each change annotated.

## Gates
- `ci.sh` green; engine tests: exported poInLockedBP parity with the
  internal predicate (canvas + page).
- e2e on decade **7900-7909** (`e2e_harness_req 0290 …`), starter-squad
  fixture, probe seam `cursorProbe: {uid|'seat:'+bpId, cursor}[]`:
  seat cells 'not-allowed' on EVERY unit (starter and normal); fixed POs
  default; badge + empty cells 'grab'; pointerdown on core does nothing
  (no carry, no rotate); pointerdown on locked-seated SI: no carry +
  flash; padlock exactly once per fixed PO.
- Screenshots under `web/preview/req-0290/`.

## Dependencies
Order-free with REQ-0289 (badge position) and REQ-0287 (corner nudge).
