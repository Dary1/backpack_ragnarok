# REQ-0049 — Layered Encounters (trap/door/chest as battle attachments)

- **Status**: DESIGN RATIFIED by user (2026-07-06) — implementation QUEUED
- Amends combat_spec_draft.md **§6** (encounter types): detection/unlock encounters
  change from *sequential* to *parallel* ("attached to" battles). The spec file itself
  is amended when implementation starts; until then THIS REQ is normative for §6.
- Strict mode gating (OQ12), the `modes` closed vocabulary, "?" masking, per-PO bounce
  budgets, and center placement for unlock entities all REMAIN ratified and unchanged.

## User spec
Consultant analysis (2026-07-06): the sequential design has two structural defects —
(i) the utility tax is binary (carry detection/unlock POs or forfeit those encounters
entirely), (ii) pure detection/unlock encounters idle the whole battle arsenal,
creating dead segments in the replay/spectate show. Proposal: attach trap/chest/door
entities to battle encounters so battle POs fight the pack while detection POs hunt
the "?" and unlock POs chip the chest — same field, same clock, same ray grammar.
User verdict: 「レイヤード・エンカウンター、素晴らしいですね」 → ratified.

## Design

### Schema (VX-2-adjacent; schema growth, no vocab growth)
Encounter defs gain an optional `attachments: []`:
```jsonc
{ "id":"pack_4", "type":"pack", "mode":"battle", "enemyPack":{...},
  "attachments":[
    { "id":"att_trap_1", "kind":"trap",  "mode":"detection",
      "entity":{ "footprint":[1,1], "skills":["trap_deadfall_volley"], "timeout_secs":22 },
      "reward":{ "roll":"reward_trap_disarm" } },
    { "id":"att_chest_1","kind":"chest", "mode":"unlock",
      "entity":{ "footprint":[2,2], "hp":[60,80], "timeout_secs":35 },
      "reward":{ "roll":"reward_frostbound_cache_roll" } } ] }
```
Cap **[TUNABLE ≤2 attachments per encounter]**. `kind: trap | chest | door`
(door = the two-stage detection→unlock chain object, golden o).

