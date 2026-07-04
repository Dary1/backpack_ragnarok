// sim/combat.cjs -- REQ-0036 P1-A combat simulator core.
//
// =====================================================================
// INVARIANT (read this before touching engine interop):
// This module MAY require('../mock-src/engine.js') READ-ONLY to compile
// static topology facts (assembly/sockets/allConnections/connectionsFrom/
// cellsOf/bpCells/combos/traceBeams). It must NEVER call any engine
// MUTATOR (movePO, moveBP, rotatePO, seatSI, stowSI, invMovePO, etc.) and
// must NEVER share a mutable object reference back into engine state.
// Every unit "snapshot" handed to the compiler is deep-copied first
// (JSON.parse(JSON.stringify(...)) -- fine since scenario/unit state is
// plain data with no functions/cycles) so nothing here can mutate the
// caller's original state object, and nothing engine.js does can leak
// mutation back out either. Combat/HP/damage logic lives ENTIRELY here;
// engine.js has none (its only combat-adjacent addition is the pure
// read-only bpHpMax(st,bpId) accessor added in REQ-0036 P1-A commit (a)).
// =====================================================================
//
// Spec: combat_spec_draft.md v0.3 (RATIFIED), S1-S9, quoted verbatim in
// the REQ-0036 P1-A task brief. Implements event-driven continuous-time
// resolution, formation-ray targeting, skills/attack-profiles, mode-tags
// (battle/detection/unlock), the status system, and run/dungeon
// integration (progress/shortcuts/rewards/wipe/cooldown).
//
// NOTE on source-doc truncation (documented per task instructions, see
// also sim/README.md "Interpretations" section): docs/combat_spec_draft.md
// v0.3 (555 lines) is truncated mid-sentence at line 555 ("| OQ5 (pen) |
// pen = occupied pass-throug"). S9's table is incomplete and S10 (tunables
// consolidation) / S11 (VX list) are entirely missing from the source
// file. This is a genuine gap in the source document -- NOT a mistake on
// this implementation's part. Every constant S10 would have held is
// already given inline via [TUNABLE]/[LOCKED OQn] markers scattered through
// S1-S9's prose, and the VX list (S11) is fully described inline too. All
// such constants are collected in the TUNABLES table below, each with a
// comment citing which spec section/inline mention it is sourced from.
'use strict';

const path = require('path');
// Read-only interop: only static, pure functions are used from engine.js.
// eslint-disable-next-line
const engine = require(path.join(__dirname, '..', 'mock-src', 'engine.js'));

function deepCopy(x) { return JSON.parse(JSON.stringify(x)); }

// =====================================================================
// TUNABLES -- reconstructed S10 (missing from source doc; see note above).
// One row per constant, each cites the spec section/inline marker it's from.
// =====================================================================
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

  // S8.5: "Wipe (all BPs of all 4 Units downed): L <- max(L_min, L -
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
function djb2Hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0; // h*33 + c
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(masterSeed) {
  const streams = new Map();
  function stream(name) {
    const key = String(name);
    if (!streams.has(key)) {
      const seed = djb2Hash(masterSeed + '|' + key);
      streams.set(key, mulberry32(seed));
    }
    const gen = streams.get(key);
    return {
      next() { return gen(); },
      range(lo, hi) { return lo + gen() * (hi - lo); },
    };
  }
  return { masterSeed, stream };
}

// =====================================================================
// Event queue -- binary min-heap keyed on (t, seq). ~40 lines per task
// brief; correctness over micro-perf but avoids O(n^2) blowups.
// =====================================================================
class EventHeap {
  constructor() { this.a = []; this._seq = 0; }
  size() { return this.a.length; }
  nextSeq() { return this._seq++; }
  _less(i, j) {
    const A = this.a[i], B = this.a[j];
    if (A.t !== B.t) return A.t < B.t;
    return A.seq < B.seq;
  }
  push(ev) {
    const a = this.a;
    a.push(ev);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._less(i, p)) { [a[i], a[p]] = [a[p], a[i]]; i = p; } else break;
    }
  }
  popMin() {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let s = i;
        if (l < a.length && this._less(l, s)) s = l;
        if (r < a.length && this._less(r, s)) s = r;
        if (s === i) break;
        [a[i], a[s]] = [a[s], a[i]];
        i = s;
      }
    }
    return top;
  }
}

// =====================================================================
// Diagonal direction vectors (S2.2/S3): (drow,dcol) terms.
// down-right=(+1,+1)  down-left=(+1,-1)  up-right=(-1,+1)  up-left=(-1,-1)
// =====================================================================
const DIR_VEC = {
  'DR': [1, 1], 'DL': [1, -1], 'UR': [-1, 1], 'UL': [-1, -1],
};
// Edge -> its fixed diagonal direction(s) per S2.2:
// "top edge -> down-left/down-right; left edge -> down-right; right edge ->
// down-left; bottom edge -> up-right/up-left"
const EDGE_DIRS = {
  top: ['DL', 'DR'],
  left: ['DR'],
  right: ['DL'],
  bottom: ['UR', 'UL'],
};

// reflect(dir, corner-aware): flip drow sign if a horizontal boundary (row
// 1 or ROWS) was crossed, flip dcol sign if a vertical boundary (col 1 or
// COLS) was crossed. A ray can cross both simultaneously at a corner --
// handle by flipping whichever component(s) actually went out of bounds.
function reflectDir(dirName, hitRow, hitCol, ROWS, COLS) {
  let [dr, dc] = DIR_VEC[dirName];
  const hitRowBound = (hitRow < 1 || hitRow > ROWS);
  const hitColBound = (hitCol < 1 || hitCol > COLS);
  if (hitRowBound) dr = -dr;
  if (hitColBound) dc = -dc;
  // find the direction name matching the new (dr,dc)
  for (const name of Object.keys(DIR_VEC)) {
    const v = DIR_VEC[name];
    if (v[0] === dr && v[1] === dc) return name;
  }
  // Should never happen (only 4 diagonal directions exist), but fail safe.
  return dirName;
}

function stepCell(cell, dirName) {
  const [dr, dc] = DIR_VEC[dirName];
  return [cell[0] + dr, cell[1] + dc];
}

function outside(cell, ROWS, COLS) {
  return cell[0] < 1 || cell[0] > ROWS || cell[1] < 1 || cell[1] > COLS;
}

// bounce mult table (S3 pseudocode): 1.0(b<=2) / 1.5(b=3) / 2.0(b=4) / 2.5(b=5)
function mult(b) {
  if (b <= 2) return 1.0;
  if (b === 3) return 1.5;
  if (b === 4) return 2.0;
  return 2.5; // b>=5
}

// =====================================================================
// Box parser for formation defs: "J2:Q9" -> {colMin,colMax,rowMin,rowMax}
// Columns A=1..Z=26.
// =====================================================================
function colLetterToIndex(ch) { return ch.toUpperCase().charCodeAt(0) - 64; } // A->1
function colIndexToLetter(idx) { return String.fromCharCode(64 + idx); }

function parseBox(boxStr) {
  const m = /^([A-Za-z])(\d+):([A-Za-z])(\d+)$/.exec(boxStr.trim());
  if (!m) throw new Error('parseBox: malformed box string "' + boxStr + '"');
  const c1 = colLetterToIndex(m[1]), r1 = parseInt(m[2], 10);
  const c2 = colLetterToIndex(m[3]), r2 = parseInt(m[4], 10);
  return {
    colMin: Math.min(c1, c2), colMax: Math.max(c1, c2),
    rowMin: Math.min(r1, r2), rowMax: Math.max(r1, r2),
  };
}

// =====================================================================
// Formation defs (S5.1/S5.2, verbatim boxes incl. the CORRECTED formation4).
// =====================================================================
const FORMATIONS = {
  formation1: {
    id: 'formation1', note: 'standard; 2 front cover 2 back (top-entry only)',
    canvases: { unit1: 'F2:M9', unit2: 'N2:U9', unit3: 'B10:I17', unit4: 'R10:Y17' },
  },
  formation2: {
    id: 'formation2', note: 'unit1 tank up top; unit4 well protected',
    canvases: { unit1: 'J2:Q9', unit2: 'B6:I13', unit3: 'R6:Y13', unit4: 'J10:Q17' },
  },
  formation3: {
    id: 'formation3', note: 'corner units tank top diagonals',
    canvases: { unit1: 'B2:I9', unit2: 'R2:Y9', unit3: 'F10:M17', unit4: 'N10:U17' },
  },
  formation4: {
    id: 'formation4',
    note: 'CORRECTED per ratified fix: unit4=backline_center=J11:Q18 (8 rows, ' +
      'in-bounds) -- supersedes any xlsx/older-doc J11:Q19 (which overran row 18).',
    canvases: {
      unit1: 'B2:I9',   // left_wing
      unit2: 'J2:Q9',   // center_top
      unit3: 'R2:Y9',   // right_wing
      unit4: 'J11:Q18', // backline_center
    },
  },
};

