'use strict';
// sim/lib/dungeon.cjs -- REQ-0047 (d): runDungeon + dungeon-level helpers (deltas, rewards, cooldown, level-down, pack budget).
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).
const { TUNABLES } = require('./core.cjs');
const { makeRng } = require('./rng.cjs');
const { compileSquadSnapshot } = require('./compile.cjs');
const { runEncounter } = require('./encounter.cjs');

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
// boss pinned at 100%). formationId/squadSlots select where each of the 4
// squads sits. Returns { events (all encounters concatenated + run-level
// events), finalProgressPct, result: 'victory'|'wipe', rewards, cooldownSecs, level }.
function runDungeon(opts) {
  const {
    masterSeed, dungeonDef, squadSnapshots, itemDefsById, enemyDefsById,
    skillDefsById, siDefsById, formationId, level, participants,
    // REQ-0170: the Unit registries. Optional -- absent means no Unit links form,
    // which is precisely the pre-REQ-0170 behaviour of a BP with no `linker`.
    unitDefsById, connShapes,
    // REQ-0184: monster_pack defs by id. Optional -- absent means no encounter in
    // this dungeon may name a pack by packId (the inline enemyIds spelling still
    // works), which is exactly the pre-REQ-0184 behaviour. Deliberately NOT named
    // `packDefsById`: that is REQ-0170's GACHA pack registry, a different thing.
    monsterPackDefsById,
    // REQ-0293/0297: the enemy level-scaling profile + attackLv (= room.level).
    // Both optional -- absent (the goldens, every unit test) means no scaling, so
    // every encounter compiles byte-identically to today. REQ-0297 RETIRED the
    // single dungeon-wide effLevel: each encounter now derives its OWN pack's
    // effLevel from attackLv + that pack's powerLevel (+ boss bonus) inside
    // runEncounter. attackLv defaults to `level` (the two are the same thing --
    // room.level) so existing callers that pass only `level` are unaffected.
    scaling, attackLv,
  } = opts;
  const rng = makeRng(masterSeed);
  const allEvents = [];
  let seq = 0;

  // Compile all 4 squads once; HP persists via the SAME bps array objects
  // threaded through every encounter call in this run (S8.2/OQ13:
  // "attrition PERMANENT within a run").
  const squadSlots = ['unit1', 'unit2', 'unit3', 'unit4'];
  const compiled = squadSlots.map((slot, i) => compileSquadSnapshot(squadSnapshots[i], itemDefsById, formationId, slot, siDefsById, unitDefsById, connShapes));
  // REQ-0095: tag squad membership onto each BP/PO (lost by the flatMap) so squad-scoped
  // reactive triggers (OnSquadHit/OnSquadBeenHit) can resolve owner -> squad at runtime.
  compiled.forEach(c => { for (const b of c.bps) b.squadSlot = c.squadSlot; for (const p of c.pos) p.squadSlot = c.squadSlot; for (const x of (c.sis || [])) x.squadSlot = c.squadSlot; });
  const allBps = compiled.flatMap(c => c.bps);
  const allPos = compiled.flatMap(c => c.pos);
  const allSis = compiled.flatMap(c => c.sis || []);

  const encounterList = dungeonDef.encounters;
  const deltas = computeEncounterDeltas(encounterList);
  let progressPct = 0;
  let runResult = 'in_progress';
  const rewardsAccrued = [];
  let lrdstAccrued = 0; // REQ-0042: total LRDST rolled across every cleared encounter this run
  const lrdstStream = rng.stream('rewards/lrdst-qty');

  allEvents.push({ t: 0, seq: seq++, ev: 'progress', enc: -1, pct: 0 });

  for (let i = 0; i < encounterList.length; i++) {
    const encDef = encounterList[i];
    const targetPct = progressPct + deltas[i];
    if (progressPct >= 100) break; // already finished via a prior shortcut

    const encResult = runEncounter({
      rng, encIndex: i, troopBps: allBps, troopPos: allPos, troopSis: allSis, formationBox: { formationId },
      enemyDefsById, skillDefsById, monsterPackDefsById, encounterDef: encDef, seedLabel: masterSeed,
      scaling, attackLv: (attackLv != null ? attackLv : level), // REQ-0297: per-pack effLevel derived in runEncounter from attackLv + pack.powerLevel (undefined scaling => no scaling)
    });
    for (const e of encResult.events) allEvents.push(Object.assign({ seq: seq++ }, e));
    // REQ-0049: attachment rewards (trap disarm / chest open) accrue like
    // encDef.rewardItems -- into rewardsAccrued, which the run-wipe rule below
    // forces to [] on a wipe (earned-then-wiped rewards are discarded).
    if (Array.isArray(encResult.attachmentRewards)) { for (const rw of encResult.attachmentRewards) if (rw && rw.roll) rewardsAccrued.push(rw.roll); }

    if (encResult.result === 'wipe') {
      runResult = 'wipe';
      break;
    }
    if (encResult.result === 'clear') {
      progressPct = targetPct;
      allEvents.push({ t: encResult.events.length ? encResult.events[encResult.events.length - 1].t : 0, seq: seq++, ev: 'progress', enc: i, pct: progressPct });
      if (encDef.rewardItems && encDef.rewardItems.length) rewardsAccrued.push(...encDef.rewardItems);
      // REQ-0042: LRDST drop for this cleared encounter -- boss gets the
      // HIGH range (a bigger capstone bonus), every other cleared
      // encounter gets the LOW range. Uniform-random within range, same
      // seeded RNG instance already threaded through this whole
      // function (own named sub-stream so it can never desync any other
      // roll, same "independent named sub-streams" discipline every
      // other roll in this file already follows).
      {
        const lrdstRange = encDef.type === 'boss' ? TUNABLES.LRDST_DROP_BOSS_RANGE : TUNABLES.LRDST_DROP_NON_BOSS_RANGE;
        const lrdstQty = Math.round(lrdstStream.range(lrdstRange[0], lrdstRange[1]));
        lrdstAccrued += lrdstQty;
      }
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
      if (encResult.doorShortcut) {
        // REQ-0049: an attachment DOOR opened during this encounter grants the
        // same +J% shortcut as a standalone door (S8.3), rolled from its own
        // sub-stream so it never desyncs other rolls.
        const jStream = rng.stream('shortcut-att/' + i);
        const jPct = jStream.range(TUNABLES.SHORTCUT_JUMP_PCT_RANGE[0], TUNABLES.SHORTCUT_JUMP_PCT_RANGE[1]);
        progressPct = Math.min(100, progressPct + jPct);
        allEvents.push({ t: 0, seq: seq++, ev: 'shortcut', enc: i, jump_pct: jPct, pct_after: progressPct, via: 'attachment' });
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
  // REQ-0042: a wipe grants NO LRDST either -- same "wipe = nothing else"
  // rule golden i already applies to item rewards (see settleRun's own
  // comment in server/schedule.cjs), applied consistently to the new
  // currency drop. LRDST accrued while progressing through encounters
  // BEFORE the eventual wipe is discarded, not partially banked -- this
  // mirrors rewardsAccrued's own handling (rewardAssignments is forced
  // to [] on a wipe regardless of what was pushed during the run).
  const lrdstReward = (runResult === 'wipe') ? 0 : lrdstAccrued;

  allEvents.push({ t: 0, seq: seq++, ev: 'run_end', result: runResult, final_pct: progressPct, troop_bp_hp: allBps.map(b => b.hp), H });

  return {
    events: allEvents, finalProgressPct: progressPct, result: runResult,
    rewards: rewardAssignments, lrdstReward, cooldownSecs, level: newLevel, H,
    bps: allBps, // exposed so tests can assert attrition/HP directly
  };
}


module.exports = {
  computeEncounterDeltas,
  distributeRewardsUniform,
  cooldownForH,
  levelDownOnWipe,
  packBudgetForLevel,
  runDungeon,
};
