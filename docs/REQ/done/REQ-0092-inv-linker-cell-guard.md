# REQ-0092 — inv-page PO placement now respects a BP's linker cell

Status: **done** (merged to `master`, client dist rebuilt, `backpack-api`
restarted, live — see "Deploy" below). User accepted via chat ("merge and
done", 2026-07-07).

## Origin

User request (chat, 2026-07-07, ja): claiming an item from the warehouse
ignores the linker's PO-unplaceable space, so the item lands inside the
backpack (an inventory-page BP) at an invalid position.

## Bug

`invCanPlacePO`/`invMovePO` (mock-src/engine.js) — the legality check and
mutator behind ALL inventory-page PO placement — never refused a BP's own
**linker cell**. The canvas equivalent (`canPlacePO`, backing on-canvas
placement) has refused it since REQ-0045 (`why:'Linker cell'`). Per
`docs/user_managed/canvas_spec.md`'s Linker section, the Linker is itself
one of the things "placed into a BP's cells" (alongside items/weapons) —
it occupies a cell exactly like a PO would, so no other PO may land there.
Because the inventory-page check never enforced this, a PO could be
placed directly on top of a page-resident BP's linker cell.

This reached players through:

- **Warehouse claim** (the reported path): `firstFitPlace` in
  `client/src/warehouse/WarehousePage.tsx` scans an inventory page
  row-major and places the claimed item at the first cell
  `engine.invCanPlacePO` calls legal — including a linker cell, since
  nothing rejected it.
- Any manual in-page PO drag/drop (same `invCanPlacePO`/`invMovePO` gate).
- `migrateState()`'s legacy-inventory first-fit (`firstFitCell`, same
  underlying `invCanPlaceCells`).

Not affected: free-placed SI (`invCanPlaceSI`) and TM stacks
(`tmCanPlace`) already refuse landing on **any** BP cell outright (a
stricter, pre-existing rule that covers the linker cell as a subset) —
this bug was reachable only through PO placement.

### Root cause

`invCanPlaceCells(container,cells,exclUids)` is a deliberately separate
implementation from the canvas's `canPlaceCells(st,cells,exclUids)` (own
code comment: "a distinct function... not a parameterization"), since
inventory pages allow free (no-BP) placement while canvas does not. When
it was written, the containment/straddle/occupancy rules were ported over
faithfully, but the canvas version's extra `linkerMap`-backed rejection
was not — a plain implementation gap, not an intentional difference.

"Linker dormancy" (engine.js's `linkStateInv` comment, near
`migrateState`) is unrelated: it only says a page-resident BP's linker
contributes nothing to `traceBeams`/connections while dormant. It says
nothing about the linker's own cell reservation, which is pure shape
geometry, independent of whether the linker is "live" (on canvas) or
"dormant" (in a page).

### Reproduction (engine-level, before fix)

```
CANVAS  placePO at linker cell 1,1: {"ok":false,"cells":[[1,1]],"why":"Linker cell"}
INV PAGE placePO at linker cell 1,1: {"ok":true,"cells":[[1,1]],"bp":"bagA"}
```

Same BP layout (a 2x2 BP, linker at its own origin cell), same target
cell — canvas correctly refuses, the inventory-page path wrongly allowed
it. After the fix both refuse identically.

## Fix

`mock-src/engine.js`: added `linkerMapIn(container)` (mirrors the
canvas's `linkerMap(st)`; `linkerCell(bp)` was already
container-independent, so this is a direct parallel of the existing
`cellBPMapIn`/`cellBPMap` relationship). `invCanPlaceCells` now builds
`lk=linkerMapIn(container)` and rejects `why:'Linker cell'` in the same
relative position `canPlaceCells` does — after BP-membership (`cbp`) is
resolved for a cell, before the shared occupancy check. No exported
engine surface changed (both are/were internal helpers; drift check
confirms 49 members, unchanged).

Also fixed two test-fixture bugs this exposed in
`mock-src/tests/run.cjs`: two inventory-page tests used a placeholder
`linker:{off:[0,0],dirs:[]}` that happened to coincide with the exact
cell each test asserted a PO could legally occupy — dead data before
this fix (nothing consulted it), a live conflict after. Relocated each
placeholder to an untested cell of the same BP (or, for a genuine 1x1 BP
with no spare cell of its own, to an explicit off-grid placeholder), each
with a comment explaining why. No other call site among the suite's ~50
`migrateState`/`invCanPlacePO`/`invMovePO` uses was affected — verified
empirically by running the full suite to green, not by manual audit of
every site.

Added one new regression test (`REQ-0092 inventory: invCanPlacePO
rejects a page-resident BP's own linker cell...`) asserting: a PO cannot
land on a page-resident BP's linker cell (checked via both
`invCanPlacePO` and `invMovePO`, `why:'Linker cell'`), a *different*,
non-linker cell of the *same* BP remains legal (guards against a
blanket/over-broad regression), and `invMovePO` leaves state completely
unchanged on refusal.

## Files changed

