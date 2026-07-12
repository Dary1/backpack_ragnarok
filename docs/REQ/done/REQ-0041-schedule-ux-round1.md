# REQ-0041 — Schedule UX Round 1 (user feedback on P1)

- **Status**: DONE (2026-07-05)

## User feedback (verbatim intent)
1. Dex EDIT mode gets an "アイテムを倉庫に取得" (acquire to warehouse) button —
   dev-only; click puts that item directly into the warehouse (for building test units).
2. Warehouse→inventory claim must be VISUALIZED: the warehouse/claim screen shows the
   Inventory tabs; pressing claim auto-finds a fitting space in the OPEN inventory
   page and places the item there; the placed item PULSES temporarily
   ("ピコンピコン"). If no space fits on the open page → auto-place into another
   page and pulse-highlight THAT page's tab as a notification. The inventory shown
   there must be fully operable with EXACTLY the same behavior as on the Backpacks
   page (Canvas-equivalent).
3. BUG: claiming an existing warehouse item did not add anything to the inventory.
4. BUG: a room with empty preset2 deployed; expanding the monitor freezes (fullscreen
   too) — empty-BP unit crash/loop.
5. RULE: presets WITHOUT any BP must NOT be deployable ("最初から死んでいるユニット" —
   Backpack-as-HP ⇒ no BP = dead on arrival). Gate at server AND client.
6. batch-002 has no preview page — user couldn't find it. Provide /preview/batch-002/.

## Root-cause hypothesis for #3 (verify, then fix via #2's design)
Dual-writer conflict: P1-B claim writes first-fit placement into the server-side
profile, while the client owns in-memory state and auto-saves (800ms debounce) —
a stale client PUT clobbers the server's insertion. FIX = single-writer restored:
**two-phase claim**: POST claim → server marks the warehouse row `claiming` and
returns the item (def id, minted uid); CLIENT performs engine first-fit placement
(open page → other pages) + pulse + auto-save; server finalizes (deletes the row)
when a profile PUT arrives containing that uid; unfinalized `claiming` rows revert
to claimable after a timeout (no item loss on crash). Server no longer writes
profiles on claim.

## Scope
- Dev grant: POST /api/admin/warehouse/grant {itemId} (item_admin only) + Dex edit
  button (i18n'd, dev-only visibility).
- Warehouse tab embeds the REAL InventoryBoard component (same ops/renderer =
  behavior parity by construction) + tabs; claim flow per #2 (pulse animation on
  placed cells ~2s; cross-page fallback + tab pulse notification).
- Deploy gate: preset must contain ≥1 BP — engine helper (presetHasBP / extend
  isUnitDeployable), server 409 reason "empty_unit", client disables slot option
  with reason text. Covers #5 (and #4's trigger).
- Monitor freeze: reproduce with an empty unit; fix defensively (renderer must
  handle 0-BP formations + never spin; find the actual loop/crash and name it).
- /preview/batch-002/: generator page (pilot items w/ placeholder icons, enemies +
  skills + telegraphs, formations diagrams, dungeon sequence summary) linked from
  the existing preview index if any.
- E2E: dev grant→warehouse; claim→placement pulse on open page; forced no-space →
  other-page fallback + tab highlight; claim finalization (warehouse row gone after
  save; still claimable after simulated abandoned claim); empty-preset deploy 409 +
  UI disable; monitor with a real unit does not freeze (guard test w/ timeout);
  preview page 200.

## Gate
All suites green (engine/sim/server/E2E/sprites/tsc/build), pages 200 incl.
/preview/batch-002/, clean tree, REQ outcome appended.

## Outcome (2026-07-05)

**Resume context**: a previous run had already committed (a) dev grant + Dex
acquire button and (b) two-phase server-side claim. This run resumed with 29
uncommitted files left in a coherent WIP state for (c)/(d), reviewed them, and
adopted essentially all of it.

### Adopt-vs-reimplement decision

**Adopted.** The uncommitted (c) work (WarehouseTab embedding the real
InventoryBoard via a React portal, `board/inventorySlot.ts` + `board/
inventoryRenderer.ts`, client-side first-fit placement, cell-pulse +
cross-page tab-pulse) and most of (d) (monitor freeze root-cause fix in
`fieldGeometry.ts`/`MonitorRenderer.ts`/`Monitor.tsx`, `isUnitDeployable` in
`mock-src/engine.js` + its engine test) were sound, well-documented, and
matched the REQ's design exactly — including a genuinely good architectural
call (Pixi-instance reuse via `createPortal` instead of a second `Application`,
avoiding a `BoardId` registry collision and the WebGL-recreation risk REQ-0031
Phase A had already flagged). No `git stash` was needed; nothing was
unsalvageable. What was genuinely still missing (server-side `isUnitDeployable`
wiring + `reason:'empty_unit'` threading, client-side SlotsPanel disabling,
the batch-002 preview generator, and essentially all new E2E coverage) was
implemented fresh on top of the adopted work.

