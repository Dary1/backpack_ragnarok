# REQ-0045 — Battle/Schedule Bug Round 2 + BP rotate + run log + roll details

- **Status**: DONE (2026-07-06)
- **HEAD**: `3362404` (branch `master`), 9 commits total: `5bd255d` (a), `a6a97d5` (a2),
  `8135aa6` (b)+(c), `1dbe1e2` (d)+(e)+(f), `8a1afed` (g), `cd1d71b` (h),
  `3362404` (final dist rebuild).

## User reports (verbatim intent)
NEW: (a2) BPs must be rotatable by DOUBLE-CLICK (like POs).
BUGS:
a. BP cannot be moved inside the Inventory.
b. ONE shared (yellow) item blocks deployment unconditionally. CORRECT RULE: block
   only when a unit SHARING that item is currently deployed in a schedule (or being
   deployed together in the same room). Mere cross-preset sharing must NOT block.
c. Preset1/2/3/4 (all unique) assigned → room never starts; changing Preset2→Preset1
   (duplicate!) made it start. BOTH directions are wrong: unique-4 must start,
   duplicate presets must be REFUSED (same uids deployed twice = invalid).
d. Only the FIRST BP of a deployed unit is copied into the run, auto-placed top-left.
   The unit's canvas must be copied AS-IS (all BPs at their positions + POs + SIs).
e. "Victory" displayed when clearly not a victory; no rewards shown.
f. Enemy-side placement overflows past the RIGHT edge of the enemy plane (screenshot).
FEATURES:
g. Run result log as TEXT for now (user suspects the party dies to the first attack
   and the run ends there — make it inspectable).
h. After a BP gacha roll, show the rolled BP's FULL details (図解 diagram incl.
   Linker performance: position, beam directions, hpMax, cells).

## Design notes
- (b)+(c) deploy gate v2: replace isUnitIndependent-as-gate with DEPLOYED-OVERLAP:
  collect uid sets of all units currently assigned to ACTIVE rooms (incl. other
  slots of the room being edited); a preset is assignable iff its uid set doesn't
  intersect those. Duplicate presetIndex across slots = automatically blocked (same
  uids). isUnitIndependent stays for the yellow/Unit-independence concept (display),
  no longer the deploy gate. Root-cause c's inverted start behavior explicitly.
- (d) sim unit compile must snapshot the FULL preset canvas ({bps,pos,sis} with
  absolute positions) into the unit's 8×8 formation box (canvas is already 8×8 —
  1:1 mapping, no auto-repositioning). Root-cause the first-BP/top-left bug.
- (e) verify victory/defeat classification + reward display path after (d) fix
  (suspicion: wipe misclassified as victory when all units die instantly, or
  victory-with-zero-rewards rendering).
- (f) enemy formation placement must clamp/pack within cols 0..25 of the ENEMY plane;
  root-cause the overflow (footprint col math or label rendering).
- (g) monitor expanded view gains a "Log" text panel: humanized one-line-per-event
  dump of visibleEvents (t, type, actor, cells, dmg, status) + a raw JSONL copy
  button. Server: GET .../run?format=text optional (nice-to-have).
- (h) gacha result modal reusing the dex diagram module: shape grid + linker cell
  marked + beam dirs as compass arrows + hpMax + cell count; shown on roll success.
- (a) root-cause BP move failure in inventory (regression from move handle? drag
  path? invMoveBP legality?); E2E regression test.
- (a2) engine canRotateBP/rotateBP (90° CW): rotate shape about its bbox, remap
  contained POs' cells+rot, linker cell rotates, linker DIRS rotate +2 (mod 8)
  (physical rotation, documented); dblclick on BP (via move-handle badge or empty
  BP cell — POs keep their own dblclick) both boards; legality via occupancy.

## Gate
Every bug gets a regression test (engine/sim/server/E2E as appropriate); full suites
green both storage modes; pages 200; REQ outcome appended.

## Outcome (2026-07-06)

