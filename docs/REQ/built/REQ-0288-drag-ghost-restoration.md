# REQ-0288 — drag ghosts restored: registry-art ghosts, lifted-BP carry, revert feedback

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

---

## Log (implementation, 2026-07-23, Fable orchestrator session)

Implemented on branch `req-0288-drag-ghost-restoration` (base: spec branch @ 375409b).

**What landed** (commits `942b299` code, `8a34886` tests, screenshots commit follows):
- `itemTex` moved to `board/itemArt.ts` (type-only pixi import; Node-loadable) — ONE
  chain for placed art AND ghosts. `renderGhostPO`/`renderGhostAssembly` resolve
  through it; PO ghost degrades to a neutral footprint + `drawPOOutline` when no art
  resolves (never-invisible law). Returns hasArt for the probe.
- BP lift: `render()` resolves the airborne bag up front; origin cells fade to a lift
  shadow (fill α0.12/strokes α0.4), skin composite, ✥ badge, empty-cell handles, unit
  core/art and its beams all lift; contained POs hide via geometric anchor-cell
  membership (container-agnostic).
- `renderGhostBP` overhaul: whole bag at the snapped origin on EVERY hover (legal α0.4 /
  illegal α0.18 under the red target paint), unit-core mini disc at the seat cell,
  contained-PO art riding at α0.6 with the placed path's contain-fit + k-quadrant math.
- Revert cue: `BoardCommitApi.revertFeedback?` + drag.ts dispatch-tracking pointerup;
  neutral-grey `flash(...,'#8a8a8a')` on the origin cells for every armed carry that
  ends without a commit; Esc routes through `cancelCarryWithFeedback()`. Dispose-path
  `cancelCarry()` stays silent by design (board unmount is not a user revert).
- Probes: `BoardRenderer.ghostProbe` + `revertCount`, exposed via
  `window.__backpackBoardProbes[boardKey]` (boot.ts `__backpackDebug` precedent).

**Gates**

| gate | result |
|---|---|
| `client/scripts/check_ghost_chain.mjs` (new tripwire) | OK |
| `tsc -b` / `pnpm run build` | OK / OK |
| `drag-ghost.spec.ts` T1-T5 (decade 7880, solo) | **5/5 green** |
| targeted suite (drag-ghost, bp-transfer, bp-rotate, reference-model, inventory-art-integrity, baseline-smoke; 2 workers) | 29 passed / 1 failed |
| baseline control: SAME suite at base 375409b (no REQ-0288 code) | 24 passed / **same 1 failed** |

The one red — `bp-transfer.spec.ts:164` "3. round trip" — is a PRE-EXISTING
parallel-budget flake (2 reloads + 3 drags + 3 saves ≈ 22s solo vs 30s budget; green
solo on BOTH trees, red under 2-worker load on BOTH trees). Not a REQ-0288 regression;
candidate for the REQ-0222 load-resilience family.
An earlier accidental FULL-suite 4-worker run produced a broader load-cascade (16 reds
incl. apiRequestContext timeouts); the targeted+baseline comparison above supersedes it.
First spec version also grabbed board cells without the canvas element offset (own bug,
fixed: coordinates are `boundingBox() + cx/cy`, the convention every drag spec uses).

**Evidence**: `web/preview/req-0288/` — bp-ghost-legal.png (lifted origin as shadow;
whole-bag ghost with unit disc + PO art + green paint at rows 6-8 × G-H),
bp-ghost-illegal.png (same ghost, dimmed, under red paint over beta).

---

## Log (revival + merge to master, 2026-08-03, Opus session)

The 2026-07-23 work above was never merged. Master moved **559 commits** while
the branch sat, and current master still carried the defect (`ghosts.ts` L11
was still `textures.get(def.icon)`), so the REQ was still live, not obsolete.
User ruling this session: bring the branch up to master rather than reimplement,
and carry it through to a master merge.

