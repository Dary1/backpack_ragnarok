// backpack_ragnarok -- server/services/ragnarok/devotion.cjs
// REQ-0145a (sd): S4 the Devotion rite (blast radius, account-wide
// destruction, eligibility, preview, devote) extracted verbatim from the
// pre-split services/ragnarok.cjs (origin lines 555-701, 765-968 @
// commit 7105d23).
'use strict';
const storage = require('../../storage.cjs');
const { getScheduleContent, makeEngine, genId } = require('../core.cjs');
const { squadCanvasOf, deployedUidSet } = require('../squads.cjs');
const { playerNameOf } = require('./lib.cjs');
const { currentSeason } = require('./seasons.cjs');
const { getOrderDoc, cmpOrderEntries } = require('./order.cjs');
const { normalizeRiteRecord } = require('./einherjar.cjs');
const { buildFrozenSnapshot } = require('./snapshot.cjs');

// ---------------------------------------------------------------------
// S4 The Devotion rite.
// ---------------------------------------------------------------------

// squadMetaOr404: resolves squadIndex against the CALLER's own canvas.
// Out-of-range / non-integer / no-squads-at-all are all the SAME plain
// 404 (no-leak convention, mirroring services/market.cjs's
// getOwnListingOr404 -- a squad is only ever addressable through the
// caller's own token, so a "foreign squad" is structurally identical
// to a typo here).
function squadMetaOr404(canvas, squadIndex) {
  if (!canvas || !canvas.presets || !Array.isArray(canvas.presets.store)
    || !Number.isInteger(squadIndex) || squadIndex < 0 || squadIndex >= canvas.presets.store.length) {
    const err = new Error('squad not found'); err.code = 'NOT_FOUND'; throw err;
  }
  const names = Array.isArray(canvas.presets.names) ? canvas.presets.names : [];
  return { index: squadIndex, name: names[squadIndex] != null ? String(names[squadIndex]) : ('Squad ' + (squadIndex + 1)) };
}

// devotionBlastRadius: READ-ONLY itemization of what the rite destroys.
// The uid sets are KIND-SCOPED on purpose: engine.js's checkUidInvariant
// tags homes 'po:'/'bp:'/'si:' precisely because the three uid
// namespaces never cross-check each other -- a BP id colliding with a
// PO uid string is legal, so destruction must never conflate kinds.
// Counts are the devoted squad's own reference counts (engine.js
// ~1215: "a uid may have AT MOST ONE reference per squad", so array
// lengths are already per-uid counts); and since inventory is MASTER
// (engine.js ~1201: every uid has exactly ONE home record living in
// st.inv.pages), each counted uid is also exactly one destroyed
// physical item. affectedSquads itemizes every OTHER squad that
// shares (yellow, REQ-0033) any doomed uid -- indices are PRE-rite
// indices (the rite deletes a slot, shifting later indices left by one
// per engine.js deleteSquad's own straddle rule).
function devotionBlastRadius(canvas, squadIndex) {
  const devoted = squadCanvasOf(canvas, squadIndex) || { bps: [], pos: [], sis: [] };
  const bps = new Set((devoted.bps || []).map((b) => b.id));
  const pos = new Set((devoted.pos || []).map((p) => p.uid));
  const sis = new Set((devoted.sis || []).map((a) => a.uid));
  const affectedSquads = [];
  const store = canvas && canvas.presets ? canvas.presets.store : [];
  const names = canvas && canvas.presets && Array.isArray(canvas.presets.names) ? canvas.presets.names : [];
  for (let i = 0; i < store.length; i++) {
    if (i === squadIndex) continue;
    const c = squadCanvasOf(canvas, i) || { bps: [], pos: [], sis: [] };
    const lostBps = (c.bps || []).filter((b) => bps.has(b.id)).length;
    const lostPos = (c.pos || []).filter((p) => pos.has(p.uid)).length;
    const lostSis = (c.sis || []).filter((a) => sis.has(a.uid)).length;
    if (lostBps + lostPos + lostSis > 0) {
      affectedSquads.push({
        index: i,
        name: names[i] != null ? String(names[i]) : ('Squad ' + (i + 1)),
        lostBps, lostPos, lostSis,
      });
    }
  }
  return {
    uids: { bps, pos, sis },
    counts: { bps: bps.size, pos: pos.size, sis: sis.size, total: bps.size + pos.size + sis.size },
    affectedSquads,
  };
}