### (a) BP cannot be moved inside the Inventory — FIXED, commit `5bd255d`
Root cause: `client/src/board/boardOps.ts`'s `makeInvOps().canMoveBP` (the hover-preview
legality check run on every pointermove during a BP drag) called `engine.invCanPlaceBP()`
without its 4th `exclUids` argument, so a short nudge whose new footprint overlapped the
BP's OWN old footprint (very common for a BP fully covered by its own contained POs) was
refused as a false self-collision. Fix: pass the dragged BP's own contained-PO uids as
`exclUids`, mirroring `canMoveBP`'s canvas-side sibling. Regression test:
`client/e2e/bp-transfer.spec.ts` — "BP move WITHIN the inventory board (same page) --
REQ-0045 bug (a)" (2 tests: short nudge succeeds; a genuinely illegal nudge against an
unrelated PO is still rejected).

### (a2) BP double-click rotate — DONE (new feature), commit `a6a97d5`
Engine: `mock-src/engine.js`'s `computeRotatedBP`/`canRotateBP`/`rotateBP` (canvas) and
`invCanRotateBP`/`invRotateBP` (inventory) — same `[r,c]->[c,-r]` rotate-about-bbox
transform PO shapes already use (`rotOffsets`), applied to the BP's shape, its linker's
`off` (same local coordinate space), and every contained PO's cell (remapped through the
identical transform) + `rot` (+1 mod 4). Linker `dirs` shift +2 (mod 8) (verified
algebraically: `DIRS[0]` (N) transforms to `DIRS[2]` (E) under the same matrix). Client:
`client/src/board/BoardRenderer.ts`'s `handleBPPointerDown` (dblclick-vs-drag
disambiguation, mirroring `handlePOPointerDown`'s own manual-timing-window pattern,
`DBLCLICK_WINDOW_MS=300`) wired to the move-handle badge, empty BP cells, and the linker
core, on both boards. Regression tests: 6 new in `mock-src/tests/run.cjs` (engine math +
legality); 4 new in `client/e2e/bp-rotate.spec.ts` (canvas dblclick, inventory dblclick,
4x-identity, PO-on-BP dblclick still rotates the PO not the BP).