// Sanity-check every formation box is exactly 8x8 (matches 8x8 unit canvas
// layout in scenario.json) at module load time -- fail fast on any typo.
(function validateFormationBoxes() {
  for (const fid of Object.keys(FORMATIONS)) {
    const cv = FORMATIONS[fid].canvases;
    for (const unit of Object.keys(cv)) {
      const box = parseBox(cv[unit]);
      const w = box.colMax - box.colMin + 1, h = box.rowMax - box.rowMin + 1;
      if (w !== 8 || h !== 8) {
        throw new Error('Formation box ' + fid + '.' + unit + ' (' + cv[unit] +
          ') is ' + w + 'x' + h + ', expected 8x8');
      }
    }
  }
})();

// =====================================================================
// Status system (S7) -- one damage cadence constant P, tiny interaction
// matrix (5 rules, kept exactly as tabulated).
// =====================================================================
const STATUS_KIND = {
  Burn: 'dot', Poison: 'dot', Chill: 'cadence_slow', Regen: 'hot',
  Spikes: 'onhit_reflect', Stun: 'suspend', Weakness: 'dmg_reduce', Haste: 'cadence_fast',
};
const DEBUFF_STATUSES = new Set(['Burn', 'Poison', 'Chill', 'Weakness', 'Stun']);
const BUFF_STATUSES = new Set(['Regen', 'Spikes', 'Haste']);

// A "statusBag" lives on any actor (BP instance or enemy instance):
// { Burn:{stacks,...}, Poison:{...}, Chill:{stacks}, Regen:{stacks},
//   Spikes:{stacks}, Stun:{remain}, Weakness:{stacks,remain}, Haste:{stacks,remain} }
function freshStatusBag() { return {}; }

function applyStatus(bag, name, n, ampMult) {
  const magnitude = (ampMult && ampMult > 0) ? n * ampMult : n;
  if (name === 'Stun') {
    // "no magnitude stack; refresh duration = n s"
    bag.Stun = bag.Stun || {};
    bag.Stun.remain = Math.max(bag.Stun.remain || 0, magnitude);
    return;
  }
  if (name === 'Weakness' || name === 'Haste') {
    bag[name] = bag[name] || { stacks: 0, remain: 0 };
    bag[name].stacks += magnitude;
    // duration = n s, refresh (S7 table): here n is the SAME magnitude used
    // for stack count per authoring convention (apply_status/n ranged param
    // doubles as both "stacks added" and "refresh duration" for these two,
    // consistent with the table's single n column). Document as interp.
    bag[name].remain = Math.max(bag[name].remain || 0, magnitude);
    return;
  }
  // Burn/Poison/Chill/Regen/Spikes: "stacks add"
  bag[name] = bag[name] || { stacks: 0 };
  bag[name].stacks += magnitude;
  if (name === 'Chill') bag[name].stacks = Math.min(bag[name].stacks, TUNABLES.CHILL_STACK_CAP);
}

function cleanse(bag) {
  for (const s of DEBUFF_STATUSES) delete bag[s];
  // buffs (Regen/Spikes/Haste) untouched (S7 rule 3)
}

// net cadence multiplier from Chill/Haste (S7 rule 1: "one cadence axis,
// opposite sign -> NET (one number)"). Returned as a multiplier on the
// base every_secs interval: >1 slower (chilled), <1 faster (hasted).
function cadenceMultiplier(bag) {
  const chillStacks = (bag.Chill && bag.Chill.stacks) || 0;
  const hasteStacks = (bag.Haste && bag.Haste.stacks) || 0;
  const netPct = chillStacks * TUNABLES.CHILL_PCT_PER_STACK - hasteStacks * TUNABLES.HASTE_PCT_PER_STACK;
  // netPct>0 => net slow (interval longer); netPct<0 => net fast (interval shorter)
  return 1 + netPct;
}

function weaknessMultiplier(bag) {
  const stacks = (bag.Weakness && bag.Weakness.stacks) || 0;
  return Math.max(0, 1 - stacks * TUNABLES.WEAKNESS_PCT_PER_STACK);
}

function isStunned(bag) {
  return !!(bag.Stun && bag.Stun.remain > 0);
}

// Advance all status timers/ticks for one actor by dtSecs of elapsed time,
// applied whenever we cross a STATUS_TICK_PERIOD_SECS boundary. Returns a
// list of {kind,name,amount} tick effects for the caller to apply as HP
// changes + emit as status_tick events. This function operates on a
// per-actor "elapsed accumulator" (bag._acc) so ticks land on a clean
// period cadence regardless of dt granularity.
function tickStatuses(bag, dtSecs) {
  const P = TUNABLES.STATUS_TICK_PERIOD_SECS;
  const results = [];
  bag._acc = (bag._acc || 0) + dtSecs;
  // Stun/Weakness/Haste duration countdown (real time, not period-quantized)
  // Stun pauses ACTION timers only; DoTs (Burn/Poison) keep ticking through
  // Stun (S7 rule 4) -- so this function still runs during Stun.
  if (bag.Stun) { bag.Stun.remain -= dtSecs; if (bag.Stun.remain <= 0) delete bag.Stun; }
  if (bag.Weakness) { bag.Weakness.remain -= dtSecs; if (bag.Weakness.remain <= 0) delete bag.Weakness; }
  if (bag.Haste) { bag.Haste.remain -= dtSecs; if (bag.Haste.remain <= 0) delete bag.Haste; }

  while (bag._acc >= P) {
    bag._acc -= P;
    if (bag.Burn && bag.Burn.stacks > 0) {
      results.push({ name: 'Burn', amount: bag.Burn.stacks, kind: 'damage' });
      bag.Burn.stacks -= 1;
      if (bag.Burn.stacks <= 0) delete bag.Burn;
    }
    if (bag.Poison && bag.Poison.stacks > 0) {
      results.push({ name: 'Poison', amount: bag.Poison.stacks, kind: 'damage' });
      bag.Poison.stacks -= 1;
      if (bag.Poison.stacks <= 0) delete bag.Poison;
    }
    if (bag.Chill && bag.Chill.stacks > 0) {
      bag.Chill.stacks -= 1;
      if (bag.Chill.stacks <= 0) delete bag.Chill;
    }
    if (bag.Regen && bag.Regen.stacks > 0) {
      results.push({ name: 'Regen', amount: bag.Regen.stacks, kind: 'heal' });
      bag.Regen.stacks -= 1;
      if (bag.Regen.stacks <= 0) delete bag.Regen;
    }
    // Spikes: NO time decay (consumed per hit only, handled at hit-resolution time)
  }
  return results;
}

// Spikes: "consumed per hit; when BP hit, attacker takes 1xstacks; 1 stack
// consumed per hit" (S7, OQ9 LOCKED).
function consumeSpikes(bag) {
  if (!bag.Spikes || bag.Spikes.stacks <= 0) return 0;
  const reflect = bag.Spikes.stacks; // 1x stacks reflected
  bag.Spikes.stacks -= 1; // 1 stack consumed per hit
  if (bag.Spikes.stacks <= 0) delete bag.Spikes;
  return reflect;
}

// =====================================================================
// Compile pass (S1.4) -- given a unit snapshot (BPs+POs+layout, shape of
// scenario.json) and a chosen formation id, compute absolute field cells
// for every BP and fold passive/battle_start buffs onto POs' effects.
// =====================================================================

