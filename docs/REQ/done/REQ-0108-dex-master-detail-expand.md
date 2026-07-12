# REQ-0108 — Dex master/detail expand (keep catalog grid, expand detail in place)

- **Status**: DONE (accepted 2026-07-08) — implemented + all gates green on branch `req-0108-dex-master-detail-expand` (commit ea5dbec, rebased onto master @ 2db0a50); MERGED to master @ d36f7a8 and LIVE (static serve); owner-accepted; terminal. Owner approved **option (A) inline drawer**; see Outcome.
  Number claimed via `tools/touch_next_req_reserved.py` = **REQ-0108** (earlier manual
  picks 0101/0104 collided with concurrently-synced board entries
  `REQ-0101-styleguide-fx-catalogue` / `REQ-0104-icon-align-trim`; the docs board is a
  live shared board per PROJECT.md, so it moved under us). Implementation on server
  worktree `req-0108-dex-master-detail-expand`, branched from **latest `master`**.
- **Origin**: owner directive (2026-07-08) — on `#/dex`, pressing a catalog card
  replaces the WHOLE view with a separate `[list | diagram | info]` layout whose left
  list rail is NOT consistent with the catalog grid. Ruling: keep the catalog grid (the
  index list) and show the selected item's detail as an in-place **expand**.

## The inconsistency (observed 2026-07-08, live)

- **Index (before selecting)** — `.dex-grid` of `.dex-card`: a rich card grid (No. chip,
  rarity frame + gem, shape-mounted ShapeGrid thumbnail, name, category ・ EN caps,
  rarity word, PO/SI tag), organized into sections (Catalog of Forms = PO + SI, plus a
  separate Transmutators / TM section below).
- **Detail (after selecting)** — the whole `.dex-view` swaps into `.dex-detail-columns`
  = `[.dex-detail-col-list | .dex-detail-col-diagram | .dex-detail-col-info]`. The left
  `.dex-detail-col-list` (`.dex-detail-item-list-row`) is a SECOND, independently built
  rendering: flat text rows, no rarity frames / thumbnails, no grouping, and it OMITS the
  Transmutators section.

## Root cause (code — confirmed 2026-07-08 on live `master`, read-only)

The Dex renders its item list in TWO components and *swaps* on selection:

- **Catalog** — `client/src/dex/Dex.tsx` renders `.dex-grid` from the `filtered` array
  (Dex.tsx:335-336) as `.dex-card` cards, then a separate `.dex-tm-section` from `tms`
  (Dex.tsx:~407).
- **Detail** — an EARLY RETURN `if (selectedId) { return <DexDetail entries={filtered}
  ...> }` (Dex.tsx:219) mounts ONLY `DexDetail`; the grid + TM section are not rendered.
  `DexDetail.tsx:135` re-renders the same `filtered` as `.dex-detail-item-list-row` rows.

Both surfaces map the same `filtered`, so PO/SI order + filtering already agree; the
divergence is (1) representation, (2) TM omission (`tms` never passed to `DexDetail`),
(3) the swap also hides the search/rarity/tag controls (non-selected branch, Dex.tsx:236+).
Since the rail already consumes `filtered`, removing it and keeping `.dex-grid` loses no
data fidelity.

## Goal — one list, always

- Keep `.dex-grid` (+ `.dex-tm-section`) and the search/rarity/tag controls mounted on
  selection (persistent master).
- **Remove** the `.dex-detail-col-list` rail — the grid is the only list.
- Reveal the selected item's detail (`DexDiagram` + `ItemDetailCard`) as an in-place
  EXPAND, not a view swap.

## Design — (A) inline drawer, CHOSEN (owner 2026-07-08)

Detail COMPOSITION unchanged (reuse `DexDiagram` + `ItemDetailCard`; same
`render/itemCard.ts` math / no new Pixi Application). Change only WHERE detail mounts;
drop the list rail.

- Selecting a `.dex-card` sets `selectedId` and marks the card `.dex-card-selected`. A
  full-width detail drawer (`.dex-detail-drawer`, `grid-column: 1 / -1`) is inserted into
  the grid immediately after the selected card, holding the two-pane `[diagram | info]`.
  The rest of the grid stays visible and scrollable.
