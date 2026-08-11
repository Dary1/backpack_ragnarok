# REQ-0373 — Inventory organize: auto-arrange + name search + mass-dismantle safety

## Status
built — implemented by Cowork session 2026-08-11 on worktree/branch
`req-0373-inventory-organize`. All gates green (see Gate results); NOT
merged, NOT deployed, NOT accepted.

Earlier: todo — spec by Cowork session 2026-08-10 (gamer-lens UI gap
analysis batch); ratified by user 2026-08-10, chat: 「では、それらを全て、
TODOのREQとして書き出してください」.

## Origin
UI gap analysis 2026-08-10 (Cowork). Findings P1-3 + P1-4 (both are
"the hoard grows and the tools don't" problems).

## Problem (gamer-facing)
Five fixed inventory pages, no auto-arrange, no name search — the side panel
filters by category chips only (`canvas.filter.*`; `CanvasSidePanel.tsx` has
no search input, verified). Warehouse claims and workshop rolls push items in
first-fit (`client/src/lib/placement.ts`), so pages scatter monotonically;
when everything is full, claims bounce (`schedule.warehouse.claimNoSpace`)
and the player has no tooling to make space beyond hand-dragging.
Separately, multi-select mass dismantle (REQ-0090) shows a count and a total
but NO rarity breakdown — one confirm can melt a Rare unnoticed, and
dismantle is irreversible.

## Spec
1. Auto-arrange (per page): a button in the inventory boardfoot repacks the
   ACTIVE page's items deterministically (footprint-desc first-fit, reusing
   the `placement.ts` variants) as a sequence of legal engine inventory moves
   — `shared/engine.js` untouched (rule 1), auto-save persists normally
   (rule 5). Items that cannot legally move (locked/starter-fixed) stay.
2. Name search in CanvasSidePanel: a text input beside the filter chips,
   matching the LOCALIZED item name (both locales); combines AND-wise with
   the active chip.
3. Mass-dismantle safety: the selection summary in DismantlePanel gains
   per-rarity count chips; when the selection contains Rare or better, the
   confirm button arms in two clicks ("Rare in selection — click again"),
   i18n'd. Single-item flow unchanged.
4. All new strings en/ja at the barrel; selectors additive.

## Gates
- Unit: arrange output deterministic for a fixture page (same input → same
  layout); every emitted move legal per the engine.
- e2e: scatter items → arrange → expected layout; search "frost" narrows the
  list in ja and en; select 1 Common + 1 Rare → confirm requires the armed
  second click; Commons-only → single click as today.
- Undo interop (REQ-0367): arrange counts as ONE undoable step if 0367 has
  landed (snapshot before the batch), else noted n/a.
- CI green.

## Out of scope
Cross-page global sort, page count changes, warehouse-side sorting (its
expiry-ascending order is a design choice), sell/dismantle from search
results.

---

# Execution log (2026-08-11)

## Where the code went
- `shared/placement.mjs` — new export `arrangePage(engine, state, pg)`, the
  fourth named variant beside `firstFitPlace` / `firstFitOrMergeTM` /
  `firstFitPlaceBp`. (+ `placement.d.mts` typed surface.)
- `client/src/store/squads.ts` — `arrangeInventoryPage(n?)`, the store action
  the button calls (defaults to `snapshot.activeInvPage`).
- `client/src/CanvasChrome.tsx` — `ArrangeButton`; `client/src/App.tsx` —
  the inventory stage's new `.boardfoot` row (+ `.board-wrap-inventory`).
- `client/src/canvas/CanvasSidePanel.tsx` — the name search.
- `client/src/schedule/DismantlePanel.tsx` — rarity chips + two-click arm.
- i18n: `client/src/i18n/canvas.ts` (`canvas.arrange*`, `canvas.search.*`,
  `canvas.empty.search*`), `client/src/i18n/workshop.ts`
  (`workshop.dismantle.rarity.*`, `.armBtn/.armedBtn/.armNote/.armedNote`);
  en/ja parity checked key-for-key.
- CSS: `client/src/styles/canvas.css`, `client/src/styles/dismantle.css`.
- Gates: `client/scripts/check_arrange.mjs` (new) wired into `tools/ci.sh` as
  `[5.9i/7]`; `client/e2e/inventory-organize.spec.ts` (new).
- Docs: `shared/README.md`, `client/README.md`.

## Decisions (all recorded in the code they govern)
1. **Lift-then-repack, not move-in-place.** Moving each item straight to a
   computed target deadlocks the moment two items want to swap: A sits on
   B's target and B on A's, every candidate move is illegal, and no ordering
   of legal moves escapes the cycle. `arrangePage` instead LIFTS the page's
   movable records out of the container arrays (immovables stay behind as
   real occupancy) and re-seats them one at a time into an engine-checked
   first fit — which is `firstFitPlace`'s own push-check-rollback pattern
   applied to a whole page rather than a single claim. No new engine
   concept, no cycle possible, and every landing cell is one
   `invCanPlaceBP` / `invCanPlacePO` / `invCanPlaceSI` / `tmCanPlace`
   approved before the matching mutator took it. Rule 1 untouched.
