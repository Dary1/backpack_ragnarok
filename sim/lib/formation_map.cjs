'use strict';
// sim/lib/formation_map.cjs -- REQ-0256 implements the tick half of REQ-0258's
// IBattleInstancesFormationMap. 0258 owns the ring/geometry; 0256 owns the clock.
// tickInstances() is the FIRE phase (stable instance-index order, s10.1). tickRays()
// is a NO-OP here: rays[] is always empty in 0256 (s11), REQ-0257 fills+advances it.
// tick() is brief s4's single-map entry point (= tickInstances(); tickRays()); Battle
// calls the two PHASE methods, not tick() -- with two maps tick() cannot express the
// s12.1 all-fires-then-all-advances order (s7.1a).
class IBattleInstancesFormationMap {
  constructor(instances, binding) {
    this.instances = instances || [];
    this.rays = []; // REQ-0257 fills this; ALWAYS empty in 0256 (s11)
    // REQ-0296: side-agnostic target binding. opponents() returns the live
    // OPPOSING actor list and allies() the OWN-side actor list for THIS map's
    // instances -- the last thing fireInstanceSlot still keyed to provenance.
    // Wired by the encounter (player<->enemy) or the monster arena (enemy<->enemy).
    // Default null: an unbound map whose slot fired at a target list would throw
    // LOUD (missing wiring) rather than silently mis-target.
    this.opponents = (binding && binding.opponents) || null;
    this.allies = (binding && binding.allies) || null;
  }
  tickInstances() {
    for (const inst of this.instances) { // stable instance index order (s10.1)
      if (inst.alive) inst.tick();
    }
  }
  tickRays() { /* REQ-0257 s12.1. Empty rays[] in 0256 -> no-op. */ }
  tick() { this.tickInstances(); this.tickRays(); } // brief s4's single-map entry point
}

function createFormationMap({ instances, opponents, allies }) {
  return new IBattleInstancesFormationMap(instances || [], { opponents, allies });
}

module.exports = { createFormationMap, IBattleInstancesFormationMap };
