# REQ-0090 — List multi-select (drag / Shift+Click / Ctrl+Click range)

- **Status**: DONE (2026-07-07) — merged to master and live on backpack-dev.qtie.jp.
- Origin: raised immediately after REQ-0063 shipped its Dismantle panel
  (`client/src/schedule/DismantlePanel.tsx`), whose item picker is currently
  single-select only (click one row, then confirm). User's request is
  generic (not scoped to one screen in their own wording), but the
  triggering context makes the Dismantle panel the flagship consumer.

## User spec (verbatim intent)
1. **Hold + drag** across list rows selects all rows the pointer passes over
   (「マウスをホールドしながら、ドラッグしていくことで複数選択」).
2. **Shift+Click** ALSO adds to the current selection
   (「Shift+Clickでも同様に、選択を追加する挙動」) — i.e. an additive single-item
   toggle, not a destructive re-select.
3. **Ctrl+Click** selects every item between a specified index and a
   specified index (「指定のindexから指定のindexのアイテムを選択する」) — i.e.
   range-select by list position.

**Note the inversion from typical OS/Explorer convention**: on
Windows/macOS, Ctrl(Cmd)+Click is normally the additive single-toggle and
Shift+Click is normally the range-select. This spec assigns them the
OPPOSITE way — Shift+Click = additive single toggle, Ctrl+Click =
range-select-by-index. This is the user's explicit, stated behavior, not a
typo or a slip against convention; implement exactly as specified rather
than "correcting" it to match the OS-standard mapping.

## Design

### Scope: which lists get this
No existing selection concept (single- or multi-) exists anywhere in
`client/src` today — grep for `shiftKey`/`ctrlKey`/`metaKey`/`selectedUid`
across the whole client returns nothing outside the single-select
`useState<string | null>` pattern `SellPane.tsx` and `DismantlePanel.tsx`
each already use independently. This REQ proposes building ONE reusable
selection model (see below) and wiring it into:
- **`DismantlePanel.tsx`** (flagship, v1) — the hoard list
  (`[data-testid="workshop-dismantle-item"]` rows), so a player can select
  several POs/SIs and dismantle them in one confirm action instead of one
  at a time.
- **[USER] candidate fast-follows, not committed to v1**: `SellPane.tsx`'s
  hoard list (bulk-list multiple items for sale?) and the Warehouse shelf
  list (`client/src/warehouse/WarehousePage.tsx`, bulk-claim already exists
  as a SEPARATE "claim all" button — multi-select there would be a
  finer-grained "claim these specific ones" alternative to all-or-one).

This explicitly does NOT cover the spatial inventory board
(`InventoryBoard.tsx`/`Board.tsx`, PixiJS-rendered placed items on a 2D
grid) — "index" as used in the user's own Ctrl+Click spec only has an
obvious, unambiguous meaning for a LINEARLY ORDERED LIST (array position),
not for spatially-placed items on a grid. A board-level rubber-band/marquee
select would be a materially different, separate design (different
rendering stack, different hit-testing) and is out of scope here.

### Interaction model (per list, all three coexist)
- **Plain click** (no modifier): clears any existing selection, selects
  just this row, and sets it as the new "anchor" (the reference point for a
  later Ctrl+Click range).
