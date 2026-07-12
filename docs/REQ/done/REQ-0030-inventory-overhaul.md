# REQ-0030 — Inventory System Overhaul (spatial, tabbed, BP-capable)

- **Status**: Phase 1 DONE (2026-07-04); Phase 2 (client UI) not started
- **Date**: 2026-07-04 (orchestrator gen2)
- **User spec** (2026-07-04, verbatim intent):
  1. Inventory becomes TABBED — 5 pages (for now).
  2. Inventory uses the SAME placement system as the Canvas.
  3. Inside the inventory: POs may be placed WITHOUT a BP (directly on the grid).
     SIs likewise may be placed without a host PO; a free-placed SI occupies exactly
     1 cell.
  4. BPs themselves can be placed in the inventory, and POs can be placed on those
     BPs exactly like on Canvas. SI seat/unseat also works inside the inventory.
  5. Overlap rules: if a PO overlaps a BP it must fit ENTIRELY within that one BP
     (canvas law); a PO placed directly must NOT overlap any BP.
  6. Dragging a BP moves the BP together with ALL its contents (POs and their SIs) —
     both inventory→canvas and canvas→inventory.
  7. Linkers do NOT operate in the inventory.

## Orchestrator decisions (defaults; flag to user in report)
- Page grid size = same dimensions as the Canvas grid (per page; 5 independent pages).
- Inventory is placement-only: no effects, no connections/◆, no combos, no beams
  (extends the existing "items parked here take no effect" principle; Linker dormant
  per spec §7 — a BP's linker is rendered dimmed, no beams).
- Free-placed SI = 1×1 footprint regardless of anything; when socketed it occupies
  no cell (as today).
- Legacy list-inventory contents migrate by first-fit auto-placement onto page 1
  (POs first, then SIs); profile schema_version bumps with backward-compatible load.
- Free-placed POs/SIs and inventory BPs may coexist on a page; BP-in-inventory
  placement may not overlap another BP or any free-placed PO/SI.
- Canvas rules are unchanged (POs still require a BP on canvas; SIs cannot be
  free-placed on canvas).

## Phase 1 — Engine (shared, framework-free; mock untouched behaviorally)
ADDITIVE state + API in mock-src/engine.js (old fields/API unchanged so mock & 18
tests keep passing): inventory model {pages: 5 × grid}, placement/legality/move/
rotate/seat/unseat within pages, BP-with-contents transfer canvas⇄page and
page⇄page, link/beam computation restricted to canvas BPs. Extend the node test
suite with inventory scenarios (target ≥26 total): free PO placement + BP-overlap
rejection, PO-on-inventory-BP containment law, free SI 1-cell occupancy + collision,
SI seat/unseat in inventory, BP transfer carries contents & SIs (both directions,
origin remap), linker dormancy (no links from inventory BPs), page bounds, tab count.

## Phase 2 — Client (/app/)
Tabbed inventory board (5 tabs) rendered with the same PixiJS board renderer
(grid without BP-tint background; BPs/POs/SIs drawn as on canvas, linkers dimmed,
no beams/◆). Cross-board drag: PO/SI/BP between canvas and the active inventory page
(ghost + legality tint from engine; BP drag carries contents). Save/Load carries the
new state; legacy profiles load via migration. Old list-panel inventory UI retired.

## Gate
Engine suite (≥26) green incl. all new rules; API 9/9 (+ migration test); tsc/build;
check:sprites; pages 200; orchestrator Chrome verification of: tab switching, free PO
placement + both overlap rules, free SI placement, SI seat/unseat in inventory, BP
drag with contents in BOTH directions, linker dormancy; Save/Load round-trip.
Commits per logical unit; REQ updated with outcomes.

## Phase 1 outcome (2026-07-04, DONE)
Implemented entirely in mock-src/engine.js (+ tools/tool_gen_data.cjs for the
makeState() shape), 3 commits on server repo ~/backpack_ragnarok:
  (a) 5b2a004 -- engine inventory model (st.inv={pages:[5 x {bps,pos,sis}]},
      mirrors canvas arrays field-for-field; invCanPlacePO/invMovePO/
      invRotatePO, invCanPlaceSI/invMoveSI, pageSockets/invSeatSI/invStowSI,
      invCanPlaceBP/invMoveBP, canTransferBP/transferBP). Linker dormancy
      required ZERO extra guard code: traceBeams/connectionsFrom/combos
      already only ever iterate st.bps/st.pos, never st.inv.pages[].
  (b) 4c1c4dd -- 12 new inventory tests (mock-src/tests/run.cjs), 30/30 green
      (18 baseline untouched + 12 new).
  (c) 2f48f8f -- migrateState(oldState) + its test, 31/31 green total.

State design: st.inv.pages[n] = {bps:[],pos:[],sis:[]}, byte-identical
shape to the canvas-level st.{bps,pos,sis} arrays. Chosen over a per-record
{loc,page} tag so EVERY existing canvas code path (movePO, moveBP, sockets,
traceBeams, combos, ...) stays untouched -- a BP transfer is a plain splice
between array pairs + the same dr/dc cell-shift moveBP already used, now
just crossing a container boundary. SI seat records ({po:uid,si:idx}) never
need rewriting on transfer since they name the PO by uid, not by container.

Legacy list-inventory representation found (mock-src/data.js SCENARIO /
content/live/scenario.json, pre-existing, no separate list structure ever
existed): unplaced PO = st.pos[] entry with loc:'inv',cell:null; unplaced/
unseated SI = st.sis[] entry with host:'inv' (string sentinel). Confirmed
via the live fixture (p8 oil_flask; a3/a4/a5/a6 whetstone/arrowhead/poison/
frost).

Resolved ambiguities (flagged per orchestrator policy, no user block):
  1. Free-placed POs DO accept SI seat/unseat (spec silent; REQ item 4's
     "SI seat/unseat also works inside the inventory" reads unconditional).
  2. A free-placed SI may never land on a BP cell at all (no partial/full
     containment concept for a single cell -- BP is occupied infrastructure).
  3. No 'bond' pseudo-socket exists inside inventory pages -- assemblies
     (blade+hilt join) are a canvas-only mechanic in the current roster;
     pageSockets() only ever emits per-PO sockets.
  4. migrateState() overflows onto page 2/3/... if page 1 fills before all
     legacy items place (REQ text only says "onto page 1"); never drops an
     item -- un-fittable leftovers after all 5 pages stay in their original
     legacy loc:'inv'/host:'inv' form.

Full test list (31 total, mock-src/tests/run.cjs): the pre-existing 18
(unchanged) plus 13 new -- makeState() 5-page shape; free PO placement
legality (bounds/PO-PO collision/BP-overlap rejection); PO fully-inside-
one-BP containment (accept/reject-straddle-edge/reject-span-two-BPs); free
SI 1-cell occupancy + collision (PO/BP/SI); SI seat/unseat on inventory-BP-
hosted PO; SI seat/unseat on a free-placed PO; BP transfer canvas->page
(origin remap verified, rejects on target collision, no partial state);
BP transfer page->canvas reverse; BP transfer page->page; linker dormancy
(transferred linker-bearing BP emits nothing from traceBeams/connections);
rotation of a free-placed PO; 5-page bounds/independence; migrateState
legacy->new.

Verification: mock-src/tests/run.cjs 31/31 green; python3 mock-src/build.py
+ curl /mock/ -> 200; server/tests/api_test.cjs 9/9 green (server untouched);
git tree clean after each commit.

Phase 2 (client UI) not started -- tracked separately.

## Phase 2 outcome (2026-07-04, DONE with one gap flagged)

Implemented in client/ (server repo ~/backpack_ragnarok), 5 commits:
  (a) 78b5c0e -- engine.d.ts inventory types (InvPage/Inventory/InvSIHost/
      LocRef + full inv* mutator/query declarations, verified line-for-
      line against mock-src/engine.js) + new client/src/board/boardOps.ts,
      the seam letting ONE BoardRenderer class render both the canvas
      board and any inventory-page board (BoardOps wraps canvas engine
      calls vs inv*-prefixed page-bound calls behind one interface --
      legality always still comes from the engine).
  (b) b1d5e2b -- BoardRenderer.ts generalized: render()/interaction go
      through ops.container()/cellBPMap()/cellsOf()/occupancy()/sockets()/
      canPlacePO()/movePO()/rotatePO()/canMoveBP()/moveBP()/canPlaceSI()/
      moveSI()/hostOk()/seatSI()/stowSI() instead of hardcoded engine.*
      calls; canvas-only rendering (beams, assembly/bond socket, chain
      toggle, port /\/♦ marks, BP-color grid tint) gated behind
      ops.isCanvas; linkers render on both boards but DIMMED (no direction
      dots) in inventory (dormancy, spec item 7); new free-placed 1x1 SI
      rendering. drag.ts extended with a board registry + centralized
      window pointerup handler (ensurePointerUpWired) so a drag crossing
      between the two independently-mounted PixiJS canvases (each with its
      own stage-scoped globalpointermove) resolves exactly once against
      whichever board it lands on, never double-committed. Cross-board
      commit: BP uses engine.transferBP (Phase 1's atomic contents-carrying
      transfer); PO/SI use a splice-then-validate technique (move the
      record's container array membership, then call the destination
      board's own placement mutator) -- the same pattern transferBP itself
      uses, applied to a lone record with no BP-shaped contents. Cross-
      board LEGALITY PREVIEW (before drop, for ghost tinting) required a
      new technique since no engine query answers "would uid fit on a
      board it is not yet a member of" for POs/SIs (only canTransferBP
      exists, for BPs): previewCrossBoardPO/previewCrossBoardSIFreeCell/
      previewCrossBoardSocket do a synchronous splice-check-unsplice dry
      run using the REAL target-board ops call, reverted before returning
      -- never a client-side reimplementation of a rule, just a temporary,
      fully-reverted probe.
  (c) aece550 -- new board/InventoryBoard.tsx (second independent
      BoardRenderer bound to makeInvOps(engine,activeInvPage); remounts on
      tab switch since BoardOps binds its page index at construction) +
      new Tabs.tsx (5 buttons, module-store tab state per spec, NOT
      localStorage) + App.tsx (two board columns) + ItemPanel.tsx (retired
      the old drag-source inventory list per spec; kept the read-only
      catalog) + index.css.
  (d) 9f98d44 -- store.ts: boot()/loadGame() both run the state through
      engine.migrateState() before use (guarantees state.inv exists even
      though the live /api/content scenario.json has NO inv field at all
      -- confirmed by inspection, migrateState()'s `if(!st.inv)st.inv=
      emptyInventory()` is what actually supplies it); loadGame() now also
      copies canvas.inv across (the T0.2 handler silently dropped it,
      which would have reset the inventory to empty on every Load).
  (e) 998d369 -- web/app/ rebuilt (new hash index-pgLp50_C.js), deployed,
      reproducible (rebuilt twice, identical output).

Engine API calls used per interaction (all legality/mutation via engine,
zero client-side rule reimplementation): PO placement/move
canPlacePO/movePO (canvas) or invCanPlacePO/invMovePO (inventory);
rotate rotatePO/invRotatePO; BP same-board move canMoveBP/moveBP or
invCanPlaceBP/invMoveBP; BP cross-board canTransferBP/transferBP; SI
free-cell invCanPlaceSI/invMoveSI (inventory only -- canvas ops report
"not supported", matching "SIs cannot be free-placed on canvas"); SI
seat/unseat hostOk+seatSI/stowSI (canvas) or hostOk+invSeatSI/invStowSI
(inventory, via pageSockets); state shape/migration migrateState.

Mock compatibility finding: server/api.cjs + server/storage.cjs are a
pure JSON pass-through store (never validate/strip fields) -- confirmed a
GameState carrying `inv` round-trips through PUT/GET unchanged. The
separate legacy mock-src/ui.js reference page's Load handler only reads
canvas.linked/bps/pos/sis and silently ignores an unrecognized canvas.inv
field (plain property access, no crash) -- no mock-src change was needed
or made.

Verification performed (all via SSH/curl/node, see below for the Chrome
gap): tsc -b --noEmit clean; vite build succeeds and is reproducible
(rebuilt twice, identical output hash); node scripts/check_sprites.mjs
21/21 non-blank; mock-src/tests/run.cjs 31/31; server/tests/api_test.cjs
9/9; oxlint 0 warnings/0 errors; curl https://backpack-dev.qtie.jp/app/
-> 200 (new hash confirmed present in the served bundle); git tree clean
after each commit.

REAL-DATA migration/round-trip proof (substituting for part of the Chrome
smoke test, see gap below): the server's actual saved profile
(data/profiles/default.json, pre-Phase-2 shape: linked/bps/pos/sis, 1
legacy loc:'inv' PO + 4 legacy host:'inv' SIs) was run through
engine.migrateState() directly in Node using the real content/live
items/SIs/scenario -- produced inv.pages[0] with exactly that PO + those
4 SIs first-fit-placed, zero left behind, canvas contents (4 BPs, 7
grid-placed POs) untouched. The migrated state was then PUT to the live
/api/profile/default/canvas endpoint and read back via GET, confirming
byte-faithful round-trip of the new `inv` field through the real HTTP
API. The original profile was backed up before this test and restored
byte-for-byte afterward (verified via equality check against the backup).

GAP (flagged, not silently skipped): the Chrome MCP browser extension did
not connect in this session across many retries spread over roughly 10
minutes (tabs_create_mcp consistently returned "not connected"), so the
orchestrator's own interactive Chrome smoke test (tab switch, free PO
place + BP-overlap reject, free SI place, SI seat/unseat in inventory, BP
drag canvas<->inventory WITH contents, linker dimmed/no beams, Save-
>reload->Load round-trip via the UI) could NOT be executed as specified.
In its place: (1) full static verification (tsc/build/lint/tests/sprite
check, all green), (2) a deliberate manual trace of every interaction
code path against the actual engine.js source (documented inline in each
commit), and (3) the real-data migration + HTTP round-trip proof above
(exercises the actual production engine + actual production server + the
actual currently-saved profile, just not through the rendered UI/pointer
events). Genuinely UNVERIFIED by this session: PixiJS pointer-event
wiring at runtime (hit-testing, ghost rendering, drag-arm threshold,
double-click rotate), the visual appearance of the dimmed/dormant
inventory linker and neutral grid background, and the actual cross-board
drag gesture end-to-end in a real browser. A follow-up session with a
working Chrome connection should run the full smoke list before this is
considered fully gate-clear.