function blastDto(blast) {
  return {
    bps: blast.counts.bps,
    pos: blast.counts.pos,
    sis: blast.counts.sis,
    total: blast.counts.total,
    affectedSquads: blast.affectedSquads,
  };
}

// stripDestroyedUids: the ACCOUNT-WIDE destruction pass. The engine has
// no "destroy a physical item" operation at all -- REQ-0033's reference
// model only ever creates/removes REFERENCES (engine.js's createRef/
// removeRef, ~1368+), and deleteSquad explicitly "never touches
// st.inv" (engine.js ~1892: deleting a squad's reference set leaves
// every inventory home and every other squad's references untouched)
// -- so physical destruction is necessarily this server-side pass. It
// applies ONE uniform kind-scoped filter to every container that holds
// item records, all of which share the {bps, pos, sis} array shape
// (engine.js ~1183: "the inv/canvas containers deliberately mirror each
// other"):
//   - canvas.inv.pages[]      -- the HOMES (inventory is MASTER,
//                                REQ-0033): removing these IS the
//                                destruction
//   - canvas.{bps,pos,sis}    -- the ACTIVE squad's references
//   - canvas.presets.store[i] -- every stored squad's references
//                                (yellow-shared squads lose exactly
//                                their doomed pieces, nothing else)
// plus one repair rule: a SURVIVING SI record seated on a DESTROYED PO
// is stowed (host = 'inv', the stowed sentinel -- engine.js ~1078),
// mirroring engine.js unseatOrphans' own missing-host repair (~388-389:
// a host whose PO cannot be found reverts to 'inv') without calling it
// (unseatOrphans assumes the ACTIVE-canvas record shape -- p.loc
// checks -- while this rule must run uniformly across inventory pages
// and stored snapshots too; it touches only devotion-caused danglers).
function stripDestroyedUids(canvas, uids) {
  const strip = (c) => {
    if (!c) return;
    if (Array.isArray(c.bps)) c.bps = c.bps.filter((b) => !uids.bps.has(b.id));
    if (Array.isArray(c.pos)) c.pos = c.pos.filter((p) => !uids.pos.has(p.uid));
    if (Array.isArray(c.sis)) {
      c.sis = c.sis.filter((a) => !uids.sis.has(a.uid));
      for (const a of c.sis) {
        if (a.host && typeof a.host === 'object' && a.host.po && uids.pos.has(a.host.po)) a.host = 'inv';
      }
    }
  };
  strip(canvas); // the active squad's top-level reference arrays
  if (canvas.presets && Array.isArray(canvas.presets.store)) {
    for (const snap of canvas.presets.store) strip(snap); // stored squads (the active slot is null; strip guards)
  }
  if (canvas.inv && Array.isArray(canvas.inv.pages)) {
    for (const pg of canvas.inv.pages) strip(pg); // THE HOMES -- this is the physical destruction
  }
}

