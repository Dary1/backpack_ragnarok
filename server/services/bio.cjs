// backpack_ragnarok — server/services/bio.cjs
// REQ-0060: Pack Biography aggregation + the veteran-luck (bio_luck)
// curve. Pure, deterministic derivation from a settled run's OWN data
// (run.result + run.events + the lean run.bioRoster captured at start) --
// NO sim change. The storage chokepoint (server/storage.cjs ->
// storage/bio.cjs) is the ONLY place a bio is persisted; this service
// computes deltas and folds them in, at run settle.
'use strict';
const storage = require('../storage.cjs');
const { BIO_LUCK_CAP, BIO_LUCK_MILESTONES } = require('../../shared/constants.json');

const BIO_SCHEMA_VERSION = 1;

function emptyBio(uid, born) {
  return {
    schema_version: BIO_SCHEMA_VERSION,
    bp_uid: uid,
    born: born || { date: new Date().toISOString(), origin: 'unknown' },
    runsSurvived: 0,
    wipesEndured: 0,
    bossesFelled: 0,
    trapsDisarmedAboard: 0,
    chestsOpenedAboard: 0,
    damageTanked: 0,
    weathervaneRerolls: 0,
    chiselCellsAdded: 0,
    chiselCellsFiled: 0,
    namesCarried: [],
    updated_at: new Date().toISOString(),
  };
}

function ensureBio(uid, originHint, name) {
  const existing = storage.readBio(uid);
  if (existing) return existing;
  const bio = emptyBio(uid, { date: new Date().toISOString(), origin: originHint || 'unknown' });
  if (name) bio.namesCarried.push({ name: String(name), since: bio.born.date });
  return storage.writeBio(uid, bio);
}

function deriveRunBioDeltas(run) {
  const roster = Array.isArray(run.bioRoster) ? run.bioRoster : [];
  const wiped = run.result === 'wipe';
  const victory = run.result === 'victory';
  let trapsDisarmed = 0, chestsOpened = 0;
  for (const e of (run.events || [])) {
    if (e.ev === 'att_disarm') trapsDisarmed += 1;
    else if (e.ev === 'att_open' && e.kind === 'chest') chestsOpened += 1;
  }
  const perBp = {};
  for (const b of roster) {
    if (!b || !b.id) continue;
    const hpMax = Number(b.hpMax) || 0;
    const hpEnd = Math.max(0, Math.min(hpMax, Number(b.hpEnd) || 0));
    perBp[b.id] = {
      runsSurvived: wiped ? 0 : 1,
      wipesEndured: wiped ? 1 : 0,
      bossesFelled: victory ? 1 : 0,
      trapsDisarmedAboard: trapsDisarmed,
      chestsOpenedAboard: chestsOpened,
      damageTanked: Math.max(0, hpMax - hpEnd),
    };
  }
  return perBp;
}

function foldDelta(bio, d) {
  bio.runsSurvived += d.runsSurvived || 0;
  bio.wipesEndured += d.wipesEndured || 0;
  bio.bossesFelled += d.bossesFelled || 0;
  bio.trapsDisarmedAboard += d.trapsDisarmedAboard || 0;
  bio.chestsOpenedAboard += d.chestsOpenedAboard || 0;
  bio.damageTanked += d.damageTanked || 0;
  bio.updated_at = new Date().toISOString();
  return bio;
}

function applyRunBio(run) {
  const perBp = deriveRunBioDeltas(run);
  const touched = [];
  for (const uid of Object.keys(perBp)) {
    const bio = ensureBio(uid, 'field');
    foldDelta(bio, perBp[uid]);
    storage.writeBio(uid, bio);
    touched.push(uid);
  }
  return touched;
}

function recordRename(uid, name) {
  const bio = ensureBio(uid, 'unknown');
  bio.namesCarried.push({ name: String(name), since: new Date().toISOString() });
  bio.updated_at = new Date().toISOString();
  return storage.writeBio(uid, bio);
}

function recordTmOp(uid, ops) {
  const bio = ensureBio(uid, 'unknown');
  if (ops && ops.weathervaneRerolls) bio.weathervaneRerolls += ops.weathervaneRerolls;
  if (ops && ops.chiselCellsAdded) bio.chiselCellsAdded += ops.chiselCellsAdded;
  if (ops && ops.chiselCellsFiled) bio.chiselCellsFiled += ops.chiselCellsFiled;
  bio.updated_at = new Date().toISOString();
  return storage.writeBio(uid, bio);
}

function bioLuck(bio) {
  if (!bio) return 0;
  let sum = 0;
  for (const m of BIO_LUCK_MILESTONES) {
    if ((Number(bio[m.field]) || 0) >= m.at) sum += m.grant;
  }
  return Math.min(BIO_LUCK_CAP, Math.round(sum * 1e6) / 1e6);
}

function bioMilestones(bio) {
  return BIO_LUCK_MILESTONES.map((m) => ({
    field: m.field, at: m.at, grant: m.grant,
    reached: (Number(bio && bio[m.field]) || 0) >= m.at,
  }));
}

function tmSuccessChance(baseChance, bio, tmDef) {
  const base = Math.max(0, Math.min(1, Number(baseChance) || 0));
  if (!tmDef || tmDef.respects_bio_luck !== true) return base;
  return Math.max(0, Math.min(1, base + bioLuck(bio)));
}

function bioAgeDays(bio, nowMs) {
  if (!bio || !bio.born || !bio.born.date) return 0;
  const bornMs = Date.parse(bio.born.date);
  if (!bornMs) return 0;
  return Math.max(0, Math.floor(((nowMs || Date.now()) - bornMs) / 86400000));
}

module.exports = {
  BIO_SCHEMA_VERSION, emptyBio, ensureBio, deriveRunBioDeltas, foldDelta,
  applyRunBio, recordRename, recordTmOp, bioLuck, bioMilestones,
  tmSuccessChance, bioAgeDays,
};
