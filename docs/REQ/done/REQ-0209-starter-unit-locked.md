# REQ-0209 — Starter units: fully locked interiors (all cells fixed, rotation-only)

## Status
todo (ratified by user directive, 2026-07-17, chat).

## User directive (2026-07-17)
Starter units must accept NO interior operations at all. Today a starter unit
has 4 fixed POs and free placeable cells; make EVERY cell fixed uniformly:
- No PO may be placed into, moved within, rotated in, or removed from a
  starter unit's BP.
- No SI may be seated into (or unseated from) any socket of a PO inside a
  starter unit.
- The ONLY accepted interior-affecting operation is rotating the Unit (BP)
  itself (rotateBP / invRotateBP), which rotates the fixed contents with it.
- Additionally, pre-fill all four starter units with existing POs (author's
  discretion) so the now-unplaceable empty cells are put to use.

## Design
1. **BP-level `locked` flag** (engine, mock-src/engine.js):
   - `canPlaceCells` (canvas) and `invCanPlaceCells` (pages) refuse cells of a
     locked BP with `why:'locked unit'` — blocks ALL new PO placement/move
     into a locked BP on both surfaces.
   - `seatSI`/`stowSI` (canvas) and `invSeatSI`/`invStowSI` (pages) refuse
     when the host PO sits inside a locked BP (`why:'locked unit'`).
   - Existing per-PO `fixed:true` continues to refuse move/rotate/stow of the
     pre-filled POs themselves (REQ-0051 mechanism, unchanged).
   - `rotateBP`/`invRotateBP` mutate contained POs directly (not via
     rotatePO), so BP rotation remains legal for locked BPs — by design.
   - BP-level move/transfer/discard stay legal (interior untouched).
2. **Reference propagation fix**: `createRef` drops `fixed` on PO refs and
   would drop `locked` on BP refs — propagate both (`fixed` loss is a latent
   REQ-0051 gap: removing and re-adding a starter BP to canvas made its POs
   movable). For a fixed PO ref created as nested content of a BP ref, bypass
   the canPlaceCells gate (its geometry travels with the validated BP
   placement and would otherwise be refused by its own BP's lock).
3. **Client**: `buildStarterUnitsState` (store/boot.ts) sets `locked: true`
   on starter BPs (alongside existing per-PO `fixed: true`). BP type gains
   `locked?: boolean`. UI needs no new affordance: placement previews and
   socket seating already surface engine refusals (BoardRenderer flashes on
   fixed; `why:'locked unit'` flows the same paths).
4. **Content** (content/live/starter_units.json): fill each starter unit's
   free cells with additional fixed POs drawn from its own themed starter kit
   (socketless items only, keeping the authored "no sockets/ports" property).
   Update the schema note. Mirror the new layouts into the S4 baselines
   (content/s4_boards/starter_*.json) if their format embeds PO layouts.

## Out of scope
- Server-side enforcement (state is client-authoritative today; the claim
  endpoint grants by id only).
- Any change to non-starter fixed-PO semantics.

## Gates
- mock-src/tests (engine): new locked-BP cases — PO placement into locked BP
  refused (canvas+page), SI seat/stow on locked-BP-hosted PO refused, rotateBP
  still ok, createRef propagates fixed/locked.
- client typecheck/build; existing e2e suites.
- content checks (server/services/content_checks.cjs) pass on the refilled
  starter_units.json.

## Log
- 2026-07-17 reserved (7f4529c), spec written, ratified straight to todo per
  user directive.

## Gate results (2026-07-17, worktree req-0209-starter-unit-locked)
- mock-src engine tests: 119 passed, 0 failed (5 new REQ-0209 suites).
- tsc (tsconfig.server.json), check_engine_types, self_test_vocab, check_units,
  units003_acceptance: green.
- sim tests / goldens / s4 / forecast-parity(minus perf) / wildlands / charge: green.
- server tests: files + pg api, content, schedule/content serving deps, bio,
  bpskin(+migration), pg_sync, backfills, parity classifier, content_checks
  (dialect/geometry/unit-deep), artwork, artqueue, inspection, contentagg,
  seed_derive, moderation: green.
- client script gates (unit-icon, link-trace, pack boards x3, chimes, auth,
  bpskin x2, a11y) + typecheck/build: green.
- e2e: main suite 187 passed / 1 skipped / 0 failed; artadmin (6), art_inspect,
  content_admin harnesses: green.
- PRE-EXISTING master failures (verified identical on the untouched main
  checkout; NOT caused by this REQ): (1) forecast_parity perf budget 75-80ms
  vs [TUNABLE 50ms]; (2) req0203 grave-legion additive-promotion baseline
  count expected 7 got 19; (3) content_serving_test pg fixture ENOENT
  content/live/dungeon/items.json (6 cases).
- Commits: c92047a (implementation), + dist rebuild.

## Deploy record (2026-07-17)
- Merged to master 06a3ccc (--no-ff, user go-ahead in chat), fast history:
  c92047a impl / 1f52468 dist / b2b399e+19dbf7b docs.
- backpack-api + backpack-web restarted; live-verified: /api/content serves
  starterUnits.locked=true with filled boards (guard 10 / arms 12 / mend 12 /
  scout 13 POs); web serves the merged dist (index-CLqndH6v.js).
- Note: backpack-mirror.service was already in failed state before this
  deploy (pre-existing, untouched).