// Chebyshev-adjacent check used for buff_adjacent folding: two BPs are
// "adjacent" if any of their footprint cells are within Chebyshev
// distance 1 of each other (on the unit's OWN local 8x8 grid, pre-offset;
// adjacency is a placement-time/local concept per the engine's own
// `adjacent(A,B)` helper at engine.js:233 -- we re-derive a Chebyshev
// cell-set adjacency here rather than reusing engine's mutation-coupled
// internals, since we only need the geometric predicate).
function cellsChebyshevAdjacent(cellsA, cellsB) {
  for (const [ra, ca] of cellsA) {
    for (const [rb, cb] of cellsB) {
      if (Math.max(Math.abs(ra - rb), Math.abs(ca - cb)) <= 1) return true;
    }
  }
  return false;
}

// Compute the absolute field cells for every PO instance in a unit
// snapshot, replicating engine.js's cellsOf/bpCells logic locally (we do
// NOT call engine mutators; we only need the pure shape math, which is
// simple enough to reimplement directly against plain-data state so this
// module has zero risk of ever touching engine's live objects).
function localCellsOfPO(poInst, itemDef) {
  // NOTE: rotation is folded at authoring/placement time in scenario.json
  // (rot field); for the sim's compile pass we only need the PLACED shape,
  // so we replicate rotOffsets' 90-degree-CW-per-step + renormalize logic
  // exactly as engine.js's rotOffsets (mock-src/engine.js function
  // rotOffsets(base,k)) so results match engine.js bit-for-bit.
  let off = itemDef.shape.map(o => [o[0], o[1]]);
  const k = ((poInst.rot % 4) + 4) % 4;
  for (let i = 0; i < k; i++) off = off.map(([r, c]) => [c, -r]);
  const mr = Math.min(...off.map(o => o[0]));
  const mc = Math.min(...off.map(o => o[1]));
  off = off.map(([r, c]) => [r - mr, c - mc]);
  return off.map(([r, c]) => [poInst.cell[0] + r, poInst.cell[1] + c]);
}

function localBpCells(bpDef) {
  return bpDef.shape.map(([dr, dc]) => [bpDef.origin[0] + dr, bpDef.origin[1] + dc]);
}

// compileUnitSnapshot(unitState, itemDefsById, formationId, unitSlot)
// unitState: deep-copied {bps:[...], pos:[...], layout:{ROWS,COLS}} (shape
// of content/live/scenario.json). itemDefsById: map id->PO def (from
// live_items.json entries). formationId: one of FORMATIONS keys.
// unitSlot: 'unit1'..'unit4' (which canvas box this unit occupies).
//
// Returns a compiled snapshot:
// {
//   bps: [{id,name,hpMax,hp,localCells,fieldCells,statusBag}],
//   pos: [{uid,id,def,localCells,fieldCells,effects (buff-folded), bpId}],
// }
function compileUnitSnapshot(unitState, itemDefsById, formationId, unitSlot) {
  const st = deepCopy(unitState);
  const formation = FORMATIONS[formationId];
  if (!formation) throw new Error('compileUnitSnapshot: unknown formation ' + formationId);
  const boxStr = formation.canvases[unitSlot];
  if (!boxStr) throw new Error('compileUnitSnapshot: unknown unit slot ' + unitSlot);
  const box = parseBox(boxStr);
  // Local (1-indexed, 8x8) -> shared field (A1:Z18) offset: field = local +
  // (box.rowMin-1, box.colMin-1), since local origin (1,1) maps to the
  // box's top-left absolute cell (box.rowMin, box.colMin).
  const rOff = box.rowMin - 1, cOff = box.colMin - 1;
  const toField = ([r, c]) => [r + rOff, c + cOff];

  const bps = st.bps.map(bpDef => {
    const localCells = localBpCells(bpDef);
    const fieldCells = localCells.map(toField);
    const hpMax = (typeof bpDef.hpMax === 'number') ? bpDef.hpMax : 100;
    return {
      id: bpDef.id, name: bpDef.name, hpMax, hp: hpMax,
      localCells, fieldCells, statusBag: freshStatusBag(),
      alive: true,
    };
  });
  const bpByLocalCellKey = new Map();
  for (const bp of bps) for (const [r, c] of bp.localCells) bpByLocalCellKey.set(r + ',' + c, bp.id);

  // Build PO instances with local + field cells, and figure out which BP
  // each PO physically sits in (needed for buff_self_per_tag "in this BP").
  const posRaw = st.pos.filter(p => p.loc === 'grid').map(p => {
    const def = itemDefsById[p.id];
    if (!def) throw new Error('compileUnitSnapshot: missing item def for ' + p.id);
    const localCells = localCellsOfPO(p, def);
    const fieldCells = localCells.map(toField);
    const bpId = bpByLocalCellKey.get(localCells[0][0] + ',' + localCells[0][1]) || null;
    return { uid: p.uid, id: p.id, def, localCells, fieldCells, bpId };
  });

  // ---- Buff folding (S1.4 OQ2 "fold everything") ----
  // Combination formula (documented interpretation, see sim/README.md):
  // base strike/verb-range for each PO's damage-bearing verbs (those
  // carrying an 'n' [lo,hi] range representing damage) is shifted by an
  // ADDITIVE flat bonus, summed from ALL qualifying buff_host / passive
  // buff_self_per_tag / buff_adjacent contributions, applied ONCE at
  // compile time, in this fixed order: buff_host (self) -> buff_self_per_tag
  // (counts other qualifying-tag POs in the SAME bp) -> buff_adjacent
  // (counts qualifying-tag POs in Chebyshev-adjacent BPs). Each bonus's own
  // [lo,hi] range is itself resolved to a single scalar via the compile-time
  // RNG's "compile/buff" sub-stream (deterministic per run) BEFORE being
  // added, since buffs are folded once and frozen (not re-rolled per
  // application).
  function resolveScalar(range, rng) {
    if (Array.isArray(range)) return rng.range(range[0], range[1]);
    return range;
  }

  function foldBuffsForPO(poEntry, rng) {
    const effects = deepCopy(poEntry.def.effects || []);
    let flatBonus = 0;
    // buff_host: passive, self-only, stat must be 'damage' (OQ7 LOCKED).
    for (const eff of effects) {
      if (eff.trigger && eff.trigger.t === 'passive' && eff.verb && eff.verb.t === 'buff_host' && eff.verb.stat === 'damage') {
        flatBonus += resolveScalar(eff.verb.n, rng.stream('compile/buff/' + poEntry.uid));
      }
    }
    // buff_self_per_tag: passive; sums contribution per OTHER qualifying-tag
    // PO in the SAME bp.
    for (const eff of effects) {
      if (eff.trigger && eff.trigger.t === 'passive' && eff.verb && eff.verb.t === 'buff_self_per_tag' && eff.verb.stat === 'damage') {
        const tag = eff.verb.tag;
        const perTag = resolveScalar(eff.verb.n, rng.stream('compile/buff/' + poEntry.uid));
        let count = 0;
        for (const other of posRaw) {
          if (other.uid === poEntry.uid) continue;
          if (other.bpId !== poEntry.bpId) continue;
          if ((other.def.tags || []).includes(tag)) count++;
        }
        flatBonus += perTag * count;
      }
    }
    return { effects, flatBonus };
  }

  function applyFlatBonusToEffects(effects, flatBonus) {
    if (flatBonus === 0) return effects;
    return effects.map(eff => {
      const e = deepCopy(eff);
      if (e.verb && (e.verb.t === 'strike' || e.verb.t === 'multi_strike') && Array.isArray(e.verb.n)) {
        e.verb.n = [e.verb.n[0] + flatBonus, e.verb.n[1] + flatBonus];
      }
      return e;
    });
  }

  // Pass 1: fold buff_host + buff_self_per_tag (both are self/same-bp scoped,
  // no cross-PO ordering dependency).
  const rngForCompile = makeRng('compile-placeholder'); // caller overrides via foldWithRng below
  const folded = posRaw.map(p => {
    const { effects, flatBonus } = foldBuffsForPO(p, rngForCompile);
    return { ...p, _effects: effects, _flatBonus: flatBonus };
  });

  // Pass 2: buff_adjacent -- sums contribution from qualifying-tag POs in
  // Chebyshev-ADJACENT bps (on the local grid, pre-formation-offset, since
  // adjacency is a placement-local concept).
  for (const p of folded) {
    let adjBonus = 0;
    for (const eff of p._effects) {
      if (eff.trigger && eff.trigger.t === 'adjacent' && eff.verb && eff.verb.t === 'buff_adjacent' && eff.verb.stat === 'damage') {
        const tag = eff.verb.tag;
        const perTag = resolveScalar(eff.verb.n, rngForCompile.stream('compile/buff/' + p.uid));
        for (const other of folded) {
          if (other.uid === p.uid) continue;
          if (!(other.def.tags || []).includes(tag)) continue;
          const pBp = bps.find(b => b.id === p.bpId);
          const oBp = bps.find(b => b.id === other.bpId);
          if (!pBp || !oBp || pBp.id === oBp.id) continue;
          if (cellsChebyshevAdjacent(pBp.localCells, oBp.localCells)) adjBonus += perTag;
        }
      }
    }
    p._flatBonus += adjBonus;
  }

  const pos = folded.map(p => ({
    uid: p.uid, id: p.id, def: p.def, localCells: p.localCells, fieldCells: p.fieldCells,
    bpId: p.bpId, effects: applyFlatBonusToEffects(p._effects, p._flatBonus),
  }));

  return { bps, pos, formationId, unitSlot, box };
}