// applyDevotionToCanvas: THE COST, as a pure function over the profile
// state (no storage I/O; engine-style in-place mutator, the same
// mutate-st-and-return contract every engine.js mutator has). Order:
//   1. itemize the blast radius (the devoted squad's kind-scoped uid
//      sets, read before anything moves),
//   2. delete the devoted squad slot via the ENGINE's OWN deleteSquad
//      (engine.js ~1914 -- refs-only removal, names[] splice, active-
//      index bookkeeping incl. the nearest-remaining-tab rule; its
//      last-squad refusal is pre-checked by devote() as a 409 but
//      re-asserted here defensively),
//   3. destroy every doomed uid account-wide (stripDestroyedUids).
// The engine instance only dispatches on `st` for deleteSquad (item
// defs are never dereferenced by it), same "any bound instance works"
// note as services/squads.cjs's isSquadIndependent delegation.
function applyDevotionToCanvas(engine, canvas, squadIndex) {
  const blast = devotionBlastRadius(canvas, squadIndex);
  const del = engine.deleteSquad(canvas, squadIndex);
  if (!del.ok) {
    // Mirrors engine.js deleteSquad's own refusal ("cannot delete the
    // last remaining squad", ~1919) -- reachable here only if devote()'s
    // own pre-check was bypassed (direct service-call misuse).
    const err = new Error('devotion refused: ' + (del.why || 'deleteSquad failed'));
    err.code = 'CONFLICT';
    err.reason = del.why && del.why.indexOf('last') !== -1 ? 'last_squad' : 'not_devotable';
    throw err;
  }
  stripDestroyedUids(canvas, blast.uids);
  return blast;
}

// ---- eligibility ----

// riteEligibilityReasons: the shared gate used by preview (as DATA:
// eligible:false + reasons[]) and devote (as 409s, first reason wins).
// Reason vocabulary (STRUCTURED tags, same err.reason convention as
// assignSlot / the market):
//   mid_rite     a fresh 'applying' record exists (a rite is in flight
//                or just crashed; lazily recovered after
//                RITE_LOCK_TIMEOUT_MS -- see normalizeRiteRecord)
//   last_squad  devoting the caller's ONLY squad -- mirrors engine.js
//                deleteSquad's own last-refusal (~1919: "must always
//                keep at least 1") as a 409 [ORCH decision]
//   empty_squad   the squad has no BP -- engine.isSquadDeployable
//                (REQ-0041 feedback 5: zero BP = dead on arrival).
//                Deliberate EXTENSION of the spec'd 409 set: einherjar
//                join the season-end battle line (REQ-0068), and a squad
//                that could never deploy must not be devotable either
//                (also closes free einherjarCount farming via empty
//                squads). Same reason tag assignSlot already uses.
//   deployed     the devoted squad's uid set intersects the caller's
//                CURRENTLY-DEPLOYED uid set (any squad assigned to a
//                slot of any of their own open/active rooms --
//                services/market.cjs's deployedUidSet, the same Law-of-
//                Possession scan the market's listing gate uses).
//                Intersection (not just "this squad index is slotted")
//                on purpose: destroying a uid a DEPLOYED squad shares
//                would gut a standing army mid-campaign. Mock step 1:
//                「遠征中でない一隊のみ。」
// `already_devoted` is deliberately NOT a reason: no squadName-
// uniqueness constraint exists [ORCH decision] -- every rite mints a
// new record, and two records may share an engraving.
function riteEligibilityReasons(callerId, canvas, squadIndex, nowMs) {
  const reasons = [];
  for (const raw of storage.listEinherjarRecords()) {
    if (raw.playerId !== callerId) continue;
    const rec = normalizeRiteRecord(raw, nowMs);
    if (rec && rec.rite && rec.rite.state === 'applying') { reasons.push('mid_rite'); break; }
  }
  if (canvas.presets.store.length <= 1) reasons.push('last_squad');
  const { itemDefsById } = getScheduleContent();
  const engine = makeEngine(itemDefsById);
  if (!engine.isSquadDeployable(canvas, squadIndex)) reasons.push('empty_squad');
  const blast = devotionBlastRadius(canvas, squadIndex);
  const deployed = deployedUidSet(callerId, canvas);
  let hit = false;
  for (const uid of blast.uids.bps) if (deployed.has(uid)) { hit = true; break; }
  if (!hit) for (const uid of blast.uids.pos) if (deployed.has(uid)) { hit = true; break; }
  if (!hit) for (const uid of blast.uids.sis) if (deployed.has(uid)) { hit = true; break; }
  if (hit) reasons.push('deployed');
  return { reasons, blast, engine };
}

