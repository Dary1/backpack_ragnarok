> [Board triage 2026-07-12, integration owner] todo -> draft: blocked on REQ-0128 geometry rulings (Weathervane shuffles a Unit beam; beam/connection semantics under re-ruling). Re-ratify numbers after 0128.

> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0053 — Economy v1: Weathervane rename + TM roster + numbers

- **Status**: PARTIALLY RATIFIED (2026-07-06): economy.md population approved;
  naming delegated to orchestrator (done, §1); roster/numbers below are the volatile
  layer the user ordered kept OUT of economy.md — each item marked [USER]/[TUNABLE]
  accordingly. Implementation QUEUED.
- Standing rule from the same ruling: **economy.md holds only change-resistant
  principles; anything spec-fragile lives in REQs** (this one and successors).

## §1 LRDST → **Weathervane** (rename, user-delegated, DECIDED)
- User clarification (2026-07-06): LRDST = **L**inker**R**andom**D**irection**S**huffle
  **T**ransmutator — its true function is to RANDOMLY SHUFFLE a Unit's beam
  directions. It is not a generic shard.
- New codename: **Weathervane** (`weathervane`, ja 風見鶏) — an instrument that spins
  with the wind and settles pointing somewhere new; reads instantly as "reroll the
  compass". Fits the plain-name art rule and the existing tool-name register
  (Chisel/File/Resin). Runners-up recorded: Windrose, Gyre.
- **Function (crafting use, 1×)**: apply to an owned BP with a Unit → server-seeded
  reroll of its beam directions. [ORCH default, USER-vetoable]: direction COUNT is
  preserved, directions rerolled (bounded gambling); alternative = full reroll
  including count.
- **Dual use retained** (glossary canon: "currency doubling as crafting material"):
  10× → Common BP gacha, unchanged (REQ-0042).
- **Migration** (recommended: full id migration now — exactly 1 TM live, tiny
  playerbase; display-only rename kept as documented fallback):
  content/live/live_tms.json id+i18n; sprite symbol `icon-lrdst` → `icon-weathervane`
  (SVG symbol rename, sprite v11→v12 per never-overwrite rule; art itself may be
  redrawn later via S5, user-gated, not blocking); server guest-seed / dev-grant /
  reward tables (`sim/combat.cjs` tunables, `schedule.cjs`); client i18n keys;
  profile + warehouse data migration (tm records, migrateState pattern + a
  `tools/migrate_*` script per house precedent); all test fixtures.

## §2 TM roster v1 (volatile; [USER] to bless the set)
| id | name | function | sink shape |
|---|---|---|---|
| weathervane | Weathervane | reroll Unit beam directions (§1); 10× = BP gacha | gambling repeats; gacha |
| chisel | Chisel | +1 cell to an owned BP shape (must be edge-adjacent, cap [TUNABLE 12 cells]) | cost scales with current cell count [TUNABLE curve] — big-BP hunger mirrors the One-Unit tension |
| file | File | −1 cell from an owned BP (refused if the cell is occupied, would disconnect the shape, or would strand the Unit cell) | cheap, enables re-sculpting |
| resin | Resin | +hpMax on a BP, diminishing per application, cap [TUNABLE] | long-tail permanent sink |
- Requires `hpMax` redefinition: `hpMax = 15 × cells + resinBonus` (engine/gacha/
  schedule touch; REQ-0051's starter override uses the same authored-override seam).
- **Tuner (move Unit cell) deliberately DEFERRED** — full unit control too early
  would kill Weathervane's gambling value; revisit with Unit types (REQ-0048 §5.6).
- Drop sources: chest attachments are TM-weighted (REQ-0049) [TUNABLE mix]; deeper
  levels unlock rarer TMs.

## §3 Live numbers — baseline & bands (all [TUNABLE], monitored by S4-E1)
- Weathervane faucet: 1–3 non-boss / 5–10 boss (existing) — keep until S4-E1 data.
- Guest seed: 100× (existing) ≈ 10 gacha pulls — generous by design during friends
  alpha; revisit with REQ-0051 (starter jobs absorb the on-ramp job the seed was
  implicitly doing).
- Gacha price: 10× (existing).
- Steady-state invariant target: **sinks ≥ 70% of faucet volume** (S4-E1 warn band);
  no dynamic pricing ever — the cooldown H-curve is the natural throughput governor
  (worse play = slower economy), a property worth protecting.
- Warehouse: 200 cap / 7-day TTL unchanged HERE, but flagged: the TTL is the one
  appointment-pressure mechanic in the game — candidate for revisit under the
  2026-07-06 retention ruling [USER].

## §4 Market (P3 scope sketch) — CONCRETIZED by REQ-0064 (market screen draft,
2026-07-06; mock resolves the tax band to 8%). REQ-0064 rules where they differ.
- **TM-barter, no gold**: listings priced in TM mixes (PoE lesson — currency with
  use-value resists inflation and needs no auction-house price oracle).
- Async player shops: list → browse (Dex-integrated per-item listing tab, via
  REQ-0052's card surface) → buy; listing TTL 7 days (mirrors warehouse).
- **Burn tax [USER: 5–10%]** on every trade, paid in Weathervane, destroyed — the
  inflation valve.
- **Deploy-exclusion**: a deployed item cannot be listed (same uid-set gate as the
  deploy path — REQ-0045 deployedUidSetsForGate pattern).
- Gifts between members of the same settled run are untaxed [ORCH, vetoable] —
  rewards co-play; revisit at global scope (friends scope first, per auth reality).
- Positioning (principles layer, also in economy.md): trade is the social insurance
  for uniform-random reward distribution.

## §5 [USER] decision list
1. Bless TM roster v1 (§2) and Weathervane reroll semantics (count-preserving vs full).
2. Migration path: full id migration (recommended) vs display-only.
3. Market burn tax rate band; gift-untaxed rule.
4. Warehouse TTL stance under the retention ruling.
5. Guest seed size once starter jobs land.

## Test plan (gates before DONE, per phase)
- Rename: migration script dry-run parity (files+pg), sprite check 22/22 with new
  symbol, all suites green post-rename, live page 200.
- TM ops: engine shape-edit legality (adjacency/disconnect/unit-strand refusals),
  server op endpoints + atomicity, E2E chisel/file/resin/weathervane flows,
  determinism of seeded rerolls, S4-E2 gacha audit re-run after hpMax redefinition.
