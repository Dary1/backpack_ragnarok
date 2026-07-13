// shared/forecast.mjs -- REQ-0057 Ray Forecast Overlay ("weather map").
//
// THE forecast fold: a dependency-free, deterministic, side-effect-free
// geometry pass that answers "how much incoming ray damage would a backpack
// occupying cell (r,c) expect to eat, per second, in this dungeon?".
//
// Consumed by BOTH:
//   - the client (client/src/forecast/* -- ESM import, Vite)
//   - node      (sim/tests/forecast_parity.cjs -- dynamic import)
// ...so the walker the overlay draws IS the walker the parity test proves
// equivalent to sim/lib/ray.cjs's walkRay. Per shared/README.md this module
// may NOT import from server/, sim/, client/ or mock-src/ -- every constant
// it needs is re-declared here and PINNED to its sim twin by
// sim/tests/forecast_parity.cjs (which asserts the numbers still match sim's
// TUNABLES, so a sim-side tunable change fails the gate instead of silently
// desyncing the forecast).
//
// ---------------------------------------------------------------------
// Ratified design (REQ-0057) + the interpretations this file makes
// ---------------------------------------------------------------------
// (1) NO statuses, NO timing, NO HP: "a pure geometry fold" (REQ-0057
//     Design/Computation). Weakness/Chill/damage_reduction/Spikes are all
//     out of scope by spec -- the forecast is a placement tool, not a sim.
// (2) EXPECTED damage, not a roll: a verb's [lo,hi] range folds to its
//     midpoint; a skill's every_secs [lo,hi] cadence folds to 1/midpoint
//     fires per second. The output unit is therefore expected incoming
//     damage per second (DPS) on that cell.
// (3) The RNG is MARGINALISED ANALYTICALLY, not sampled. sim's
//     selectEntryCell() makes exactly three ray-stream draws -- the edge
//     (uniform over attack_profile.edge), the entry jitter
//     (Math.round((u*2-1)*J)), and, on a 2-direction edge (top/bottom), the
//     diagonal (uniform). Each has a closed-form discrete distribution (see
//     jitterWeights() for the jitter one), so the fold enumerates every
//     outcome with its exact probability instead of Monte-Carlo sampling it:
//     deterministic, and exact rather than noisy.
// (4) PER-CELL COUNTERFACTUAL ATTRIBUTION. sim's walkRay deals damage to an
//     OCCUPANT (a whole BP), not to a cell. The overlay's question runs the
//     other way -- "what would a BP placed HERE eat?" -- so every in-field
//     cell the ray ENTERS is credited with the hit it would have taken
//     there, at the bounce multiplier in force at that moment. Occupied
//     cells (the BPs already on the board) still block / consume penetration
//     / land the ray exactly as in the sim, so the map also shows the shadow
//     your existing backpacks cast. The one place the approximation shows:
//     sim excludes the LANDING OCCUPANT (all of its cells) from its own AOE
//     splash ("landing occupant NOT double-hit", S3.4); cell-wise we can only
//     exclude the LANDING CELL, because a would-be occupant's footprint is
//     unknown. Deliberate, documented, and asserted in the parity test.
// (5) The 5-bounce all-field terminator (sim's ray_hit_all) strikes EVERY
//     live occupant, so it credits every cell of the field uniformly -- a
//     flat background term in the map, never a hot spot.
// (6) FORECAST != SPOILER. This module never sees a run's hidden placements:
//     its inputs are enemy DEFs folded to attack profiles (see
//     server/lib/forecast.cjs), exactly as REQ-0057 requires.
// (7) NOT A PROMISE. The result is a DISTRIBUTION (jitter, pack variance).
//     Callers must label it "expected pressure" -- never "safe"/"unsafe".

// ---------------------------------------------------------------------
// Constants (mirrors of sim/lib/{core,field}.cjs -- pinned by the parity
// test; see the header note on why they are re-declared, not imported).
// ---------------------------------------------------------------------

/** sim/lib/field.cjs FIELD_ROWS. */
export const FIELD_ROWS = 18;
/** sim/lib/field.cjs FIELD_COLS. */
export const FIELD_COLS = 26;
/** sim TUNABLES.RAY_STEP_BUDGET (S2.3 determinism/DoS guard). */
export const RAY_STEP_BUDGET = 512;
/** sim TUNABLES.ENTRY_JITTER_HALF_WIDTH (S4.3 step 4, J=2). */
export const ENTRY_JITTER_HALF_WIDTH = 2;

