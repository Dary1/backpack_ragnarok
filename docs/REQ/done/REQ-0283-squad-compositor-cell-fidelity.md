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

## Built (2026-07-22)
Branch req-0283-squad-compositor-cell-fidelity, base master@1ea0167.

S1 seat cell -- CLIENT-SIDE, no server/DTO change. The Unit seat is `bp.unit.off`
(shared/engine.d.ts BPUnit.off; engine.unitCell(bp)=origin+unit.off), already on the
canvas-store BP objects Monitor.tsx reads (line 167 already read bp.unit.id).
MonitorSquadBP gained an additive `seatCell?: Offset` = [origin+unit.off], in the
SAME absolute local-grid space as `cells`. No server field added (verified engine
adapter + preset store already expose the seat client-side).

S2 client/src/board/squadCompositor.ts (~200 SLOC + doc). Draw-only, cellPx-
parameterized, eventMode:'none'. composeSquad({bps,pos},opts) / composeSquadBP(bp,
pos,opts) draw board z-order: BP cell fill (+ bp-skin tiling via resolveBpSkin +
bpSkinSprite, board->cellPx remapped), PO sprites contain-fit (resolveItemIcon +
insetBoxFor + fitBoxInBounds) with the board's two-tone footprint outline
(boundaryLoops/insetLoop/PO_OUTLINE_*), then the unit core disc (r=26/80*cellPx,
cyan stroke) + icon (44/80*cellPx contain-fit) centred on the seat cell at FULL
alpha, ON TOP. Reuses the pure pieces; only the board->cellPx coordinate remap is new.

S3 MonitorRenderer.mountSquads consumes composeSquad; the REQ-0276 drawUnitArt
footprint-bbox wash is DELETED; formation outline + squad label/plate/KO/pips stay at
their exact anchors; the icons loop is retained only for the ray_fire flash handle.
getLastMountedSquads shape unchanged (bps carry seatCell additively).

S4 cell-fidelity purge -- persistent-element displacements REMOVED:
  1. EnemyPlane.relayoutLabels (roster actors): lane bumping gone -> nameplate at a
     FIXED box-bottom anchor; overlaps resolved by topmost-leftmost priority keep +
     non-spatial hide.
  2. MonitorRenderer.relayoutEnemyLabels (legacy blob fallback): same -- fixed
     label.y=0 anchor, priority-hide, no lanes. MAX_LABEL_LANES / MAX_LANES removed.
  HP bars were already fixed (never laned). Audit of the rest: damage-number spread
  seeds are transient FX at the true anchor (acceptable per the binding rules); status
  chips / charge pips / KO stamp are fixed layouts. No other persistent displacement.
  getEnemyMarkerBounds honesty comment updated (lane now only 0=shown / -1=hidden);
  the stale "no real enemy art exists" header comment fixed.

S5 e2e: schedule.spec.ts:1036 (enemy marker bounds) gains a positive assertion of the
honest contract -- marker.lane <= 0 for every marker (never a bumped-down lane). No
spec asserted the OLD lane/de-overlap contract, so nothing needed rewriting; the
FIELD_W (x+labelWidth<=468) invariant assertion is unchanged and still passes.

S6 gates: full tools/ci.sh (nohup) GREEN modulo the documented master reds ONLY --
forecast.spec.ts:206 and schedule.spec.ts:1457 (the documented schedule:1451 monitor-
capture load-flake, shifted +6 lines by the S5 insertion; failed in 194ms on 500/404
resource errors, before any render -- not a rendering regression). artadmin:124/:273
and workshop:361 PASSED this run. 194/196 e2e passed incl. schedule:1036 (new
assertion) + schedule:994 multi-BP mount; all sim/server/typecheck/build green.
Scoped e2e ran on the REQ-decade fleet (tools/e2e_ports.sh 0283 -> proxy 2832, fleet
2834+, the tool-enforced PORT=REQ*10 decade). Production client build passed ([6/7]);
web/ reverted per convention.

S7 screenshots (scoped fleet, seeded live niflheim_depths run, webdriver-gated static
render): req0283_player_field.png (4 squad boxes: BP colour fill + PO icons WITH the
two-tone footprint outline + unit core disc AT THE SEAT CELL, not a footprint wash),
req0283_enemy_field.png (Rime Shaman actor: cell block + HP bar + nameplate at a fixed
offset under its cells, no lane), req0283_monitor_full.png (both planes). Under
mnt/outputs/.

Non-goals untouched: BoardRenderer keeps its own canonical draw path (the compositor
is ready for a later adoption via composeSquadBP); no frost-monster art / schema work.

## Deploy log
- 2026-07-22 built -> MERGED to master + DEPLOYED (deploy agent, owner-authorized 2026-07-22).
  Merge `eaf7610` (--no-ff, base master@1ea0167 -- master had NOT moved from base, ZERO conflicts;
  the flagged overlap files client/src/schedule/* + client/e2e/schedule.spec.ts merged cleanly).
  Client-only change (touches ONLY client/ + docs/, no server/ or shared/) -> backpack-api restart
  SKIPPED as unnecessary; backpack-web (python http.server :8801) serves web/app from disk, no
  restart. web/app rebuilt in the main checkout `7a1fa67` (`cd client && pnpm run build`, vite
  outDir ../web/app) -> live bundle `index-C6UPg4kD.js` (old `index-D0--QoC6.js` gone); fresh build
  reproduced the identical hash (deterministic). Master gate (tools/ci.sh, DATABASE_URL from
  server/.env, ART_FAMILY_BARRIER=0): all deterministic + pg gates GREEN -- sim/server, [5.x] pg
  backend (api/artwork/artqueue/artfamily/inspection/content/content_serving/schedule_serving/
  bio/bpskin), every client unit suite, [6/7] client typecheck + build of the merged code, [6.1]
  bundle Supabase-env tripwire. [6.5] aborted ci.sh under `set -e` on ONLY the documented artadmin
  goto-under-load family (artadmin.spec :124/:273, REQ-0222 lineage, tolerated per the REQ-0276/0280
  deploys) -- reproduced on a standalone retry (2 failed / 6 passed, exactly :124 + :273), NOT
  touched by REQ-0283, no NEW reds. Documented client reds (forecast:206, schedule:1457 monitor-
  capture flake, workshop:361) pre-existing/unchanged. Live verify: /app/ serves the new bundle
  `index-C6UPg4kD.js` on local :8801 AND the public tunnel (backpack-dev.qtie.jp); /api/health
  `{ok:true,version:0.1.0}` on local :8802 AND the tunnel. Worktree left in place.