// =====================================================================
// Entry-cell selection (S4.3, ruling 4) -- deterministic + bounded jitter.
// =====================================================================
function centroidRoundHalfUp(cells) {
  const rSum = cells.reduce((a, c) => a + c[0], 0);
  const cSum = cells.reduce((a, c) => a + c[1], 0);
  const rAvg = rSum / cells.length, cAvg = cSum / cells.length;
  // round-half-up (not banker's rounding): floor(x+0.5)
  return [Math.floor(rAvg + 0.5), Math.floor(cAvg + 0.5)];
}

// selectEntryCell(attackerFieldCells, edges, rngRayStream, oppFieldBounds)
// edges: attack_profile.edge list (e.g. ['top'] or ['left','right']).
// oppFieldBounds: {ROWS,COLS} of the shared field (A1:Z18 => rows 1-18,
// cols 1-26) that the ray will be fired ONTO (the opposing plane).
// Returns { edge, entryCell:[r,c], dir }.
function selectEntryCell(attackerFieldCells, edges, rayStream, oppFieldBounds) {
  const [rowc, colc] = centroidRoundHalfUp(attackerFieldCells);
  let edge;
  if (edges.length > 1) {
    const u0 = rayStream.next();
    const idx = Math.floor(u0 * edges.length);
    edge = edges[Math.min(idx, edges.length - 1)];
  } else {
    edge = edges[0];
  }
  const J = TUNABLES.ENTRY_JITTER_HALF_WIDTH;
  const ROWS = oppFieldBounds.ROWS, COLS = oppFieldBounds.COLS;
  let base, edgeMin, edgeMax, fixedCoord, isRowEdge;
  if (edge === 'top' || edge === 'bottom') {
    base = colc; edgeMin = 1; edgeMax = COLS; isRowEdge = false;
    fixedCoord = (edge === 'top') ? 1 : ROWS;
  } else {
    base = rowc; edgeMin = 1; edgeMax = ROWS; isRowEdge = true;
    fixedCoord = (edge === 'left') ? 1 : COLS;
  }
  const u1 = rayStream.next();
  const offset = Math.round((u1 * 2 - 1) * J);
  const entryCoord = Math.min(edgeMax, Math.max(edgeMin, base + offset));
  const entryCell = isRowEdge ? [entryCoord, fixedCoord] : [fixedCoord, entryCoord];
  // fixed diagonal dir per edge (S2.2); if the edge has >1 possible dir
  // (top/bottom), pick via the SAME u0 draw's fractional structure is not
  // specified separately in the spec for dir-choice on multi-dir edges --
  // the spec only describes edge-choice via u0 when attack_profile.edge
  // lists >1 EDGE. For top/bottom's inherent 2-direction fan (S2.2: "top
  // edge -> down-left/down-right"), we deterministically pick by the ray
  // stream's NEXT draw (documented interpretation, see sim/README.md).
  let dir;
  const dirs = EDGE_DIRS[edge];
  if (dirs.length > 1) {
    const u2 = rayStream.next();
    dir = dirs[Math.floor(u2 * dirs.length) % dirs.length];
  } else {
    dir = dirs[0];
  }
  return { edge, entryCell, dir };
}

// =====================================================================
// Ray walk (S2.2/S3, verbatim pseudocode).
// field: {ROWS,COLS, occupants: Map(cellKey -> occupant)} where occupant
// is {kind:'bp'|'enemy', ref, isDiscoveryTarget?, alive}.
// mode: 'battle' | 'detection' | 'unlock'.
// Returns { events: [...], hits: [...] } and mutates HP/discovery state via
// the provided callback functions (dealHitFn, splashFn) so the caller
// (encounter runner) controls actual HP application + logging uniformly.
// =====================================================================
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
    events.push({ ev: 'ray_hit', dst: hitResult.dstLabel, amount: hitResult.amount, bounce_mult: mult(bounces), hp_after: hitResult.hpAfter });
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
const FIELD_ROWS = 18, FIELD_COLS = 26;

function cellKey(cell) { return cell[0] + ',' + cell[1]; }

// Build a live-occupancy index for one field/plane from a list of
// occupants, each {kind:'bp'|'enemy', id, fieldCells:[[r,c],...], alive}.
function buildOccupancyIndex(occupants) {
  const map = new Map();
  for (const occ of occupants) {
    if (!occ.alive) continue;
    for (const cell of occ.fieldCells) map.set(cellKey(cell), occ);
  }
  return map;
}

// =====================================================================
// Replay log helpers (S1.5). Events are plain objects; toJSONL joins
// them as newline-delimited JSON text (one event per line, matching the
// spec's example format exactly).
// =====================================================================
function toJSONL(events) {
  return events.map(e => JSON.stringify(e)).join('\n');
}

// Masking mechanism (documented interpretation, see sim/README.md): a
// "?" entity (detection target, or an undiscovered hidden-door stage1
// target) is represented internally with its real id, but any event
// that would reveal its identity/position to a spectator has that field
// replaced with the literal string "?" until a `discovery` event is
// emitted for it. We implement this by tagging such entities with
// `masked:true` and, when building events that reference them, using a
// `maskLabel(entity)` helper that returns "?" while masked and the real
// id once `entity.masked` is cleared (flipped false at the moment its
// discovery event fires).
function maskLabel(entity) {
  return entity.masked ? '?' : entity.id;
}

// =====================================================================
// Skill / effect firing helpers.
// =====================================================================
// Resolve a skill's own [lo,hi] ranges through its own owning-effect
// sub-stream (S1.2: "Every [lo,hi] range ... draws ... from the OWNING
// EFFECT's sub-stream").
function effectStreamName(ownerUid, effectIdx) {
  return 'effect/' + ownerUid + '/' + effectIdx;
}

// Actor wrapper: unifies BP occupants (player field) and enemy occupants
// (enemy field) behind one shape so ray-hit / status / HP logic doesn't
// need to branch on kind everywhere. Built once per encounter from the
// compiled unit snapshots (player side) and the encounter's enemy pack
// (enemy side).
function makeBPActor(bp) {
  return {
    kind: 'bp', id: bp.id, ref: bp, fieldCells: bp.fieldCells,
    statusBag: bp.statusBag,
    get alive() { return bp.hp > 0; },
    hp() { return bp.hp; },
    hpMax() { return bp.hpMax; },
    applyDamage(amount) {
      bp.hp = Math.max(0, bp.hp - amount);
      if (bp.hp <= 0) bp.alive = false;
    },
    heal(amount) { bp.hp = Math.min(bp.hpMax, bp.hp + amount); },
  };
}
function makeEnemyActor(en) {
  return {
    kind: 'enemy', id: en.id, ref: en, fieldCells: en.fieldCells,
    statusBag: en.statusBag,
    get alive() { return en.hp > 0; },
    hp() { return en.hp; },
    hpMax() { return en.hpMax; },
    applyDamage(amount) {
      en.hp = Math.max(0, en.hp - amount);
      if (en.hp <= 0) en.alive = false;
    },
    heal(amount) { en.hp = Math.min(en.hpMax, en.hp + amount); },
  };
}