**Merge** (`8d170d19`). `ghosts.ts` / `drag.ts` / `commits.ts` / `itemArt.ts`
auto-merged. `BoardRenderer.ts` conflicted in 6 hunks, every one of them master
restructuring rather than a disagreement about REQ-0288 behaviour:

| master's change | resolution |
|---|---|
| BP and BP-unit loops wrapped in `drawGuarded(...)` closures; label/badge/handles moved inside the BP closure | took master's structure; re-applied the lift as `lifted`/`carriedBPId` guards inside it (`continue` -> `return` where a loop body became a closure) |
| REQ-0287 ownership ribbons, new, sitting between the badge and the grab handles | badge + ribbons + handles are all bag furniture at the TAIL of the closure, so ONE early `if (lifted) return;` replaces the branch's three separate guards. Ribbons lift with the bag: a wedge hovering over a lifted footprint reads as "the bag is still there". Merge-era decision the original spec could not have made. |
| REQ-0345 killed the always-on Ticker; mutation sites now `requestRender()` themselves | additive at both conflict sites -- kept both sides. `flash()` now carries REQ-0288's colour parameter AND REQ-0345's repaints. |

**A real defect the merge exposed** (`7f08f424`). The refreshed evidence
screenshot showed the bag ghosting correctly at the drop origin while its
ORIGIN cells stayed fully painted -- badge, unit core, contained-PO art, full
outline. All five specs were green across that change, because the lift's only
evidence WAS the screenshot. Found by looking at the PNG, not by a gate.

Root cause is PRE-EXISTING and not merge damage: every Pixi Application's
EventSystem listens on `document`, so BOTH boards run `onGlobalPointerMove` for
every pointermove (the REQ-0031 note inside that function already says so).
`armCarry()` is global and one-shot, so whichever board's handler crosses the
5px threshold FIRST arms the carry -- and the origin repaint sat inside that
same `if (!carry.armed)` branch. An origin board that LOST the race saw
`carry.armed === true` on its own pass, skipped the branch, and never
repainted. Which board won was decided by mount order, so this was a silent
order-dependent flake for PO hide-in-place long before REQ-0288; the BP lift
made it impossible to miss, and master's board mount changes flipped the race.
Fixed by arming and then repainting the ORIGIN board regardless of which
handler armed it, latched one-shot per carry (`armRendered`).

**New gate seam**: `BoardRenderer.liftProbe` -- the BP id `render()` actually
resolved as airborne -- published through the same `__backpackBoardProbes`
seam, asserted by T3. Verified RED before the fix (`lift: null` on a losing
race) and green 3/3 solo runs after. A screenshot nobody diffs is not a gate.

**Correction to this REQ's own Gates section**: the port decade named there
(7880-7889, derived from the REQ number) is exactly what PROJECT.md forbids --
ports come from the port desk (`tools/e2e_ports.sh`, REQ-0323), which post-dates
the spec. Scoped runs leased their decade from the desk; `tools/ci.sh` leases
its own.

**Gates (2026-08-03, on the merged tree)**

| gate | result |
|---|---|
| `tools/ci.sh` (scope=both) | **CI GREEN** -- 217 client e2e, 28+8+4+1 admin e2e, full server/sim suites |
| `drag-ghost.spec.ts` T1-T5, scoped solo, 3 consecutive runs | 5/5 green x3 (no flake) |
| `check_ghost_chain.mjs` tripwire / `tsc --noEmit` | OK / clean |
| lift regression, pre-fix | T3 RED (`lift: null`) -- the fix is pinned |

No pre-existing red this time: the `bp-transfer.spec.ts:164` parallel flake the
2026-07-23 run had to explain away did not reproduce.

**Evidence**: `web/preview/req-0288/` refreshed from the fixed tree --
bp-ghost-legal.png (origin alpha at rows 1-3 x A-B reduced to its lift shadow:
no badge, no unit core, no contained-PO art, dimmed outline; whole-bag ghost
with unit disc + PO art under green paint at rows 6-8 x G-H),
bp-ghost-illegal.png (same ghost dimmed, under red paint over beta).