- Collapse control reuses `dex.backToList`; re-selecting another card re-anchors it.
- Narrow (<1100px): drawer full width, `[diagram -> info]` stacked.
- (Rejected alt B: docked right pane.)

## Selector / E2E contract — BREAKING, handled

- **Keep verbatim**: `.dex-root`, `.dex-view`, `.dex-count`, `.dex-grid`, `.dex-card`,
  `.dex-card-summary`, `.dex-card-shape .shape-grid` (+ overlay/footprint), `.dex-search`,
  `.dex-empty`, the whole `.dex-diagram*` family, `ItemDetailCard` info + `.dex-market*`,
  all `.dex-tm-*` / `.dex-admin-*`.
- **Removed**: `.dex-detail-columns`, `.dex-detail-col-list`, `.dex-detail-item-list-row`
  (+ overlay), the full-view swap. `.dex-detail-col-diagram` / `.dex-detail-col-info`
  retained as the drawer's two panes; `.dex-detail-back-btn` retained as collapse.
- **Add**: `data-testid="dex-detail-drawer"`, `.dex-card-selected`, `dex-detail-open`.
  Update `client/e2e/dex.spec.ts`; `dex-admin.spec.ts` untouched.

## Interplay with shipped features

- `#/dex/<id>` deep link (REQ-0052): `dexFocusId` effect sets `selectedId` -> now selects
  + expands within the grid. Reuse as-is.
- "i" preview subwindow (REQ-0052): **kept** (owner: keep both).
- DexAdmin edit view: out of scope, unaffected.
- TM section: preserved for free; TM cards stay display-only.

## i18n

Reuse `dex.*` detail keys incl. `dex.backToList`. No content-text change.

## Decisions (resolved 2026-07-08)

1. Expand mode = **(A) inline full-width drawer under the row**.
2. Separate list rail = **removed**.
3. Narrow-screen = drawer full width, `[diagram -> info]` stacked.
4. `client/e2e/dex.spec.ts` **may be updated**.
5. "i" preview subwindow = **kept**.

## Dependencies

- Modifies REQ-0075 detail layout; reuses REQ-0038 behavior + REQ-0052 deep link /
  subwindow. Client-only; no server/engine/GameState change.

## Test plan (gates before built)

- **client E2E** (`dex.spec.ts`, updated): selecting a `.dex-card` keeps `.dex-grid`
  visible; the drawer shows the SAME item's `.dex-diagram*` + info / `.dex-market*`;
  exactly ONE list in the DOM (no `.dex-detail-col-list`); TM section stays; collapse
  returns to the plain grid; `#/dex/<id>` opens expanded; the "i" subwindow still opens;
  `.dex-empty` on no-match; DexAdmin unaffected.
- **Preserve**: `dex-admin.spec.ts`; `nav-routing` round-trips.
- No server change -> `tsc -b` clean; `pnpm build` (tsc + vite) success; `oxlint` clean;
  `check:sprites` 22/22; engine + server suites untouched; fresh `web/app` dist committed.
  E2E not live-run (Playwright baseURL is prod) -> dry-run-read the updated spec.

## Outcome (2026-07-08) — BUILT (client-only; not merged/deployed)

Implemented on server worktree `req-0108-dex-master-detail-expand` (branched from
`master` @ 23ac456), commit **2521df0**.

### What shipped
- **Dex.tsx** — removed the `if (selectedId)` whole-view swap. The catalog grid
  (`.dex-grid`) + TM section + search/rarity/tag controls stay mounted on selection.
  The selected `.dex-card` gets `.dex-card-selected` (ring) and a full-width
  `.dex-detail-drawer` (`data-testid="dex-detail-drawer"`, `grid-column: 1 / -1`) is
  rendered right after it via a `Fragment`, holding `<DexDetail>`. Re-clicking the
  selected card (or Back) collapses it. `#/dex/<id>` deep link (dexFocusId) still sets
  `selectedId` → now expands in place.
- **DexDetail.tsx** — reduced from the 3-column `[list | diagram | info]` (with its own
  re-derived list rail) to the drawer's two panes `[diagram | info]`
  (`.dex-detail-col-diagram` / `.dex-detail-col-info`, both retained). `DexDiagram` +
  `ItemDetailCard` reused verbatim (same fit math; no new Pixi app). The list rail
  (`.dex-detail-col-list` / `.dex-detail-item-list-row`) + `ShapeMountedThumb` removed.
