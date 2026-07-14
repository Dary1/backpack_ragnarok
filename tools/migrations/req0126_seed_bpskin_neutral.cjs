#!/usr/bin/env node
'use strict';
// tools/migrations/req0126_seed_bpskin_neutral.cjs -- REQ-0126.
// Seeds an EXPLICIT neutral cosmetic-skin slot for every pre-existing BP
// instance across all profiles ("no skin ref = neutral"). The BP skin slot is a
// NEW concept, so before this migration no profile's BPs carry one; resolution
// already treats a missing slot as neutral, but this makes the default EXPLICIT,
// auditable and idempotent. Enumerates BP uids by deep-walking each profile doc
// for any `bps` array element with a string `id` (canvas + squad presets +
// inventory pages), matching the REQ-0170 purge's traversal. Files backend
// (like req0170); for a pg deployment the same default holds by absence, so no
// row migration is required there.
//   node tools/migrations/req0126_seed_bpskin_neutral.cjs           # dry run
//   node tools/migrations/req0126_seed_bpskin_neutral.cjs --apply    # write
// Env (tests): BPK_PROFILES_DIR, BPK_BPSKIN_DIR. Idempotent (2nd run seeds 0).
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const DEF_PROFILES = process.env.BPK_PROFILES_DIR || path.join(REPO, 'data', 'profiles');
const DEF_BPSKIN = process.env.BPK_BPSKIN_DIR || path.join(REPO, 'data', 'bpskin');
function collectBpIds(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const x of node) collectBpIds(x, out); return; }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'bps' && Array.isArray(v)) { for (const bp of v) { if (bp && typeof bp === 'object' && typeof bp.id === 'string') out.add(bp.id); collectBpIds(bp, out); } }
    else collectBpIds(v, out);
  }
}
function run(opts) {
  const apply = !!(opts && opts.apply);
  const profilesDir = (opts && opts.profilesDir) || DEF_PROFILES;
  const bpskinDir = (opts && opts.bpskinDir) || DEF_BPSKIN;
  const ids = new Set();
  if (fs.existsSync(profilesDir)) {
    for (const f of fs.readdirSync(profilesDir)) {
      if (!f.endsWith('.json') || f.startsWith('.')) continue;
      let doc; try { doc = JSON.parse(fs.readFileSync(path.join(profilesDir, f), 'utf8')); } catch (e) { continue; }
      collectBpIds(doc, ids);
    }
  }
  let seeded = 0, existing = 0;
  for (const uid of ids) {
    const p = path.join(bpskinDir, uid + '.json');
    if (fs.existsSync(p)) { existing++; continue; }
    seeded++;
    if (apply) {
      fs.mkdirSync(bpskinDir, { recursive: true });
      const doc = { bp_uid: uid, skin_id: null, seeded_by: 'req0126', updated_at: new Date().toISOString() };
      const tmp = path.join(bpskinDir, '.' + uid + '.tmp');
      fs.writeFileSync(tmp, JSON.stringify(doc, null, 1));
      fs.renameSync(tmp, p);
    }
  }
  return { totalBps: ids.size, seeded, existing, apply };
}
if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const res = run({ apply });
  console.log(`[req0126 seed] BPs=${res.totalBps} already=${res.existing} ${apply ? 'seeded' : 'would seed'}=${res.seeded}`);
  if (!apply) console.log('(dry run; pass --apply to write)');
}
module.exports = { run, collectBpIds };
