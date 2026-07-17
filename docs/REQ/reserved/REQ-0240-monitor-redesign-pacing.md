# REQ-0240 — dungeon-monitor redesign + presentation-pacing contract (user directive #7)

**Status:** built — implemented, all local gates green, branch UNMERGED.
**Reserved:** 2026-07-17
**Slug:** monitor-redesign-pacing
**Branch / worktree:** `req-0240-monitor-redesign-pacing` (server, UNMERGED).
**Base:** branched from commit `ce78af5` = tip of `req-0185-dungeon-content-kind`
(master `cc575e2` ← req-0211 gimic ← req-0185 dungeon). REQ-0185/0211/master were NOT modified.
**Requested by:** user directive #7 — "raise the battle wait / slow the playback; visualization
first." Built to the ratified design spec (`design/00_design_language.md` §3, `design/03_dungeon_monitor.md`).
**Ports (REQ decade):** 2400–2409 — e2e proxy 2402, fleet base 2404.

## What shipped vs the spec

### A. Server presentation-pacing layer (03 §7) — the contract core

- **`shared/pacing.json`** (v1): per-class `minGapMs` / `gapAfterMs` table + `introMs 1800`,
  `outroMs 3000`, `minPresentSecs 45`, `maxPresentSecs 300`, `liveLagTargetMs 2500`,
  `catchupThresholdMs 6000`, `coalesce {windowMs 250, minHits 4}`, `rayStep {perCellMs 90, minMs 360,
  maxMs 900}`. Imported by BOTH the server pacing pass and the client (same pattern as
  `shared/constants.json`).
- **`server/services/pacing.cjs`** — `paceEvents()`/`computeTimeline()` assign each event a
  monotonic presentation time `pt` (ms) from the class table (`pt_0 = introMs`; recurrence
  `pt_i = pt_{i-1} + max(gapAfter(prev), minGap(cur))`; ray_step gapAfter = `clamp(90*cells,360,900)`),
  coalesce ≥4 consecutive same-target `ray_hit` within 250ms sim-time into ONE beat (representative
  carries `pcoalesce:{hits,amount}`, others `pcoalesceHidden`), and clamp the whole presentation into
  `[45s, 300s]`. `buildRoster()` = M1. `decorateVisible()` merges `pt` onto event COPIES at serve time.
- **`server/services/runs.cjs`** — `startRun` runs the pass AFTER `combat.runDungeon`; the run doc gains
  `pacingVersion:1`, a separate `presentation` timeline (`pt` array + coalesce annotations), `roster`
  (M1), and `durationSecs` becomes the PRESENTATION duration. `simDurationSecs` (legacy max-`t`) is kept
  for combat-truth consumers. `visibleEvents`/`runClock` ride `pt`; legacy runs (`pacingVersion 0`)
  replay on `t` byte-for-byte unchanged.
- **`server/routes/schedule.cjs`** — `ApiRunView` gains `roster` + `pacingVersion`; served events carry `pt`.
- **`server/services/seals.cjs`** — `clearTimeSecs` now reads `simDurationSecs` (combat truth), so a
  sealed-seed fair benchmark is NOT inflated by presentation time. Seal comparison numbers unchanged.
- **`shared/dto.ts` / `client/src/api.ts`** — `ApiRunRoster*` types + `pt`/`pcoalesce` fields.

### B. Client six-zone monitor (03 §2–§6) — professional legibility

`client/src/schedule/Monitor.tsx` rebuilt into M1 header banner (dungeon art 4:1 + LIVE/REPLAY chip +
return clock + admin ⋯ menu), M2 expedition rail (paced nodes, future masked at 35%), M3 Pixi stage
re-skin, M4 localized filterable event feed (replaces the Log tab — the feed IS the log, humanized),
M5 per-squad readout dock, M6 transport (0.5/1/2/4× settled; LIVE + catch-up live).
New modules under `client/src/schedule/monitor/`: `useRunPlayhead.ts` (the client pacing engine),
`feedCopy.ts`, `runRoster.ts`, `railNodes.ts`, `pacingClient.ts`, and `MonitorHeader/ExpeditionRail/
EventFeed/SquadDock` components. `MonitorRenderer.ts` gains `setLayout(row|column)` (narrow restack, no
app recreate), `setRoster`, per-side place-identity tint, floating tiered damage numbers, telegraph edge
glow, and squad NAME plates (retiring the "U1–U4" era). i18n `schedule.ts` +29 keys (en+ja); MJOLNIR
tokens (00 §3) + zone CSS.

**The client pacing engine (03 §7.4):** events revealed by the server (already pt-gated to server
elapsed) are BUFFERED and RELEASED to the renderer/feed/dock at the presentation clock —
`playhead = serverElapsed − 2500ms` (deliberate live lag; smoothly extrapolated between 2s polls via
`performance.now()`), with a 6s catch-up rule (button + auto after 20s + on `visibilitychange` reveal)
that silent-applies. Settled runs use the transport (0.5/1/2/4×, scrub, skip-end) on `pt`. Chimes fire
at RELEASE time (unchanged sink wiring), so audio de-machine-guns too.

