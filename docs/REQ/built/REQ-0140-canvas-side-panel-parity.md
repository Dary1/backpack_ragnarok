# REQ-0140 — canvas-side-panel-parity

**Status:** todo
**Reserved:** 2026-07-12
**Slug:** canvas-side-panel-parity
**Origin:** 2026-07-12 UI/UX + AI-pipeline review session; user verdict **ALL GREEN**.
**Reference:** `web/redesign/canvas.html` (design mock "MJÖLNIR" v1.0),
client Canvas screen (`client/src/` board + ItemPanel).

## Goal

Close the largest design→implementation gap found in review: at 1280×800 the
live app's Canvas screen shows a bare board with a mostly unused right region
and the inventory pushed below the fold, while the ratified MJÖLNIR mock puts
an inventory panel (filter chips, rarity-tinted entries) plus a selected-item
detail card on the right. Port that right-panel composition into the app.

## Scope

- React panel: inventory list w/ filter chips (all / weapon / element / link /
  relic per mock), selected-entry detail card (icon, rarity, effect lines via
  the shared effect-text renderer, flavor, dex ref).
- Selection wiring both ways: board (Pixi) selection ⇄ panel highlight; drag
  from panel to board preserved.
- Empty states designed, not blank: zero-BP canvas and empty inventory get
  guidance copy (ties into REQ-0141).
- Engine consumed AS-IS (adapter only); `i18n.ja` for all new strings; keep
  1280×800 fully usable without vertical scroll on the canvas screen.

## Non-goals

No visual re-theme beyond MJÖLNIR tokens already in the app; no first-run tour
(REQ-0141); no BoardRenderer rework beyond what selection wiring needs.

## Gates

- e2e green via `pnpm run e2e` (box-lock discipline; never raw playwright).
- Side-by-side screenshot vs `web/redesign/canvas.html` at 1280×800 for user
  acceptance.

---

## Implementation (2026-07-14)

**Status:** built. Branch `req-0140-canvas-side-panel`.

### What shipped
Ported the MJÖLNIR mock's right region into the live Canvas screen as an
ADDITIVE React composition under `client/src/canvas/`:
- `CanvasSidePanel.tsx` — inventory list (rarity-tinted `.icard` rows, the
  player's inventory-page POs) with filter chips (all / weapon / element /
  link / relic) + a selected-item detail card (icon, rarity, effect lines
  via the shared renderer, flavor, dex No.).
- `effectText.tsx` — the SHARED effect-text renderer (`effTextOf` +
  `<EffectLines>`), exported for reuse.
- `CanvasEmptyState.tsx` + i18n `canvas.empty.*` — the SHARED empty-state
  copy (zero-BP canvas, empty inventory); REQ-0141 imports these directly.
- `canvasSelection.ts` (selection pub-sub) + `CanvasSelectionOverlay.tsx`
  (panel->board highlight ring, DOM overlay from PAD/CELL board geometry).
- Wiring: `App.tsx`, `styles/canvas.css`, `i18n/canvas.ts`.

### Decisions (conservative; [vetoable] noted)
- **BoardRenderer/drag.ts changes = ZERO**, to minimise conflict with the
  concurrent REQ-0126 skin work. Selection wiring: board->panel reuses the
  existing `board/itemTip` tap channel; panel->board is a
  pointer-events:none DOM ring overlay. Drag panel->board is an ADAPTER over
  `drag.ts`'s existing carry seam (`startCarry`/`armCarry`); the engine's
  inv->canvas REFERENCE-CREATION model is consumed as-is (inventory home
  stays listed, a reference is placed on the board). [vetoable]
- **Pixi InventoryBoard kept** (drag source, always-mounted per REQ-0034).
  At the compact canvas layout (viewport width <= 1500) the wide Pixi
  inventory column is hidden (still mounted) and the side panel IS the
  inventory; at the 2000px E2E viewport both coexist, so every existing
  inventory-board spec is untouched. [vetoable]
