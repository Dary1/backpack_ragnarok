'use strict';
// server/services/runs.cjs -- REQ-0047 (c): the run clock + replay view
// (computeDurationSecs / runClock / visibleEvents), snapshot building,
// startRun / settleRun / settleRoomIfDue / maybeAutoStartNextRun and the
// dev-only backdate seam, moved VERBATIM from server/schedule.cjs.
const crypto = require('crypto');
const storage = require('../storage.cjs');
const combat = require('../../sim/combat.cjs');
const dungeonRoll = require('../../sim/dungeon_roll.cjs'); // REQ-0185: the dive roller
const fs = require('fs'); // REQ-0293
const path = require('path'); // REQ-0293
const { loadProfile } = require('../../sim/lib/level_scale.cjs'); // REQ-0293: enemy level-scaling engine
const { WAREHOUSE_TTL_MS, SQUAD_SLOTS, getScheduleContent, resolveRewardItemId, genId, normalizeSlot, slotIsFilled } = require('./core.cjs');
const { squadCanvasOf, applyPendingSwapIfAny } = require('./squads.cjs');
const { addToWarehouse } = require('./warehouse.cjs');
const bioService = require('./bio.cjs'); // REQ-0060
const notifications = require('./notifications.cjs'); // REQ-0327: troop-disband notification feed emission hook
const pacing = require('./pacing.cjs'); // REQ-0240: presentation-pacing serving-layer decoration

// REQ-0357: consecutive zero-progress wipes tolerated before the circuit
// breaker refuses the next auto-start (troop -> disband, solo -> halt).
const WIPE_STREAK_LIMIT = 3;

// REQ-0293: the enemy level-scaling manifest, loaded ONCE at module load (the
// same discipline as the sim content fixtures). v1 ships NEUTRAL -- every rule
// is identity -- so this changes no output; it wires the effLevel-driven,
// per-field scaling path for the gated follow-up that supplies real g values.
// null on a missing/malformed file => no scaling (today behaviour), never a
// startup crash.
let SCALING_PROFILE = null;
try {
  SCALING_PROFILE = loadProfile(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'content', 'scaling_profile.json'), 'utf8')));
} catch (_e) { SCALING_PROFILE = null; }

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
  // REQ-0240: gate on PRESENTATION time `pt` for a paced run (pacingVersion
  // >= 1) and return each visible event as a COPY carrying its `pt` (+ any
  // coalesce annotation) so the client obeys the timeline -- the stored
  // run.events stays BYTE-IDENTICAL to the sim log. A legacy run (pacingVersion
  // 0) gates on sim `t` and returns raw events, exactly as before.
  return pacing.decorateVisible(run, clock.elapsedSecs);
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

// REQ-0325: is this a co-op Troop (a visibility:'public' room)? A Troop runs
// with one squad snapshot PER SEATED OWNER and fans rewards to EVERY seated
// participant; a solo (visibility:'self') room keeps the byte-for-byte single-
// canvas / single-participant path below.
function isTroopRoom(room) {
  return !!room && room.visibility === 'public';
}

// loadOwnerCanvas: a seat owner's CURRENT saved profile canvas -- the SOURCE of
// a troop run's frozen snapshot, re-read at every departure so an auto-restarted
// run re-snapshots each owner's live squads. Null if the owner has no saved
// profile (defensive: such a seat is dropped from the run, not crashed on).
function loadOwnerCanvas(ownerId) {
  const doc = storage.readProfile(ownerId);
  return doc ? doc.canvas : null;
}

