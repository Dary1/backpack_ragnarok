// backpack_ragnarok -- server/storage/bpskin_slot.cjs
// REQ-0126: per-BP-instance COSMETIC SKIN SLOT persistence. A skin is an
// instance-level cosmetic on a BP (two BPs of one def can wear different skins),
// so -- exactly like the pack-biography ledger (storage/bio.cjs) -- it lives in
// its OWN storage root keyed by the BP instance uid (canvas bps[].id === sim
// bpId === gacha-minted uid), NOT in the client-owned profile canvas (which
// writeProfile() overwrites wholesale on every PUT). Files + pg backends +
// backend-dispatching public fns kept adjacent, mirroring storage/bio.cjs.
// storage.cjs re-exports these so it stays THE single persistence chokepoint.
//   files: data/bpskin/<bpUid>.json   |   pg: bp_skin(bp_uid, doc, updated_at)
// A slot doc is { bp_uid, skin_id, updated_at }; skin_id null (or a missing
// slot) resolves to the neutral default -- absence never blocks rendering.
'use strict';
const fs = require('fs');
const path = require('path');
const { backendMode, namespacedId, REPO_ROOT, atomicWriteJSON } = require('./lib.cjs');
const SKIN_DIR = path.join(REPO_ROOT, 'data', 'bpskin');
function skinSlotPath(uid) { return path.join(SKIN_DIR, uid + '.json'); }
function readSlotFiles(uid) { const p = skinSlotPath(uid); if (!fs.existsSync(p)) return null; return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeSlotFiles(uid, doc) { atomicWriteJSON(SKIN_DIR, skinSlotPath(uid), doc); return doc; }
function deleteSlotFiles(uid) { const p = skinSlotPath(uid); if (fs.existsSync(p)) fs.unlinkSync(p); }
function listSlotsFiles() { if (!fs.existsSync(SKIN_DIR)) return []; const out = []; for (const f of fs.readdirSync(SKIN_DIR)) { if (!f.endsWith('.json') || f.startsWith('.')) continue; try { out.push(JSON.parse(fs.readFileSync(path.join(SKIN_DIR, f), 'utf8'))); } catch (e) { /* skip */ } } return out; }
function readSlotPg(uid) { const { querySync } = require('../pg_sync.cjs'); const r = querySync('SELECT doc FROM bp_skin WHERE bp_uid = $1', [namespacedId(uid)]); return r.rows.length > 0 ? r.rows[0].doc : null; }
function writeSlotPg(uid, doc) { const { querySync } = require('../pg_sync.cjs'); querySync('INSERT INTO bp_skin (bp_uid, doc, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (bp_uid) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at', [namespacedId(uid), JSON.stringify(doc)]); return doc; }
function deleteSlotPg(uid) { const { querySync } = require('../pg_sync.cjs'); querySync('DELETE FROM bp_skin WHERE bp_uid = $1', [namespacedId(uid)]); }
function listSlotsPg() { const { querySync } = require('../pg_sync.cjs'); const r = querySync('SELECT doc FROM bp_skin WHERE bp_uid LIKE $1', [namespacedId('') + '%']); return r.rows.map((x) => x.doc); }
function readSkinSlot(uid) { return backendMode() === 'pg' ? readSlotPg(uid) : readSlotFiles(uid); }
function writeSkinSlot(uid, doc) { return backendMode() === 'pg' ? writeSlotPg(uid, doc) : writeSlotFiles(uid, doc); }
function deleteSkinSlot(uid) { return backendMode() === 'pg' ? deleteSlotPg(uid) : deleteSlotFiles(uid); }
function listSkinSlots() { return backendMode() === 'pg' ? listSlotsPg() : listSlotsFiles(); }
function setBpSkin(uid, skinId) { const doc = { bp_uid: uid, skin_id: (typeof skinId === 'string' && skinId) ? skinId : null, updated_at: new Date().toISOString() }; return writeSkinSlot(uid, doc); }
function getBpSkinId(uid) { const d = readSkinSlot(uid); return d && typeof d.skin_id === 'string' ? d.skin_id : null; }
module.exports = { SKIN_DIR, skinSlotPath, readSkinSlot, writeSkinSlot, deleteSkinSlot, listSkinSlots, setBpSkin, getBpSkinId };
