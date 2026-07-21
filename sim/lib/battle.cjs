'use strict';
// sim/lib/battle.cjs -- REQ-0256. The Battle object (spec b/c, brief s4) + the
// IBattleInstance whose tick() is the SOLE instance-fire walk (s15.13). Battle holds
// the two IBattleInstancesFormationMaps and OWNS the clock: tickIndex is THE integer
// tick counter (s10.3); t() === tickIndex * TICK_SECS, COMPUTED never accumulated.
// tick() is the s7.1a chain: player then enemy FIRES (phase A), then player then enemy
// RAY ADVANCES (phase B). modeConfig is RESERVED here (null); REQ-0259 populates it and
// is the only REQ that reads it. Battle is a VALUE runEncounter DRIVES; it is NOT the
// home of the loop (s7.0).
const { TUNABLES } = require('./core.cjs');

// IBattleInstance: ONE per BP (player) or per enemy/entity. cooldownSkills is the FLAT
// TIMED-FIRE map (s8.4) fusing POs + SIs + Unit effects (player) or e.raw.skills (enemy)
// -- "same interface, different provenance". The fire + rollCooldownTicks closures are
// attached by Battle (below), so tick() -- and NOTHING else -- walks the slots (s15.13).
class IBattleInstance {
  constructor(spec) {
    this.id = spec.id;
    this.kind = spec.kind;                    // 'bp' | 'enemy' | 'gimic' (s8.3; 'gimic' is REQ-0259)
    this.squadSlot = spec.squadSlot != null ? spec.squadSlot : null; // player side only
    this.fieldCells = spec.fieldCells || [];
    this.hp = spec.hp;
    this.hpMax = spec.hpMax;
    this.mode = spec.mode || 'battle';        // DECLARED here, USED by REQ-0259 (s8.3)
    this.statusBag = spec.statusBag || null;
    this.cooldownSkills = spec.cooldownSkills; // Map<int, { skill, remainingTicks, ...provenance }>
    // enemy-side provenance handles (s8.4 "different provenance"): the compiled
    // pack actor pair. null on the player side.
    this.raw = spec.raw || null;
    this.actor = spec.actor || null;
    // alive: player BPs keep firing regardless of their own death until the whole troop
    // is wiped (preserves the heap model's reschedule-regardless behaviour); enemies stop
    // the tick they die. A live view, so map.tickInstances() sees the current truth.
    this._aliveFn = spec.aliveFn || (() => spec.alive !== false);
    this.fire = null;             // attached by Battle (s7.0 closure over runEncounter scope)
    this.rollCooldownTicks = null; // attached by Battle
  }
  get alive() { return this._aliveFn(); }
  // s7.1a / s8.5: decrement, fire, RESET -- in insertion (slot) order. THE only fire walk.
  tick() {
    for (const cd of this.cooldownSkills.values()) { // insertion order = slot order (s8.4)
      cd.remainingTicks -= 1;
      if (cd.remainingTicks > 0) continue;
      this.fire(this, cd);                              // existing fire bodies, unchanged (s7.0)
      cd.remainingTicks = this.rollCooldownTicks(this, cd); // s8.5 RESET
    }
  }
  // REQ-0256 s8.5: the advance_cooldown charge verb's tick-model substrate. The
  // heap version mutated scheduled skill_fire events in place (never before NOW);
  // this pulls every slot's remainingTicks down, FLOORED AT 1 -- never fire THIS
  // tick from an advance (s9.2). Infinity (mode-filtered, never-scheduled) slots
  // stay Infinity. NOT the same rule as the heap's: a real behaviour change on
  // charge-bearing content (42/54 live units) -- covered by
  // unit_charge_encounter_test.cjs, NOT by the goldens (s8.5: no golden builds a
  // chargeMgr).
  advanceCooldownTicks(dTicks) {
    for (const cd of this.cooldownSkills.values()) {
      cd.remainingTicks = Math.max(1, cd.remainingTicks - dTicks);
    }
  }
}

function createBattle(opts) { return new Battle(opts); }

class Battle {
  constructor({ playerMap, enemyMap, modeConfig, fire, rollCooldownTicks }) {
    this.playerMap = playerMap;
    this.enemyMap = enemyMap;
    this.modeConfig = modeConfig != null ? modeConfig : null; // s7.0 RESERVED; REQ-0259 populates
    this.tickIndex = 0;                                        // THE clock (s10.3)
    for (const inst of this.playerMap.instances) { inst.fire = fire; inst.rollCooldownTicks = rollCooldownTicks; }
    for (const inst of this.enemyMap.instances) { inst.fire = fire; inst.rollCooldownTicks = rollCooldownTicks; }
  }
  t() { return this.tickIndex * TUNABLES.TICK_SECS; } // COMPUTED, never accumulated (s10.3)
  // s8.5: the initial roll at battle start -- replaces the heap model's initial
  // scheduleEffect walk. rollInitialTicks(inst, cd) returns int ticks, or
  // Infinity for a slot the encounter mode filters out (the heap model simply
  // never scheduled those; Infinity decrements to Infinity, so they never fire).
  initCooldowns(rollInitialTicks) {
    for (const map of [this.playerMap, this.enemyMap]) {
      for (const inst of map.instances) {
        for (const cd of inst.cooldownSkills.values()) {
          cd.remainingTicks = rollInitialTicks(inst, cd);
        }
      }
    }
  }
  tick() {
    this.playerMap.tickInstances();
    this.enemyMap.tickInstances();
    this.playerMap.tickRays();
    this.enemyMap.tickRays();
  }
}

module.exports = { createBattle, Battle, IBattleInstance };