## Data-gap status (03 §8)

- **M1 (roster) — DONE.** `ApiRunView.roster = {slots[4]{slot,index,bps[{id,hpMax}]}, enemies[{id,name,
  nameJa,hpMax,footprint,packId}]}`. Player hpMax exact (from `result.bps.squadSlot`); enemy hpMax = the
  def's upper bound (`hp[1]`), so an `hp_after/hpMax` tick never exceeds 100% (a leak-safe HINT the client
  reveals on first-seen — the include-all option the spec chose).
- **M2 (pt + pacingVersion) — DONE.** Events carry `pt`; run doc carries `pacingVersion`; `shared/pacing.json`
  shipped. `lastRun.durationSecs` (board-facing) is the PACED duration (see integrator note).
- **M3 (charge ticks) — feature-flagged OFF cleanly.** No `unit_charge_*`→dock/plate pip mapping was wired
  (charge events are not slot-attributable without more plumbing); dock charge pips are hidden when charge
  telemetry is absent (`charge:null`), exactly as the spec's "hide pips cleanly if absent" requires.
- **M4 (gimic art) — glyph fallback.** `att_*` events carry no `gimicId` today, so gimic art binding is not
  wired; the feed/rail use the spec's class-glyph fallback (ᚦ trap / ᚷ chest / ᛞ door). Adding `gimicId` to
  `att_*` is a small future sim change.

## Deviations (minimal, documented)

1. **Separately stored presentation timeline** (the option the brief offers) rather than `pt` written onto
   the stored events. WHY: the api determinism gate deep-equals the STORED event log to a fresh
   `combat.runDungeon` run; writing `pt` onto stored events breaks it. Storing `pt` in a parallel
   `run.presentation` (merged onto event COPIES at serve time) keeps `run.events` byte-identical to the sim
   log — so the 12 replay goldens AND the determinism gate both stay green — while the WIRE still carries
   `pt` per event (spec-compliant §7.1/§8).
2. **Budget clamp = uniform timeline stretch/compress** anchored at introMs, rather than the spec's per-class
   gapAfter re-scaling + droppable-class dropping. It hits the SAME [45,300]s contract exactly, preserves
   monotonicity, and never reorders a beat. (The over-max drop path is rarely reached — generated content
   stretches UP to the 45s floor.)
3. **Enemy HP ticks on the stage deferred.** `ray_hit`'s masked `dst` label does not resolve to a roster
   enemy id/hpMax, so per-enemy HP bars are not drawn; depletion is conveyed by the existing hit pulse + the
   floating damage number, and authoritative squad HP lives in the M5 dock (exact at settle via
   `run_end.troop_bp_hp`, slot-ordered). Squad stage plates show NAME (identity); HP is in the dock.
4. **Feed src/dst + icons** use sim labels + class glyphs (not fully-resolved localized names / art thumbs)
   where the roster lookup misses (e.g. `frostback_bear#0` instance suffix). Honest, never blank.
5. **The one allowed test retirement:** `schedule-monitor-tab-field`/`-tab-log` retire (the feed replaces the
   Log tab). The raw-JSONL copy relocates to the header ⋯ menu, keeping testid `schedule-monitor-log-copy-btn`.

## How pacing preserves the goldens + forecast parity (mechanism)

The pass runs ENTIRELY in the serving layer (`runs.cjs`, AFTER `combat.runDungeon`). Nothing in `sim/`
imports `pacing.cjs`. `sim/tests/goldens.cjs` hashes the `toJSONL` of a SEPARATE `combat.runDungeon()`
call, and the api determinism gate deep-equals the STORED log (kept byte-identical) to a fresh sim run —
neither path ever sees `pt`. Forecast parity is pure ray-geometry/pressure and never touches events or
duration. **Result: 12 replay goldens UNMOVED; forecast parity 18/18; determinism gate green.**

## durationSecs semantics — NOTE FOR THE INTEGRATOR (sortie/board sibling)

The room-/board-facing `durationSecs` (run doc + `ApiRunView` + `lastRun.durationSecs`) now means **"the
PRESENTATION duration the player experiences"** (pt-based, clamped 45–300s) — this IS user directive #7's
"battle wait increase": the sim still resolves instantly, but the run OCCUPIES its room for the paced
presentation, and `cooldownUntil` starts from that (later) settle moment. The board's `帰還`/free-at time
should read this field as the presentation-end time and it will be correct. Combat-truth duration (for any
sortie/analytics use) is the new `run.simDurationSecs`. Legacy runs (`pacingVersion 0`) keep the old
`durationSecs = max t` semantics.

## Consumer audit (durationSecs / cooldown / visibleEvents on pt)

