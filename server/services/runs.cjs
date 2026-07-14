'use strict';
// server/services/runs.cjs -- REQ-0047 (c): the run clock + replay view
// (computeDurationSecs / runClock / visibleEvents), snapshot building,
// startRun / settleRun / settleRoomIfDue / maybeAutoStartNextRun and the
// dev-only backdate seam, moved VERBATIM from server/schedule.cjs.
const crypto = require('crypto');
const storage = require('../storage.cjs');
const combat = require('../../sim/combat.cjs');
const dungen = require('../../sim/dungen.cjs');
const { WAREHOUSE_TTL_MS, SQUAD_SLOTS, getScheduleContent, resolveRewardItemId, genId } = require('./core.cjs');
const { squadCanvasOf, applyPendingSwapIfAny } = require('./squads.cjs');
const { resolveDungeonType } = require('./rooms.cjs');
const { addToWarehouse } = require('./warehouse.cjs');

function computeDurationSecs(events) {
  let maxT = 0;
  for (const e of events) if (typeof e.t === 'number' && e.t > maxT) maxT = e.t;
  return maxT;
}

function runClock(run) {
  const startedMs = Date.parse(run.startedAt);
  const elapsedSecs = Math.max(0, (Date.now() - startedMs) / 1000);
  const isSettled = elapsedSecs >= run.durationSecs;
  return { elapsedSecs, durationSecs: run.durationSecs, isSettled, pct: run.durationSecs > 0 ? Math.min(100, (elapsedSecs / run.durationSecs) * 100) : 100 };
}

function visibleEvents(run) {
  const clock = runClock(run);
  return run.events.filter((ev) => typeof ev.t === 'number' && ev.t <= clock.elapsedSecs);
}

// Builds the squadSnapshots[4] array runDungeon expects, one per slot, by
// reading the OWNER's own profile squads (solo scope: every slot in a
// P1-B room belongs to the same player). A slot with no assigned squad
// (squadIndex===null) is illegal at start time (caller must fill all 4
// slots first, per golden b "troop = 4 Squads" -- a partial troop cannot
// sortie).
function buildSquadSnapshots(room, profileCanvas) {
  return room.slots.map((slot, i) => {
    if (slot.squadIndex == null) {
      const err = new Error('slot ' + i + ' (' + SQUAD_SLOTS[i] + ') has no assigned squad'); err.code = 'BAD_REQUEST'; throw err;
    }
    const canvas = squadCanvasOf(profileCanvas, slot.squadIndex);
    if (!canvas) { const err = new Error('slot ' + i + ' squad snapshot not found'); err.code = 'BAD_REQUEST'; throw err; }
    return canvas;
  });
}

// startRun: golden b/j. Compiles SQUAD COPIES (deep-copied snapshots,
// taken NOW, at start -- sim/combat.cjs's own compileSquadSnapshot deep-
// copies again internally too, so a squad edited by its owner mid-run
// never affects the in-flight run; golden j "runs execute on a copy of
// the squad"). Seed is crypto-random, generated here and STORED verbatim
// on the run document (never re-rolled), so the run is independently
// re-derivable/auditable from its own record.
function startRun(room, profileCanvas) {
  if (room.status === 'active') {
    const err = new Error('room already has an active run'); err.code = 'CONFLICT'; throw err;
  }
  if (room.status === 'canceled') {
    const err = new Error('room is canceled'); err.code = 'CONFLICT'; throw err;
  }
  const squadSnapshots = buildSquadSnapshots(room, profileCanvas);
  const { itemDefsById, enemyDefsById, skillDefsById, unitDefsById, connShapes } = getScheduleContent();
  // REQ-0043: the dungeon def now comes from sim/dungen.cjs's generator,
  // keyed off the room's OWN dungeonType/level/genSeed (stored at
  // create-room time, see createRoom()/resolveDungeonType()) -- no
  // longer always the one static batch-002 dungeon.json. A room created
  // before this REQ landed carries neither field (pre-existing on-disk
  // room docs, files-mode dev data) -- resolveDungeonType()'s own
  // back-compat rule derives a type from the legacy dungeonId, and a
  // fresh random seed is rolled here (once) for a legacy room that never
  // had a genSeed persisted, exactly mirroring how the run's OWN combat
  // seed below is freshly rolled per-run rather than reused.
  const dungeonType = room.dungeonType || resolveDungeonType(undefined, room.dungeonId);
  const genSeed = room.genSeed || crypto.randomBytes(16).toString('hex');
  const dungeonDef = dungen.generate(dungeonType, room.level, genSeed);
  const seed = crypto.randomBytes(16).toString('hex'); // crypto random, stored (per task brief) -- combat RNG, INDEPENDENT of genSeed (layout vs combat outcome stay separate seeds, see sim/dungen.cjs's own header comment)
  const participants = [room.ownerId]; // solo scope: the room owner is the sole participant/reward recipient

  const result = combat.runDungeon({
    masterSeed: seed, dungeonDef, squadSnapshots, itemDefsById, enemyDefsById, skillDefsById,
    formationId: room.formationId, level: room.level, participants,
    // REQ-0170: without these the sim would see every BP as unlinked -- the board
    // would draw rays the battle did not honour.
    unitDefsById, connShapes,
  });

  const runId = genId('run');
  const startedAt = new Date().toISOString();
  const runDoc = {
    id: runId,
    roomId: room.id,
    seed,
    startedAt,
    durationSecs: computeDurationSecs(result.events),
    events: result.events,
    result: result.result, // 'victory' | 'wipe' | 'incomplete'
    finalProgressPct: result.finalProgressPct,
    rewards: result.rewards, // [{item, participant}] per distributeRewardsUniform
    lrdstReward: result.lrdstReward || 0, // REQ-0042: total LRDST rolled this run (0 on wipe)
    cooldownSecs: result.cooldownSecs,
    levelAfter: result.level, // wipe -> level-1 (floored); else unchanged
    H: result.H,
    settled: false,
  };
  storage.writeRun(runId, runDoc);

  room.status = 'active';
  room.lastRunId = runId;
  room.updatedAt = startedAt;
  storage.writeRoom(room.id, room);
  return runDoc;
}

