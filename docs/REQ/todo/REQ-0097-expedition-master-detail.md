> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0097 — Expedition master/detail rebuild (mock 3-column)

- **Status**: DRAFT (原案) — awaiting owner review (2026-07-08). BACKBONE of the
  "Expedition 大改修" series (REQ-0097–0100). Mock NORMATIVE for structure:
  `web/redesign/expedition.html` (shared primitives already in
  `client/src/theme/mjolnir.css`, ported REQ-0069). **Supersedes the layout note
  in REQ-0071** — that REQ deliberately kept the per-card nested monitor and a
  responsive card grid; the owner has now chosen the faithful 3-column
  master/detail (ruling 2026-07-08).
- **Origin**: owner directive — "大改修 … make `#/schedule` produce the
  `expedition.html` mock result." Fidelity ruling (2026-07-08): (1) rebuild to the
  mock's true structure; (2) OMIT elements with no backing data; (3) leave HOOKS
  for features owned by queued REQs (do not re-implement them here).

## Series & route (framing only — status lives in each file's folder, per PROJECT.md)

| REQ | Piece | Size | Depends on |
|---|---|---|---|
| **0097** (this) | 3-column master/detail shell + ONE shared re-targetable monitor | L | — |
| 0098 | Room cooldown ring (蛇環 / 次戦まで %) | S | server field only; independent |
| 0099 | Settled-run replay player (⏸ / 1×2×4× / 結末まで飛ぶ) | M | 0097 (center monitor) |
| 0100 | Spoils rail (right column preview) | S–M | 0097 (shell), 0072 (warehouse data) |

**Recommended route**: 0098 (quick, independent early win) → **0097 (backbone)** →
0099 + 0100 (both build on the new shell; parallelizable). Rationale: 0098 ships a
visible win with no layout risk while 0097 (the risky structural change) is
designed; 0099/0100 only make sense once the center/right columns exist.

## Scope

Rebuild the `#/schedule` **Rooms** view from the current responsive card grid
(monitor nested per-card, REQ-0071) into the mock's master/detail:

- **LEFT — rooms list**: existing `RoomCard` restyled as the mock's left column
  list (emblem, name/level, status chip, 2×2 slot preview, footer). Selecting a
  card drives the center pane.
- **CENTER — shared detail pane**: ONE monitor — small summary strip when nothing
  is selected/idle, expanded dual-plane playback for the SELECTED room; the ctrl
  bar (wall-clock readout + timeline + encounter pips, REQ-0071) sits below it.
- **RIGHT — spoils rail**: a stub container + hook here (so the 3-column frame
  exists); its content is REQ-0100.

BEHAVIOR UNCHANGED (REQ-0036/0041/0045/0046/0071 semantics): deploy gates,
wall-clock replay pacing, lazy settlement, swap-after-run, cancel policies,
hide-canceled toggle, run LOG tab, rewards list. The **Warehouse remains its own
TAB** (REQ-0072), untouched.

## The load-bearing problem — ONE Pixi Application (central risk)

REQ-0069 hard rule: one Pixi Application per board, never torn down on a route
switch. REQ-0036/0071: the Monitor is a long-lived Pixi Application created on
first expand, **one per room**, asserted visible WITHIN its card by the E2E suite.
The mock has ONE shared center monitor. Two candidate designs — implementation
picks one; this is the main risk of the REQ:

- **(A) Shared re-targetable renderer — ORCH-preferred.** A single Monitor Pixi
  Application mounted once in the center pane; its DATA SOURCE swaps to the
  selected room's run. `MonitorRenderer` gains `retarget(roomId, run)` that resets
  field state and remounts squads/enemies/event-cursor for the newly selected run
  (diff-render preserved). One Application total — cleanest, matches the mock's
  single monitor, lowest memory. Cost: the renderer must fully reset per-run state
  (squad visuals, enemy markers, event cursor, "?" masks) with **no residual actor
  or timeline-pip leak** across retargets — add a guard on `window.__monitorDebug`.
- **(B) Portal the active monitor — fallback.** Keep per-room Monitor instances
  (REQ-0071 lifecycle) mounted-but-hidden; React-portal the SELECTED room's canvas
  node into the center pane. Preserves per-room state; costs N Applications (memory
  grows with room count — acceptable at solo/friends scale).