// ---------------------------------------------------------------------
// Ray geometry -- VERBATIM ports of sim/lib/geometry.cjs. Any edit here is
// a parity-test failure by construction.
// ---------------------------------------------------------------------

/** @type {Record<string, [number, number]>} */
export const DIR_VEC = {
  DR: [1, 1], DL: [1, -1], UR: [-1, 1], UL: [-1, -1],
};

/** Edge -> its fixed diagonal direction(s) per S2.2. */
export const EDGE_DIRS = {
  top: ['DL', 'DR'],
  left: ['DR'],
  right: ['DL'],
  bottom: ['UR', 'UL'],
};

export function reflectDir(dirName, hitRow, hitCol, ROWS, COLS) {
  let [dr, dc] = DIR_VEC[dirName];
  const hitRowBound = (hitRow < 1 || hitRow > ROWS);
  const hitColBound = (hitCol < 1 || hitCol > COLS);
  if (hitRowBound) dr = -dr;
  if (hitColBound) dc = -dc;
  for (const name of Object.keys(DIR_VEC)) {
    const v = DIR_VEC[name];
    if (v[0] === dr && v[1] === dc) return name;
  }
  return dirName;
}

export function stepCell(cell, dirName) {
  const [dr, dc] = DIR_VEC[dirName];
  return [cell[0] + dr, cell[1] + dc];
}

export function outside(cell, ROWS, COLS) {
  return cell[0] < 1 || cell[0] > ROWS || cell[1] < 1 || cell[1] > COLS;
}

/** Bounce multiplier table (S3): 1.0 (b<=2) / 1.5 (b=3) / 2.0 (b=4) / 2.5 (b>=5). */
export function mult(b) {
  if (b <= 2) return 1.0;
  if (b === 3) return 1.5;
  if (b === 4) return 2.0;
  return 2.5;
}

