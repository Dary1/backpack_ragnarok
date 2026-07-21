# REQ-0239 — sortie-squad-board: dedicated SORTIE page (#/sortie) + SQUAD STATUS BOARD (#/schedule) + non-immediate-cancel fix

**Status:** done — merged `e9076e7` (2026-07-19), deployed and live 2026-07-21, user accepted
2026-07-21. Was: built, branch `req-0239-sortie-squad-board` UNMERGED, tip `c6539c3`.
**Base:** branched from `ce78af5` (tip of `req-0185-dungeon-content-kind`; stacked master `cc575e2` ← req-0211 gimic ← req-0185 dungeon).
**Requested by:** user directives #5 (sortie page) + #6 (squad board + non-immediate-cancel bug).
**Design contract:** design/01_sortie_page.md + 02_squad_status_board.md (00 = shared tokens). Implements specs 01 + 02.

## Summary

Turns "create a room" from a settings form into the game's marquee decision moment
(dedicated `#/sortie` route) and adds an always-visible SQUAD STATUS BOARD to
`#/schedule`, and fixes the user-reported bug where canceling appeared to end an
expedition immediately. Server gaps D1 (atomic sortie) + B1 (rooms lastRun window)
are implemented with tests; the cancel bug is fixed at the sortie flow (B2).

## Bug #6 — root cause + fix (non-immediate cancel)

**Root cause (client default):** `client/src/schedule/CreateRoomForm.tsx:42` defaulted
`cancelImmediate = true`, so every room created through the (only) create UI carried
`cancelPolicy:{immediate:true}`. The server's `cancelRoom()` then took the immediate
branch (`status='canceled'` now) when the player canceled a LIVE run — disbanding the
in-flight expedition at once. The server's `validateCancelPolicy()` absent-default was
also `{immediate:true}`. Golden g says a cancel is honored when the CURRENT run ends.

**Fix (sortie-scoped default, minimal blast radius):** the deferred default is applied at
the SORTIE FLOW, which is the golden-g entry point:
- `server/services/sorties.cjs :: createSortie()` defaults `cancelPolicy` to
  `{immediate:false}` when the body omits it. The AdvancedFold exposes the destructive
  `{immediate:true}` opt-in.
- `client/src/sortie/SortiePage.tsx` sends `{immediate:false}` by default; the old
  CreateRoomForm (with its immediate default) is REMOVED entirely.