// buildTroopSquadSnapshots: REQ-0325. One squad snapshot per room slot, each
// drawn from THAT slot owner's own current canvas (the frozen-canvas rule for a
// co-op run). Returns { squadSnapshots, participants }:
//   squadSnapshots -- a 4-length array runDungeon compiles POSITIONALLY into the
//     formation slots; an empty/vanished seat becomes an empty squad so the run
//     never crashes (REQ-0325 ruling: an emptied seat REDUCES participants, it
//     does not abort the dive).
//   participants   -- only the owners of FILLED, resolvable seats (the reward
//     fan-out recipients passed to runDungeon -> distributeRewardsUniform).
function buildTroopSquadSnapshots(room) {
  const EMPTY_SQUAD = { bps: [], pos: [], sis: [] };
  const squadSnapshots = [];
  const participants = [];
  (room.slots || []).forEach((rawSlot) => {
    const slot = normalizeSlot(rawSlot, room);
    if (!slot) { squadSnapshots.push(EMPTY_SQUAD); return; }
    const canvas = loadOwnerCanvas(slot.ownerId);
    const squadCanvas = canvas ? squadCanvasOf(canvas, slot.squadIndex) : null;
    if (!squadCanvas) { squadSnapshots.push(EMPTY_SQUAD); return; } // owner/squad vanished -> drop this seat
    squadSnapshots.push(squadCanvas);
    participants.push(slot.ownerId);
  });
  // Pad to the 4 formation slots runDungeon expects (a troop always carries 4
  // slots; stay defensive against a shorter legacy slots array).
  while (squadSnapshots.length < SQUAD_SLOTS.length) squadSnapshots.push(EMPTY_SQUAD);
  return { squadSnapshots, participants };
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
  // REQ-0325: a co-op Troop snapshots one squad per SEATED OWNER (each frozen
  // from that owner's OWN current canvas) and fans rewards to ALL participants;
  // a solo room keeps the single-canvas / single-participant path unchanged.
  let squadSnapshots, participants;
  if (isTroopRoom(room)) {
    const built = buildTroopSquadSnapshots(room);
    squadSnapshots = built.squadSnapshots;
    participants = built.participants;
  } else {
    squadSnapshots = buildSquadSnapshots(room, profileCanvas);
    participants = [room.ownerId]; // solo scope: the room owner is the sole participant/reward recipient
  }
  const { itemDefsById, enemyDefsById, skillDefsById, unitDefsById, connShapes, monsterPackDefsById, gimicDefsById, dungeonDefsById } = getScheduleContent(); // REQ-0184: monsterPackDefsById; REQ-0185: gimicDefsById + dungeonDefsById (the roller reads these)
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
  // REQ-0185: the dungeon def comes from the registry; the dive is ROLLED from
  // its weighted tables (sim/dungeon_roll.cjs) deterministically from the room's
  // OWN genSeed (stored at create time). A legacy room's dungeonId still names
  // the (now authored) def; an unknown id falls back to the first available def
  // (defensive -- a room must never fail to start on a stale/renamed id).
  let dungeonDefRef = dungeonDefsById[room.dungeonId];
  if (!dungeonDefRef) { const ids = Object.keys(dungeonDefsById); dungeonDefRef = ids.length ? dungeonDefsById[ids[0]] : null; }
  if (!dungeonDefRef) { const e = new Error('no dungeon def available to roll for room ' + room.id); e.code = 'BAD_REQUEST'; throw e; }
  const genSeed = room.genSeed || crypto.randomBytes(16).toString('hex');
  const dungeonDef = dungeonRoll.rollDungeon(dungeonDefRef, room.level, genSeed, { gimicDefsById });
  // REQ-0297: enemy STRENGTH now scales PER PACK. Each encounter derives its own
  // effLevel = attackLv - pack.powerLevel (+ boss bonus) inside the sim, where the
  // pack def is resolved -- so runs.cjs no longer computes one dungeon-wide
  // effLevel. REQ-0293/0295's dungeon.baseDifficulty is RETIRED as a runtime input
  // (dungeon.Lv / baseDifficulty remain AUTHORING anchors only). attackLv IS
  // room.level, passed to runDungeon below as `level`; COUNTS still key off
  // room.level via the rollDungeon call above. A pack with no powerLevel scales at
  // effLevel 0 (factor 1) => byte-identical, so today's live packs (none carry a
  // powerLevel yet -- the calibrated values ship via the Phase-3 surgical path)
  // are unchanged.
  const seed = crypto.randomBytes(16).toString('hex'); // crypto random, stored (per task brief) -- combat RNG, INDEPENDENT of genSeed (layout vs combat outcome stay separate seeds, see sim/dungen.cjs's own header comment)

  const result = combat.runDungeon({
    masterSeed: seed, dungeonDef, squadSnapshots, itemDefsById, enemyDefsById, skillDefsById,
    monsterPackDefsById, // REQ-0184: resolves an encounter's packId -> its monster_pack def
    formationId: room.formationId, level: room.level, participants,
    scaling: SCALING_PROFILE, // REQ-0297: profile only; per-pack effLevel derived in the sim from room.level (= attackLv) + each pack's powerLevel (+ boss bonus)
    // REQ-0170: without these the sim would see every BP as unlinked -- the board
    // would draw rays the battle did not honour.
    unitDefsById, connShapes,
  });

  // REQ-0240: the presentation-pacing pass. A SERVING-LAYER decoration run
  // AFTER combat.runDungeon (whose event log is combat truth): it assigns
  // every event a monotonic presentation time `pt` (ms), coalesces same-
  // target bursts, and clamps the whole presentation into [45s,300s]. It
  // MUTATES result.events in place (adding `pt` + additive feed annotations)
  // -- safe because sim/tests/goldens.cjs hashes a SEPARATE
  // combat.runDungeon() call and never goes through here, so `pt` can never
  // leak into sim-hashed content. This is user directive #7 ("slow playback,
  // visualization first"): the sim stays instant; presentation TIME stretches.
  const paced = pacing.paceEvents(result.events);
  // REQ-0240 M1: the per-slot player BP pools (exact hpMax) + enemy hints the
  // dock/plates read; enemy side derived from the ROLLED def + content defs.
  // REQ-0355: squadSnapshots ride into the roster as lean per-seat canvases so
  // EVERY viewer of this run (all troop members) can draw all four seats.
  const roster = pacing.buildRoster(result, dungeonDef, { monsterPackDefsById, enemyDefsById }, squadSnapshots);
  // REQ-0276 A2(iii): attachment instance id -> source gimic content id, so
  // the serving layer (pacing.decorateVisible) can bind att_* events to a
  // gimic for art/badges. Derived from the ROLLED def (rollDungeon now keeps
  // `gimicId` on each attachment); it never touches run.events, so the log
  // stays byte-identical to the sim output (determinism gate + goldens green).
  const gimics = {};
  for (const enc of (dungeonDef && dungeonDef.encounters) || []) {
    for (const att of (enc && enc.attachments) || []) {
      if (att && att.id && att.gimicId) gimics[att.id] = att.gimicId;
    }
    // The standalone entityDef path emits no att_* events (its gimic is
    // discovered via a ray_hit whose dst IS the entity id), but map its
    // identity too for symmetry / any future att_* emission on that path.
    if (enc && enc.entityDef && enc.entityDef.id) gimics[enc.entityDef.id] = enc.entityDef.id;
  }

  const runId = genId('run');
  const startedAt = new Date().toISOString();
  const runDoc = {
    id: runId,
    roomId: room.id,
    seed,
    startedAt,
    // REQ-0240: durationSecs is now the PRESENTATION duration the player
    // watches (pt-based) -- this IS the "battle wait increase"; the room is
    // occupied for as long as the paced replay lasts. The sim itself still
    // resolves instantly. Legacy runs (pacingVersion 0) keep durationSecs =
    // max sim `t` via computeDurationSecs (see runClock/visibleEvents).
    durationSecs: paced.durationSecs,
    pacingVersion: paced.pacingVersion, // REQ-0240 M2
    // REQ-0240: the SEPARATELY STORED presentation timeline (pt array +
    // coalesce annotations, parallel to `events` by index). Kept OFF the
    // event objects so run.events stays byte-identical to the sim log (the
    // determinism gate + replay goldens); the serving layer (visibleEvents /
    // decorateVisible) merges pt onto event COPIES at read time.
    presentation: paced.presentation,
    // REQ-0240: the LEGACY combat-time duration (max sim `t`) kept for
    // consumers that must stay on COMBAT TRUTH rather than presentation time
    // (seals' fair-benchmark clearTimeSecs). Presentation `durationSecs`
    // above drives room occupancy / settle; this drives seal comparison.
    simDurationSecs: computeDurationSecs(result.events),
    roster, // REQ-0240 M1: ApiRunView.roster source
    gimics, // REQ-0276 A2(iii): att instance id -> gimic content id (serve-time att_* enrichment)
    events: result.events, // BYTE-IDENTICAL sim log (pt lives in `presentation`)
    result: result.result, // 'victory' | 'wipe' | 'incomplete'
    finalProgressPct: result.finalProgressPct,
    rewards: result.rewards, // [{item, participant}] per distributeRewardsUniform
    participants, // REQ-0325: the seated owners this run fanned rewards across (solo: [ownerId])
    lrdstReward: result.lrdstReward || 0, // REQ-0042: total LRDST rolled this run (0 on wipe)
    cooldownSecs: result.cooldownSecs,
    levelAfter: result.level, // wipe -> level-1 (floored); else unchanged
    H: result.H,
    // REQ-0060: lean per-BP roster captured for settle-time biography
    // aggregation (the run is fully simulated at start, so result.bps
    // already carries each BP's final hp -- NO sim change).
    bioRoster: (result.bps || []).map((b) => ({ id: b.id, hpMax: b.hpMax, hpEnd: b.hp })),
    settled: false,
  };
  storage.writeRun(runId, runDoc);

  room.status = 'active';
  room.lastRunId = runId;
  room.updatedAt = startedAt;
  storage.writeRoom(room.id, room);
  return runDoc;
}