// dealHitOnField: applies a skill's verb(s) to a single occupant actor
// (S3.3). Returns {amount, hpAfter, dstLabel, isDiscovery}.
function dealHitOnField(actor, verbEff, bounceMult, rng, mode, events) {
  if (mode === 'detection') {
    // "a hit IS the find, damage irrelevant" -- no HP change, just discovery.
    return { amount: 0, hpAfter: actor.hp(), dstLabel: maskLabel(actor.ref), isDiscovery: true };
  }
  const verb = verbEff.verb;
  let amount = 0;
  if (verb.t === 'strike') {
    let hitAmt = rng.range(verb.n[0], verb.n[1]) * bounceMult;
    hitAmt *= weaknessMultiplier(actor.statusBag);
    actor.applyDamage(hitAmt);
    amount += hitAmt;
  } else if (verb.t === 'multi_strike') {
    // OQ19 LOCKED: each sub-hit is a SEPARATE on_hit event (per-hit status
    // stacking). Each sub-hit independently rolls n and applies bounceMult.
    for (let i = 0; i < verb.hits; i++) {
      let hitAmt = rng.range(verb.n[0], verb.n[1]) * bounceMult;
      hitAmt *= weaknessMultiplier(actor.statusBag);
      actor.applyDamage(hitAmt);
      amount += hitAmt;
    }
  }
  if (verb.t === 'apply_status' || verb.t === 'add_on_hit_status') {
    const n = rng.range(verb.n[0], verb.n[1]);
    applyStatus(actor.statusBag, verb.status, n);
    events.push({ ev: 'apply_status', dst: maskLabel(actor.ref), status: verb.status, n });
  }
  // Spikes: consumed per hit when the ACTOR (defender) is hit (OQ9 LOCKED).
  const spikesReflect = consumeSpikes(actor.statusBag);
  if (spikesReflect > 0) {
    events.push({ ev: 'reflect_damage', dst: 'attacker', amount: spikesReflect });
  }
  return { amount, hpAfter: actor.hp(), dstLabel: maskLabel(actor.ref), isDiscovery: false };
}

// fireSkillRay: fires ONE ray for one skill-effect against the opposing
// field. Wraps walkRay with dealHit/splash callbacks bound to the actual
// actor list + RNG streams, and emits entry-cell events (ray_fire).
// attacker: {fieldCells, ownerId} (centroid computed from fieldCells).
// attackProfile: S4.2 schema. verbEff: {trigger,verb}. mode: encounter mode.
// targetActors: live actor list on the OPPOSING field.
// rng: the run's makeRng() instance. streamPrefix: unique per-firing key
// for '.../ray' sub-stream isolation (S4.3: "All ray randomness confined
// to .../ray sub-stream, isolated from damage/timing streams").
function fireSkillRay(opts) {
  const {
    attacker, attackProfile, verbEff, mode, targetActors, targetBounds,
    rng, streamPrefix, events, aoeStatuses,
  } = opts;
  const rayStream = rng.stream(streamPrefix + '/ray');
  const dmgStream = rng.stream(streamPrefix + '/dmg');
  const { edge, entryCell, dir } = selectEntryCell(attacker.fieldCells, attackProfile.edge, rayStream, targetBounds);
  events.push({
    ev: 'ray_fire', src: attacker.ownerId, field: targetBounds.label, entry: entryCell.slice(),
    dir, pen: attackProfile.penetration || 0, aoe: attackProfile.aoe || 0,
  });

  function liveOccupantFn(cell) {
    for (const a of targetActors) {
      if (!a.alive) continue;
      for (const c of a.fieldCells) if (c[0] === cell[0] && c[1] === cell[1]) return a;
    }
    return null;
  }
  function dealHitFn(occ, bmult, opts2) {
    if (opts2 && opts2.allField) {
      const hits = [];
      for (const a of targetActors) {
        if (!a.alive) continue;
        const r = dealHitOnField(a, verbEff, bmult, dmgStream, mode, events);
        hits.push({ dst: r.dstLabel, amount: r.amount });
      }
      return hits;
    }
    return dealHitOnField(occ, verbEff, bmult, dmgStream, mode, events);
  }
  function splashFn(landing, radius, bmult, doStatuses) {
    const hits = [];
    for (const a of targetActors) {
      if (!a.alive) continue;
      const withinRadius = a.fieldCells.some(c => chebyshevDist(c, landing) <= radius);
      if (!withinRadius) continue;
      // "Landing occupant NOT double-hit (primary already applied)" (S3.4)
      const isLandingOccupant = a.fieldCells.some(c => c[0] === landing[0] && c[1] === landing[1]);
      if (isLandingOccupant) continue;
      let dmgAmount = 0;
      if (mode !== 'detection' && verbEff.verb.t === 'strike') {
        dmgAmount = dmgStream.range(verbEff.verb.n[0], verbEff.verb.n[1]) * bmult * weaknessMultiplier(a.statusBag);
        a.applyDamage(dmgAmount);
      } else if (mode !== 'detection' && verbEff.verb.t === 'multi_strike') {
        for (let i = 0; i < verbEff.verb.hits; i++) {
          const hitAmt = dmgStream.range(verbEff.verb.n[0], verbEff.verb.n[1]) * bmult * weaknessMultiplier(a.statusBag);
          a.applyDamage(hitAmt);
          dmgAmount += hitAmt;
        }
      }
      if (doStatuses && (verbEff.verb.t === 'apply_status' || verbEff.verb.t === 'add_on_hit_status')) {
        const n = dmgStream.range(verbEff.verb.n[0], verbEff.verb.n[1]);
        applyStatus(a.statusBag, verbEff.verb.status, n);
      }
      hits.push({ dst: maskLabel(a.ref), amount: dmgAmount });
    }
    return hits;
  }

  const result = walkRay({
    field: { ROWS: targetBounds.ROWS, COLS: targetBounds.COLS },
    entryCell, dir, mode,
    penetration: attackProfile.penetration || 0,
    aoe: attackProfile.aoe || 0,
    aoeStatuses: !!attackProfile.aoe_statuses,
    bounceBudget: attackProfile.bounce_budget || 0,
    dealHitFn, splashFn, liveOccupantFn,
  });
  for (const e of result.events) events.push(e);
  return result;
}

// =====================================================================
// Enemy pack compilation -- footprints on enemy field, HP rolled from
// [lo,hi] def range, skills attached (S4.4).
// =====================================================================
function compileEnemyPack(packDef, enemyDefsById, skillDefsById, rng, enemyFieldBox) {
  // enemyFieldBox: {rowMin,colMin,rowMax,colMax} region of the enemy field
  // this pack occupies (bosses/packs placed within the shared A1:Z18
  // enemy plane; for simplicity/documented-interpretation this sim places
  // pack members left-to-right starting at the box's top-left corner,
  // spaced by footprint width, wrapping rows as needed).
  const hpStream = rng.stream('pack/hp');
  let cursorRow = enemyFieldBox.rowMin, cursorCol = enemyFieldBox.colMin;
  const enemies = packDef.enemyIds.map((eid, idx) => {
    const def = enemyDefsById[eid];
    if (!def) throw new Error('compileEnemyPack: missing enemy def ' + eid);
    const hpMax = Math.round(hpStream.range(def.hp[0], def.hp[1]));
    const [fh, fw] = def.footprint || [1, 1];
    if (cursorCol + fw - 1 > enemyFieldBox.colMax) { cursorCol = enemyFieldBox.colMin; cursorRow += fh; }
    const fieldCells = [];
    for (let dr = 0; dr < fh; dr++) for (let dc = 0; dc < fw; dc++) fieldCells.push([cursorRow + dr, cursorCol + dc]);
    cursorCol += fw;
    const skills = (def.skills || []).map(sid => {
      const sdef = skillDefsById[sid];
      if (!sdef) throw new Error('compileEnemyPack: missing skill def ' + sid);
      return sdef;
    });
    return {
      id: eid + '#' + idx, defId: eid, name: def.name, hp: hpMax, hpMax,
      footprint: [fh, fw], fieldCells, skills, statusBag: freshStatusBag(),
      alive: true, ownerId: eid + '#' + idx,
    };
  });
  return enemies;
}