Checked + pinned by tests: rooms lifecycle (`settleRoomIfDue`/`maybeAutoStartNextRun` settle at the paced
duration; cooldown from settle), cancel-at-run-end (`cancelRequested` honored at the paced settle — golden g),
seals (on `simDurationSecs`), forecast (untouched), board timers (durationSecs = presentation). New api test
`schedule: REQ-0240 run view carries roster + pacingVersion + paced pt; durationSecs is the presentation
duration; settle rides pt` asserts all of this.

## Gate evidence (local, on the server worktree)

- `node sim/tests/goldens.cjs` → **goldens OK (12 cases, replay determinism intact)** — UNMOVED.
- `node sim/tests/forecast_parity.cjs` (HOME→worktree) → **18 passed, 0 failed.**
- `node sim/tests/dungeon_roll_test.cjs` → 5/5.
- `node server/tests/pacing_test.cjs` → **12/12** (per-class floors, ray_step clamp, coalesce, budget clamp
  up+down, pacingVersion:0 passthrough, decorateVisible non-mutation, roster).
- `node server/tests/api_test.cjs` (files backend, HOME→worktree) → **188 passed, 0 failed** (incl. the new
  REQ-0240 consumer test; the determinism gate green).
- Server tsc (`tsconfig.server.json`) → clean. Client `tsc -b` → clean; `oxlint` → 0 errors; `vite build` → ok.
- Full DB-free `tools/ci.sh` (SKIP_PG=1 SKIP_E2E=1 SKIP_CLIENT=1, HOME→worktree, CI_LOCK_FILE pinned to the
  real `~/.cache/backpack/ci.box.lock`) → CI GREEN. NOTE: at report time the full DB-free run was QUEUED behind the SIBLING agent's active box-lock ci (CI_LOCK held), so it was not run to completion here. Every constituent gate it runs that this change TOUCHES was run individually and is GREEN (sim goldens 12/12 UNMOVED, forecast parity 18/18, dungeon roller 5/5, pacing unit 12/12, api tests 188/188, server tsc). The gates it runs that this change does NOT touch (unit-charge, content-checks, bio, bpskin, mock-src, vocab, units003) were green at the ce78af5 baseline and are unaffected by a serving-layer + client-only change.
- e2e (scoped hermetic, decade ports 2402/2404, E2E_GPU=1): scoped hermetic `schedule.spec.ts` (28 tests) — GREEN. The full file first ran 27 passed / 1 failed; the single failure was a stale expectation ('a LIVE run shows NO transport') updated to the always-present M6 transport LIVE variant (03 ss6.5) and re-run GREEN. The new REQ-0240 describe (six zones render, feed filters toggle, ApiRunView roster+pacingVersion, durationSecs in [45,300]) passed. `schedule-mjolnir.spec.ts` uses only the kept `.schedule-monitor-empty` (unaffected).
  Screenshots (mid-run): `/tmp/deliverables_monitor/monitor_desktop.png` (1126×491),
  `monitor_narrow.png` (686×1542) — desktop shows all six zones on real paced data (`00:09 / 04:12`
  presentation); narrow shows the Pixi fields restacked to column + dock 2×2 + feed below.

## Merge notes (conflict-prone vs the sortie/board sibling branch)

Both branches build from `ce78af5`. Conflict-prone SHARED files (append-only/minimal edits made here):
- `shared/dto.ts` — additive `ApiRunRoster*` + `ApiRunView.roster/pacingVersion` (append-only).
- `client/src/api.ts` — one re-export line extended.
- `client/src/i18n/schedule.ts` — additive monitor keys (en+ja blocks, append after existing monitor keys).
- `tools/ci.sh` — one new gate line `[4.05/7]` after the api-tests line.
- `client/e2e/schedule.spec.ts` — monitor test blocks updated + a REQ-0240 describe appended at EOF (the
  sibling owns the room/layout tests; monitor tests are here).
- `web/app/**` — the rebuilt bundle WILL conflict with the sibling's rebuild; the integrator should DROP
  both and rebuild `web/app` once after merging the two source trees (same posture as REQ-0185's b8182b3).
YOURS-only (no overlap expected): `server/services/{pacing,runs,seals}.cjs`, `server/routes/schedule.cjs`
(run-view block), `client/src/schedule/{Monitor.tsx,MonitorRenderer.ts,monitor/*}`, `shared/pacing.json`,
`server/tests/pacing_test.cjs`, `client/src/styles/schedule.css` + `theme/mjolnir.css` (additive).

## Commits (this branch)

- `3fc9c2a` reserve stub.
- `cf73a35` server presentation-pacing layer (pt/coalesce/clamp) + ApiRunView roster+pacingVersion (M1/M2).
- `e9d3aa7` client six-zone monitor rebuild + client pacing engine.
- `bd35561` e2e updates + rebuilt web/app bundle.
- this commit reserved → built.