### Pixi-instance decision (confirmed, not re-litigated)

One InventoryBoard/BoardRenderer instance for the whole app lifetime, portaled
between the Backpacks page and the Warehouse tab via `board/inventorySlot.ts`'s
`useInventorySlot()` + `createPortal`. A second Pixi `Application` was
correctly rejected in the adopted work's own module comment: it would either
collide under the same `BoardId` in `drag.ts`'s registry or require a third
`BoardId` kind, rippling through `boardOps.ts`/`BoardRenderer.ts`'s transfer-
preview branches for no benefit.

### Per-item outcomes

- **(a)/(b)**: unchanged, already committed and verified prior to this run.
- **(c) warehouse receive UI**: adopted as-is. Claim → client engine first-fit
  (open page, else other pages in order) → `pulseCellsSuccess` (~2s green
  blink) on the landing cells if same-page, else `tab-claim-pulse` CSS pulse
  (~1.6s, 3 cycles) on the destination tab → `notifyStateChanged()` (existing
  auto-save choke point, no manual save call). All-pages-full → toast + inline
  error, row left `claiming` server-side (lazy timeout revert, no explicit
  abandon-claim round-trip).
- **(d) deploy gate**: `mock-src/engine.js`'s `isUnitDeployable(st,n)` (adopted)
  is a deliberately SEPARATE predicate from `isUnitIndependent` — an empty
  preset is vacuously independent but must still fail deployability. Added
  fresh: `server/schedule.cjs`'s `assignSlot` now gates on it before the
  independence check (409, `err.reason='empty_unit'`); `server/api.cjs`'s
  `sendScheduleError` threads `e.reason` through as a JSON `reason` field
  (strictly additive — every other schedule error is byte-identical);
  `client/src/schedule/SlotsPanel.tsx` disables the non-deployable preset's
  `<option>` with an i18n'd reason (title + label suffix), failing open (all
  enabled) only if the engine/state aren't ready yet.
- **(d) monitor freeze — ROOT CAUSE NAMED**: `sim/combat.cjs`'s `ray_fire`/
  `ray_bounce`/`ray_step` events carry `entry`/`at`/`path[]` as raw `[row,col]`
  NUMBER TUPLES on the wire, never `"M9"`-style strings.
  `MonitorRenderer.ts`'s `cellIdToColRow` (via `fieldGeometry.ts`) assumed the
  latter unconditionally and called `.trim()` on a tuple, throwing
  (`TypeError: e.trim is not a function`, confirmed via a live repro +
  captured browser exception). `Monitor.tsx`'s poll effect only advanced
  `lastEventIndexRef` AFTER a successful `applyEvents()` call, so the SAME
  stuck event was re-thrown on every ~2s poll FOREVER — a permanent
  crash-loop (browser tab becomes unresponsive), not a one-off dropped frame.
  Fixed at the root (`fieldGeometry.ts` now accepts either shape) plus
  defense-in-depth adopted from the WIP: `MonitorRenderer.ts` wraps each event
  in its own try/catch (skip-and-log), `Monitor.tsx` advances
  `lastEventIndexRef` in a `finally` block unconditionally, and
  `client/src/render/itemCard.ts` / `mock-src/engine.js`'s `rotOffsets` are
  hardened against an empty/degenerate shape producing a non-finite bounding
  box (`Math.min/max(...[])` → `±Infinity`).