- The room doc's `cancelRequested` stays TRUE and the release happens at run end
  (`runStartedAt+durationSecs`), which the board renders as-is (B2 — "fix the doc, not
  the board").
- The legacy `POST /api/schedule/rooms` `validateCancelPolicy` absent-default is left
  UNCHANGED (still `{immediate:true}`) to preserve the existing server contract that
  many api tests rely on for cleanup (DELETE-an-active-room). This is a deliberate,
  documented deviation from spec 01 sec 8's "flip the default" — flipping it globally
  broke ~10 verbatim api-test cleanups; scoping it to the sortie path fixes the user's
  bug (no client omits the policy now) with zero test churn.

**Regression test (pins the semantics):** `server/tests/api/schedule_ops.cjs` — a sortie
created with NO cancelPolicy gets `{immediate:false}`; canceling the LIVE run keeps
`status:'active'` + `cancelRequested:true` (does NOT disband immediately); the deferred
cancel is honored (`canceled`) only once the run settles.

## D1 — POST /api/schedule/sorties (atomic create+assign)

`server/services/sorties.cjs :: createSortie(callerId, opts, profileCanvas, itemDefsById)`
runs create-room + assign-all-4-slots under the SAME deploy gate `assignSlot` enforces,
then the route settles it to launch the run. All-or-nothing: any refusal (409
same_room_duplicate / deployed_overlap / empty_squad, or a 400) deletes the freshly
created room (`storage.deleteRoom`) and re-throws — a rejected sortie never orphans a
room. The 409 conflict reasons propagate verbatim (the shared-unit collision backstop the
sortie page relies on when its client-side gate misses). Route: `server/routes/schedule.cjs`
(genSeed gated like `/rooms`). **STATUS: DONE + tested.**

## B1 — rooms list `lastRun` window (no N+1)

`server/services/runs.cjs :: lastRunSummary(room)` → `{runId, startedAt, durationSecs,
settled}` (one `storage.readRun` field-pick per room with a lastRunId; rooms lists are
short). Decorated onto the rooms LIST + single-room GET + sortie responses via a
route-local `withLastRun()` (response-only; the stored doc is never mutated).
`shared/dto.ts` gains `ApiRoomLastRun` + `ApiRoom.lastRun`. The board draws honest
wall-clock progress + a 帰還 time from it. **STATUS: DONE + tested.**
Note: `durationSecs` is the run's sim duration today; the monitor/pacing track (03) may
re-key it — the board reads whatever the run doc reports.

## B2 — board renders the cancel truthfully

`cancelRequested:true` surfaces on the board as the 解散予約 chip ALONGSIDE 出撃中/療養中,
with the release time = run end (`runStartedAt+durationSecs`) or `cooldownUntil`, shown as
BOTH countdown and absolute clock (00 P-D). The `returning` transient covers the lazy
settle gap. **STATUS: DONE.**

## Sortie page (spec 01) — what shipped

Dedicated `#/sortie` route (+ `#/sortie/<id>` deep link via SORTIE_HASH_RE +
sortieFocusDungeonId; no Nav rail entry). Components under `client/src/sortie/`:
DungeonGallery (h-scroll scroll-snap art cards, ←/→ selection, rune-well fallback),
DungeonCard, DungeonDossier (21:9 hero, encounterSummary chips ⚔×n/罠×n/宝×n/扉×n, loot
preview, LevelStepper w/ 300ms-debounced forecast, formation select, AdvancedFold),
TroopSlots (4 ◇ slots, ordinals 壱/弐/参/肆, ✕ unassign, Delete/Backspace),
SquadShelf + SquadMiniCard (40px SquadMicrogrid + unit strip + canonical state chip; NO
inventory grids), useSquadConflicts, deriveSquadCard, LaunchBar (the one gold CTA).
Atomic launch via createSortie → `#/schedule` with the new room watched (sessionStorage
`bp.watchRoom` handoff). Default cancel `{immediate:false}`.

**3-layer shared-unit legibility (§6.3):** passive link badge (🔗+count on any squad
sharing ≥1 uid) / active red conflict strip naming the shared UNIT + partner squad the
moment a conflicting squad is assigned / mirrored lockout copy on the assigned card. Server
409 backstop via friendlyScheduleError in the LaunchBar.

## Squad status board (spec 02) — what shipped

`client/src/schedule/{SquadStatusBoard,SquadBoardTile,useSquadDeployment}.tsx` mounted
above `.schedule-master-detail`. One tile per preset, always; 3px state edge; canonical
state chips; time row (countdown+absolute); 解散予約 chip with honest release; `returning`
transient. Consumes the SAME rooms state + 4s poll (no new poll loop); ONE shared 1s
ticker. All five states + two cancel-reserved variants per §3. Tile click watches the
room; ready/undeployable CTAs navigate.

## SchedulePage IA change

CreateRoomForm REMOVED (file deleted); its toolbar toggle is now a `btn-forge` CTA to
`#/sortie` (testid `schedule-create-toggle` kept as an `<a href="#/sortie">`); the
zero-rooms empty state points at the same CTA (`schedule-create-cta`). `localizedName`
relocated to `client/src/lib/contentName.ts` (SealPanel + WarehousePage imports repointed
— the only cross-boundary touch, compilation-required).

## Deviations from the spec (documented)

- **Cancel default is sortie-scoped, not global** (see Bug #6 above): spec 01 sec 8 said
  "flip the default"; flipping `validateCancelPolicy` globally broke ~10 verbatim api-test
  cleanups. Scoped to `createSortie` (+ client) — fixes the bug with zero churn.
- **Conflict "item" name = shared UNIT (BP) name**, not a resolved item name. No client
  item-name map exists; a shared unit surfaces as a shared BP id in both canvases (the
  dominant real case). POs/SIs shared without their BP fall back to the raw count.
- **Board styles live in `styles/sortie.css`, not `schedule.css`** (spec 02 said extend
  schedule.css) — keeps this REQ's surface conflict-free against the parallel monitor
  branch's schedule.css edits.
- **Dossier gimic chips are text (罠×n) not 28px gimic art** — encounterSummary gives
  counts by class, not per-gimic ids; the count chips convey the same information.
- **Dungeon cards are never locked** — no player-level gate data exists; all served
  dungeons render unlocked (the locked visual is supported via a prop but unused).
- **Recovering squads blocked client-side on the shelf** — a client courtesy (the server
  deploy gate only blocks ACTIVE-room squads); never lets an invalid assignment through.

## Artwork (user directive #5) — outcome

The D4 seam is COMPLETE (REQ-0185 already wired dungeon def ids into `/api/content`'s
art_urls; the client resolves `getItemArtUrl(dungeonId)` with the designed rune-well
fallback). Created the three **custom, 1024×576** artwork registry rows in the shared dev
PG (`niflheim_depths` id 10101, `grave_hollows` id 10102, `beastreach_wilds` id 10263)
with the design-00-§4.1 operator prompts, via the app's OWN pipeline
(`storage.createArtwork`). Drove a REAL FLUX.2 render for `niflheim_depths` through the
art queue (`storage.createRender` + `art_jobs.enqueue` → art_job.py → ComfyUI) — the
render REACHED GPU sampling (proving the pipeline works end-to-end), but end-to-end
completion is pathologically slow on this box's USB-2 model disk (>7 min cold-load +
extended post-processing per image; the documented REQ-0197 bottleneck, SSD-migration
playbook pending), and the serialized single-GPU queue cannot parallelize. **No render is
adopted yet**, so the sortie page currently shows the rune-well fallback (a valid, spec'd
state — screenshots below).

**FLAG (needs a dedicated art pass):** finalize adoption of the dungeon renders on the
SSD-migrated box. The rows + seam + client crop matrix are ready; adoption is a one-liner:
`storage.adoptRender('<dungeonId>', <seed>)` + `content.refreshArtUrls()`. The three
artwork rows are a shared-DB side effect (additive, unadopted → serve nothing → harmless).

## Gate evidence (2026-07-17)

- **server tsc:** clean (all REQ-0239 server modules load).
- **api tests (files backend):** `node server/tests/api_test.cjs` → **191 passed / 0
  failed** (187 pre-existing + 4 new REQ-0239: D1 atomic happy path + B1 lastRun on
  response + list; D1 409 rollback (no orphan); D1 400 validate; bug#6/golden-g deferred
  default + cancel-of-live-run defers, honored at run end). Zero churn to existing tests.
- **client tsc -b:** clean. **client lint:** 0 errors (46 pre-existing warnings, none in
  REQ-0239 files). **client build (tsc+vite):** OK; web/app dist rebuilt + committed.
- **12 replay goldens:** UNMOVED — `git diff ce78af5..HEAD -- sim/ content/live/` is empty
  (no sim/content changes; only shared/dto.ts types).
- **e2e (scoped HERMETIC, decade 0239, PARALLEL=2, E2E_GPU off to avoid art conflict):**
  the 3 new REQ-0239 sortie/board specs PASS (sortie atomic launch D1/B1/bug#6; board
  deployed tile; AdvancedFold seed gate REQ-0043); the 2 REQ-0071 MJOLNIR chrome specs
  PASS (incl. the migrated create-panel→#/sortie-CTA test); the 2 screenshot specs PASS.
  In the first FULL 188-test run, the schedule.spec API tests were observed passing
  (dungeons list, deploy-gate 409s, cancel-flow immediate+deferred, warehouse rewards),
  but the run saturated the box: a PRE-EXISTING warehouse-claim UI test
  (schedule.spec.ts:665) hung ~19.8 min under load, and ~20 board/DnD/WebGL specs flaked
  under saturation (the documented REQ-0185 "under-load flake, passes in isolation"
  pattern) — none touch REQ-0239 code. A load-saturation incident occurred (load→75) and
  was cleaned up; the box was freed. **Integrator: re-run the FULL suite in isolation at
  E2E_PARALLEL=2 to green the whole gate; my touched specs are verified green in isolation.**

## Screenshots (deliverable)

`/tmp/deliverables_sortie/{sortie,board}_{desktop,narrow}.png` (server) + mirrored to the
outputs mount `screenshots_sortie/`. Show the finished sortie page (gallery + dossier +
muster with assigned squads + launch bar) and the squad status board (tiles, state chips,
time rows) at 1600w desktop and 768w narrow. Dungeon key art shows the rune-well fallback
(art adoption pending per above).

## Commit hashes (base ce78af5)

- `9fee954` — reserve number
- `f77efe0` — server surface: atomic /sorties (D1), rooms lastRun (B1), deferred-cancel
  sortie default (bug #6/B2) + 4 api tests
- `65bb034` — client: SORTIE page + SQUAD STATUS BOARD + routing/i18n/tokens/dto + web/app dist
- `3239059` — e2e: migrate create-form flow to sortie flow + board coverage
- `c6539c3` — e2e: stabilize sortie/board tests + mjolnir CTA assertion
- Tip: **c6539c3** (branch UNMERGED).

## Merge notes for the final integrator (vs the monitor branch, spec 03)

- **Shared files, append-only/minimal edits (low conflict risk):**
  - `client/src/i18n/schedule.ts` — appended board keys into BOTH en/ja objects (at each
    `} as const;`). Monitor appends its own monitor keys — disjoint regions.
  - `client/src/store/core.ts` / `routing.ts` — added the `sortie` route + SORTIE_HASH_RE
    + sortieFocusDungeonId (additive union member + one focus field).
  - `client/src/App.tsx` — added one `{route === 'sortie' ? ... }` arm + import.
  - `client/src/i18n.ts` — registered the sortie module (one import + two spreads).
  - `client/src/index.css` — added `@import './styles/sortie.css'`.
  - `client/src/theme/mjolnir.css` — added the 00-§3 state ramp + elevation tokens to
    `:root`. **CONFLICT-PRONE:** the monitor branch (00 §3) also adds shared tokens
    (--field-line, --stage-well, etc.) to `:root`. CSS tolerates duplicates; the merge
    just needs a dedup of any overlapping token (I added --stage-well; monitor may too).
  - `shared/dto.ts` — added ApiRoomLastRun + ApiRoom.lastRun + ApiSortieBody (additive).
- **Files I OWN (monitor must not need these):** everything under `client/src/sortie/`,
  `client/src/schedule/{SquadStatusBoard,SquadBoardTile,useSquadDeployment}`,
  `client/src/lib/contentName.ts`, `client/src/styles/sortie.css`,
  `server/services/sorties.cjs`. RoomCard/SlotsPanel unchanged. SchedulePage.tsx heavily
  edited (removed CreateRoomForm, added board + CTA) — the monitor branch also renders the
  Monitor inside SchedulePage's detail pane; **CONFLICT-PRONE if both edit SchedulePage** —
  my edits are in the rooms-column/board/create-CTA region; monitor's are in the
  detail-pane/Monitor region (largely disjoint, but review).
- **Monitor OWNS (I did NOT touch):** Monitor.tsx, MonitorRenderer.ts, shared/pacing.json,
  runs.cjs event-pacing decoration. My runs.cjs edit is ONLY the additive `lastRunSummary`
  helper — no overlap with the pacing decoration.
- **CreateRoomForm.tsx DELETED** — if the monitor branch imports `localizedName` from it,
  repoint to `client/src/lib/contentName.ts` (I already repointed SealPanel + WarehousePage).

## Not done here (needs coordination / follow-up)

- Dungeon render adoption (see Artwork) — a dedicated art pass on the SSD-migrated box.
- Full-suite e2e green — re-run in isolation at PARALLEL=2 (box-saturation flakes only).
- Merge to master + deploy — HANDS-OFF; the branch is UNMERGED per policy.

## Outcome — merged 2026-07-19, deployed 2026-07-21, accepted 2026-07-21

Merged on **2026-07-19** as part of the REQ-0255 expedition baseline (see
`docs/REQ/done/REQ-0255-expedition-merge-baseline.md` §12), and DEPLOYED on **2026-07-21**,
riding REQ-0266's deploy rather than its own: `5066b2a` applied migrations 020-022 and the
backfills, `42238f8` rebuilt `web/app` fresh in the main checkout, `a3aaf66` restarted the api
and recorded live verification. User accepted **2026-07-21**.

Gates re-run on `master` 2026-07-21, matching the values this REQ recorded on its branch:
sim **117 passed / 0 failed**, replay goldens **OK (12 cases)**, forecast parity **18 passed /
0 failed**, `pnpm lint` **0 errors**.

**Merge commit:** `e9076e7` `Merge branch 'req-0239-sortie-squad-board'` — third of the four, so
the monitor sibling (REQ-0240) merged AFTER it and absorbed the conflicts the "Merge notes for
the final integrator" section anticipated. The `schedule.spec.ts` union those two branches
produced left a stray `describe`-close, fixed syntactically in `2088c34` (e2e was explicitly not
a gate for the baseline — REQ-0255 §7/§11).

**Live verification, 2026-07-21** — the SERVED bundle (`web/app/assets/`, built 2026-07-21 08:08
by `42238f8`) carries this REQ's own test ids: `sortie-back`, `squad-board-cta`,
`schedule-create-cta`. The page is reachable at `#/sortie`, with the squad board on `#/schedule`.

"Merge to master + deploy — HANDS-OFF; the branch is UNMERGED per policy" (Not-done-here section)
is now discharged: the user authorized the merge via REQ-0255 ruling Q2 and the deploy via
REQ-0266. **Branch still exists**, 0 commits ahead of master. Rollback path.
