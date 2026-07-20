'use strict';
// sim/lib/formation_map.cjs -- REQ-0256 implements the tick half of REQ-0258's
// IBattleInstancesFormationMap. 0258 owns the ring/geometry; 0256 owns the clock.
// tickInstances() is the FIRE phase (stable instance-index order, s10.1). tickRays()
// is a NO-OP here: rays[] is always empty in 0256 (s11), REQ-0257 fills+advances it.
// tick() is brief s4's single-map entry point (= tickInstances(); tickRays()); Battle
// calls the two PHASE methods, not tick() -- with two maps tick() cannot express the
// s12.1 all-fires-then-all-advances order (s7.1a).
class IBattleInstancesFormationMap {
  constructor(instances) {
    this.instances = instances || [];
    this.rays = []; // REQ-0257 fills this; ALWAYS empty in 0256 (s11)
  }
  tickInstances() {
    for (const inst of this.instances) { // stable instance index order (s10.1)
      if (inst.alive) inst.tick();
    }
  }
  tickRays() { /* REQ-0257 s12.1. Empty rays[] in 0256 -> no-op. */ }
  tick() { this.tickInstances(); this.tickRays(); } // brief s4's single-map entry point
}

function createFormationMap({ instances }) {
  return new IBattleInstancesFormationMap(instances || []);
}

module.exports = { createFormationMap, IBattleInstancesFormationMap };