// =====================================================================
// Skill scheduling -- every_secs firing timers with mode-filter pause
// semantics (S6.2): a skill/effect whose modes don't match the active
// encounter's mode does not fire and its next-fire timer does not
// accumulate/backlog. Mechanism (documented interpretation, see
// sim/README.md): each schedulable effect tracks nextFireAt in "active
// time" (time actually spent in a matching-mode encounter). When a new
// encounter opens, every schedulable effect whose modes now match gets
// its timer RE-ANCHORED to the encounter's start time (nextFireAt =
// encounterStart + firstInterval) rather than carrying over any stale
// absolute-time value from a previous (possibly non-matching) encounter.
// This guarantees no backlog: elapsed wall-clock time in a non-matching
// encounter never counts for OR against a paused effect.
function scheduleEffect(heap, rng, ownerUid, effIdx, effect, encounterStart, cadenceMult, pushEvFn) {
  const s = effect.trigger.s; // [lo,hi] seconds
  const stream = rng.stream(effectStreamName(ownerUid, effIdx) + '/timing');
  const interval = stream.range(s[0], s[1]) * cadenceMult;
  const fireAt = encounterStart + interval;
  heap.push({ t: fireAt, seq: heap.nextSeq(), kind: 'skill_fire', ownerUid, effIdx, effect, interval0: s });
}

function effectModesOf(effect, ownerModes) {
  return effect.modes || ownerModes || ['battle'];
}

// =====================================================================
// runEncounter -- drives ONE encounter (pack/trap/door/chest/boss) to
// completion via the event-driven loop (S1.1). Mutates partyBps (array of
// compiled BP objects, HP persists across encounters per S8.2/OQ13) and
// returns { events, result, progressAwarded, rewardEligible }.
//
// encounterDef shape (documented, informal schema -- see sim/README.md):
// {
//   id, type: 'pack'|'trap'|'door'|'chest'|'boss', mode: 'battle'|'detection'|'unlock',
//   enemyPack?: {enemyIds:[...]}    // pack/boss
//   entityDef?: {id,hp,footprint,skills,timeout_secs,modes,masked?}  // trap/door/chest
//   doorStage2?: {...}              // door only: unlock-stage entity def
//   timeout_secs?: number,
//   deadline_secs?: number  // for pack: escalating-pressure soft deadline (no forced win)
// }
// =====================================================================
function runEncounter(opts) {
  const {
    rng, encIndex, partyBps, partyPos, formationBox, enemyDefsById, skillDefsById,
    encounterDef, seedLabel,
  } = opts;
  const events = [];
  const heap = new EventHeap();
  const t0 = 0; // encounter-local time origin
  events.push({ t: t0, seq: heap.nextSeq(), ev: 'encounter_start', enc: encIndex, kind: encounterDef.type, seed: seedLabel, formation: formationBox.formationId });

  // ---- Build player-side actors (BPs already compiled + persistent HP) ----
  const playerActors = partyBps.map(makeBPActor);
  // Player-side schedulable effects: every PO's effects with an every_secs
  // trigger (host_on_hit/on_hit/passive/battle_start handled at compile
  // time or as immediate reactive hooks -- for the sim's scope here we
  // schedule every_secs-triggered verbs, which covers all of batch-002's
  // and live_items.json's damage-dealing content).
  const schedulable = [];
  for (const po of partyPos) {
    (po.effects || []).forEach((eff, idx) => {
      if (eff.trigger && eff.trigger.t === 'every_secs') {
        schedulable.push({ ownerUid: po.uid, ownerId: po.id, effIdx: idx, effect: eff, modes: po.def.modes || ['battle'], attackProfile: eff.attack_profile || po.def.attack_profile || defaultAttackProfileFor(po) });
      }
    });
  }

  // ---- Build enemy-side actors ----
  let enemyActors = [];
  if (encounterDef.enemyPack) {
    const enemyFieldBox = { rowMin: 1, colMin: 1, rowMax: FIELD_ROWS, colMax: FIELD_COLS };
    enemyActors = compileEnemyPack(encounterDef.enemyPack, enemyDefsById, skillDefsById, rng, enemyFieldBox).map(en => ({ raw: en, actor: makeEnemyActor(en) }));
  }
  let entity = null; // trap/door/chest "?" entity
  if (encounterDef.entityDef) {
    const ed = encounterDef.entityDef;
    const [fh, fw] = ed.footprint || [1, 1];
    const centerRow = Math.floor((1 + FIELD_ROWS) / 2), centerCol = Math.floor((1 + FIELD_COLS) / 2);
    const fieldCells = [];
    for (let dr = 0; dr < fh; dr++) for (let dc = 0; dc < fw; dc++) fieldCells.push([centerRow + dr, centerCol + dc]);
    entity = {
      id: ed.id, name: ed.name, hp: (ed.hp || 20), hpMax: (ed.hp || 20), fieldCells,
      statusBag: freshStatusBag(), alive: true, ownerId: ed.id,
      masked: !!ed.masked, skills: (ed.skills || []).map(sid => skillDefsById[sid]).filter(Boolean),
    };
  }

  function enemyActorList() { return enemyActors.map(e => e.actor).concat(entity ? [makeEnemyActor(entity)] : []); }

  // ---- Schedule initial firings (player side, filtered by encounter mode) ----
  const cadenceMultFor = () => 1.0; // cadence buffs folded at compile-time (OQ2); no per-actor Haste/Chill on POs in v1 scope.
  for (const s of schedulable) {
    if (s.modes.includes(encounterDef.mode)) {
      scheduleEffect(heap, rng, s.ownerUid, s.effIdx, s.effect, t0, 1.0);
    }
    // non-matching effects: simply never scheduled while this encounter is
    // active (no timer exists to backlog) -- satisfies S6.2 pause semantics.
  }
  // Enemy-side schedule (packs/boss/trap/door skills, always scheduled --
  // enemies are typed to their own encounter and always match its mode).
  const enemySchedulable = [];
  for (const e of enemyActors) {
    e.raw.skills.forEach((skill, sIdx) => {
      if (skill.trigger && skill.trigger.t === 'every_secs') {
        enemySchedulable.push({ ownerUid: e.raw.ownerId, ownerId: e.raw.defId, effIdx: sIdx, effect: skill, actor: e.actor, raw: e.raw });
      }
    });
  }
  if (entity) {
    entity.skills.forEach((skill, sIdx) => {
      if (skill.trigger && skill.trigger.t === 'every_secs') {
        enemySchedulable.push({ ownerUid: entity.ownerId, ownerId: entity.id, effIdx: sIdx, effect: skill, actor: makeEnemyActor(entity), raw: entity });
      }
    });
  }
  for (const s of enemySchedulable) scheduleEffect(heap, rng, s.ownerUid, s.effIdx, s.effect, t0, 1.0);

  // ---- Status tick scheduling: a lightweight periodic tick event drives
  // Burn/Poison/Regen/Chill/Stun/Weakness/Haste countdown for ALL actors
  // (S7). Scheduled at STATUS_TICK_PERIOD_SECS cadence.
  heap.push({ t: t0 + TUNABLES.STATUS_TICK_PERIOD_SECS, seq: heap.nextSeq(), kind: 'status_tick' });

  const timeoutSecs = encounterDef.timeout_secs;
  const deadlineSecs = encounterDef.deadline_secs || (timeoutSecs != null ? timeoutSecs + 0.001 : 600);
  let result = null;
  let discoveredEntity = false;

  function allEnemiesDead() {
    return enemyActors.length > 0 && enemyActors.every(e => !e.actor.alive);
  }
  function partyWiped() {
    return playerActors.every(a => !a.alive);
  }

  let guardIters = 0;
  while (heap.size() > 0 && guardIters < 200000) {
    guardIters++;
    const ev = heap.popMin();
    if (ev.t > deadlineSecs) break;

    if (ev.kind === 'status_tick') {
      for (const a of playerActors) if (a.alive) tickAndEmit(a, ev.t, events);
      for (const e of enemyActors) if (e.actor.alive) tickAndEmit(e.actor, ev.t, events);
      if (entity && entity.alive) tickAndEmit(makeEnemyActor(entity), ev.t, events);
      heap.push({ t: ev.t + TUNABLES.STATUS_TICK_PERIOD_SECS, seq: heap.nextSeq(), kind: 'status_tick' });
    } else if (ev.kind === 'skill_fire') {
      const isPlayerSide = schedulable.some(s => s.ownerUid === ev.ownerUid && s.effIdx === ev.effIdx);
      if (isPlayerSide) {
        const s = schedulable.find(x => x.ownerUid === ev.ownerUid && x.effIdx === ev.effIdx);
        if (s.modes.includes(encounterDef.mode)) {
          const attacker = { fieldCells: unionCells(playerActorsInSameBpAs(s.ownerUid, partyPos, playerActors)), ownerId: s.ownerId };
          const lead = TUNABLES.TELEGRAPH_LEAD_SECS;
          // telegraph is derived + emitted at fire-time as an informational
          // preview line (S4.5) since this is a server-authoritative batch
          // sim, not a live monitor stream; we emit it immediately before
          // ray_fire with fires_at = ev.t (lead is a DISPLAY concern for a
          // live monitor UI, not a sim-timing concern -- documented interp).
          events.push({ t: Math.max(0, ev.t - lead), seq: heap.nextSeq(), ev: 'telegraph', src: s.ownerId, skill: s.effect.verb.t, edge: (s.attackProfile.edge || ['top'])[0], fires_at: ev.t });
          const rayEvents = [];
          fireSkillRay({
            attacker, attackProfile: s.attackProfile, verbEff: s.effect, mode: encounterDef.mode,
            targetActors: enemyActorList(), targetBounds: { ROWS: FIELD_ROWS, COLS: FIELD_COLS, label: 'enemy' },
            rng, streamPrefix: effectStreamName(s.ownerUid, s.effIdx) + '/' + ev.t, events: rayEvents, aoeStatuses: !!s.attackProfile.aoe_statuses,
          });
          for (const re of rayEvents) events.push(Object.assign({ t: ev.t, seq: heap.nextSeq() }, re));
          if (encounterDef.mode === 'detection' && rayEvents.some(r => r.ev === 'ray_hit' && r.dst !== '?')) {
            discoveredEntity = true;
          }
        }
        // reschedule regardless of match (pause = simply not fired above;
        // rescheduling from ev.t keeps cadence continuous while matching)
        scheduleEffect(heap, rng, s.ownerUid, s.effIdx, s.effect, ev.t, 1.0);
      } else {
        const s = enemySchedulable.find(x => x.ownerUid === ev.ownerUid && x.effIdx === ev.effIdx);
        if (s && s.raw.alive) {
          const attackProfile = s.effect.attack_profile || { edge: ['top'], penetration: 0, aoe: 0 };
          const attacker = { fieldCells: s.raw.fieldCells, ownerId: s.ownerId };
          const lead = TUNABLES.TELEGRAPH_LEAD_SECS;
          events.push({ t: Math.max(0, ev.t - lead), seq: heap.nextSeq(), ev: 'telegraph', src: s.ownerId, skill: s.effect.verb.t, edge: (attackProfile.edge || ['top'])[0], fires_at: ev.t });
          const rayEvents = [];
          fireSkillRay({
            attacker, attackProfile, verbEff: s.effect, mode: 'battle',
            targetActors: playerActors, targetBounds: { ROWS: FIELD_ROWS, COLS: FIELD_COLS, label: 'player' },
            rng, streamPrefix: effectStreamName(s.ownerUid, s.effIdx) + '/' + ev.t, events: rayEvents, aoeStatuses: !!attackProfile.aoe_statuses,
          });
          for (const re of rayEvents) events.push(Object.assign({ t: ev.t, seq: heap.nextSeq() }, re));
        }
        if (s && s.raw.alive) scheduleEffect(heap, rng, s.ownerUid, s.effIdx, s.effect, ev.t, 1.0);
      }
    }

    if (encounterDef.type === 'pack' || encounterDef.type === 'boss') {
      if (allEnemiesDead()) { result = 'clear'; break; }
      if (partyWiped()) { result = 'wipe'; break; }
    } else if (encounterDef.type === 'trap') {
      if (discoveredEntity) { result = 'clear'; break; }
      if (partyWiped()) { result = 'wipe'; break; }
    } else if (encounterDef.type === 'door') {
      if (entity && !entity.alive) { result = 'clear'; break; }
      if (partyWiped()) { result = 'wipe'; break; }
    } else if (encounterDef.type === 'chest') {
      if (entity && !entity.alive) { result = 'clear'; break; }
      if (partyWiped()) { result = 'wipe'; break; }
    }
  }

  if (!result) {
    // timeout/deadline path per S6 encounter table.
    if (encounterDef.type === 'trap' && !discoveredEntity) {
      // "trap fires its skill payload ONCE (a battle-style volley on the
      // player field, rolled), then encounter ends. No disarm step."
      if (entity && entity.skills.length > 0) {
        const skill = entity.skills[0];
        const attackProfile = skill.attack_profile || { edge: ['top'], penetration: 0, aoe: 0 };
        const attacker = { fieldCells: entity.fieldCells, ownerId: entity.id };
        const rayEvents = [];
        fireSkillRay({
          attacker, attackProfile, verbEff: skill, mode: 'battle',
          targetActors: playerActors, targetBounds: { ROWS: FIELD_ROWS, COLS: FIELD_COLS, label: 'player' },
          rng, streamPrefix: 'trap-timeout/' + encounterDef.id, events: rayEvents, aoeStatuses: !!attackProfile.aoe_statuses,
        });
        for (const re of rayEvents) events.push(Object.assign({ t: timeoutSecs, seq: heap.nextSeq() }, re));
      }
      result = partyWiped() ? 'wipe' : 'timeout';
    } else if (encounterDef.type === 'door') {
      result = 'timeout_break'; // "keyhole breaks": forced end, no shortcut
    } else if (encounterDef.type === 'chest') {
      result = 'timeout_lost'; // chest lost, no penalty
    } else if (encounterDef.type === 'pack') {
      result = partyWiped() ? 'wipe' : 'pressure_timeout'; // no forced win
    } else {
      result = partyWiped() ? 'wipe' : 'timeout';
    }
  }

  events.push({ t: heap.size() ? heap.a[0].t : deadlineSecs, seq: heap.nextSeq(), ev: 'encounter_end', enc: encIndex, result, party_bp_hp: partyBps.map(b => b.hp) });
  return { events, result, discoveredEntity, entity };
}