- **1280x800 no-scroll:** compact media query hides the wide inventory
  column; a Chromium `zoom:0.75` on `.board-wrap-canvas` at short viewports
  shrinks+reflows the 716px board. `board/geom.ts`'s `clientToLocal` divides
  by the CSS-vs-backing ratio, so drags stay pixel-correct under the zoom.
- **Distinct classes** (`.canvas-side-panel` / `.canvas-item-detail`) so the
  REQ-0114 "no catalog panel on this view" assertions still hold; rarity
  rows reuse the theme `.item-list .icard` / `.rar-*` primitives.
- **Filter chips:** weapon/element/link are best-effort tag-keyword
  heuristics; `relic` = rarity `Relic` OR a `Relic` tag (live content has no
  Relic-rarity items but `herb_pouch` carries a `Relic` tag). [vetoable]
- i18n.ja added for every new string (en/ja parity gate green).

### Gate results
- **ci.sh: CI GREEN** — `flock /tmp/backpack_ci.lock`, `SKIP_PG=1
  SKIP_E2E=1` (no `DATABASE_URL` in the worktree shell; the pg api-test is
  DB-only and this change is client-only; e2e runs via the sanctioned
  wrapper). sim/goldens/S4/forecast/mock-src-engine tests, server+shared
  typecheck, engine type-drift, inspect_kits, client typecheck+build all
  green. (Provisioned `server/` deps -- `pg` -- in the worktree.)
- **e2e: 172 passed, 0 failed (12.6m)** — full default suite via
  `pnpm run e2e` (tools/e2e_run.sh box lock),
  `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8803` (local proxy serves THIS
  worktree build). Includes the new `e2e/canvas-side-panel.spec.ts` (7/7):
  panel+filters render, filters narrow deterministically, selection sync
  both ways, drag panel->board places, empty-inventory copy, zero-BP copy,
  1280x800 no vertical scroll.

### Commits (branch req-0140-canvas-side-panel)
- `cdbf083` — impl (panel, selection, drag, empty states, 1280x800 layout)
- `3ee60a7` — merge master (re-sync before final gates; no conflicts)
- `7c6ef42` — e2e spec (self-contained fixtures) + relic filter + zoom 0.75
- this doc-append + the todo->built move follow.

Side-by-side screenshot vs `web/redesign/canvas.html` at 1280x800 remains for
user acceptance (deferred to the integration/UX owner; NOT merged/deployed
here, per task scope).

---

## Wave-6 integration / deploy record (2026-07-14)

Merged to master via `--no-ff` merge commit `0a8de96` (branch
`req-0140-canvas-side-panel`, tip `8691fc5`). ZERO merge conflicts -- additive
`client/src/canvas/*`; the App.tsx / canvas.css / i18n wiring did not collide
with the concurrent REQ-0126 merge. The worktree`'s intentionally-uncommitted
derived web/app artifacts were ignored (release.sh rebuilds dist).

Full gate `flock /tmp/backpack_ci.lock bash tools/release.sh` GREEN on
integrated master: CI GREEN, admin e2e harnesses green (artadmin 4/4,
artinspect 1/1, contentadmin 21/21), default e2e 172/172 incl.
`canvas-side-panel.spec.ts` 7/7. Dist rebuilt + committed `fa2a0e8`.
Post-deploy e2e re-verify 172/172 (0 failed, 0 flaky), canvas-side-panel 7/7.
Services restarted, HTTP 200 (8801 /app/, 8802 /api/health).

Disposition: the side-by-side UX screenshot vs `web/redesign/canvas.html` at
1280x800 is an EXPLICIT open user-acceptance item (Gates: "...for user
acceptance"; impl note: "remains for user acceptance"). Per board law
(built -> done only with NO open user-acceptance items) this REQ STAYS at
`built` pending that acceptance. Feature is merged + deployed + fully e2e-green;
the only outstanding item is the human side-by-side sign-off.

Final master at deploy: `fa2a0e8`.
