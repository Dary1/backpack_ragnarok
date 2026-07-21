'use strict';
// server/storage/skin_prefs.cjs -- REQ-0266: the PER-PROFILE skin selection.
// One doc per player: { player_id, unit:{<unitId>:<skinId>}, bpskin:{<unitId>:
// <skinId>}, updated_at } -- which unit_skin def this player has picked for each
// of their units, per SLOT. Same one-doc-per-PLAYER shape as starter.cjs /
// dismantle.cjs. Root: data/skin_prefs/<playerId>.json | pg: skin_prefs.
//
// WHY ITS OWN ROOT (REQ-0266 D-B). writeProfile() replaces `canvas` WHOLESALE on
// every PUT (storage/profiles.cjs), so a preference kept in the canvas would be
// destroyed by any client that PUTs a canvas built from a slightly older payload.
// That is exactly why storage/bio.cjs and storage/bpskin_slot.cjs are sibling
// roots. Those two are keyed by BP INSTANCE, which is the wrong grain here -- a
// skin pick belongs to the PLAYER -- hence the starter.cjs (per-player) template.
//
// ABSENCE IS THE DEFAULT (D5), at EVERY level: a missing file/row, a missing
// `unit`/`bpskin` map, a missing unit key and an explicit null all mean "use the
// def-declared default". Nothing is ever backfilled -- the house convention
// (REQ-0141 state.guide, REQ-0126 decision 5, REQ-0042 inv.pages[].tms,
// REQ-0037 dev_mode, REQ-0118c authId).
//
// The two PURE functions at the bottom (validateSkinPrefsPatch / resolveSkinPrefs)
// take the skin corpus as an ARGUMENT and read no files: the route hands them
// /api/content's unit_skins section. Same posture shared/content_validate.cjs has
// with vocab -- which is what makes them cheap to unit-test.
const fs = require('fs');
const path = require('path');
const { backendMode, namespacedId, REPO_ROOT, atomicWriteJSON } = require('./lib.cjs');
// ONE definition of the slot vocabulary, shared with the content validator so a
// map name here can never drift from a legal `slot` value there.
const { UNIT_SKIN_SLOTS } = require('../../shared/content_validate.cjs');

const SKIN_PREFS_DIR = path.join(REPO_ROOT, 'data', 'skin_prefs');
function skinPrefsPath(playerId) { return path.join(SKIN_PREFS_DIR, playerId + '.json'); }

/** An empty selection -- what every absence resolves to. Fresh object per call:
 * callers merge into it. */
function emptySkinPrefs() {
  const out = {};
  for (const slot of UNIT_SKIN_SLOTS) out[slot] = {};
  return out;
}

/** The {unit,bpskin} maps of a stored doc, defensively normalized: any missing
 * or non-object map becomes {}, and any non-string value is dropped. A doc that
 * predates a slot (or was hand-edited) therefore reads as "no pick" for it
 * rather than throwing somewhere far away. */
function prefsFromDoc(doc) {
  const out = emptySkinPrefs();
  if (!doc || typeof doc !== 'object') return out;
  for (const slot of UNIT_SKIN_SLOTS) {
    const m = doc[slot];
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
    for (const unitId of Object.keys(m)) {
      if (typeof m[unitId] === 'string' && m[unitId]) out[slot][unitId] = m[unitId];
    }
  }
  return out;
}

function readSkinPrefsFiles(playerId) {
  const p = skinPrefsPath(playerId);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}
