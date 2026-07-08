# REQ-0055 — Dungeon Weather (ray affixes)

- **Status**: ADOPTED by user (2026-07-06) — implementation QUEUED
- Origin: brainstorm batch 2 item 9 ("ダンジョン天候"). PoE-map-mod translated into
  the formation-ray language: one ray system, multiplicative content.

## User spec
「採用です」 — deterministic global modifiers per dungeon+level, telegraphed in the
scouting report, answered at loadout time.

## Design
- **Affix defs (content, closed list per dungeon family)** — examples for batch:
  | id | effect surface |
  |---|---|
  | aurora | bounce table override: 3rd bounce +100% (instead of +50%) |
  | fog | all detection `bounce_budget` −1 (min 0) |
  | gale_west | side-entry base-coordinate distribution shifted N cols windward [TUNABLE 2] before jitter |
  | deep_frost | Chill per-stack cadence slow +2pp; Burn tick period ×1.25 |
  | thin_air | PULSE_CAP −1 (circuits labor at altitude; REQ-0048 interplay) |
- **Inviolable guardrail**: affixes modify NUMBERS and DISTRIBUTIONS only — never
  geometry LAWS (45° movement, boundary-only reflection, mode transparency stay
  untouched, always). Legibility depends on the laws being constant.
- **Rolling**: `sim/dungen.cjs` rolls 0–2 affixes [TUNABLE curve by level] from the
  dungeon family's list, seeded by the dungeon seed (deterministic, REQ-0043
  discipline). `test_fixed` remains affix-free unless its fixture says otherwise.
- **Telegraph**: scouting report (REQ-0049 surface) lists affixes with plain-language
  effect lines (eff_render pattern); monitor shows an affix badge row; run log
  header records them. Sealed-seed shares (REQ-0058) carry affixes with the seed —
  all participants face identical weather.
- **Sim**: one `weather` object threaded into the encounter compile: bounce-mult
  table, budget deltas, entry-distribution shift, cadence/status multipliers. All
  existing tunables already flow through TUNABLES — weather is a per-run overlay on
  that table, applied at compile, never mutated mid-run.
- **S4 (REQ-0050)**: matrix gains an affix axis; D2 clear-rate bands re-checked per
  affix; hard-flag any affix that flips a formation's B5 equity beyond [TUNABLE].
- **Dex**: "Weather" chapter (REQ-0052 reserved kind `chapter`).

## Test plan
- sim: affix application unit tests per surface, determinism goldens (seeded rolls),
  guardrail test (geometry law functions untouched by any affix path).
- dungen: roll bounds + level curve monotonicity smoke.
- server/client: scouting report + monitor badges + log header E2E.
- S4: inaugural affix-axis matrix run committed as baseline.