2. **What never moves.** A `fixed` PO — `engine.js`'s `invMovePO` refuses it
   outright (REQ-0051 starter kit), so it is the literal definition of the
   spec's "cannot legally move"; it stays and the repack packs around it. A
   PO inside a BP is cargo: it travels with its pack (`invMoveBP` shifts
   contained POs by the same dr/dc, by design) and is never re-seated alone.
   Socketed/stowed SIs occupy no cell, so there is nothing to arrange.
3. **A LOCKED BP does move** (amends the spec's parenthetical). REQ-0209's
   `locked` refuses new CONTENTS inside a starter pack, not relocation of the
   pack: `invCanPlaceBP`/`invMoveBP` accept it, and moving a starter unit as
   ONE block preserves the build exactly. The spec's "locked/starter-fixed
   stay" was written before that distinction was checked against the engine;
   the engine's own answer is what shipped.
4. **What the repack may not invent.** A previously free PO may never land
   fully inside a BP (that would silently load a pack) — `invCanPlaceCells`
   reports containment as `bp` on its result, so those candidates are
   skipped. Two same-id TM stacks are never merged even though `tmCanPlace`
   would call it legal: this is a relocation, not an economy change.
   Candidates reporting `mergeInto` are skipped. Merging stacks is a real
   "organize" idea and a legitimate follow-up REQ; it is not this one.
5. **All-or-nothing.** If any lifted record cannot be re-seated, every record
   is restored to its original slot in its original array position and the
   call reports `moved: 0`. A half-arranged page is worse than an untidy one.
6. **Undo interop (REQ-0367 has landed).** An arrange is ONE undoable step.
   The snapshot is taken before the repack but ARMED only after it is known
   to have moved something — the same arm-on-success discipline the
   dblclick-rotate sites use, so a no-op arrange neither overwrites an armed
   slot with a copy that undoes nothing nor schedules a pointless save.
7. **The arrange announces itself.** A repack that moves nothing is
   indistinguishable from a broken button, so the boardfoot carries a
   short-lived note (`Arranged — {n} moved` / `Already packed`) beside the
   control. Same short-lived-inline-feedback shape as SquadTabs' delete
   refusal.
8. **Search haystack = names only, both locales.** `dex/Dex.tsx`'s catalog
   search (`[id, name, name_ja].join(' ').toLowerCase().includes(q)`) is the
   precedent for the plain contains test; the item ID is deliberately left
   OUT here, because this is the player's hoard, not a catalog, and the spec
   asks for a NAME search. Both locales are matched whichever locale the UI
   is in — a JA player should not have to flip the language toggle to find an
   item they know by its EN name.
9. **A search that matches nothing is not an empty inventory.** Reusing
   REQ-0140's "nothing stowed here" empty state for a failed search would
   tell someone holding 40 items that they hold none; the search miss gets
   its own copy (`canvas.empty.search*`).
10. **Arm threshold.** `needsArm` = more than one item selected AND the
    selection holds Rare or better. Single-item dismantle already names the
    exact piece being destroyed, which is the one thing the multi flow was
    missing — spec item 3's "single-item flow unchanged" holds literally.
    The arm is dropped whenever the selection SET changes (sorted key), so an
    arm granted for "1 Common + 1 Rare" cannot survive twenty more rows
    joining, and it is cleared after every confirm.
11. **Rarity fallback.** A def with an unknown/absent rarity counts as
    Common — the same fallback the hoard row's own `rar-${rarity||'common'}`
    class already uses, so a chip can never disagree with the tint beside it.
12. **The inventory stage gained a `.boardfoot`.** It had none; it now
    carries the canvas stage's own row (`.board-wrap-inventory .boardfoot`),
    which keeps the two stages structurally twinned and leaves the canvas
    boardfoot's existing E2E selectors (`.board-wrap-canvas .boardfoot ...`)
    unambiguous.

## Amendments to the spec (recorded honestly)
- **`client/src/lib/placement.ts` does not exist.** REQ-0310 promoted the
  first-fit helpers to `shared/placement.mjs`; the spec (written 2026-08-10
  from a stale reading) still pointed at the old path. `arrangePage` was
  added at the real one. `client/README.md` still carried the same stale
  pointer — swept in this commit, per the standing doc-hygiene rule.
- **The e2e search gate uses `dagger`, not `frost`.** Live content
  (`content/live/live_items.json`) has no frost PO — `acc_frost` is an SI and
  the side panel lists POs. `dagger` (EN "Dagger" / JA "ダガー") exercises the
  same both-locales clause against real served content instead of inventing a
  fixture-only item.
- **The dismantle gate reaches for SIs.** Live content carries no Rare or
  Relic PO today; `sis005_thunder_core` / `sis005_moon_pearl` are Rare, and
  the picker takes POs and SIs alike (`collectDismantlable`), so the
  Common+Rare selection is built from real content rather than a fixture
  rarity nobody serves.
- **One out-of-REQ test-hygiene fix.** `client/e2e/input-conventions.spec.ts`
  (REQ-0369) seeds a market listing and never withdrew it. Market listings
  are server-side rows shared by every spec on the same worker backend, so
  whichever worker also ran `market.spec.ts` saw a THIRD listing and that
  spec's exact `toHaveCount(2)` browse assertion failed. Which worker that is
  depends only on file→worker sharding, so the leak was invisible until THIS
  REQ added a spec file and shifted the shards. Fixed at the source (an
  `afterEach` that withdraws what the file created — REQ-0172 order
  independence), not by loosening market.spec.ts's assertion.

## Gate results
- **Unit — `client/scripts/check_arrange.mjs` (new, `tools/ci.sh` `[5.9i/7]`):
  PASS.** Drives `arrangePage` against the REAL `shared/engine.js` in plain
  node (both modules are dependency-free by invariant, same as
  `check_placement.mjs`). Nine cases: determinism (two independently built
  copies of one scattered page arrange to a byte-identical layout, and the
  two runs report the same {moved,total}); idempotence; footprint-descending
  order; every seat engine-legal and no two records sharing a cell; the
  `fixed` PO pinned and excluded from the arrangeable set; BP cargo keeping
  its offset inside its pack; no free PO loaded into a pack; TM stacks
  relocated but never merged (both survive, quantities untouched); socketed
  and stowed SIs untouched; empty and already-packed pages as no-ops; every
  record surviving the round trip with no other page touched; and a LOCKED
  starter pack relocating as one block with its `fixed` kit piece riding
  along, while `invMovePO` still refuses that piece on its own.
  The assertions are BEHAVIOURAL: any future repack strategy that satisfies
  them may replace this one.
- **e2e — `client/e2e/inventory-organize.spec.ts` (new): 8/8 PASS**, inside a
  default suite of **243 passed / 1 skipped / 0 failed (3.2m)**. Covers the
  scatter → Arrange → EXACT expected layout (pack `[1,1]`, shield `[1,3]`,
  dagger `[1,5]`, hilt `[1,6]`) persisted through the normal auto-save PUT;
  the second press reporting `moved: 0`; the arrange as ONE undoable step
  putting all four records back and consuming the slot; search narrowing by
  EN name, by JA name, case-insensitively, in BOTH UI locales, ANDed with the
  chip; the no-match copy being distinct from the empty-inventory copy; the
  rarity chips; the two-click arm; the arm dropping when the selection
  changes; and a Commons-only selection still confirming in one click.
- **Undo interop: covered, not n/a** — REQ-0367 is in `docs/REQ/done/`.
- **Typecheck / lint:** `tsc -b` clean; `oxlint` 0 errors (48 warnings, all
  pre-existing).
- **CI: `CI GREEN`** — `tools/ci.sh`, scope=both (admin+public), 404.3s,
  receipt tree `c6b8bea9759febcf2e39e85484c30a8ffa2d1b53`. Admin/registry
  harnesses green too (8 / 1 / 28 / 4 / 5 passed).

### Two failures seen on the FIRST e2e run, and what they were
Recorded because a run that goes green on the second try owes an
explanation.
- `market.spec.ts` "browse renders listing cards" expected 2 listings, got 3
  — the `input-conventions.spec.ts` listing leak described under Amendments.
  Real, pre-existing, fixed at the source; green since.
- `board-render-ondemand.spec.ts` case 1 timed out in `bootApp` waiting for
  the live data-source badge. A load artefact: that run shared the box with
  another session's full GPU suite (box load average ~25). It passed in the
  CI run above under normal load, and nothing in this REQ touches the render
  scheduler. Not carried as a known-failing test — there is no such set
  (REQ-0159).

## Outcome
Commits on `req-0373-inventory-organize`:
- `9ee67b42` — REQ-0373: inventory organize — auto-arrange, name search,
  mass-dismantle safety (the implementation + both new gates + docs).
- `16fb65c2` — REQ-0373: pin the locked-starter-pack case in check_arrange.
- `b0ab902d` — REQ-0373: dist rebuild (web/app/) from tools/ci.sh — CI GREEN,
  receipt tree c6b8bea9.

Not merged, not deployed, not accepted. The branch tree at `b0ab902d` is
exactly the tree the CI receipt was written for, so it can be merged as-is
without re-running the gate; any further edit invalidates the receipt and
the push gate will (correctly) say so.

Follow-ups this REQ deliberately did NOT take:
- Merging same-id TM stacks during an arrange (legal per `tmCanPlace`, but an
  economy change rather than a relocation — decision 4).
- Cross-page arrange / "make space on a full page by spilling to the next" —
  out of scope here, and the natural next step for the claim-bounce problem
  the Problem section names.
- Sorting or searching the warehouse side, and dismantling straight from
  search results (both explicitly out of scope above).