- **index.css** — appended `.dex-card-selected`, `.dex-detail-drawer`,
  `.dex-detail-drawer-panes` (flex; stacks `[diagram → info]` under the existing 1100px
  breakpoint). Old `.dex-detail-columns` / `-col-list` / `-item-list-row` rules left in
  place but now unused (no DOM references them).
- **e2e/dex.spec.ts** — replaced the two tests that asserted the 3-column swap + the
  narrow stacked list with two REQ-0108 tests: (1) selecting keeps `.dex-grid` visible,
  opens the drawer with diagram+info, asserts NO `.dex-detail-col-list` /
  `.dex-detail-item-list-row`, diagram-left-of-info, info shows id + eff_en, collapse
  returns to the plain grid; (2) narrow viewport stacks the drawer panes, grid
  preserved. The other 5 dex tests are unchanged (retained selectors). Header comments
  in Dex.tsx + dex.spec.ts updated to the new behavior.

### Gates (worktree, 2026-07-08)
- `tsc -b` → clean. `oxlint` (Dex.tsx, DexDetail.tsx) → 0 warnings / 0 errors.
- `vite build` → success; `web/app` dist rebuilt (only the pre-existing >500 kB chunk
  advisory).
- `check:sprites` → 22/22 non-blank (fresh worktree lacked `.venv`; borrowed the main
  checkout's `.venv` for the run, symlink removed after — same posture as REQ-0052).
- engine `node mock-src/tests/run.cjs` → 101 passed, 0 failed; `node sim/tests/run.cjs`
  → 66 passed, 0 failed (client-only; engine untouched).
- E2E not live-run (Playwright `baseURL` is the prod tunnel, per house norm) →
  `playwright test --list` parses all 134 tests incl. the 2 new dex cases; new specs
  hand-traced against the implementation.

### Deliberately not done (coordinate-required / out of scope)
- **Merge to `master` + deploy** — separate, coordinate-required (live services).
  `master` moved during this session; a rebase onto latest master is needed before any
  merge.
- **pnpm-lock.yaml** — `pnpm install` generated `client/pnpm-lock.yaml`; left
  UNCOMMITTED to avoid colliding with the in-flight REQ-0107 (pnpm-lockfile-formalize).
- Old unused `.dex-detail-columns` / `-col-list` CSS not physically removed from the
  ~4600-line index.css (nothing references it; low-risk to leave).

### Commit
- `2521df0` — REQ-0108: dex master/detail inline expand (branch
  `req-0108-dex-master-detail-expand`).

### Rebase (2026-07-08) — ready for merge
Rebased cleanly onto latest `master` @ 2db0a50 (incl. REQ-0093 / 0094 / 0107); no
conflicts — none of the touched client files (Dex.tsx, DexDetail.tsx, index.css,
dex.spec.ts) or the dist changed on master since the branch base. New commit
**ea5dbec**. Re-verified on the new base: `pnpm install --frozen-lockfile`
(REQ-0107 canonical lockfile) → up to date; `tsc -b` clean; `vite build` ok and the
rebuilt dist is byte-identical to the committed one (nothing to re-commit);
`node mock-src/tests/run.cjs` → 101 passed, 0 failed. Branch is up to date with
master and ready to merge — merge + deploy remain coordinate-required (live services)
and were NOT performed.

### Merged + deployed (2026-07-08) — LIVE, awaiting acceptance
Merged into `master` with `--no-ff` (repo convention). master @ **d36f7a8**
("Merge branch req-0108-dex-master-detail-expand (REQ-0108: …)"), feature commit
`ea5dbec` beneath. `backpack-web` serves `~/backpack_ragnarok/web` statically
(`python3 -m http.server 8801`), so the merge is live immediately — no restart.
Verified: live `/app/index.html` references `assets/index-SAXvGrrV.js`, and that
bundle contains the `dex-detail-drawer` markup → change is live at
https://backpack-dev.qtie.jp/app/#/dex . Kept in `built/` pending user acceptance;
move to `done/` on confirmation.

### Accepted → DONE (2026-07-08)
Owner accepted the live change ("DONE"). Moved `built/` → `done/`. Terminal; history.