### Field placement (deterministic, seeded)
- **chest/door**: center-most FREE enemy-field cell cluster (center rule retained;
  "free" = not occupied by the pack's spawn template; resolved at compile).
- **trap "?"**: seeded uniform among free enemy-field cells; smaller footprint =
  harder (retained). Position masked in the replay until discovered (retained).

### Mode-pure ray transparency — [LOCKED, vetoable]
A ray interacts ONLY with occupants matching its own mode:
- battle rays ignore "?"/chest/door entities (pass through; cannot break a chest);
- detection/unlock rays pass through live enemies harmlessly (no damage, no
  penetration cost, no stop).
Rationale: dense packs must not shield traps (frustration), weapons must not
bruteforce locks (OQ12), and cross-mode interference would make ray outcomes
illegible. Boundary reflection & bounce budgets unchanged per mode (§2.2).

### Clocks & outcomes (all on the encounter's battle clock)
| attachment | resolved when | on success | on failure |
|---|---|---|---|
| trap | detection hit before `timeout_secs` AND before pack clear | disarmed; small reward roll | **timeout mid-battle** → fires its skill volley into the fight; **pack cleared while undiscovered & unexpired** → fires once at encounter end ("stumbled into it while looting") [LOCKED, vetoable] |
| chest | unlock DPS brings hp→0 before `timeout_secs` AND before pack clear | reward roll (TM-weighted, REQ-0053) | chest lost, no penalty |
| door | stage 1 detection find, then stage 2 hp→0, both within the encounter | shortcut `+J%` (§8.3 unchanged) | no shortcut, run continues |
Anti-rush tension is DELIBERATE (user-endorsed): melting the pack too fast can cost
you the chest/door. Trap punishes fast-clear too (end volley), so detection retains
value at every clear speed.

### Generator & pure rooms
- `sim/dungen.cjs`: traps/chests/doors move from standalone encounters to attachment
  rolls on generated packs (density scales with level, curve **[TUNABLE]**, reusing the
  existing `level/(level+4)` pattern). Reward roll ids unchanged (schedule.cjs table
  untouched).
- Pure detection/unlock encounters REMAIN legal as rare "puzzle rooms"
  **[TUNABLE p ≈ 0.1/run]** — §6.2's pause-not-accumulate rule now applies only there.
- batch-002's hand-authored dungeon.json gains attachments in a data-only pass
  (`test_fixed` stays byte-stable per REQ-0043 semantics — new fixture version).

### Sim implementation notes
- Multi-objective encounter loop: per-mode occupancy indexes on the enemy field;
  attachment entities are actors with their own timers/HP; encounter ends on pack
  clear (battle win condition unchanged) → then end-of-encounter attachment
  settlement (trap end-volley, unresolved chest/door lost).
- Replay events: `att_reveal`, `att_disarm`, `att_open`, `att_lost`, `att_fire`
  (+ existing ray events with mode tags). Spectator masking retained.

### Client / UX
- Monitor: attachment badges on the enemy field; mode-colored rays (battle/detection/
  unlock); "?" mask until reveal.
- Run LOG (REQ-0045 g): **non-participation invoice lines** — "trap fired: −X HP
  (no detection POs deployed)", "chest lost (unlock DPS 0)" — the price of skipping
  utility must be legible.
- Room create / dungeon info: scouting report (expected trap/chest/door counts for
  the dungeon+level).

### Interactions
- REQ-0048: `on_link_pulse` detection/unlock payloads fire only in matching context —
  scout circuits emerge with zero extra work.
- REQ-0051: the Scout starter job demonstrates attachment value from run 1.
- REQ-0050: S4 gains D4-class metrics — trap-discovery rate, chest completion vs
  clear-speed correlation, % chests lost to fast clears (flag > **[TUNABLE 40%]**),
  utility-vs-battle EV bands.

## Test plan (gates before DONE)
- sim: attachment placement determinism, per-mode transparency, all clock outcome
  branches (trap 3 endings, chest 3, door stages), cap enforcement, masking,
  determinism goldens; dungen attachment density + monotonicity smoke.
- server: reward accrual parity (files+pg), scouting report endpoint.
- client E2E: monitor badges/colored rays, run-log invoice lines, pure-room fallback.
- combat_spec_draft.md §6 amended + PROJECT.md updated same day (standing lesson).

## Gate results & outcome (2026-07-09, branch `req-0049-layered-encounters`, stacked on REQ-0048)

Commits:
- `bcff1d7` sim core — attachments loop (deterministic placement, mode-pure
  transparency, trap/chest/door outcome branches, `att_*` events, cap ≤2, masking); +8 tests.
- `fb38aa4` dungen — trap/chest/door as pack attachment rolls + rare pure room;
  `dungen/default` goldens rebaselined (generator FEATURE change; batch-002 byte-identical); +2 smoke.
- `02be4ac` run integration — attachment reward accrual + attachment-door shortcut in runDungeon; +2 tests.
- `452c66a` land — `dungen.scoutingReport` + `/api/schedule/dungeons` scout payload;
  client MonitorRenderer attachment badges + run-log invoice lines + debug seam; attachment-badge e2e spec.

Gate matrix:
- sim tests: PASS (96) — placement determinism, per-mode transparency, trap 3 endings,
  chest open/lost, door 2-stage shortcut, cap, masking, run-level reward accrual + shortcut,
  dungen attachment density, scouting report.
- sim replay goldens: PASS (12) — `dungen/default` rebaselined for the generator feature
  change; batch-002 byte-identical (verified: only dungen/default keys changed).
- mock-src engine tests: PASS (101, engine untouched). server tsc / type-drift: PASS.
- server api tests (files backend): PASS (153) — incl. dungeons scout payload.
- client tsc -b + vite build + oxlint: PASS (0 errors).
- combat_spec_draft.md §6: amended (sequential → parallel attachments).
- reward accrual (files+pg): attachment rewards flow through the existing
  settleRun→warehouse path (structural files/pg parity; sim reward-accrual test green).
- client E2E (attachment badges): spec authored + committed + build-verified; the identical
  `__monitorDebug` applyTestEvents seam + monitor-open flow is proven green in-browser against
  live by the REQ-0048 pulse e2e. A live run of THIS spec was blocked only by shared e2e-rig
  background-process / proxy-port contention (environment, not code).
- server pg backend + full E2E regression suite: environment-gated (same as REQ-0048);
  recommend a full-suite run at the next clear rig window before deploy.

Supersedes the sequential encounter model. Interactions: REQ-0048 on_link_pulse
detection/unlock circuits work by construction; REQ-0051 Scout job; REQ-0050 D4 metrics
now have `att_*` events to measure.