// settleRun: applies a completed (run-clock-elapsed) run's EFFECTS
// exactly once -- rewards -> warehouse, cooldown, level change on wipe
// (golden i), pending-swap application (golden j), then AUTO-SCHEDULEs
// the next run after the cooldown window unless the room was canceled
// (golden g) or flagged cancel-after-current-run. Idempotent via
// run.settled -- safe to call from multiple readers racing to observe
// isSettled===true (files-mode has no cross-request lock, so this
// module accepts a benign double-apply race in that mode as an accepted
// dev-grade risk, same class of risk server/README.md already documents
// for storage.cjs profile writes; a real production hardening pass would
// add a compare-and-swap or DB-level row lock).
function settleRun(room, run, profileCanvas, itemDefsById) {
  if (run.settled) return { room, run };

  const now = new Date().toISOString();

  if (run.result !== 'wipe') {
    // distributeRewardsUniform's assignment shape is {item, owner,
    // destination} (sim/combat.cjs) -- `owner` is the participant id the
    // uniform-random draw picked (golden p: "distribution fully RANDOM").
    const { rollQuality } = require('./dismantle.cjs');
    for (const assignment of run.rewards) {
      const itemUid = genId('wh');
      const itemId = resolveRewardItemId(assignment.item);
      const doc = {
        itemUid, playerId: assignment.owner, itemId,
        q: rollQuality(assignment.owner, itemId), // REQ-0063: per-instance quality roll, minted once here
        harvestedAt: now, expiresAt: new Date(Date.now() + WAREHOUSE_TTL_MS).toISOString(),
        sourceRoomId: room.id, sourceRunId: run.id,
      };
      addToWarehouse(assignment.owner, doc);
    }
    // REQ-0042: LRDST reward -- lands in the warehouse as ONE qty-bearing
    // TM row for the room owner (solo scope: the sole participant is
    // always room.ownerId, same as the item-reward loop above uses
    // assignment.owner per-item; LRDST is a single aggregate drop for
    // the whole run rather than a per-encounter warehouse row, since
    // stacking multiple tiny qty rows would just immediately merge on
    // claim anyway -- see the TM claim-merge behavior below). Skipped
    // entirely when lrdstReward is 0 (a wipe, or -- defensively -- an
    // older run doc from before this field existed).
    if (run.lrdstReward > 0) {
      const itemUid = genId('wh');
      const doc = {
        itemUid, playerId: room.ownerId, itemId: 'lrdst', qty: run.lrdstReward,
        kind: 'tm',
        harvestedAt: now, expiresAt: new Date(Date.now() + WAREHOUSE_TTL_MS).toISOString(),
        sourceRoomId: room.id, sourceRunId: run.id,
      };
      addToWarehouse(room.ownerId, doc);
    }
  }
  // wipe: golden i "nothing else" -- no rewards, no other side effect
  // beyond the level-down + cooldown already computed by runDungeon.

  room.level = run.levelAfter;
  room.cooldownUntil = new Date(Date.now() + run.cooldownSecs * 1000).toISOString();
  room.status = 'open'; // no run currently in flight; auto-schedule (below) will flip it back once cooldown clears
  room.updatedAt = now;

  const swapped = applyPendingSwapIfAny(room, profileCanvas, itemDefsById);

  run.settled = true;
  storage.writeRun(run.id, run);
  storage.writeRoom(swapped.id, swapped);

  return { room: swapped, run };
}