const RITE_409_MESSAGES = {
  mid_rite: 'a devotion rite is already in progress for this account',
  last_squad: 'cannot devote your last remaining squad (the engine refuses to delete the last squad)',
  empty_squad: 'empty squad: squad has no Backpack (BP) and cannot join the einherjar',
  deployed: 'squad (or an item it shares) is deployed in an open/active schedule room -- squads standing for war cannot be devoted',
};

// projectDevotionOrder: the preview's order projection [ORCH:
// percentile vs the current order; degenerate-safe when empty]. Scores
// cannot move at rite time (戦果 only accrues from REQ-0068's season-end
// battles), so the honest projection is: einherjarCount+1, re-ranked
// against today's (dawn-cached) order. topPercentile = ceil(rank/total
// *100), read as "you would stand within the top N%" -- an ESTIMATE
// against a snapshot, never a promise (documented for the client squad;
// the mock's own "+2%" chip is this projection's display slot).
// Degenerate-empty: an empty order projects rank 1 of 1, top 100%.
function projectDevotionOrder(callerId, nowMs) {
  const now = nowMs != null ? nowMs : Date.now();
  const { doc } = getOrderDoc(now);
  const others = doc.entries.filter((e) => e.playerId !== callerId);
  const mine = doc.entries.find((e) => e.playerId === callerId) || null;
  const projectedMe = {
    playerId: callerId,
    name: playerNameOf(callerId),
    einherjarCount: (mine ? mine.einherjarCount : 0) + 1,
    score: mine ? mine.score : 0,
  };
  const ranked = others.concat([projectedMe]).sort(cmpOrderEntries);
  const projectedRank = ranked.findIndex((e) => e.playerId === callerId) + 1;
  const totalAfter = ranked.length;
  return {
    currentRank: mine ? mine.rank : null,
    projectedRank,
    totalAfter,
    topPercentile: totalAfter > 0 ? Math.ceil((projectedRank / totalAfter) * 100) : null,
    einherjarCountAfter: projectedMe.einherjarCount,
  };
}

// previewDevotion: GET /api/ragnarok/devotion/preview/:squadIndex --
// the itemized blast radius + eligibility + order projection, all
// READ-ONLY (a preview persists nothing; lazy rite recovery inside the
// eligibility walk is the one converging write it can trigger).
// Ineligibility is DATA here (eligible:false + reasons[]), not an error
// status -- the client renders the ceremony panel with the vow button
// disabled; only an unaddressable squad 404s.
function previewDevotion(callerId, squadIndex, nowMs) {
  const now = nowMs != null ? nowMs : Date.now();
  const doc = storage.readProfile(callerId);
  const canvas = doc ? doc.canvas : null;
  const squad = squadMetaOr404(canvas, squadIndex);
  const { reasons, blast } = riteEligibilityReasons(callerId, canvas, squadIndex, now);
  return {
    squad,
    eligible: reasons.length === 0,
    reasons,
    blast: blastDto(blast),
    projection: projectDevotionOrder(callerId, now),
  };
}