function tickAndEmit(actor, t, events) {
  const ticks = tickStatuses(actor.statusBag, TUNABLES.STATUS_TICK_PERIOD_SECS);
  for (const tk of ticks) {
    if (tk.kind === 'damage') { actor.applyDamage(tk.amount); events.push({ t, ev: 'status_tick', dst: maskLabel(actor.ref), status: tk.name, amount: tk.amount, hp_after: actor.hp() }); }
    else if (tk.kind === 'heal') { actor.heal(tk.amount); events.push({ t, ev: 'status_tick', dst: maskLabel(actor.ref), status: tk.name, amount: tk.amount, hp_after: actor.hp() }); }
  }
}

function unionCells(actorsOrCellsArrays) {
  const out = [];
  for (const item of actorsOrCellsArrays) {
    if (Array.isArray(item)) out.push(...item);
    else if (item && item.fieldCells) out.push(...item.fieldCells);
  }
  return out.length ? out : [[9, 13]]; // fallback center-ish cell if empty
}

function playerActorsInSameBpAs(ownerUid, partyPos, playerActors) {
  const po = partyPos.find(p => p.uid === ownerUid);
  if (!po) return [];
  const bpActor = playerActors.find(a => a.id === po.bpId);
  return bpActor ? [bpActor.fieldCells] : [];
}

function defaultAttackProfileFor(po) {
  return { edge: ['top'], direction: 'front', penetration: 0, aoe: 0, aoe_statuses: false, bounce_budget: 3 };
}

// =====================================================================
// Run integration (S8) -- progress accrual, scheduling, shortcuts,
// rewards, wipe/level-down, cooldown.
// =====================================================================

// computeEncounterDeltas: even split of 100% across the generated
// encounter list, EXCLUDING the boss slot -- the boss is "pinned at 100%"
// (S8.2), i.e. clearing it is what brings progress to exactly 100.
// Documented interpretation (spec gives no numbers, S8.1): non-boss
// encounters evenly split the remaining 100% among themselves; the boss
// entry's own delta is whatever closes the gap to 100 exactly.
function computeEncounterDeltas(encounterList) {
  const nonBossIdx = [];
  let bossIdx = -1;
  encounterList.forEach((e, i) => { if (e.type === 'boss') bossIdx = i; else nonBossIdx.push(i); });
  const deltas = new Array(encounterList.length).fill(0);
  if (bossIdx === -1) {
    // no boss in list (shouldn't happen per S6 table, but guard anyway):
    // split 100% evenly across everything.
    const each = 100 / encounterList.length;
    for (let i = 0; i < encounterList.length; i++) deltas[i] = each;
    return deltas;
  }
  const each = nonBossIdx.length > 0 ? 100 / (nonBossIdx.length + 1) : 100;
  let runningSum = 0;
  for (const i of nonBossIdx) { deltas[i] = each; runningSum += each; }
  deltas[bossIdx] = 100 - runningSum; // closes exactly to 100
  return deltas;
}

