// backpack_ragnarok — server/storage/bio.cjs
// REQ-0060: per-BP-instance Pack Biography ledger persistence. Server-
// AUTHORITATIVE: a bio is derived at run settle from replay/settlement
// data the server already has and must never be forgeable by the client,
// so it lives in its OWN storage root (NOT the client-owned profile
// canvas, which writeProfile() overwrites wholesale on every PUT), keyed
// by the BP instance uid (canvas bps[].id === sim bpId === gacha-minted
// uid). Files + pg backends + backend-dispatching public fns kept
// adjacent, mirroring storage/seals.cjs / storage/runs.cjs exactly.
//   files: data/bio/<bpUid>.json   |   pg: bp_bio(bp_uid, doc, updated_at)
'use strict';
const fs = require('fs');
const path = require('path');
const { backendMode, namespacedId, REPO_ROOT, atomicWriteJSON } = require('./lib.cjs');

const BIO_DIR = path.join(REPO_ROOT, 'data', 'bio');

function bioPath(uid) { return path.join(BIO_DIR, uid + '.json'); }

// ---- files backend ----
function readBioFiles(uid) {
  const p = bioPath(uid);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeBioFiles(uid, doc) {
  atomicWriteJSON(BIO_DIR, bioPath(uid), doc);
  return doc;
}
function listBiosFiles() {
  if (!fs.existsSync(BIO_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(BIO_DIR)) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(BIO_DIR, f), 'utf8'))); } catch (e) { /* skip */ }
  }
  return out;
}

// ---- pg backend ----
function readBioPg(uid) {
  const { querySync } = require('../pg_sync.cjs');
  const res = querySync('SELECT doc FROM bp_bio WHERE bp_uid = $1', [namespacedId(uid)]);
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeBioPg(uid, doc) {
  const { querySync } = require('../pg_sync.cjs');
  querySync(
    'INSERT INTO bp_bio (bp_uid, doc, updated_at) VALUES ($1, $2::jsonb, now()) ' +
    'ON CONFLICT (bp_uid) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at',
    [namespacedId(uid), JSON.stringify(doc)]
  );
  return doc;
}
function listBiosPg() {
  const { querySync } = require('../pg_sync.cjs');
  const res = querySync('SELECT doc FROM bp_bio WHERE bp_uid LIKE $1', [namespacedId('') + '%']);
  return res.rows.map((r) => r.doc);
}

// ---- public API (backend-dispatching) ----
function readBio(uid) { return backendMode() === 'pg' ? readBioPg(uid) : readBioFiles(uid); }
function writeBio(uid, doc) { return backendMode() === 'pg' ? writeBioPg(uid, doc) : writeBioFiles(uid, doc); }
function listBios() { return backendMode() === 'pg' ? listBiosPg() : listBiosFiles(); }

module.exports = { BIO_DIR, bioPath, readBio, writeBio, listBios };
