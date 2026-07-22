# REQ-0288 — drag ghosts restored: registry-art ghosts, lifted-BP carry, revert feedback

## Status
draft (spec by orchestrator session 2026-07-22; awaiting user ratification).
Reserved 2026-07-22 on branch `req-canvas-inventory-ux-spec`.

## Origin (user directive, 2026-07-22, chat — verbatim)
「ドラッグしている最中のドラッグ途中状態が表示されず、ドラッグアンドドロップが
やりにくいです。(以前はもっとわかりやすかったのですが、直近のセッションが
書き換えてしまった)」and (item 4, second half)「もし、ドラッグアンドドロップに
失敗した場合(置く場所がない)は、元の位置に戻るようにしてください。」
Translation: no in-flight visual during drags makes DnD hard (it used to be
clearer); a failed drop must return the item to its original position.

## Root causes (verified in source — fix exactly these, no rewrites)
1. **Registry-art POs have NO ghost.** `ghosts.ts renderGhostPO()` resolves
   its texture as `textures.get(def.icon)` — the LEGACY sprite key only —
   and returns early when it misses. The placed-PO path was upgraded by
   REQ-0133 to registry-first via `itemTex(textures, p.id, def.icon)`
   (BoardRenderer.ts L100, itemArt.ts `itemIconKey`), but the ghost path
   was never migrated. Every PO whose art is a registry raster (most of the
   current corpus) therefore drags with NO ghost at all. Same latent gap:
   early-return means no footprint feedback either.
2. **A carried BP never visually lifts.** `render()`'s `carriedUids`
   (BoardRenderer.ts ~L770-780) only collects `'po'|'si'|'asm'` uids — a
   BP-kind carry hides nothing, so the origin BP stays fully painted, and
   `renderGhostBP()` draws only when the hovered drop is LEGAL
   (`if (chk.ok && chk.cells)` at ~L1683), and then only flat tinted cells.
   Net feel: "nothing is happening" while dragging a BP.
3. Failed drops already revert state-wise (unresolved/illegal drop =>
   `takeCarry()` with no engine call — drag.ts `ensurePointerUpWired`), but
   give ZERO feedback, which reads as a silent malfunction.

## Design (binding)
1. **One texture chain for placed art and ghosts.** MOVE `itemTex` from
   BoardRenderer.ts (module-local, L100) into `board/itemArt.ts` and export
   it (itemArt is already the registry-first home; this avoids a runtime
   import cycle BoardRenderer <-> ghosts). BoardRenderer imports it back;
   `renderGhostPO` uses it. The SI ghost branch (BoardRenderer
   onGlobalPointerMove 'si') already uses itemTex — leave it.
2. **A ghost ALWAYS renders while the pointer is over a board.**
   - PO/asm: if no texture resolves, draw the footprint as per-cell rounded
     rects `#8a8a8a` alpha 0.35 + `drawPOOutline` (poOutline.ts) instead of
     returning early — a drag must never be invisible.
   - BP (`renderGhostBP` overhaul): draw the WHOLE bag at the snapped drop
     origin (`cell - grabOff`) regardless of legality: per-cell fill in
     `bp.color` (legal: alpha 0.4 as today; illegal: alpha 0.18 + the
     existing red target paint stays), PLUS a mini unit-core disc at the
     seat cell (radius CELL*0.27, colors of the placed core), PLUS each
     contained PO's art via `itemTex` at alpha 0.6 with the same
     k-quadrant rotation math renderGhostPO uses. Cells outside the board
     clip as today. Contained-PO/unit data comes from the ORIGIN container
     (read-only peek, same as the existing bp lookup there).
3. **The origin visibly lifts.** For an armed BP carry, `carriedUids` adds
   the BP id, its contained PO uids, and suppresses its unit/core, badge,
   skin composite and beams; the origin cells render as a "lift shadow":
   per-cell fill `bp.color` alpha 0.12 + stroke alpha 0.4 (communicates
   "came from here / returns here on cancel"). PO/SI carries keep their
   existing hide-in-place behavior.
4. **Revert feedback on EVERY non-committed armed drop** (unresolved drop,
   illegal drop, Esc cancel): the ORIGIN board briefly outlines the item's
   (unchanged) cells in neutral `#8a8a8a`, 350ms — REUSE the flash
   mechanism (ghosts.ts `flash()`) parameterized by color; NOT red (red
   means "rejected target", this means "snapped home"). Wiring: extend
   `BoardCommitApi` with optional `revertFeedback(carry: CarryState)`;
   `ensurePointerUpWired` (drag.ts) calls it on the ORIGIN board's
   registered api whenever an armed carry ends without a commit; Esc path
   (`onWindowKeyDown` -> cancelCarry) routes through the same helper.
5. **Non-goals for feel:** pointer outside BOTH boards keeps today's
   no-ghost behavior (each board is its own Pixi Application; a DOM-level
   ghost is out of scope — note only).

## Implementation notes
- Files: `board/itemArt.ts` (+`itemTex`), `board/ghosts.ts`,
  `board/BoardRenderer.ts` (carriedUids, ghost call sites, badge/skin/beam
  suppression), `board/drag.ts` (BoardCommitApi optional method + cancel
  routing). No engine (mock-src) changes. Keep every existing doc-comment
  invariant (single pointerup listener; per-board bounds authority fix at
  onGlobalPointerMove — do not touch that logic).
- Probe seam for e2e: BoardRenderer gains `ghostProbe: {kind: CarryKind;
  cells: Cell[]; hasArt: boolean; legal: boolean} | null`, set alongside
  ghost drawing, cleared with gCarry.

## Out of scope
Rotation-lift / sticky float (REQ-0289 builds on this); drop legality rules;
cross-board transfer semantics; monitor.

## Gates
- `ci.sh` green; existing `bp-transfer.spec.ts` / `bp-rotate.spec.ts` /
  `inventory-art-integrity.spec.ts` unchanged-green.
- New e2e `drag-ghost.spec.ts` on decade **7880-7889** (`e2e_harness_req
  0288 …`): (a) fixture PO whose art exists ONLY as a registry raster
  (art_urls fixture): ghostProbe.hasArt true during drag — RED before this
  REQ, green after; (b) BP drag: ghostProbe cells present over legal AND
  illegal hovers, origin renders lift shadow (screenshot), unit disc +
  contained-PO art present; (c) drop on dead space: state hash unchanged +
  revertFeedback fired (probe counter); (d) Esc: same as (c).
- Screenshots before/after under `web/preview/req-0288/`.

## Dependencies
None. REQ-0289 depends on THIS.