export function chebyshevDist(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

/** Round-half-up centroid (S4) -- VERBATIM from sim/lib/entry.cjs. */
export function centroidRoundHalfUp(cells) {
  const rSum = cells.reduce((a, c) => a + c[0], 0);
  const cSum = cells.reduce((a, c) => a + c[1], 0);
  const rAvg = rSum / cells.length, cAvg = cSum / cells.length;
  return [Math.floor(rAvg + 0.5), Math.floor(cAvg + 0.5)];
}

export function cellKey(r, c) { return r + ',' + c; }

// ---------------------------------------------------------------------
// walkRayPath -- the forecast's walker.
//
// Structurally identical to sim/lib/ray.cjs's walkRay in 'battle' mode: same
// loop, same step budget, same "reflection does NOT consume penetration"
// rule, same 5-bounce terminator, same "stay at the last IN-FIELD cell on a
// bounce", same "the entry cell is never itself tested for an occupant".
// walkRay's four damage/HP callbacks collapse into ONE pure predicate --
// isOccupied(r, c) -- and its event log into a plain record of where the ray
// went. Mutates nothing.
//
// The returned `path` carries the bounce multiplier IN FORCE as each cell was
// entered, which is exactly the counterfactual figure interpretation (4)
// needs ("a BP standing here eats dmg x bmult").
// ---------------------------------------------------------------------
export function walkRayPath(opts) {
  const { ROWS, COLS, entryCell, dir, penetration, aoe, isOccupied } = opts;
  const path = [];
  let cell = [entryCell[0], entryCell[1]];
  let curDir = dir;
  let bounces = 0;
  let passed = 0;
  let steps = 0;
  let landing = null;
  let aborted = false;
  let allField = false;

  for (;;) {
    steps++;
    if (steps > RAY_STEP_BUDGET) { aborted = true; break; } // sim: ray_abort
    const next = stepCell(cell, curDir);
    if (outside(next, ROWS, COLS)) {
      curDir = reflectDir(curDir, next[0], next[1], ROWS, COLS);
      bounces++;
      if (bounces === 5) {
        // sim: ray_hit_all -- strike every live occupant at mult(5); the AOE
        // still splashes from the last IN-FIELD cell (S3.4), then return.
        allField = true;
        landing = [cell[0], cell[1]];
        break;
      }
      continue; // reflection does NOT consume penetration; stay at `cell`
    }
    cell = next;
    path.push([cell[0], cell[1], mult(bounces)]);
    if (!isOccupied(cell[0], cell[1])) continue; // empty / destroyed = passable
    if (passed < penetration) { passed++; continue; }
    landing = [cell[0], cell[1]];
    break;
  }

  return {
    path,
    landing,
    bounces,
    aborted,
    allField,
    endMult: mult(bounces),
    aoe: aoe || 0,
  };
}

// ---------------------------------------------------------------------
// Entry-cell distribution -- the analytic marginalisation of
// sim/lib/entry.cjs's selectEntryCell over its three ray-stream draws.
// ---------------------------------------------------------------------

/**
 * The exact discrete distribution of sim's entry jitter:
 *   offset = Math.round((u * 2 - 1) * J),   u ~ Uniform[0, 1)
 * Let x = (2u - 1)J, uniform on [-J, J). Math.round(x) === k exactly when x
 * lands in [k - 0.5, k + 0.5), so P(k) = |[k-0.5, k+0.5) n [-J, J)| / 2J.
 * For J = 2 this gives {-2: 1/8, -1: 1/4, 0: 1/4, 1: 1/4, 2: 1/8} -- the two
 * extreme offsets are HALF as likely as the middle three, which is why a
 * naive uniform-over-offsets forecast would over-weight the fringes.
 */
export function jitterWeights(J) {
  const out = [];
  const span = 2 * J;
  for (let k = -J; k <= J; k++) {
    const lo = Math.max(k - 0.5, -J);
    const hi = Math.min(k + 0.5, J);
    const w = (hi - lo) / span;
    if (w > 0) out.push({ offset: k, weight: w });
  }
  return out;
}

/**
 * Every (edge, entry cell, direction) sim could roll for one attacker, with
 * its exact probability. Mirrors selectEntryCell()'s projection + clamp
 * arithmetic verbatim; only the three RNG draws are replaced by an
 * enumeration over their supports.
 *
 * NOTE the clamp: two different jitter offsets can clamp onto the SAME edge
 * coordinate, so entries are FOLDED by (edge, cell, dir) and their weights
 * summed -- which is precisely what the clamp does to the real distribution
 * (an attacker hugging a corner really is more likely to enter at the
 * clamped cell).
 */
export function entryDistribution(centroid, edges, bounds, J) {
  const ROWS = bounds.ROWS, COLS = bounds.COLS;
  const edgeList = (edges && edges.length) ? edges : ['top'];
  const wEdge = 1 / edgeList.length;
  const jitter = jitterWeights(J);
  const folded = new Map();

  for (const edge of edgeList) {
    const dirs = EDGE_DIRS[edge] || EDGE_DIRS.top;
    const wDir = 1 / dirs.length;
    const isRowEdge = (edge === 'left' || edge === 'right');
    const base = isRowEdge ? centroid[0] : centroid[1];
    const edgeMin = 1;
    const edgeMax = isRowEdge ? ROWS : COLS;
    const fixedCoord = (edge === 'top') ? 1
      : (edge === 'bottom') ? ROWS
        : (edge === 'left') ? 1
          : COLS;

    for (const j of jitter) {
      const coord = Math.min(edgeMax, Math.max(edgeMin, base + j.offset));
      const entryCell = isRowEdge ? [coord, fixedCoord] : [fixedCoord, coord];
      for (const dir of dirs) {
        const k = edge + '|' + entryCell[0] + ',' + entryCell[1] + '|' + dir;
        const w = wEdge * j.weight * wDir;
        const hit = folded.get(k);
        if (hit) hit.weight += w;
        else folded.set(k, { edge, entryCell, dir, weight: w });
      }
    }
  }
  return Array.from(folded.values());
}

// ---------------------------------------------------------------------
// Skill-profile folding: a content def -> expected-pressure numbers.
// (Kept here, not only server-side, so the client can re-fold a profile
// locally -- and so the parity test can check both folds agree.)
// ---------------------------------------------------------------------

/** Midpoint of an authored [lo, hi] range (interpretation (2)). */
export function rangeMid(n) {
  if (!Array.isArray(n) || n.length === 0) return 0;
  if (n.length === 1) return n[0];
  return (n[0] + n[1]) / 2;
}

/**
 * Expected DAMAGE one firing deals to the cell it hits, at bounce multiplier
 * 1.0. Only the two damage verbs contribute; a status-only ray
 * (apply_status / add_on_hit_status) deals no damage and is tracked
 * separately as `statusRate`, so it can be named in the tooltip without
 * colouring a tint that REQ-0057 defines as "damage-weighted".
 */
export function expectedDamagePerFire(verb) {
  if (!verb) return 0;
  if (verb.t === 'strike') return rangeMid(verb.n);
  if (verb.t === 'multi_strike') return rangeMid(verb.n) * (verb.hits || 1);
  return 0;
}

/** Expected firings per second of an every_secs trigger (interpretation (2)). */
export function ratePerSec(trigger) {
  if (!trigger || trigger.t !== 'every_secs') return 0;
  const mid = rangeMid(trigger.s);
  return mid > 0 ? 1 / mid : 0;
}

// ---------------------------------------------------------------------
// forecastPressure -- THE fold.
// ---------------------------------------------------------------------

/**
 * @typedef {Object} ForecastProfile
 * @property {string} key            stable id, e.g. "frost_gnoll#gnoll_claw@1,1"
 * @property {string} enemyId
 * @property {string} skillId
 * @property {Object} [i18n]         {en:{name}, ja:{name}} -- the SKILL's name
 * @property {Object} [enemyI18n]    {en:{name}, ja:{name}} -- the ENEMY's name
 * @property {[number, number]} centroid attacker centroid on the ENEMY plane
 * @property {number} weight         expected count of this attacker per battle
 * @property {string[]} edges        attack_profile.edge
 * @property {number} penetration
 * @property {number} aoe
 * @property {boolean} [aoeStatuses]
 * @property {number} damage         expectedDamagePerFire()
 * @property {number} rate           ratePerSec()
 * @property {boolean} [statusOnly]  true when the verb deals no damage
 */

/**
 * Fold every profile's entry distribution over the board's geometry.
 *
 * opts.occupied -- cellKey()s of PLAYER-field cells already covered by a
 *   backpack. They block / consume penetration / land the ray, per
 *   interpretation (4). Omit for an empty board.
 * opts.cells    -- the cells to report on (e.g. one squad's 8x8 formation
 *   box). Omit to report the whole field.
 */
export function forecastPressure(opts) {
  const bounds = opts.bounds || { ROWS: FIELD_ROWS, COLS: FIELD_COLS };
  const J = (opts.jitterHalfWidth == null) ? ENTRY_JITTER_HALF_WIDTH : opts.jitterHalfWidth;
  const occupied = opts.occupied || new Set();
  const profiles = opts.profiles || [];
  const topN = opts.topN || 3;
  const isOccupied = (r, c) => occupied.has(cellKey(r, c));

  let reportCells = opts.cells;
  if (!reportCells) {
    reportCells = [];
    for (let r = 1; r <= bounds.ROWS; r++) {
      for (let c = 1; c <= bounds.COLS; c++) reportCells.push([r, c]);
    }
  }

  const acc = new Map();
  for (const rc of reportCells) {
    acc.set(cellKey(rc[0], rc[1]), { row: rc[0], col: rc[1], damage: 0, statusRate: 0, _by: new Map() });
  }

  // Credit one cell with the pressure `w` a ray brings at bounce multiplier
  // `bm`, remembering which profile brought it so the tooltip can name the
  // top contributors.
  //
  // The bounce multiplier scales DAMAGE only: sim's dealHitOnField() applies
  // bounceMult to strike / multi_strike and pointedly NOT to apply_status /
  // add_on_hit_status (a status ray lands the same stack count however many
  // times it bounced). statusRate mirrors that.
  function credit(r, c, w, bm, p) {
    const amount = p.statusOnly ? w : w * bm;
    if (!(amount > 0)) return;
    const e = acc.get(cellKey(r, c));
    if (!e) return; // outside the reported window
    if (p.statusOnly) e.statusRate += amount;
    else e.damage += amount;
    e._by.set(p.key, (e._by.get(p.key) || 0) + amount);
  }

  let rays = 0;
  for (const p of profiles) {
    // A skill with no every_secs cadence (a battle_start passive, or a
    // REQ-0078 OnSquadBeenHit retaliation rider that only exists if YOU hit
    // first) is not a recurring incoming ray, so a per-second pressure map
    // has nothing honest to say about it. Skipped rather than given an
    // invented rate. (server/lib/forecast.cjs already filters these out; the
    // guard is here too so the module is safe standing alone.)
    const perFire = p.statusOnly ? 1 : p.damage;
    if (!(p.rate > 0) || !(perFire > 0) || !(p.weight > 0)) continue;
    const unit = p.weight * p.rate * perFire;

    for (const e of entryDistribution(p.centroid, p.edges, bounds, J)) {
      rays++;
      const w = e.weight * unit;
      const res = walkRayPath({
        ROWS: bounds.ROWS, COLS: bounds.COLS,
        entryCell: e.entryCell, dir: e.dir,
        penetration: p.penetration || 0, aoe: p.aoe || 0,
        isOccupied,
      });

      // Every in-field cell the ray ENTERED, at the bounce multiplier in
      // force at that moment (interpretation (4)): an occupied one because
      // sim really did hit it, an empty one because sim would have, had a
      // backpack been standing there.
      for (const step of res.path) credit(step[0], step[1], w, step[2], p);

      // sim's 5-bounce terminator strikes EVERY live occupant at mult(5) on
      // top of whatever the path already dealt -- a flat background term.
      if (res.allField) {
        for (const rc of reportCells) credit(rc[0], rc[1], w, mult(5), p);
      }

      // AOE splash from the landing cell (S3.4). Damage always splashes;
      // statuses splash only when the profile sets aoe_statuses.
      if (res.landing && res.aoe > 0 && !(p.statusOnly && !p.aoeStatuses)) {
        const lr = res.landing[0], lc = res.landing[1];
        for (let r = lr - res.aoe; r <= lr + res.aoe; r++) {
          for (let c = lc - res.aoe; c <= lc + res.aoe; c++) {
            if (r < 1 || r > bounds.ROWS || c < 1 || c > bounds.COLS) continue;
            if (r === lr && c === lc) continue; // landing occupant not double-hit (S3.4)
            credit(r, c, w, res.endMult, p);
          }
        }
      }
    }
  }

  const byKey = new Map();
  for (const p of profiles) byKey.set(p.key, p);

  const perCell = new Map();
  let max = 0, total = 0;
  for (const entry of acc) {
    const k = entry[0], e = entry[1];
    const contributors = Array.from(e._by.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map((pair) => {
        const p = byKey.get(pair[0]);
        return {
          key: pair[0],
          enemyId: p ? p.enemyId : pair[0],
          skillId: p ? p.skillId : pair[0],
          i18n: p ? p.i18n : undefined,
          enemyI18n: p ? p.enemyI18n : undefined,
          amount: pair[1],
          statusOnly: !!(p && p.statusOnly),
        };
      });
    perCell.set(k, { row: e.row, col: e.col, damage: e.damage, statusRate: e.statusRate, contributors });
    if (e.damage > max) max = e.damage;
    total += e.damage;
  }

  return { perCell, max, mean: reportCells.length ? total / reportCells.length : 0, total, rays };
}

// ---------------------------------------------------------------------
// Formation helpers -- box parsing + canvas <-> field cell mapping.
// (The FORMATIONS table itself is NOT duplicated here: it is served by
// GET /api/schedule/forecast, so content stays the server's business and
// this module stays pure geometry.)
// ---------------------------------------------------------------------

/** "J2:Q9" -> {colMin,colMax,rowMin,rowMax}. VERBATIM from sim/lib/formation.cjs. */
export function parseBox(boxStr) {
  const m = /^([A-Za-z])(\d+):([A-Za-z])(\d+)$/.exec(String(boxStr).trim());
  if (!m) throw new Error('parseBox: malformed box string "' + boxStr + '"');
  const c1 = m[1].toUpperCase().charCodeAt(0) - 64, r1 = parseInt(m[2], 10);
  const c2 = m[3].toUpperCase().charCodeAt(0) - 64, r2 = parseInt(m[4], 10);
  return {
    colMin: Math.min(c1, c2), colMax: Math.max(c1, c2),
    rowMin: Math.min(r1, r2), rowMax: Math.max(r1, r2),
  };
}

/** Every field cell of a formation box, row-major. */
export function boxCells(box) {
  const out = [];
  for (let r = box.rowMin; r <= box.rowMax; r++) {
    for (let c = box.colMin; c <= box.colMax; c++) out.push([r, c]);
  }
  return out;
}

/**
 * 0-indexed squad-canvas cell (the 8x8 the editor draws) -> 1-indexed A1:Z18
 * field cell, given that squad's formation box.
 */
export function canvasToField(box, row0, col0) {
  return [box.rowMin + row0, box.colMin + col0];
}

/** Inverse of canvasToField; null when the field cell lies outside the box. */
export function fieldToCanvas(box, row, col) {
  if (row < box.rowMin || row > box.rowMax) return null;
  if (col < box.colMin || col > box.colMax) return null;
  return [row - box.rowMin, col - box.colMin];
}
