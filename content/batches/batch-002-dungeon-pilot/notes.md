# Batch-002 — Niflheim Depths (dungeon pilot) — Design Notes

## Pipeline stage reached

**S1-lite, hand-authored.** This batch has NOT been run through S2-S7 of
the content pipeline (no `tool_validate.cjs` pass — that tool doesn't
exist yet, see `tools/self_test_vocab.cjs`'s own header note; no S5 icon
art; no S7 user review). It is staged under
`content/batches/batch-002-dungeon-pilot/` and is deliberately **not**
registered in `content/registry.json` (that file only gets entries after
real S2-S7 gates, per the content pipeline convention established by
batch-001) and does **not** touch `content/live/*`.

Flagged for future work:
- **S2 gate**: once `tool_validate.cjs` exists, this batch's enemy/skill/
  entity/formation/dungeon defs should be run through it (today there is
  no schema validator at all for these NEW schema kinds — only PO/SI
  validation was ever scoped for `tool_validate.cjs`, so a dungeon-content
  validator is itself new work, likely P1-B territory).
- **S5 icon art**: `lockpick` and `spyglass` carry placeholder icon refs
  (`icon-placeholder-lockpick`, `icon-placeholder-spyglass`) — NOT final
  art. Real art comes later via the S5 icon pipeline (fit-checked,
  contact-sheet-reviewed, same as batch-001's items were).
- **S7 user review**: this batch has not been shown to the user for
  approval/rejection the way batch-001 was (`awaiting_user_review` in
  registry.json). It exists purely to give `sim/tests/run.cjs`'s
  full-dungeon smoke test real, coherent content to run against.

## Family identity / theme

**Niflheim Depths** continues batch-001's Frost family into a monster/
dungeon setting — the same "arrangement tax" cold theme, now expressed as
enemy skills (Chill/Weakness/Stun-inflicting attacks) and a Frost-coded
dungeon (frost gnolls, ice archers, a rime shaman, a frostback bear, a
niflheim stalker, and a frost-elemental wisp), capped by a named boss,
Hrimgrimnir the Frost-Masked. The two pilot player items (lockpick,
spyglass) are also Frost/relic-flavored so they read as belonging to the
same world, even though their mechanical purpose (demonstrating
`modes:["unlock"]` / `modes:["detection"]`) is orthogonal to the Frost
family's damage identity.

## Per-entry notes

### Enemies

**frost_gnoll** (common, 1x1, pack_role: line). Intent: the pack's basic
melee attacker — `gnoll_claw` is a plain front-edge, no-penetration,
no-aoe strike. Puzzle/hook: establishes the "default" enemy shape so the
more exotic skills below read as deliberate variation, not noise.

**ice_archer** (common, 1x1, pack_role: line). Intent: the pack's ranged
threat — `ice_arrow` uses `edge:["left","right"], direction:"side"` per
ruling 7's bow-type convention (typically penetration:0). Hook: forces
the player's formation choice to matter, since side-entry rays land on
different units than top-entry ones (formation1's documented "side-entry
rays hit backline first" behavior, S5.2).

**rime_shaman** (common, 1x1, pack_role: support). Intent: a pure support
— `chilling_word` (Chill applier with `aoe_statuses:true` so its splash
also chills) and `frost_ward` (a weak filler strike so the shaman isn't
totally inert between Chill casts). Puzzle/hook: demonstrates a
skill-only-support enemy archetype (S4.6: "support (0..1, buffs pack)" —
here realized as pure debuff support rather than a buff-the-pack effect,
since v1's vocab has no "buff enemy pack" verb; Chill-the-player-side is
this dungeon's analogous "support" contribution).

**frostback_bear** (common, 2x2 footprint, pack_role: anchor). Intent:
the pack's tanky anchor — bigger footprint, higher HP range, `bear_slam`
(penetration:1, aoe:1) and `frost_roar` (a wide 3-edge AOE Weakness
debuff). Hook: demonstrates a non-1x1 enemy footprint and an
attack_profile with BOTH penetration and aoe set.

**glacier_wisp** (common, 1x1, pack_role: line). Intent: a fast, weak
multi-hit striker — `wisp_bolt` is a `multi_strike` (3 sub-hits) fired
from the side, demonstrating OQ19's per-sub-hit `on_hit` semantics in a
real enemy kit (each of the 3 hits is independently rollable and could in
principle each proc a stacking status, though this particular skill
doesn't carry one).

**niflheim_stalker** (common, 1x1, pack_role: line). Intent: a
bottom-edge attacker (`stalker_pounce`, penetration:2) plus a Burn-bite
DoT (`stalker_bleed_bite`). Hook: `edge:["bottom"]` demonstrates the
less-common bottom-entry direction fan (up-right/up-left per S2.2),
exercised nowhere else in this enemy roster.

**hrimgrimnir** (rare, 3x3 footprint, pack_role: boss). Intent: the
dungeon's hand-authored boss (per OQ18 LOCKED: bosses are hand-authored,
not a rarity roll) — three signature skills: `hrim_cleave` (heavy
front-edge strike with both penetration and aoe), `hrim_blizzard_volley`
(a 3-edge multi_strike AOE volley), and `hrim_deep_freeze` (a Stun
applier, penetration:1). Puzzle/hook: the Stun skill is the one place in
this dungeon where the Stun status is exercised by a monster, giving the
sim test suite's Stun-suspend-but-DoTs-keep-ticking assertion (S7 rule 4)
real content to point at.

### Trap / Door / Chest

**trap_frost_deadfall** (detection mode, 1x1, masked). Intent: a small,
hard-to-find hazard. Win = a detection-mode PO's ray finds it
(`discovery`) before `timeout_secs=18`; on timeout it fires
`trap_deadfall_volley` once (a wide 4-edge AOE battle-style volley on the
player field) then the encounter ends with no disarm step, exactly per
the S6 encounter table.

**door_rimefast_stage1 / door_rimefast_stage2** (two-stage chain per S6).
Stage1 is a masked 1x1 detection target (`timeout_secs=20`); once
discovered, stage2 (a revealed 2x2 unlock-mode entity with 60 HP and its
own `door_keeper_strike` skill, `timeout_secs=25`) becomes active. Clearing
stage2 before its timeout applies the S8.3 shortcut jump; timing out
stage2 is the "keyhole breaks" forced-end path (no shortcut, run
continues). NOTE: in this pilot's `batch002_dungeon.json`, stage1 and
stage2 are modeled as two SEPARATE encounter-list entries
(`enc_door_1_stage1`, `enc_door_1_stage2`) run back-to-back, since P1-A's
`sim/combat.cjs` runs one encounter at a time via `runEncounter` and
doesn't yet have its own two-stage-chain orchestration primitive inside a
single encounter call — chaining two `runEncounter` calls is a
documented, reasonable simplification for the pilot; a real two-stage
single-encounter object (so a party can't "walk away" between stages) is
left as a P1-B schedule-service concern.

**chest_frostbound_cache** (unlock mode, 2x2, at enemy-field center per
S6.2). Intent: a straightforward HP-race reward chest, 40 HP,
`timeout_secs=22`, no offensive skills (chests don't fight back). Reward
roll on clear; lost with no penalty on timeout.

### Pilot player items

**lockpick** (`modes:["unlock"]`, 1x1, Common, Relic tag). Intent:
demonstrate a non-battle-mode PO whose `every_secs` schedule only fires
during `unlock`-mode encounters (chests, door stage2) and stays paused
(no backlog) during `battle`/`detection` encounters. Its own attack is a
plain front-edge strike — flavorful as "picking" a lock/chest's HP down
rather than combat damage, mechanically identical to any other strike
verb usage. 1x1 shape justified the same way `hilt`/`blade` are in
`live_items.json`: a `part:{assembles:'na',role:'na'}` marker exempts it
from the 1x1 scarcity rule as a standalone utility item, NOT a bare
scarcity violator (batch-001's `frost_bead` was the deliberate violator
for that batch; this batch has no violator, per the task brief's
instruction that batch-002 doesn't need one).

**spyglass** (`modes:["detection"]`, 2-cell domino, Common, Frost/Rune
tags). Intent: demonstrate a detection-mode PO with an elevated
`bounce_budget:4` (detection-mode rays get a per-PO bounce budget instead
of the global 5-bounce battle terminator, per S2.2) — a slightly
"farther-searching" detection tool. Flavor ties it to the Frost family
(frosted lens revealing hidden things) so it reads as native to this
dungeon's world even though mechanically it's mode-orthogonal.

## Reward placeholders

`reward_frost_shard_common`, `reward_frost_shard_uncommon`,
`reward_frostbound_cache_roll`, `reward_boss_relic_roll` referenced in
`batch002_dungeon.json`'s `rewardItems` are bare string ids, not full
item defs — this pilot's `sim/tests/run.cjs` full-dungeon smoke test only
needs `runDungeon`'s reward-distribution mechanism (uniform-random
per-item assignment to a participant, landing in the abstract
`'warehouse'` destination) to be exercised, not real reward-table
resolution. Real reward-table content (rolling these placeholder ids into
actual item/gold/currency grants) is out of scope for P1-A and left for
P1-B's schedule-service work.

## Level scaling

`batch002_dungeon.json`'s `level_scaling` block documents the chosen
scaling knob: `packBudgetForLevel(level)` in `sim/combat.cjs`
(`PACK_BUDGET_BASE + PACK_BUDGET_PER_LEVEL*(level-1)`, a documented
interpretation per `sim/README.md` since S4.6 gives no formula). The enemy
HP ranges authored in `batch002_enemies.json` are the level-1 baseline;
this pilot's smoke test runs at a fixed level and does not exercise a
level-scaled HP/skill-cadence multiplier pipeline — that's flagged as
future work alongside the S2 validator gate.