// devote: POST /api/ragnarok/devotion/:squadIndex -- THE rite,
// irreversible. Commit ordering (crash posture documented per step; the
// whole function is synchronous on the single-threaded server --
// pg_sync's querySync blocks too -- so two requests can never
// interleave mid-rite, exactly the serialization argument
// services/market.cjs's buyListing makes):
//   0. Idempotency-Key replay: a FINALIZED record with the same
//      (playerId, key) returns the original outcome, no re-rite.
//   1. Eligibility 409s (mid_rite / last_squad / empty_squad /
//      deployed) + squad 404 (no-leak), all read-only.
//   2. Write the einherjar record with rite.state 'applying' -- the
//      rite LOCK [ORCH: storage-level lock flag during the rite] and
//      the durable frozen snapshot, captured while the squad still
//      exists. CRASH HERE: profile untouched; the stale 'applying'
//      record is lazily VOIDED (normalizeRiteRecord: every devoted uid
//      still homed -> the cost never landed -> delete the record). The
//      player lost nothing and no engraving stands: nothing duplicated.
//   3. COMMIT POINT: ONE atomic profile write carrying the entire cost
//      (squad slot deleted + every referenced uid destroyed account-
//      wide -- applyDevotionToCanvas). This is the rule-5 divergence
//      write; see the module header. CRASH AFTER: cost landed, record
//      still 'applying' -> lazily ROLLED FORWARD to 'done' (the
//      engraving the player paid for stands). Under-deliver-never-
//      duplicate, the market-settle stance: at no point can the items
//      and the void of the record coexist with a completed engraving.
//   4. Finalize: rite.state 'done'. The record is immutable from here
//      (REQ-0068 will only ever APPEND perSeason entries).
function devote(callerId, squadIndex, idemKey, nowMs) {
  const now = nowMs != null ? nowMs : Date.now();

  // (0) Idempotency replay (finalized records only -- an 'applying'
  // record with the same key is a crashed rite, handled by the
  // eligibility normalization below, never replayed as success).
  if (idemKey) {
    for (const raw of storage.listEinherjarRecords()) {
      if (raw.playerId === callerId && raw.idemKey === idemKey
        && (!raw.rite || raw.rite.state === 'done')) {
        return { record: raw, replayed: true };
      }
    }
  }

  // (1) Eligibility.
  const doc = storage.readProfile(callerId);
  const canvas = doc ? doc.canvas : null;
  const squad = squadMetaOr404(canvas, squadIndex);
  const { reasons, engine } = riteEligibilityReasons(callerId, canvas, squadIndex, now);
  if (reasons.length > 0) {
    const reason = reasons[0];
    const err = new Error(RITE_409_MESSAGES[reason] || ('devotion refused: ' + reason));
    err.code = 'CONFLICT'; err.reason = reason; throw err;
  }

  // (2) The record: snapshot frozen BEFORE any destruction, persisted
  // as the rite lock.
  const cs = currentSeason(now);
  const snapshot = buildFrozenSnapshot(canvas, squadIndex);
  const blast = devotionBlastRadius(canvas, squadIndex);
  const tIso = new Date(now).toISOString();
  /** @type {any} */
  const record = {
    id: genId('ein'),
    playerId: callerId,
    // squadName = the squad's own display name (the mock engraves the
    // team's existing name -- 焔手の隊; a player who wants a different
    // engraving renames the squad first, via the normal client rename).
    // No uniqueness constraint [ORCH]: two rites may engrave the same
    // name as two records.
    squadName: squad.name,
    seasonDevoted: cs.season ? cs.season.index : null,
    devotedAt: tIso,
    snapshot,
    blast: blastDto(blast),
    bioArchive: null, // REQ-0060 (squad bios) not built yet -- reserved, stored empty
    perSeason: [], // 戦果 history -- REQ-0068 appends {season, battles:[...]}
    emblems: [],
    idemKey: idemKey || null,
    rite: { state: 'applying', t: tIso },
  };
  storage.writeEinherjarRecord(record.id, record);

  // (3) COMMIT POINT: the cost, in one atomic profile write.
  applyDevotionToCanvas(engine, canvas, squadIndex);
  storage.writeProfile(callerId, canvas);

  // (4) Finalize the record.
  record.rite = { state: 'done', t: tIso };
  storage.writeEinherjarRecord(record.id, record);

  return { record, replayed: false };
}

module.exports = {
  squadMetaOr404,
  devotionBlastRadius,
  blastDto,
  stripDestroyedUids,
  applyDevotionToCanvas,
  riteEligibilityReasons,
  projectDevotionOrder,
  previewDevotion,
  devote,
};
