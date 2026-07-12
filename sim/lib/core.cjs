'use strict';
// sim/lib/core.cjs -- REQ-0047 (d): tunables table + deepCopy (the compile-boundary copy discipline).
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).


function deepCopy(x) { return JSON.parse(JSON.stringify(x)); }

const TUNABLES = {
  // S2.3: "capped by a [TUNABLE step budget = 512] total steps as
  // determinism/DoS guard, logging ray_abort."
  RAY_STEP_BUDGET: 512,

  // S4.3 step 4: "Base segment: center a segment of half-width J
  // [TUNABLE J=2 cells] on base coordinate, clamped to edge's valid range."
  ENTRY_JITTER_HALF_WIDTH: 2,

  // S4.5: "Monitor display derives it from the NEXT SCHEDULED SKILL: ...
  // at a fixed lead L [TUNABLE L=0.6s] before it fires."
  TELEGRAPH_LEAD_SECS: 0.6,

  // S4.6: "Pack rarity (common/magic/rare, [TUNABLE weights common .7/
  // magic .25/rare .05])"
  PACK_RARITY_WEIGHTS: { common: 0.70, magic: 0.25, rare: 0.05 },

  // S7 table: "Burn ... -1 stack per period P [TUNABLE P=1.0s]" (also
  // shared by Poison/Chill/Regen per the table's "same P" / "-1/P" cells).
  STATUS_TICK_PERIOD_SECS: 1.0,

  // S7 table: "Chill ... stacks add, cap C [TUNABLE C=10]"
  CHILL_STACK_CAP: 10,

  // S7 table: "Chill ... slows target's action cadence by stacks x s%
  // [TUNABLE 4%/stack]"
  CHILL_PCT_PER_STACK: 0.04,

  // S7 table: "Haste ... speeds owner's every_secs cadence by stacks x s%
  // [TUNABLE 4%/stack] (dual of Chill)"
  HASTE_PCT_PER_STACK: 0.04,

  // S7 table: "Weakness ... target deals -X% dmg per stack [TUNABLE 5%/stack]"
  WEAKNESS_PCT_PER_STACK: 0.05,

  // S8.3: "solved hidden door applies +J% [TUNABLE J=15-25%]". Spec gives a
  // range not a point value; ranged tunables elsewhere in the spec (every
  // [lo,hi] authored range) are resolved via the seeded RNG at the moment
  // they're used, so for consistency we keep this as a [lo,hi] range too
  // and roll it from the "shortcut" sub-stream rather than picking one
  // fixed number. See sim/README.md Interpretations for this choice.
  SHORTCUT_JUMP_PCT_RANGE: [15, 25],

  // S8.5: "Wipe (all BPs of all 4 Squads downed): L <- max(L_min, L -
  // failure_step); ... (all constants TUNABLE, failure_step default 1)"
  FAILURE_STEP: 1,
  LEVEL_MIN: 1,

  // S8.5: "spec gives no numbers, only the formula shape" for CD_min/CD_max.
  // PLACEHOLDER values, flagged as a documented interpretation (see
  // sim/README.md): 60s minimum cooldown (full-HP clear), 600s maximum
  // (wipe-equivalent, H=0).
  CD_MIN_SECS: 60,
  CD_MAX_SECS: 600,

  // S4.6: "Pack budget: Sigma(per-enemy hp-weight x rarityMult) bounded per
  // encounter difficulty so packs scale with sortie level [TUNABLE]" --
  // spec gives no formula, only "bounded per encounter difficulty". This
  // implementation invents a simple linear scaling by dungeon level,
  // flagged as an interpretation in sim/README.md: budget(level) =
  // PACK_BUDGET_BASE + PACK_BUDGET_PER_LEVEL * (level-1).
  PACK_BUDGET_BASE: 100,
  PACK_BUDGET_PER_LEVEL: 15,

  // S8.1: "Each cleared encounter grants Delta% from its def [TUNABLE];
  // schedule sums a clean run to 100%." Spec gives no numbers. This
  // implementation's scheme (flagged as an interpretation in
  // sim/README.md): even split of 100% across the generated encounter
  // list length, EXCLUDING the boss (boss is "pinned at 100%" per S8.2,
  // i.e. it is the entry that brings progress to exactly 100).
  // See computeEncounterDeltas() below for the exact algorithm.

  // REQ-0042: LRDST (Transmutator currency) drop range per cleared
  // encounter -- uniform-random within range, matching
  // distributeRewardsUniform's own uniform-random reward-distribution
  // shape (no existing reward roll in this file uses a different
  // distribution, so uniform is the consistent choice here too, per the
  // REQ's own "uniform is fine unless existing reward rolls use a
  // different distribution shape" guidance). Non-boss encounters roll
  // LOW (a small trickle per room cleared); the boss (the "clear the
  // dungeon" capstone encounter) rolls the HIGH range as a larger
  // lump-sum finishing bonus.
  LRDST_DROP_NON_BOSS_RANGE: [1, 3],
  LRDST_DROP_BOSS_RANGE: [5, 10],

  // REQ-0048: Linker Combat Effects v1 -- Pulse + Resonance tunables.
  PULSE_HOP_BUDGET: 3,           // max edges one pulse traverses (spec H=3)
  PULSE_HOP_LATENCY_SECS: 0.15,  // deterministic per-hop travel delay
  PULSE_CAP_PER_SEC: 2,          // per-origin-linker emission rate cap
  MUTUAL_RESONANCE_MULT: 1.5,    // mutual-pair resonance contribution multiplier
};

// =====================================================================
// Seeded RNG -- named sub-streams (S1.2).
// djb2 string hash -> 32-bit seed -> mulberry32 PRNG. Deterministic per
// (masterSeed, streamName) pair; independent streams never share mutable
// counters (each stream gets its OWN mulberry32 state seeded from the
// hash of masterSeed+"|"+streamName), so unrelated rolls can never desync
// each other even though they all trace back to one master seed.
// NOT cryptographic -- documented as acceptable per S1.2 (OQ1: no
// cross-platform bit-identical replay requirement, server-only sim).
// =====================================================================

module.exports = {
  deepCopy,
  TUNABLES,
};