### (b) Shared (yellow) item blocks deployment unconditionally — FIXED, commit `8135aa6`
Root cause: `assignSlot()` in `server/schedule.cjs` hard-blocked on `isUnitIndependent`, a
STATIC warehouse-wide check ("does this preset share a uid with ANY other preset,
deployed or not") — mere cross-preset sharing with an undeployed sibling preset was
refused unconditionally. Fix: replaced with `deployedUidSetsForGate(playerId, room,
profileCanvas, excludeSlotIndex)`, which only collects uids ACTUALLY deployed right now
(this room's own other slots regardless of status, plus every other room this caller owns
with `status==='active'`). `isUnitIndependent` is unchanged and kept for the
yellow/display concept, just no longer the deploy gate. Regression test:
`server/tests/api_test.cjs` + `client/e2e/schedule.spec.ts` — "a preset sharing a uid with
another of the caller's OWN presets, where that OTHER preset is NOT deployed anywhere,
deploys OK".

### (c) Unique-4 presets never start; duplicate presets DO start — FIXED, commit `8135aa6`
Same root cause as (b): the old static gate never looked at the room's OWN other slots,
so assigning the SAME presetIndex to two slots of one room trivially passed (duplicate
deployment bug), while four mutually-unique presets could each independently fail if any
one happened to share a uid with an unrelated, undeployed preset elsewhere (false-positive
refusal). `deployedUidSetsForGate` fixes both directions at once. Regression tests:
`server/tests/api_test.cjs` + `client/e2e/schedule.spec.ts` — "four mutually-unique
presets... auto-starts" and "assigning the SAME presetIndex to a SECOND slot of the SAME
room is refused 409 reason=deployed_overlap".

### (d) Only the FIRST BP of a deployed unit is copied into the run — FIXED, commit `1dbe1e2`
Root cause: entirely CLIENT-side, in `client/src/schedule/Monitor.tsx`'s unit-building
effect and `client/src/schedule/MonitorRenderer.ts`'s `MonitorUnitVisual` — the monitor
only ever read `snapshot.bps[0]`'s shape/color and one PO icon, silently dropping every
other BP and PO. The sim layer (`sim/combat.cjs`'s `compileUnitSnapshot`) was ALWAYS
correct (iterates every BP via `bps.map`, each offset by its own `origin`) — proven by a
new permanent guard test rather than merely trusted. Fix: `Monitor.tsx` now builds a
`bps: MonitorUnitVisual['bps']` array (every BP's cells) and an `icons` array (every
placed PO, using `snapshot.gameData?.ITEMS` for shape/icon lookup);
`MonitorRenderer.mountUnits()` rewritten to iterate both. Regression tests:
`sim/tests/run.cjs` guard ("compileUnitSnapshot copies EVERY BP..."); new
`client/e2e/schedule.spec.ts` test using a dedicated 2-BP/2-PO fixture preset, asserting
via a new `window.__monitorDebug` debug hook that both BPs mount at their own distinct
origins and both POs are present.

### (e) "Victory" shown when not a victory; no rewards shown — FIXED, commit `1dbe1e2`
Root cause: entirely CLIENT-side, in `Monitor.tsx`'s summary-panel gate, which read
`run && (settled || run.result !== 'incomplete')` — true for ANY non-"incomplete" result
including a mid-run mid-encounter snapshot, so a transient/partial state could render the
"Victory" label before the run had actually settled; separately, no reward-fetch/list-
render logic existed at all. The sim layer (`sim/combat.cjs`'s `runDungeon`) was ALWAYS
correct (wipe on first encounter's wipe, victory only on boss-clear) — proven by a new
permanent guard test. Fix: gate corrected to `run && settled`; added a `rewards`-fetching
effect (via `fetchContent`/`fetchWarehouse`, filtered by `sourceRunId`) and a rendered
rewards list. Regression tests: `sim/tests/run.cjs` guard ("an instant/forced wipe
classifies as result=='wipe'..."); covered by the same (d)/(g) E2E tests' full monitor
exercising, since a real run's summary panel is asserted there too.

### (f) Enemy placement overflows past the right edge — FIXED, commit `1dbe1e2`
Root cause: entirely CLIENT-side, in `MonitorRenderer.ts`'s `getOrCreateEnemyMarker` --
enemy NAME LABELS were drawn at a fixed size regardless of how close to the field's right
edge the marker sat, so a long name near the edge visually overflowed past
`FIELD_W`. The sim layer (`sim/combat.cjs`'s `compileEnemyPack`, a column-fill-with-row-
wrap algorithm) was ALWAYS correct (verified via a new 60-seed sweep test, zero
violations) -- the enemy PLACEMENT itself never left the field, only its rendered LABEL
TEXT did. Fix: added `truncateLabelToFit(label, style, maxWidth)`, which measures real
Pixi Text width via a probe object and trims + appends '…' until it fits
`maxWidth = FIELD_W - pos.x`. Regression tests: `sim/tests/run.cjs` guard
("compileEnemyPack NEVER places a pack member outside..."); new
`client/e2e/schedule.spec.ts` test polling `window.__monitorDebug[roomId].enemyBounds()`
on a real run, asserting every marker's `x + labelWidth <= FIELD_W`.

### (g) Run result log as text — DONE (new feature), commit `8a1afed`
Server: `server/api.cjs` gained an optional `?format=text` query param on
`GET .../run`, returning one idx-prefixed humanized line per event (`sendText` +
`humanizeEventText`) instead of the JSON envelope. Client: `Monitor.tsx` gained a
Field/Log tab switcher in the expanded monitor view; the Log tab shows the same
humanized text (`humanizeEvent`) plus a copy-to-clipboard button that writes the RAW
JSONL (one `JSON.stringify(ev)` per line), not the humanized text. Regression tests:
`server/tests/api_test.cjs` — text-format response shape + Content-Type + JSON-format
unaffected; `client/e2e/schedule.spec.ts` — Log tab shows humanized lines, clipboard
holds independently-JSON.parse-able raw events.

### (h) Gacha roll result diagram — DONE (new feature), commit `cd1d71b`
New `client/src/dex/BpDiagram.tsx`, reusing the Dex module's `ShapeGrid` component
(extended with a new optional `linkerTile` prop, mirroring its existing `portTiles`
highlight pattern) plus the same `dex-diagram-*` visual language `DexDiagram.tsx`
established. Beam-direction compass arrows use the exact `DIR_ANGLES` table from
`client/src/board/BoardRenderer.ts` (the one place that already defines the game's 8-
point compass convention), reimplemented as an SVG overlay since `ShapeGrid`/`DexDiagram`
are deliberately DOM/SVG-only (never Pixi). Wired into `client/src/schedule/
WorkshopPage.tsx`'s `handleRoll`, shown as a dismissible panel immediately after a
successful roll (no server changes needed -- `ApiRolledBp`'s response already carried
every needed field). Regression test: `client/e2e/workshop.spec.ts` -- asserts the shape
grid, exactly one linker cell, one compass arrow per `linker.dirs` entry (cross-checked
against the server-finalized BP, not just a plausible count), and matching hpMax/
cellCount text.

### Deviations from spec (documented, reasoned)
- (b)+(c) share one commit: identical root cause (the old static
  `isUnitIndependent`-as-gate), one fix (`deployedUidSetsForGate`) resolves both
  symptoms atomically -- splitting into two commits would have required an artificial
  intermediate state.
- (d)+(e)+(f) share one commit: all three are independent CLIENT-side `Monitor.tsx`/
  `MonitorRenderer.ts` rendering bugs discovered and fixed in the same investigation
  pass, with the sim layer proven correct for all three via new permanent guard tests
  (not merely trusted) -- committing separately would have meant re-touching the same
  two files three times for logically-related fixes.
- A pre-existing, out-of-scope E2E-harness gap was found (not introduced by this REQ,
  not one of the 8 named items): `schedule.spec.ts`/`workshop.spec.ts`'s dev-profile
  backup/restore fixtures are raw `fs.readFileSync`/`writeFileSync` against
  `data/profiles/dev.json`, which is completely inert against the live server's actual
  `STORAGE_BACKEND=pg` backend. This causes genuine cross-spec-file test debris (a prior
  test's placed items surviving into the next spec file's run) when multiple spec files
  run back-to-back in one invocation; each spec file passes cleanly in isolation (the
  normal way to run them). Flagged for a future REQ; the live dev profile was reset to a
  clean baseline via a direct `storage.writeProfile` call each time it was found dirty
  during this REQ's own work, but the harness gap itself was left unfixed as out of
  scope.
- A process gap (not a code bug) was found and fixed: `web/app/`'s committed dist bundle
  had not been rebuilt since REQ-0043 (c), predating ALL of REQ-0045's client changes --
  every REQ-0045 source commit deliberately deferred the dist rebuild to one final
  commit (`3362404`), per this project's established convention. This was caught as
  genuinely necessary (not just housekeeping) when a full E2E gate run against the stale
  dist showed 7 failures across items (a), (a2), (d), (f), (g), (h) -- all confirmed via
  byte-for-byte source diffs and direct browser automation to be a stale-artifact issue,
  not a code regression; all 7 pass once the dist rebuild landed.

### Gate (final, post-dist-rebuild, HEAD `3362404`)
- Engine (`mock-src/tests/run.cjs`): 97 passed, 0 failed.
- Sim (`sim/tests/run.cjs`): 60 passed, 0 failed (57 before this REQ; +3 guard tests
  for (d)/(e)/(f)).
- Server, files backend (`server/tests/api_test.cjs`): 102 passed, 0 failed (was ~97
  before this REQ).
- Server, pg backend (`STORAGE_BACKEND=pg`): 102 passed, 0 failed.
- Sprites (`client/scripts/check_sprites.mjs`): 22/22 non-blank.
- `tsc --noEmit`: clean. `npm run build`: clean.
- Full E2E suite (`npm run e2e`, all 17 spec files, 94 tests): 94 passed, 0 failed --
  confirmed on TWO consecutive full runs post-dist-rebuild.
- Pages 200: `/app/`, `/mock/`, `/preview/batch-002/`, `/api/health`,
  `/api/schedule/dungeons`.
- Working tree: clean at HEAD `3362404` on branch `master` (only an unrelated,
  untouched REQ-0046 background agent's own untracked files present).
