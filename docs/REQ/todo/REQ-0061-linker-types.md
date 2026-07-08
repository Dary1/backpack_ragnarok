# REQ-0061 — Linker Types (the factorized 8-element axis)

- **Status**: ADOPTED by user (2026-07-06; staging "All Green") — implementation
  QUEUED. Consumes the `linker.schema` seat reserved since content_pipeline v1.0 §1.
- **Acquisition ruling (user, 2026-07-06)**: linker types are obtained by CHOOSING
  which themed BP pack to open (REQ-0062). The orchestrator's earlier TM-type-reroll
  idea is **SUPERSEDED** by this ruling.

## User spec
「採用にはします。開けるBPパックを選べば良くて、これらが欲しい人はBPパックそのものを
選べば良い」 + staging per the ratified chat proposal.

## The axis (each type = exactly ONE deviation from standard relay behavior)
Standard (REQ-0048): receive → payloads fire → auto-relay on remaining hops.

| wave | type | single function | params |
|---|---|---|---|
| 1 | delay | relay is postponed by +D s | D [TUNABLE 0.4] |
| 1 | divider | relays only every Nth received pulse (per-encounter counter) | N [TUNABLE 2] |
| 1 | junction | relays ONLY if ≥2 pulses arrive within window W (AND) | W [TUNABLE 0.5s] |
| 2 | toggle | alternates its outgoing links, one per relay (stable dir-index order) | — |
| 2 | terminal | never relays (absorbs; payloads still fire) | — |
| 2 | amplifier | +1 hopsLeft on pass-through (§5 pool, greened) | cap via lens rules |
| 2 | splitter | re-fans a received pulse even with zero payloads (§5 pool) | — |
| 2 | condenser | merges pulses within Δt into one boosted relay (§5 pool) | Δt, boost [TUNABLE] |

Ratified staging: **wave 1 ships first** (Delay/Divider/Junction — the teaching
staircase), wave 2 follows once wave 1's S4 data is green.

## Semantics (deterministic details)
- `junction`/`condenser` merge rule: emitted relay carries `hopsLeft = max(contributors) − 1`,
  `visited = union(contributors)`; contributors are consumed.
- `divider` counter resets at encounter start; `toggle` pointer likewise.
- All behaviors resolve at the relay step of REQ-0048's pulse walk; PULSE_CAP,
  visited-set and hop-budget laws are unchanged and outrank every type.
- Replay: `link_pulse` gains `via_type`; monitor draws the type icon on the linker
  cell; chimes (REQ-0059) map type → timbre.

## Schema / content
- BP instance field `linker.type` (default `"standard"`; migrateState adds it).
- Content defs `content/live/live_linker_types.json` (id, params, icon, i18n);
  vocab untouched (types are schema+content, not vocabulary).
- Dex: "Circuitry" chapter (REQ-0052 kind reserved) — one card per type, one line
  per function, composition examples.

## Pack assignment (user ruling: synergy bundles; catalog lives in REQ-0062)
- Wave-1 types headline the **Clockwork Pack**: logic-type linker BPs minted with
  chain-friendly small shapes (3–4 cells) + a spark-PO bonus slot — a pack that
  teaches Spark → Divider → payload by construction.
- Wave-2: `amplifier`/`splitter`/`condenser` seed the **Prism Pack** (with lenses,
  REQ-0054); `toggle`/`terminal` join Clockwork tier 2. Starter jobs stay
  linker-less (REQ-0051); Common Pack mints `standard` only.

## Test plan
- sim: per-type unit tests + composed chains (Spark→Divider→Capacitor-style once
  capacitor lands; Delay dominoes; Junction two-source AND; Toggle alternation;
  Terminal absorption), determinism goldens, merge-rule edge cases.
- engine: linker.type persistence + migrate back-compat.
- client: E2E type icons on both boards + monitor `via_type` rendering.
- S4: A4 metrics per type (amplification, cap-hit rate) before wave-2 ships.