The `seek/reset` capability (A) needs is the SAME primitive REQ-0099 needs for
scrubbing — build it once, share it.

## Selector / E2E contract — BREAKING, must be handled

Moving the monitor out of the card breaks the "monitor visible WITHIN the card"
assertions (REQ-0036 `schedule.spec.ts`, REQ-0071 `schedule-mjolnir.spec.ts`).

- **Keep verbatim**: `.schedule-page`, `.schedule-tab`(`-active`),
  `schedule-monitor-expand-btn`, `schedule-monitor-live-chip`,
  `schedule-monitor-clock`, `.schedule-monitor-head`, and every warehouse testid.
- **Change**: monitor DOM now lives in the center pane, not inside the card —
  update the two specs' monitor locators from card-scoped to page-scoped.
- **Add**: `data-testid="schedule-rooms-col"`, `schedule-detail-pane`,
  `schedule-spoils-col`, and a room-selection hook `schedule-room-selected`
  (`.schedule-room-card-open` is kept for the focus ring but its meaning becomes
  "selected"). Record the spec diff in the REQ outcome.

## Hooks left for owning REQs (per "フックのみ" ruling — no fiction, just seams)

The shell renders labelled empty component slots (stable testid, no visible output
until the owning REQ lands):

- Weather/element chip on cards + monitor affix-badge row → **REQ-0055** (霜/燐火).
- Currency (ᚠ balance) + season countdown HUD chips → **REQ-0053 / REQ-0068**
  (global HUD chrome, REQ-0069).
- Seed-share button beside the seed readout → **REQ-0058** (seed DISPLAY already
  shipped in REQ-0071; only sharing is new).
- Log filter chips (損害/戦利品) + attachment log lines → **REQ-0049**.

## Explicitly OMITTED (owner ruling 2026-07-08 "裏付け無しは省略")

No backing data / new gameplay — the mock/app diff is accepted, nothing is faked:

- **Muninn NIGHT REPORT** header (汝が眠りし間に) + raven arc + night clock
  (22:40→06:10): no sleep/away-session tracking exists. Header keeps the hall
  identity (REQ-0071 pagehead), unchanged.
- **NIGHT TALLY** slab (踏破/討伐/被弾/献身): no per-night aggregate.
- **Lap counter / 周回 N/M** (auto-repeat) and **未踏 / 隊商Lv** locked room: new
  gameplay mechanics; if ever wanted they earn their own gameplay REQs. The card
  footer keeps room id + actions (REQ-0071).
- **Reward multiplier ×1.2** footer: no multiplier concept — deferred to REQ-0053
  (not even a hook).
- **grain / vignette / snow particles**: perf stance vs the live WebGL monitor
  (REQ-0070/0071). Not opted in.

## i18n

New keys (EN natural / ja mock copy): `schedule.detail.empty` (no-room-selected
prompt), `schedule.rooms.colTitle`, `schedule.spoils.colTitle` (rail header stub).
All REQ-0071 keys reused.

## [USER] decision list

1. Monitor design: **(A) shared re-targetable** (recommended) vs (B) portal.
2. Selection UX: click-to-select single detail; on mobile (<840px) collapse to a
   stacked single column (rooms → detail → spoils) — confirm stack order.
3. Empty-center prompt copy (`schedule.detail.empty`).
4. Confirm the two E2E specs may be updated for the moved monitor (contract change).

## Dependencies

- No blocking data dependency (uses existing room/run data). Pairs with REQ-0100
  (fills the right column) and is required by REQ-0099 (transport lives in the
  center ctrl bar). REQ-0098 is independent and can precede this.

## Test plan (gates before DONE)

- client E2E: 3-column shell renders; selecting a room drives the shared center
  monitor; the monitor Pixi survives repeated room re-selection with NO leak
  (`__monitorDebug` actor/pip counts stable across N retargets); expand/collapse;
  cancel + hide-canceled unchanged; Warehouse tab unaffected.
- Preserve: full `schedule.spec.ts` + `schedule-mjolnir.spec.ts` intent on the
  updated locators; `nav-routing` round-trips (boards mounted-but-hidden rule,
  REQ-0069, still holds).
- No server change in this REQ. `tsc -b` clean; engine/sim/server suites untouched;
  fresh dist committed.