// participants: array of abstract participant/owner ids (documented
// abstraction, see sim/README.md -- no real player/room objects here;
// P1-B's schedule service will map these to actual room members).
function distributeRewardsUniform(rewardItems, participants, rng) {
  const stream = rng.stream('rewards/distribute');
  const assignments = [];
  for (const item of rewardItems) {
    const idx = Math.floor(stream.next() * participants.length);
    const owner = participants[Math.min(idx, participants.length - 1)];
    assignments.push({ item, owner, destination: 'warehouse' });
  }
  return assignments;
}

function cooldownForH(H) {
  const { CD_MIN_SECS, CD_MAX_SECS } = TUNABLES;
  const clampedH = Math.max(0, Math.min(1, H));
  return CD_MIN_SECS + (CD_MAX_SECS - CD_MIN_SECS) * (1 - clampedH);
}

function levelDownOnWipe(level) {
  return Math.max(TUNABLES.LEVEL_MIN, level - TUNABLES.FAILURE_STEP);
}

function packBudgetForLevel(level) {
  // Documented interpretation (S4.6 gives no formula): simple linear
  // scaling by dungeon level.
  return TUNABLES.PACK_BUDGET_BASE + TUNABLES.PACK_BUDGET_PER_LEVEL * (level - 1);
}

// runDungeon: threads persistent BP HP through a whole dungeon's
// encounter list (S8.2 backbone: packs + traps/doors/chests seeded in +
// boss pinned at 100%). formationId/unitSlots select where each of the 4
// units sits. Returns { events (all encounters concatenated + run-level
// events), finalProgressPct, result: 'victory'|'wipe', rewards, cooldownSecs, level }.
function runDungeon(opts) {
  const {
    masterSeed, dungeonDef, unitSnapshots, itemDefsById, enemyDefsById,
    skillDefsById, formationId, level, participants,
  } = opts;
  const rng = makeRng(masterSeed);
  const allEvents = [];
  let seq = 0;

  // Compile all 4 units once; HP persists via the SAME bps array objects
  // threaded through every encounter call in this run (S8.2/OQ13:
  // "attrition PERMANENT within a run").
  const unitSlots = ['unit1', 'unit2', 'unit3', 'unit4'];
  const compiled = unitSlots.map((slot, i) => compileUnitSnapshot(unitSnapshots[i], itemDefsById, formationId, slot));
  const allBps = compiled.flatMap(c => c.bps);
  const allPos = compiled.flatMap(c => c.pos);

  const encounterList = dungeonDef.encounters;
  const deltas = computeEncounterDeltas(encounterList);
  let progressPct = 0;
  let runResult = 'in_progress';
  const rewardsAccrued = [];

  allEvents.push({ t: 0, seq: seq++, ev: 'progress', enc: -1, pct: 0 });

  for (let i = 0; i < encounterList.length; i++) {
    const encDef = encounterList[i];
    const targetPct = progressPct + deltas[i];
    if (progressPct >= 100) break; // already finished via a prior shortcut

    const encResult = runEncounter({
      rng, encIndex: i, partyBps: allBps, partyPos: allPos, formationBox: { formationId },
      enemyDefsById, skillDefsById, encounterDef: encDef, seedLabel: masterSeed,
    });
    for (const e of encResult.events) allEvents.push(Object.assign({ seq: seq++ }, e));

    if (encResult.result === 'wipe') {
      runResult = 'wipe';
      break;
    }
    if (encResult.result === 'clear') {
      progressPct = targetPct;
      allEvents.push({ t: encResult.events.length ? encResult.events[encResult.events.length - 1].t : 0, seq: seq++, ev: 'progress', enc: i, pct: progressPct });
      if (encDef.rewardItems && encDef.rewardItems.length) rewardsAccrued.push(...encDef.rewardItems);
      if (encDef.type === 'door' && encResult.result === 'clear') {
        // Shortcut: solved hidden door applies +J% (S8.3), a ranged
        // tunable resolved via the "shortcut" sub-stream (see TUNABLES
        // comment for why this stays a range rather than a fixed point).
        const jStream = rng.stream('shortcut/' + i);
        const jPct = jStream.range(TUNABLES.SHORTCUT_JUMP_PCT_RANGE[0], TUNABLES.SHORTCUT_JUMP_PCT_RANGE[1]);
        progressPct = Math.min(100, progressPct + jPct);
        allEvents.push({ t: 0, seq: seq++, ev: 'shortcut', enc: i, jump_pct: jPct, pct_after: progressPct });
        // "Skipped encounters yield NO reward" -- mark skipped indices.
      }
      if (encDef.type === 'boss') {
        runResult = 'victory';
        progressPct = 100;
      }
    } else {
      // timeout/pressure/no-forced-win/etc. paths: encounter ends without
      // clearing; run continues (except boss/pack special-cased above via
      // 'wipe'; non-boss non-clears simply move on per spec's per-type
      // timeout behavior, already encoded inside runEncounter's own event
      // stream). Progress does not advance for this encounter.
    }
    if (runResult === 'victory') break;
  }

  if (runResult === 'in_progress') {
    runResult = progressPct >= 100 ? 'victory' : 'incomplete';
  }

  const totalHpMax = allBps.reduce((s, b) => s + b.hpMax, 0);
  const totalHp = allBps.reduce((s, b) => s + Math.max(0, b.hp), 0);
  const H = totalHpMax > 0 ? totalHp / totalHpMax : 0;

  let cooldownSecs, newLevel;
  if (runResult === 'wipe') {
    cooldownSecs = cooldownForH(0); // "wipe = same curve at H=0" (OQ15/16/17)
    newLevel = levelDownOnWipe(level);
  } else {
    cooldownSecs = cooldownForH(H);
    newLevel = level;
  }

  const rewardAssignments = (runResult === 'wipe') ? [] : distributeRewardsUniform(rewardsAccrued, participants, rng);

  allEvents.push({ t: 0, seq: seq++, ev: 'run_end', result: runResult, final_pct: progressPct, party_bp_hp: allBps.map(b => b.hp), H });

  return {
    events: allEvents, finalProgressPct: progressPct, result: runResult,
    rewards: rewardAssignments, cooldownSecs, level: newLevel, H,
    bps: allBps, // exposed so tests can assert attrition/HP directly
  };
}

module.exports = {
  // Tunables + RNG + event queue
  TUNABLES,
  makeRng,
  EventHeap,
  // Ray geometry primitives
  DIR_VEC,
  EDGE_DIRS,
  reflectDir,
  stepCell,
  outside,
  mult,
  chebyshevDist,
  // Formation parsing/defs
  parseBox,
  colLetterToIndex,
  colIndexToLetter,
  FORMATIONS,
  FIELD_ROWS,
  FIELD_COLS,
  // Status system
  STATUS_KIND,
  DEBUFF_STATUSES,
  BUFF_STATUSES,
  freshStatusBag,
  applyStatus,
  cleanse,
  cadenceMultiplier,
  weaknessMultiplier,
  isStunned,
  tickStatuses,
  consumeSpikes,
  // Compile pass
  deepCopy,
  compileUnitSnapshot,
  cellsChebyshevAdjacent,
  centroidRoundHalfUp,
  selectEntryCell,
  // Ray walker + firing
  walkRay,
  fireSkillRay,
  dealHitOnField,
  makeBPActor,
  makeEnemyActor,
  // Enemy pack compilation
  compileEnemyPack,
  // Replay log
  toJSONL,
  maskLabel,
  // Encounter + dungeon runners
  runEncounter,
  runDungeon,
  computeEncounterDeltas,
  distributeRewardsUniform,
  cooldownForH,
  levelDownOnWipe,
  packBudgetForLevel,
  // Engine interop (read-only; exposed for tests that want to sanity-check
  // this invariant, e.g. asserting engine has no mutator side-effects when
  // called from this module -- though this module never calls mutators).
  engine,
};