function writeSkinPrefsFiles(playerId, doc) {
  atomicWriteJSON(SKIN_PREFS_DIR, skinPrefsPath(playerId), doc);
  return doc;
}
function deleteSkinPrefsFiles(playerId) {
  const p = skinPrefsPath(playerId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
function readSkinPrefsPg(playerId) {
  const { querySync } = require('../pg_sync.cjs');
  const res = querySync('SELECT doc FROM skin_prefs WHERE player_id = $1', [namespacedId(playerId)]);
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeSkinPrefsPg(playerId, doc) {
  const { querySync } = require('../pg_sync.cjs');
  querySync(
    'INSERT INTO skin_prefs (player_id, doc, updated_at) VALUES ($1, $2::jsonb, now()) ' +
    'ON CONFLICT (player_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at',
    [namespacedId(playerId), JSON.stringify(doc)]
  );
  return doc;
}
function deleteSkinPrefsPg(playerId) {
  const { querySync } = require('../pg_sync.cjs');
  querySync('DELETE FROM skin_prefs WHERE player_id = $1', [namespacedId(playerId)]);
}

/** The RAW doc, or null when this player has never picked a skin. Callers should
 * prefer getSkinPrefs() -- null and {} mean the same thing to every consumer. */
function readSkinPrefs(playerId) {
  return backendMode() === 'pg' ? readSkinPrefsPg(playerId) : readSkinPrefsFiles(playerId);
}
function writeSkinPrefs(playerId, doc) {
  return backendMode() === 'pg' ? writeSkinPrefsPg(playerId, doc) : writeSkinPrefsFiles(playerId, doc);
}
function deleteSkinPrefs(playerId) {
  return backendMode() === 'pg' ? deleteSkinPrefsPg(playerId) : deleteSkinPrefsFiles(playerId);
}

/** The player's selection as {unit:{}, bpskin:{}}. NEVER null: absence at every
 * level is the default, so "has never picked anything" and "picked nothing" are
 * the same answer. */
function getSkinPrefs(playerId) {
  return prefsFromDoc(readSkinPrefs(playerId));
}

/** MERGE `patch` into the player's selection and persist (D-B). Per slot map
 * present in the patch, each key is applied individually:
 *   "<skinId>"  -> set that unit's pick for this slot
 *   null        -> CLEAR it back to the def-declared default
 *   (absent)    -> untouched
 * A slot map absent from the patch is untouched in full. Returns the persisted
 * doc. Validation is the caller's job (validateSkinPrefsPatch) -- this function
 * is the persistence half and stays content-free. */
function mergeSkinPrefs(playerId, patch) {
  const current = getSkinPrefs(playerId);
  const p = (patch && typeof patch === 'object' && !Array.isArray(patch)) ? patch : {};
  for (const slot of UNIT_SKIN_SLOTS) {
    const m = p[slot];
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
    for (const unitId of Object.keys(m)) {
      const v = m[unitId];
      if (v === null || v === undefined || v === '') delete current[slot][unitId];
      else current[slot][unitId] = String(v);
    }
  }
  const doc = Object.assign({ player_id: playerId }, current, { updated_at: new Date().toISOString() });
  return writeSkinPrefs(playerId, doc);
}

/** Validates one PUT patch against the live skin corpus. Throws a descriptive
 * Error (the message becomes the 400 body) -- never coerces, never silently
 * drops. `skinDefsById` is /api/content's unit_skins section (id -> def); pass
 * null for shape-only validation.
 *
 * The three content rules are the ones that make a pick MEAN something: the skin
 * must exist, its `slot` must match the map it was written to (a bpskin in the
 * portrait map would render nothing), and the unit must be one the skin declares
 * it can dress (units[], D3). A null value is always legal -- clearing is how a
 * player goes back to the default. */
function validateSkinPrefsPatch(patch, skinDefsById) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('body must be a JSON object');
  for (const key of Object.keys(patch)) {
    if (UNIT_SKIN_SLOTS.indexOf(key) < 0) {
      throw new Error('unknown field "' + key + '" (only ' + UNIT_SKIN_SLOTS.join('/') + ' are settable)');
    }
    const m = patch[key];
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error(key + ' must be an object of {unitId: skinId|null}');
    for (const unitId of Object.keys(m)) {
      const v = m[unitId];
      if (!unitId) throw new Error(key + ': unit id must be a non-empty string');
      if (v === null) continue; // clears back to the default -- always legal
      if (typeof v !== 'string' || !v) throw new Error(key + '.' + unitId + ' must be a skin id string or null');
      if (!skinDefsById) continue; // shape-only
      const def = skinDefsById[v];
      if (!def) throw new Error(key + '.' + unitId + ': no such unit_skin "' + v + '"');
      if (def.slot !== key) {
        throw new Error(key + '.' + unitId + ': unit_skin "' + v + '" has slot "' + def.slot + '", which cannot be written to the "' + key + '" map');
      }
      const units = Array.isArray(def.units) ? def.units : [];
      if (units.indexOf(unitId) < 0) {
        throw new Error(key + '.' + unitId + ': unit_skin "' + v + '" does not list unit "' + unitId + '" in its units[]');
      }
    }
  }
  return true;
}

/** The selection as the RESOLVER should see it: any pick whose skin id is no
 * longer in the corpus is dropped, so it reads as ABSENT and the unit falls back
 * to its default. A deleted or renamed skin must never blank a unit (D-B). With
 * no corpus supplied the selection is returned normalized but unfiltered. */
function resolveSkinPrefs(prefs, skinDefsById) {
  const src = prefsFromDoc(prefs);
  if (!skinDefsById) return src;
  const out = emptySkinPrefs();
  for (const slot of UNIT_SKIN_SLOTS) {
    for (const unitId of Object.keys(src[slot])) {
      const def = skinDefsById[src[slot][unitId]];
      if (!def) continue;              // deleted skin -> absent -> default
      if (def.slot !== slot) continue; // re-slotted skin -> absent -> default
      out[slot][unitId] = src[slot][unitId];
    }
  }
  return out;
}

module.exports = {
  SKIN_PREFS_DIR, skinPrefsPath,
  readSkinPrefs, writeSkinPrefs, deleteSkinPrefs,
  getSkinPrefs, mergeSkinPrefs,
  emptySkinPrefs, prefsFromDoc,
  validateSkinPrefsPatch, resolveSkinPrefs,
};