- `mock-src/engine.js` — `linkerMapIn` + `invCanPlaceCells` fix.
- `mock-src/tests/run.cjs` — 2 fixture fixes + 1 new regression test.

Branch: `req-0092-inv-linker-cell-guard` (cut off `master`@`e43e0bc`).
Commits: `ebd08cad9379f81da877ad60f631166db5adcd99` (engine fix + tests),
`e1f0bdf` (client dist rebuild, after merging master forward to pick up
REQ-0090/0091 which had landed on `master` in the meantime).

## Gates

- `node mock-src/tests/run.cjs` — **101/101** (100 pre-existing + 1 new).
- `node sim/tests/run.cjs` — **63/63**.
- `node sim/tests/goldens.cjs` — **12/12**, determinism intact.
- `node tools/check_engine_types.cjs` — OK, 49 members, no drift.
- `node server/tests/api_test.cjs` (files backend) — **153/153**.
- Root `tsc` typecheck (`server/pg_sync.cjs(59,86/100)`, pre-existing
  from REQ-0089) — was still red on this branch's original base
  (`master@e43e0bc`); confirmed identically red on unmodified master at
  the time, so not this fix's doing. Resolved on its own once this
  branch merged current `master` forward (REQ-0090/0091's merge to
  master included a 2-line `pg_sync.cjs` fix) — re-ran after that merge:
  **green**.
- `cd client && npm run build` — **succeeds** (796 modules, no errors;
  one pre-existing "chunk >500kB" advisory, unrelated). Dist rebuilt and
  committed (see commit `e1f0bdf`).
- `SKIP_PG=1` (no `DATABASE_URL` in this session) — pg-backend api tests
  not run. `SKIP_E2E` — Playwright e2e not run this session (client
  build itself was verified directly instead).

## Interpretations / decisions

1. **Fix scope: shared engine function, not the warehouse client code.**
   The user reported the bug via warehouse claim specifically, but the
   root cause is a general inventory-page legality gap. Patching only
   `firstFitPlace` (client) would have left manual drag-and-drop and
   `migrateState` first-fit exposed to the same bug. Fixed at the one
   shared chokepoint instead.
2. **REQ numbering correction (process note, not a code decision):** this
   agent initially claimed REQ-0090, but discovered — only after creating
   a worktree/branch under that number — that `req-0090-list-multiselect`
   and `req-0091-warehouse-claim-feedback` already existed as in-progress,
   uncommitted worktrees on llmlocal with no corresponding `docs/REQ`
   stub. Corrected to REQ-0092 (confirmed free via both `docs/REQ/*` and
   `git for-each-ref refs/heads/` on llmlocal). The stray, now-void
   `docs/REQ/reserved/REQ-0090-inv-linker-cell-guard.md` stub could not be
   deleted (Cowork FS write-once protection) and was left in place with a
   retraction note rather than silently abandoned. `req-0091`'s
   in-progress diff (`WarehousePage.tsx` claim-button press feedback —
   flash/chime/double-press guard) was inspected read-only to confirm no
   file or logic overlap with this fix; none found (different files:
   `WarehousePage.tsx` UI feedback vs. `engine.js` placement legality).
3. **`req-0072-redesign-warehouse`, `req-0086-warehouse-main-nav`,
   `req-0091-warehouse-claim-feedback`** are other in-flight,
   warehouse-adjacent branches noticed during this REQ's setup, not
   inspected further (out of scope) beyond confirming no file-level
   overlap with req-0091 as noted above.

## Deploy

User said "merge and done" (chat, 2026-07-07) — explicit go-ahead.

1. `master` had advanced past this branch's original base in the
   meantime (`req-0090-list-multiselect` + `req-0091-warehouse-claim-
   feedback` merged to `master` as `10622cc`, unrelated files — no
   overlap with this fix, confirmed by diff inspection). Merged current
   `master` into `req-0092-inv-linker-cell-guard` (`git merge master`,
   clean, no conflicts) before merging forward.
2. Re-ran the full gate post-merge: mock-src 101/101, sim 63/63,
   goldens 12/12, typecheck GREEN (see Gates), engine drift OK, server
   api (files) 153/153.
3. Rebuilt the client (`cd client && npm run build`) so the browser-side
   bundle actually carries the fixed `engine.js` (the two-phase
   warehouse-claim design means the CLIENT, not the server, is what
   enforces placement legality — a server-only merge would not have
   fixed the live bug for players). Committed the refreshed `web/app/`
   dist.
4. `~/backpack_ragnarok` (main checkout): `git merge --ff-only
   req-0092-inv-linker-cell-guard` — clean fast-forward,
   `10622cc..e1f0bdf`. Unrelated pre-existing dirty files in that
   checkout (`content/vocab.json`, `tools/build_dungeon_preview.py`,
   art-session assets — a separate, hands-off area per PROJECT.md) were
   untouched by the merge.
5. `systemctl --user restart backpack-api` — restarted clean; smoke
   check `GET /api/content` → 200, `GET /app/` → 200.

Live at `master@e1f0bdf` / commit `e1f0bdf` on llmlocal.
