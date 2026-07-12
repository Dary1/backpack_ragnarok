> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0050 — S4 Simulate Gate (tools/simulate.cjs)

- **Status**: DESIGN RATIFIED by user ("all green", 2026-07-06), **assuming layered
  encounters (REQ-0049)** — implementation QUEUED
- Builds the S4 stage reserved by content_pipeline.md §3 and combat_spec §10.
  Everything below derives from the replay JSONL (already first-class, §1.5) —
  S4 is a matrix runner + log post-processor + threshold asserter. No LLM anywhere.

## User spec
Consultant metric catalog (2026-07-06 chat) approved verbatim; encode as the standing
S4 gate. Runs before any batch S7 review and after any combat-affecting REQ.

## Design

### Runner
- `tools/simulate.cjs run <matrix.json>` — matrix = boards × packs/dungeons ×
  formations × levels × seed list (fixed seed list ⇒ deterministic, goldens hashable).
- Board library `content/s4_boards/`: the four starter jobs (REQ-0051 — dual use as
  reference fixtures, user-endorsed) + archetype boards (dense turtle / sparse glass /
  circuit chain (REQ-0048) / scout-heavy / no-utility control).
- Thresholds in `sim/s4_thresholds.json`, two classes: **warn** (report) and **hard**
  (gate fails). Output: `report.txt` + JSON summary; optional gallery page
  `/preview/s4/<run-id>/` via the existing preview build pattern.
- Wired into the single quality gate (`tools/ci.sh`) when REQ-0047 (a) lands; until
  then a standalone command listed in PROJECT.md test gates.

### Metric catalog (post-processor)
**A. Item/effect level**
- A1 effective DPS per PO (mean/p95 across seeds): bounce-mult, AOE splash,
  penetration multi-hits, and DoT attributed to the applier — vs
  `vocab.dps_ceiling_warn` per rarity. **Conditional effects report measured uptime**
  (assembled/adjacent/linked) and "DPS given uptime" — static ceilings cannot judge
  conds; this metric can (the `blade` case).
- A2 status saturation: stack growth vs decay per status; flag runaway
  (`amp_status` loops) = hard.
- A3 block/heal throughput + overheal/overblock waste %.
- A4 (with REQ-0048) circuit metrics: amplification factor (linked vs de-linked same
  board; warn > [TUNABLE 2.5×]), pulses/sec, hop-depth & fan-out distributions,
  PULSE_CAP hit rate (warn > 5%).

**B. Ray geometry**
- B1 bounce-count distribution per skill; % rays reaching the 5-bounce all-field
  terminator (warn if a skill's rate > [TUNABLE 30%] — spec §10's "balance smell").
- B2 damage heatmap per field cell / per BP: permanent safe cells (degenerate
  placement real estate) and dead columns; jitter-J sensitivity sweep.
- B3 penetration utilization (avg pass-throughs vs budget) & AOE avg extra targets
  (overcosted-skill detectors).
- B4 sparse-vs-dense study: parametric coverage boards → damage-taken curve; hard-flag
  if minimal-coverage builds strictly dominate (consultant-review risk #4).
- B5 formation equity: same troop across the 4 formations vs reference packs — spread
  of win rate (warn > [TUNABLE 15pt]); side-entry damage share per formation
  (quantifies formation1's known bypass).
- B6 ray_abort (step-budget) rate: hard-flag if > 0 outside crafted stress fixtures.

**C. Squad/troop**
- C1 time-to-first-BP-down / time-to-wipe under reference packs; slot death-order
  equity per formation.
- C2 overkill % and idle-squad % (rays with no living target).
- C3 post-first-BP-loss cascade factor (damage distribution shift once a BP is
  passable) — snowball watch.

**D. Encounter/run (layered-encounter aware)**
- D1 encounter duration distributions per type — pacing bands (dull-replay detector).
- D2 clear-rate vs level curve per dungeon type (dungen default, multi-seed):
  target band [TUNABLE e.g. ~80% on-level / ~20% at +3]; **monotonicity** hard-check
  (level k+1 never easier than k).
- D3 troop HP fraction H vs progress %; distribution of finishing H — hard-flag a
  0/1 bimodal H (it would void the linear cooldown curve, OQ15–17).
- D4 utility EV bands: trap-discovery rate before timeout; trap end-volley damage on
  no-detection boards; chest completion vs clear-speed correlation; % chests lost to
  fast clear (warn > [TUNABLE 40%]); scout-board vs control-board net EV (loot + HP
  saved − battle DPS foregone) must sit inside a declared band [TUNABLE].
- D5 door shortcut real throughput: (time saved × auto-requeue cycle rate) − skipped
  rewards, per level.
- D6 wipe autopsy: cause mix and encounter index at wipe (early-wipe frustration
  detector, warn if > [TUNABLE 25%] of wipes in first 2 encounters).

**E. Meta/economy (cheap add-ons, feed REQ-0053)**
- E1 Weathervane/hour and items/hour by rarity per level; warehouse pressure
  (items/day vs 200 cap / 7-day TTL).
- E2 gacha BP audit: cell-count histogram, shape entropy, hpMax spread, degenerate
  shape frequency.
- E3 plateau ETA: expected days-to-level-L composed from cooldown H-curve + auto
  requeue cadence (the ruling of 2026-07-06: goals over appointments — this metric
  tells us when the goal ladder runs dry, without adding any appointment mechanics).
- E4 adoption: % of live items appearing in any top-decile matrix board; pairwise
  co-presence damage lift (degenerate-pair detector).

### Determinism & cadence
- Fixed seed lists; per-matrix golden hashes (same discipline as REQ-0047 (a) sim
  goldens; if 0047 lands first, share the harness).
- Mandatory runs: every content batch S4 stage; every REQ touching sim/engine/content
  numbers; before any S7 user review.

## Test plan (gates before DONE)
- Post-processor unit tests on hand-crafted JSONL fixtures (each metric, each flag).
- Matrix determinism test (same matrix ⇒ identical report hash).
- Threshold classes behave (warn vs hard exit codes).
- One real full-matrix run committed as the inaugural baseline report.