// pickLrdstOwner: REQ-0325 -- the single warehouse recipient of a run's
// aggregate LRDST drop, drawn UNIFORMLY at random from the run's participants
// (uniform single-winner, golden p), deterministic in the run's own stored
// seed. A legacy run doc predating `participants` (or any solo run) falls back
// to the sole room owner -- byte-for-byte the pre-REQ single-participant credit.
function pickLrdstOwner(run, room) {
  const participants = (Array.isArray(run.participants) && run.participants.length)
    ? run.participants
    : [room.ownerId];
  if (participants.length === 1) return participants[0];
  const draw = combat.makeRng(run.seed).stream('rewards/lrdst-owner').next();
  return participants[Math.min(participants.length - 1, Math.floor(draw * participants.length))];
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
      // REQ-0325: the aggregate LRDST drop ALSO follows the uniform rule -- a
      // single winner drawn UNIFORMLY at random from the run's participants
      // (golden p), deterministic in the run's OWN stored seed (the same seeded-
      // rng discipline distributeRewardsUniform uses for the item rewards above).
      // A solo run carries the sole owner as the only participant, so this stays
      // byte-for-byte the pre-REQ single-row-to-owner behaviour.
      const lrdstOwner = pickLrdstOwner(run, room);
      const itemUid = genId('wh');
      const doc = {
        itemUid, playerId: lrdstOwner, itemId: 'lrdst', qty: run.lrdstReward,
        kind: 'tm',
        harvestedAt: now, expiresAt: new Date(Date.now() + WAREHOUSE_TTL_MS).toISOString(),
        sourceRoomId: room.id, sourceRunId: run.id,
      };
      addToWarehouse(lrdstOwner, doc);
    }
  }
  // wipe: golden i "nothing else" -- no rewards, no other side effect
  // beyond the level-down + cooldown already computed by runDungeon.

  room.level = run.levelAfter;
  room.cooldownUntil = new Date(Date.now() + run.cooldownSecs * 1000).toISOString();
  room.status = 'open'; // no run currently in flight; auto-schedule (below) will flip it back once cooldown clears
  room.updatedAt = now;

  // REQ-0357: wipe-streak accounting. A wipe with NO progress is the
  // observable signature of a hopeless matchup (level-down self-correction
  // floors at LEVEL_MIN and then loops forever); count consecutive
  // occurrences here, break the loop in maybeAutoStartNextRun. Any run that
  // made ANY progress -- or won -- resets the streak.
  const zeroProgressWipe = run.result === 'wipe' && !(run.finalProgressPct > 0);
  room.wipeStreak = zeroProgressWipe ? (room.wipeStreak || 0) + 1 : 0;

  const swapped = applyPendingSwapIfAny(room, profileCanvas, itemDefsById);

  // REQ-0060: fold this settled run's own replay/settlement data into
  // each aboard BP's biography (append-only, per-instance). Inside the
  // apply-once section (the run.settled guard at settleRun's top) so each
  // run contributes exactly once. Defensive -- a bio write must never
  // break reward settlement.
  try { bioService.applyRunBio(run); } catch (e) { /* bio is non-critical */ }

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