- **(e) /preview/batch-002/**: new generator `tools/build_dungeon_preview.py`
  (separate from `tools/build_preview.py`, whose input shape — a flat
  `draft.json` of PO/SI entries — doesn't fit batch-002's dungeon-pilot
  content spread across `items.json`/`enemies.json`/`skills.json`/
  `entities.json`/`formations.json`/`dungeon.json`). Renders pilot items with
  an explicit placeholder-icon banner, the 7-enemy roster with per-skill
  attack telegraphs, the 4 trap/door/chest entities, all 4 formation diagrams
  as inline SVG field grids, and the 8-step dungeon sequence. Deployed,
  verified 200 both locally and via the public tunnel.
- **(f) E2E**: migrated the one pre-existing test that asserted the OLD
  single-phase claim response shape onto the two-phase contract; added dev
  grant→warehouse, claim-pulse-on-open-page, cross-page fallback + tab pulse,
  all-pages-full (row remains `claiming`), empty-BP deploy gate (409 +
  disabled option), monitor-freeze regression guard, and preview-page-200.
  The three new warehouse-tab UI tests drive the DEV_MODE fallback player
  (not the suite's own guest) because this box's live API runs
  `STORAGE_BACKEND=pg` — direct `data/warehouse/*.json` file writes (this
  suite's pre-existing pattern) are invisible to a pg-backed server, so these
  grant via the real `POST /api/admin/warehouse/grant` endpoint instead.

### Bugs found and fixed beyond the adopted diff

1. **Boot-sequence auth race (pre-existing, always-on, newly load-bearing)**:
   `main.tsx` calls `store.ts`'s `boot()` synchronously at module load, firing
   its own `fetchMe()` before `handleInviteRoute()` (only invoked from
   `App.tsx`'s `useEffect`, strictly later) ever stores the invite token.
   `boot()` deterministically lost this race on every single invite-link
   visit, silently loading the `dev_mode` fallback profile instead of the
   invited guest's own — invisible before this REQ because nothing
   previously depended on the CLIENT's own in-memory `state` reflecting the
   correct profile (server-side API calls always used the guest's real token
   explicitly). SlotsPanel's new disabled-option UI was the first thing to
   visibly break on it. Fixed: `boot()` now synchronously checks the current
   hash for the invite pattern and stores its token before its own
   `fetchMe()` call. Confirmed fixed via a targeted repro script (network-
   request capture) and by the full 71-spec E2E suite passing clean
   afterward (was previously silently masking this bug).
2. **`writeWarehouseItemPg`'s `ON CONFLICT` clause didn't refresh `player_id`**
   (only `doc`/`harvested_at`/`updated_at`) — found while writing this REQ's
   own `dev/backdate-claim` E2E-support test (which rewrote a row under a
   second `playerId` by mistake, orphaning it from `listWarehouseItemsPg`'s
   `WHERE player_id = $1` filter even though the JSON `doc.playerId` said
   otherwise). Unreachable via real app traffic (a warehouse row is never
   rewritten under a different `playerId` in normal use) but closed as cheap
   defense-in-depth.
3. Added `POST /api/warehouse/dev/backdate-claim` (dev-only, mirrors the
   existing `dev/backdate` room hook exactly) so E2E/server tests can force a
   `claiming` row to read as abandoned without a real 120s wait.

### Interpretations / documented decisions

- BPs are never warehouse-claimable content (not defined in `live_items.json`
  or `live_sis.json`) — `itemKindOf()` resolves a claimed item as PO or SI
  only.
- No explicit "abandon claim" endpoint: an all-pages-full claim leaves the
  row `claiming`, relying on the existing lazy `WAREHOUSE_CLAIM_TIMEOUT_MS`
  (120s) server-side revert — matches the REQ's own accepted two-phase design
  ("no item loss on crash" via timeout, not an extra round-trip).
- batch-002's reward-placeholder ids (`reward_frost_shard_common`, etc.) are
  bare strings, not real item defs — out of scope for this REQ (P1-B
  reward-table resolution), per `content/batches/batch-002-dungeon-pilot/
  notes.md`.

### Test counts (final)

- Engine (`mock-src/tests/run.cjs`): **80 passed, 0 failed** (79 baseline + 1
  new `isUnitDeployable` test).
- Sim (`sim/tests/run.cjs`): **41 passed, 0 failed** (includes the pre-
  existing batch-002 full-dungeon smoke test, confirming the content this
  REQ's preview generator also renders is coherent).
- Server (`server/tests/api_test.cjs`): **81 passed, 0 failed** in BOTH
  `files` mode and `STORAGE_BACKEND=pg` mode (80 baseline + 1 new
  `dev/backdate-claim` test).
- Client E2E (`npx playwright test`, full suite, all 14 spec files):
  **71 passed, 0 failed**.
- Sprites (`check_sprites.mjs`): **21/21 non-blank**.
- `tsc -b`: clean (exit 0). `vite build`: clean (one pre-existing chunk-size
  advisory warning, not an error).

### Gate results

- All suites green as above (engine/sim/server-both-modes/E2E/sprites/tsc/build).
- Pages: `/app/` 200, `/preview/batch-001/` 200, `/preview/batch-002/` 200,
  `/api/content` 200, `/api/schedule/dungeons` 200, `/api/health` 200 — all
  reconfirmed after a service restart onto the final committed dist.
- systemd services (`backpack-api`, `backpack-web`, `backpack-tunnel`): all
  `active`.
- `git status`: clean tree after the final commit.

### Commits

- `76efd27` — REQ-0041 (c): warehouse receive UI (embedded InventoryBoard,
  two-phase claim client half, cross-page pulse fallback)
- `18a6ade` — REQ-0041 (d): deploy gate (`isUnitDeployable`, empty-BP presets
  refused) + monitor freeze root-caused and fixed
- `167d2d5` — REQ-0041 (e): `/preview/batch-002/` static preview page
  (dungeon pilot generator)
- `c0ea382` — REQ-0041 (f): E2E coverage for warehouse claim UX, deploy gate,
  monitor guard, preview page
- `546921e` — REQ-0041: final dist rebuild (`web/app/`)

(Prior, already-committed: `28fa4e1` (a) dev grant + Dex acquire button,
`186bb54` (b) two-phase warehouse claim server-side.)