- **Hold + drag** (mousedown on a row, move while still down): every row
  the pointer enters while the button is held gets ADDED to the selection
  (does not clear rows outside the drag path). The mousedown row's own
  index becomes the new anchor. **[USER decision]**: does dragging back
  OVER an already-selected row de-select it (toggle), or is drag purely
  additive regardless of a row's current state? Toggle-on-revisit is the
  more common file-manager behavior (Explorer/Finder) but adds
  state-tracking complexity (must remember drag-start selection state per
  row to know whether to toggle or force-add); starting with pure-additive
  (simpler, matches the spec's literal wording "選択を追加する") and
  revisiting toggle-on-revisit only if it's actually requested is the
  recommended default.
- **Shift+Click**: adds the single clicked row to the current selection
  (additive, like the drag mechanic) and moves the anchor to this row.
  Does NOT clear anything else already selected.
- **Ctrl+Click**: selects the contiguous index RANGE between the current
  anchor and the clicked row (inclusive both ends), ADDED to whatever is
  already selected (does not clear rows outside the range — consistent
  with every other mechanic here being additive-only; a destructive/
  exclusive selection is never triggered by any modifier in this spec,
  only a plain unmodified click clears). **[USER decision]**: if no anchor
  exists yet (e.g. Ctrl+Click is the very first interaction on a fresh
  panel open), fall back to a plain single-item select of the clicked row
  (recommended default — there is no reasonable "from" index to range
  against yet).
- Selection state is keyed the same way `DismantlePanel.tsx` already keys
  rows today (`` `${kind}:${itemUid}` `` composite key) for identity, but
  the Ctrl+Click range operates on the list's rendered ARRAY INDEX at
  interaction time, not the key — matching the user's own "index" wording.

### Reusable implementation shape (proposed, non-binding on exact API)
A small local hook, e.g. `useListMultiSelect<T>(items: T[], keyOf: (t: T)
=> string)`, returning `{selected: Set<string>, anchorIndex: number | null,
handlers: {onRowMouseDown, onRowMouseEnter, onRowClick}}` — pure
interaction-state logic, no rendering opinions, so each consumer (Dismantle
panel now, others later) wires its own row JSX to the returned handlers and
renders its own `is-selected` styling (each screen already owns its own
scoped `.icard.is-selected` CSS per REQ-0063/REQ-0064's own established
"`.icard` is redefined scoped per surface" convention — this REQ does not
change that).

### Dismantle panel consumption (v1, once selection lands)
Multi-select is infrastructure; it needs an action to attach to. For
`DismantlePanel.tsx` specifically: **[USER decision]** — does the confirm
button, when N items are selected, (a) call `POST /api/dismantle` N times
in sequence (client-side loop, reusing the existing single-item endpoint
unchanged, simplest to ship), or (b) get a new batch endpoint
(`POST /api/dismantle/batch {items:[{itemUid,kind}, ...]}`) that does all N
removals + engravings + yields atomically server-side (more correct under
partial-failure, e.g. one item became deployed mid-selection, but is new
server surface). Recommended default: (a) for v1 — reuses everything
REQ-0063 already shipped and tested, surfaces partial failure per-item
(some succeed, some 409/404) via the existing single-item error handling
run N times, which is an honest reflection of "these are still N
independent removals" rather than inventing a false atomicity guarantee the
spec never asked for.

## [USER] decision list
1. Which screens adopt this beyond the Dismantle panel (SellPane? Warehouse
   shelf?) and in what order.
2. Drag-over-already-selected-row behavior: pure additive vs. toggle.
3. Ctrl+Click with no prior anchor: fall back to single-select vs. no-op.
4. Dismantle panel's bulk-confirm: N sequential calls vs. a new batch
   endpoint (§ "Dismantle panel consumption" above).
5. Any UI affordance beyond row highlighting for "N selected" (e.g. a
   count chip, a "clear selection" control) — not specified by the user,
   likely needed for a usable v1 but currently undesigned.

## Test plan (gates before DONE)
- client E2E (extends `workshop.spec.ts`'s existing REQ-0063 dismantle
  describe block, same seeded-fixture style): drag across 3 rows selects
  exactly those 3; Shift+Click on a 4th adds it (4 selected, none
  deselected); Ctrl+Click after establishing an anchor selects the correct
  inclusive index range; a plain click after any of the above clears back
  to a single selection; confirming a multi-selection actually removes ALL
  selected items server-side (not just the first/last).
- No server-side gate changes if the "N sequential calls" default (§
  decision 4) is adopted — REQ-0063's existing dismantle route/tests are
  reused unchanged. If a batch endpoint is chosen instead, that reopens
  server test scope (atomicity, partial-failure semantics) not currently
  covered by anything in this repo.

## Outcome (2026-07-07)

Built, gated, merged to master, and deployed live in the same pass as
this REQ was filed — the user's follow-up instruction ("go implement.
merge deploy.") authorized proceeding straight through without a
separate build→review→merge handoff.

### What shipped
- `client/src/schedule/useListMultiSelect.ts` (NEW) — the reusable
  interaction hook exactly as designed above: plain mousedown clears+
  selects+arms drag, mouseenter-while-armed adds (pure-additive, decision
  #2 below), Shift+mousedown adds one row, Ctrl+mousedown range-selects
  from the anchor (falls back to single-select with no anchor, decision
  #3), anchor moves to the most-recently-interacted index on every case
  including a Ctrl+Click's own endpoint (the "chains forward" reading
  from the design section, not Explorer's fixed-anchor shrink/grow).
  Also defensively prunes any selected key that falls out of the live
  `items` array (e.g. after a confirm's `loadGame()` refresh removes the
  just-dismantled rows) so a stale uid can never linger in the Set.
- `DismantlePanel.tsx` rewired onto the hook: rows get `onMouseDown`/
  `onMouseEnter` (replacing the old single `onClick`), a locked
  (deployed) row is excluded from every interaction path AND filtered
  back out of the confirmable selection even if a Ctrl+Click range
  happened to span over it. The single-selected preview (name, 分解値/
  suppression, yield note) is byte-for-byte the same block REQ-0063
  shipped; 2+ selections render a new pieces-count summary instead. A
  "N selected · Clear" row appears whenever anything is selected
  (decision #5's minimum viable answer).
- Confirm now loops the existing single-item `postDismantle` call once
  per selected item (decision #4's default: N independent calls, no new
  batch endpoint), aggregates the succeeded count + total yield into one
  toast, surfaces a partial-failure reason (deployed > not-found >
  generic priority) if some but not all succeeded, clears the selection,
  and calls `loadGame()` once at the end if anything actually succeeded.
- New i18n keys (EN+JA): `multiPieceLabel`, `multiYieldNote`,
  `selectedCount`, `clearSelection`, `resultToastMulti`. New CSS:
  `user-select:none` on the hoard rows (prevents native text-selection
  highlight while drag-selecting) plus the selected-count row's own
  scoped rule block.
- Scope stayed exactly where the REQ proposed it: the Dismantle panel
  only. SellPane/Warehouse adoption (decision #1) was not started.

### [USER] decisions resolved (with the REQ's own recommended defaults, since none were re-litigated)
1. Scope: Dismantle panel only for this pass — SellPane/Warehouse left
   as documented future candidates, untouched.
2. Drag-over-already-selected-row: pure additive, no toggle-on-revisit.
3. Ctrl+Click with no prior anchor: falls back to a plain single-select
   of the clicked row.
4. Bulk confirm: N sequential `postDismantle` calls, no new batch
   endpoint.
5. Selection UI affordance: a plain "N selected · Clear" text row (no
   count chip styling beyond that).

### A genuine pre-existing bug found and fixed along the way
`server/tools/ci.sh`'s typecheck step (`tsc -p tsconfig.server.json`) was
NOT clean on master before this REQ touched anything:
`server/pg_sync.cjs:59` read `.message` off a worker `'error'` callback
parameter TypeScript sees as `unknown`, a pre-existing issue from
REQ-0089's crash-recovery commit (`ffde7c0`), unrelated to this REQ.
Fixed via `err instanceof Error ? err.message : err` (strictly safer
than the original `err && err.message` truthy check) so this REQ's own
gate run could show a genuinely clean typecheck rather than inheriting
someone else's red.

### A real E2E-harness gotcha discovered and worked around
`client/e2e/e2e-env.ts` hardcodes `E2E_CODE_ROOT`/`E2E_DATA_ROOT` to
`homedir()/backpack_ragnarok` — the MAIN checkout, not whichever worktree
`playwright test` is invoked from. Running the new E2E test straight
from the `req-0090-list-multiselect` worktree silently exercised the
MAIN checkout's stale (pre-REQ-0090) build the entire time, producing a
confusing false failure (the new "selected-count" element never
rendered, because the OLD component being served never had one — while
the pre-existing confirm button, unaffected by staleness, rendered
fine). Resolved by temporarily copying this REQ's changed files into the
main checkout, rebuilding, running the suite there, confirming green,
then reverting the main checkout's working tree via `git checkout HEAD
-- <exact paths>` (verified byte-clean via `git status` returning to the
EXACT pre-existing baseline) before doing the real merge — which
naturally re-performs the same sync as a permanent change instead of a
throwaway one.

### Also caught and fixed during E2E authoring (test-only, not app bugs)
- The dev fixture profile carries other ambient items beyond whatever a
  test seeds (an auto-granted "Sword Hilt" stack was observed appearing
  sometime during boot, source not investigated — out of this REQ's
  scope). Initial test wrote `toHaveCount(5)` assuming total isolation
  and got 11; fixed by verifying the 5 seeded uids occupy the first 5
  rendered rows by index instead of asserting a total count, which is
  what actually holds (seeded items are written before boot; anything
  ambient is appended after) and keeps the index-based drag/range
  choreography valid regardless of what else the shared fixture carries.
- A Python-side escaping mistake while patching the spec file via SSH
  turned three apostrophes into `'''s` in code comments — caught via a
  plain re-read of the pushed file before running it, not by a test
  failure.

### Gate results
tsc -b + vite build clean (client) · tsc -p tsconfig.server.json clean
(server, after the pg_sync.cjs fix) · engine type-surface check OK · sim
63/63 · goldens 12/12 (determinism intact) · mock-src engine 100/100 ·
server api tests 153/153 on BOTH files and pg backends · oxlint 35
warnings total, ZERO in any file this REQ touched (introduces no new
lint debt) · playwright --list 132 tests/24 files · `workshop.spec.ts`
full file 10/10 (both the REQ-0063 single-select test and the new
REQ-0090 multi-select test, confirming no regression) · `dex-card.spec.ts`
5/5.

### Merged & deployed (2026-07-07)
Master had not moved since this branch was cut (still a clean
fast-forward — `git merge-base --is-ancestor master
req-0090-list-multiselect` confirmed it), so the main checkout's
`~/backpack_ragnarok` working tree — which, as with REQ-0063's own
merge, has a concurrent, unrelated session's uncommitted content-
pipeline work sitting in it (`content/vocab.json`,
`tools/build_dungeon_preview.py`, batch-004 art) — was updated via the
same `git update-ref refs/heads/master <sha>` technique (a pure
fast-forward this time, not a 3-way merge, so strictly lower-risk than
last time's precedent), then synced for this REQ's specific paths only
via `git checkout master -- <paths>` plus a fresh `web/app` rebuild.
Verified the other session's two files stayed byte-identical (md5sum
match, before and after). `backpack-api.service` restarted (picks up the
pg_sync.cjs fix); `backpack-web.service` needed no restart (static
files only). Live smoke test: `/api/content` 200, `/api/dismantle/ledger`
200, the new bundle (`index-DNvUNSsH.js`, containing the
`workshop-dismantle-selected-count` string) serving 200 both locally and
through the public Cloudflare tunnel, clean `backpack-api.service`
restart log with no errors.
