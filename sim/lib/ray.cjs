'use strict';
// sim/lib/ray.cjs -- REQ-0047 (d): walkRay -- the verbatim S3 ray-resolution pseudocode implementation.
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).
const { TUNABLES } = require('./core.cjs');
const { reflectDir, stepCell, outside, mult } = require('./geometry.cjs');

function walkRay(opts) {
  const {
    field, entryCell, dir, mode, penetration, aoe, aoeStatuses,
    bounceBudget, dealHitFn, splashFn, liveOccupantFn, isDestroyedPassable,
  } = opts;
  const ROWS = field.ROWS, COLS = field.COLS;
  const events = [];
  let cell = entryCell.slice();
  let curDir = dir;
  let bounces = 0;
  let passed = 0;
  let steps = 0;
  let landing = null;
  let aborted = false;

  const pathBatch = [];
  function flushSteps() {
    if (pathBatch.length > 0) {
      events.push({ ev: 'ray_step', path: pathBatch.slice() });
      pathBatch.length = 0;
    }
  }

  for (;;) {
    steps++;
    if (steps > TUNABLES.RAY_STEP_BUDGET) {
      aborted = true;
      events.push({ ev: 'ray_abort', reason: 'step_budget_exhausted', steps });
      break;
    }
    const next = stepCell(cell, curDir);
    if (outside(next, ROWS, COLS)) {
      flushSteps();
      const newDir = reflectDir(curDir, next[0], next[1], ROWS, COLS);
      bounces++;
      events.push({ ev: 'ray_bounce', at: next.slice(), new_dir: newDir, bounce: bounces });
      curDir = newDir;
      // stay at the last IN-FIELD cell (do not move into the out-of-bounds cell)
      if (mode === 'detection') {
        if (bounces > bounceBudget) {
          events.push({ ev: 'ray_end', reason: 'bounce_budget_exhausted' });
          return { events, landing: null, discovered: false, aborted };
        }
        continue; // no scaling; a hit is a find, not damage
      }
      if (bounces === 5) {
        // battle/unlock only: strike ALL live occupants at mult(5), then
        // aoe still splashes per S3.4 at last in-field cell, then return.
        const allHits = dealHitFn(null, mult(5), { allField: true });
        events.push({ ev: 'ray_hit_all', bounce_mult: mult(5), hits: allHits });
        landing = cell.slice();
        if (aoe > 0) {
          const splashHits = splashFn(landing, aoe, mult(5), aoeStatuses);
          events.push({ ev: 'ray_aoe', center: landing, radius: aoe, hits: splashHits });
        }
        return { events, landing, discovered: false, aborted, bounces };
      }
      continue; // reflection does NOT consume pen
    }
    cell = next;
    pathBatch.push(cell.slice());
    const occ = liveOccupantFn(cell);
    if (occ == null) continue; // empty / destroyed = passable
    flushSteps();
    const hitResult = dealHitFn(occ, mult(bounces), { allField: false });
    events.push(Object.assign({ ev: 'ray_hit', dst: hitResult.dstLabel, amount: hitResult.amount, bounce_mult: mult(bounces), hp_after: hitResult.hpAfter }, hitResult.ident || {})); // REQ-0355: + slot/bpIdx on player targets
    if (mode === 'detection' && hitResult.isDiscovery) {
      return { events, landing: cell.slice(), discovered: true, aborted, bounces };
    }
    if (passed < penetration) { passed++; continue; }
    landing = cell.slice();
    break;
  }
  flushSteps();
  if (landing && aoe > 0) {
    const splashHits = splashFn(landing, aoe, mult(bounces), aoeStatuses);
    events.push({ ev: 'ray_aoe', center: landing, radius: aoe, hits: splashHits });
  }
  return { events, landing, discovered: false, aborted, bounces };
}

function chebyshevDist(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

// =====================================================================
// Field / occupancy helpers -- two independent A1:Z18 planes (S2.1).
// =====================================================================

module.exports = {
  walkRay,
  chebyshevDist,
};