// settleRoomIfDue: the lazy-settlement entry point every route handler
// that touches a room calls first. If the room's lastRunId points at a
// run whose clock has elapsed and hasn't been settled yet, settle it
// (applying rewards/cooldown/swap/auto-schedule) before doing anything
// else with the room. This is what makes "scheduled auto-runs" a real,
// observable design fact without a background scheduler process: the
// NEXT run auto-starts (see maybeAutoStartNextRun below) the next time
// ANYONE looks at this room after its cooldown has elapsed -- a purely
// lazy, poll-driven scheduler, consistent with this service's overall
// "compute instantly, reveal/react lazily" philosophy.
function settleRoomIfDue(room, profileCanvas, itemDefsById) {
  if (room.status === 'active' && room.lastRunId) {
    const run = storage.readRun(room.lastRunId);
    if (run) {
      const clock = runClock(run);
      if (clock.isSettled) {
        const { room: settledRoom } = settleRun(room, run, profileCanvas, itemDefsById);
        return maybeAutoStartNextRun(settledRoom, profileCanvas);
      }
    }
    return room; // still mid-run (clock not yet elapsed)
  }
  // Not currently active: this covers BOTH "the very first run, once all
  // 4 slots just got filled" (status is 'open', cooldownUntil is still
  // null) AND "a later cooldown window that has now cleared" -- either
  // way, maybeAutoStartNextRun's own guards (cancelRequested, cooldown
  // not yet elapsed, incomplete slots) decide whether anything actually
  // happens.
  if (room.status === 'open') return maybeAutoStartNextRun(room, profileCanvas);
  return room;
}

// maybeAutoStartNextRun (golden i "then AUTO-SCHEDULE the next run after
// cooldown unless canceled" -- "scheduled auto-runs = core design fact").
// Fires the moment the room's cooldownUntil has passed, UNLESS the room
// was canceled outright, or flagged cancelRequested (golden g: "cancel
// after current run" -- the run that just settled WAS that "current
// run", so a pending cancelRequested is honored here by canceling the
// room instead of auto-starting the next one).
function maybeAutoStartNextRun(room, profileCanvas) {
  if (room.status !== 'open') return room; // already active, or canceled
  // REQ-0058: a sealed-seed room is single-shot -- once its one run has
  // settled, never auto-start another (each participant runs a given
  // sealId exactly once). The FIRST run still auto-starts normally
  // (lastRunId is still null at that point, so this guard is skipped).
  if (room.sealId && room.lastRunId) {
    const prev = storage.readRun(room.lastRunId);
    if (prev && prev.settled) {
      room.status = 'canceled';
      room.updatedAt = new Date().toISOString();
      storage.writeRoom(room.id, room);
      return room;
    }
  }
  if (room.cancelRequested) {
    room.status = 'canceled';
    room.updatedAt = new Date().toISOString();
    storage.writeRoom(room.id, room);
    return room;
  }
  if (room.cooldownUntil && Date.now() < Date.parse(room.cooldownUntil)) return room; // still cooling down
  // All 4 slots still need a live assignment (a swap could have cleared
  // one -- defensive; assignSlot never actually clears a slot today, but
  // this guards any future path that could).
  if (room.slots.some((s) => s.squadIndex == null)) return room;
  // startRun() returns the RUN document (its own persisted record), not
  // the room -- but it mutates `room` in place (status/lastRunId/
  // updatedAt) before persisting it via storage.writeRoom, so the SAME
  // `room` object reference is already up to date by the time it
  // returns. Returning `room` here (not startRun's return value) is what
  // callers of maybeAutoStartNextRun/settleRoomIfDue actually expect
  // (they operate on rooms throughout, never runs).
  startRun(room, profileCanvas);
  return room;
}

// ---------------------------------------------------------------------
// Warehouse (golden e/f). Cap 200 items/player, 7-day TTL from harvest,
// expired items purge LAZILY on read + a scheduled sweep.
// ---------------------------------------------------------------------

function devBackdateActiveRun(room, extraSecsIntoPast) {
  if (!room.lastRunId) {
    const err = new Error('room has no run to backdate'); err.code = 'BAD_REQUEST'; throw err;
  }
  const run = storage.readRun(room.lastRunId);
  if (!run) { const err = new Error('run record not found'); err.code = 'NOT_FOUND'; throw err; }
  const pastMs = Date.now() - (run.durationSecs + Math.max(0, Number(extraSecsIntoPast) || 5)) * 1000;
  run.startedAt = new Date(pastMs).toISOString();
  storage.writeRun(run.id, run);
  return run;
}

// devBackdateClaimedWarehouseItem (REQ-0041 E2E hook, mirrors
// devBackdateActiveRun's own test-control-seam shape exactly): rewrites a
// 'claiming' warehouse row's claimedAt further into the past so
// normalizeWarehouseStatus's own WAREHOUSE_CLAIM_TIMEOUT_MS lazy-revert
// logic treats it as abandoned on the very next read -- without making
// any E2E test actually wait out the real 120s timeout. Gated to the
// dev_mode fallback caller only by the route handler (server/api.cjs),
// same as dev/backdate; never touches a row's itemId/harvestedAt/
// expiresAt, only claimedAt (a test-control seam, not a gameplay
// feature). Throws NOT_FOUND if the row doesn't exist, BAD_REQUEST if it
// isn't currently 'claiming' (nothing to backdate).

module.exports = {
  computeDurationSecs,
  runClock,
  visibleEvents,
  buildSquadSnapshots,
  startRun,
  settleRun,
  settleRoomIfDue,
  maybeAutoStartNextRun,
  devBackdateActiveRun,
};