// REQ-0326: disbandTroopRoom -- the all-or-nothing teardown a seated member's
// cancel triggers on a co-op Troop (services/troops.cjs cancelTroop, and the
// deferred on-RETURN path in maybeAutoStartNextRun below). It RETURNS THE SEATS:
// every slot is cleared, so each seat owner's uids stop gating their other
// deploys (squads.cjs roomSeatGates/deployedUidSet both key on a LIVE seat) and
// stop being market-frozen. It flips state:'canceled' + status:'canceled' so no
// next run ever auto-starts, and records a DISCRETE, observable `disbandEvent`
// on the room doc carrying the roster of released owner ids -- the seam REQ-0327
// reads to learn whom to notify. Idempotent: an already-canceled troop is
// returned untouched (its disbandEvent preserved). All-or-nothing (golden g).
function disbandTroopRoom(room, reason) {
  if (room.state === 'canceled') return room; // already disbanded -- keep the recorded disbandEvent
  const releasedOwners = [];
  const seen = new Set();
  for (const rawSlot of room.slots || []) {
    const slot = normalizeSlot(rawSlot, room);
    if (slot && slot.ownerId != null && !seen.has(slot.ownerId)) {
      seen.add(slot.ownerId);
      releasedOwners.push(slot.ownerId);
    }
  }
  const now = new Date().toISOString();
  room.slots = (room.slots || []).map(() => null); // return every seat (release the uids)
  room.state = 'canceled';
  room.status = 'canceled';       // off every run lane -> never auto-starts again
  room.disbandRequested = false;  // consumed
  room.disbandEvent = {           // REQ-0327 seam: the released-owner roster to notify
    roomId: room.id,
    reason: reason || 'member_cancel',
    releasedOwners,
    disbandedAt: now,
  };
  room.updatedAt = now;
  storage.writeRoom(room.id, room);
  // REQ-0327: append a troop_disbanded notification to EACH released owner's
  // feed (humans and bots alike). Kept out of the run engine's core math --
  // it runs after the seat-return / state:'canceled' teardown has committed,
  // and is best-effort per owner (see services/notifications.cjs).
  notifications.emitTroopDisbanded(room);
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
  // REQ-0326: a co-op Troop whose seated member cancelled disbands ON RETURN --
  // right here, the point the next run would auto-start. The in-flight dive has
  // already settled normally (rewards fanned out, REQ-0325); instead of
  // restarting, tear the troop down all-or-nothing: every seat returned, state
  // 'canceled', a discrete disbandEvent recorded (the REQ-0327 notify roster).
  // Checked BEFORE the cooldown guard so disband fires the instant the dive
  // returns, not only once the (now-moot) cooldown would have cleared.
  if (isTroopRoom(room) && room.disbandRequested) {
    return disbandTroopRoom(room, 'member_cancel');
  }
  // REQ-0357: the wipe-streak circuit breaker. Three consecutive
  // zero-progress wipes and the room does NOT get another run: a Troop
  // disbands through the standard all-or-nothing teardown (seats returned,
  // fleet freed, troop_disbanded notification with reason 'wipe_streak' to
  // every member); a solo room cancels its lane and records a discrete
  // haltEvent + a room_halted notification to its owner. The anomaly stops
  // burning cycles AND announces itself -- the session can self-correct.
  if ((room.wipeStreak || 0) >= WIPE_STREAK_LIMIT) {
    if (isTroopRoom(room)) return disbandTroopRoom(room, 'wipe_streak');
    const now = new Date().toISOString();
    room.status = 'canceled';
    room.haltEvent = { roomId: room.id, reason: 'wipe_streak', streak: room.wipeStreak, haltedAt: now };
    room.updatedAt = now;
    storage.writeRoom(room.id, room);
    notifications.emitRoomHalted(room);
    return room;
  }
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
  // Solo: all 4 slots still need a live assignment (a swap could have cleared
  // one -- defensive; assignSlot never actually clears a slot today, but this
  // guards any future path that could). Troop (REQ-0325): proceed as long as at
  // least ONE seat is still filled -- an emptied seat (REQ-0326) merely reduces
  // participants; only a wholly-empty/disbanded troop has nothing to run.
  if (isTroopRoom(room)) {
    if (!(room.slots || []).some((s) => slotIsFilled(s))) return room;
  } else if (room.slots.some((s) => s.squadIndex == null)) {
    return room;
  }
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

// lastRunSummary (REQ-0239, design B1): a compact wall-clock window for a
// room's active/last run, attached to each room in the LIST response so the
// squad status board can draw honest run progress + a return (帰還) time
// WITHOUT an N+1 GET .../run per room (each of which ships the ENTIRE event
// array -- far too heavy for a dashboard poll). One storage.readRun field-pick
// per room that carries a lastRunId; rooms lists are short, so this stays cheap
// on the 4s poll. `durationSecs` is the run's presentation duration (today =
// the sim's computeDurationSecs; the monitor/pacing track may later re-key it
// -- the board reads whatever the run doc reports). settled lets the board hold
// a `returning` transient across the lazy settle gap (design 02 sec 3).
function lastRunSummary(room) {
  if (!room || !room.lastRunId) return null;
  const run = storage.readRun(room.lastRunId);
  if (!run) return null;
  return {
    runId: run.id,
    startedAt: run.startedAt,
    durationSecs: run.durationSecs,
    settled: !!run.settled,
  };
}

module.exports = {
  WIPE_STREAK_LIMIT, // REQ-0357
  computeDurationSecs,
  runClock,
  visibleEvents,
  buildSquadSnapshots,
  buildTroopSquadSnapshots, // REQ-0325
  startRun,
  settleRun,
  settleRoomIfDue,
  maybeAutoStartNextRun,
  disbandTroopRoom, // REQ-0326: co-op Troop teardown (member cancel -> disband on return / immediately)
  lastRunSummary,
  devBackdateActiveRun,
};
