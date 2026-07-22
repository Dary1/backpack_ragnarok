# REQ-0283 — shared squad compositor + cell-fidelity purge (/schedule monitor)

## Origin (user directives, 2026-07-22)
1. "Unit art is NOT the BP background. Canvas/Inventory are the reference.
   The monitor does partially the same thing — build a COMMON mechanism and
   implement it."
2. "Shifting things to make room for labels is a BUG. Rendering must be
   faithful to cell shape and cell position. Formation position/extent and
   Unit/PO positions cannot be shifted. Understand the game spec properly."

## Binding rules (game-spec fidelity — the point of this REQ)
- CELL GEOMETRY IS TRUTH. BP cells, the Unit's seat cell (origin +
  linker.off), PO footprint cells (rotated), formation boxes, enemy
  fieldCells: all drawn at their exact cells, exact extents. NOTHING may be
  displaced, resized, or rearranged for presentation convenience.
- Unit art: drawn AT THE SEAT CELL, board-style — core disc + icon
  contain-fit ~0.55*cellPx centered on the seat cell, FULL alpha, on TOP of
  BP fill and POs (BoardRenderer.ts:1008-1074 is the reference). The
  REQ-0276 drawUnitArt footprint-bbox translucent overlay is WRONG and is
  removed.
- Labels/nameplates/HP bars are ANNOTATIONS: they anchor at a fixed offset
  from their owner's cells and NEVER move (no lane bumping, no de-overlap
  displacement). Overlap resolution is allowed only by non-spatial means
  (truncation, priority hiding, hover). The REQ-0169 M2 label-lane
  machinery and monitorActors relayoutLabels lane logic are removed/
  replaced accordingly. Dots/actors never had lanes - keep that.
- Nothing else in the monitor may shift geometry for display: audit
  remaining offsets (damage-number spread seeds etc. are transient FX at
  the true anchor - acceptable; anything that repositions a PERSISTENT
  element is not).

## Scope
S1. Server: monitor squad projection gains the Unit seat cell per BP
    (origin + linker.off), additive DTO.
S2. client/src/board/squadCompositor.ts — draw-only, cellPx-parameterized,
    non-interactive compositor used by the monitor now (BoardRenderer may
    adopt later): (1) BP cell fill / bp-skin tiling, (2) PO sprites via
    fitBoxInBounds + poOutline insets, (3) unit core disc + icon at seat
    cell (resolveUnitIcon chain), (4) optional charge-ring hook. Reuses
    the pure pieces: fitBoxInBounds (render/itemCard.ts), resolveUnitIcon
    (board/unitIcon.ts), resolveItemIcon (board/itemArt.ts), poOutline.ts,
    resolveBpSkin/bpSkinSprite. eventMode none throughout.
S3. MonitorRenderer.mountSquads consumes the compositor; drawUnitArt bbox
    overlay deleted; PO icons gain the board's outline treatment.
S4. Cell-fidelity purge: enemy nameplate lane system replaced with fixed
    anchoring per binding rules; stale header comments fixed; e2e seams
    (getEnemyMarkerBounds etc.) updated HONESTLY to the new contract.
S5. Gates: ci.sh green (modulo the documented master reds), scoped e2e on
    REQ-0283 decade ports 7830-7839, screenshots, todo -> built.

## Non-goals
- BoardRenderer refactor onto the compositor (follow-up; it stays visually
  canonical as-is). Frost monster art / REQ-0206 (owner's art domain).
  REQ-0259 schema work.

## Status log
- 2026-07-22 reserved -> todo (user-directed, spec-fidelity ruling above).
