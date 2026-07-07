#!/usr/bin/env node
// backpack_ragnarok — server/tool_prune_pg_profiles.cjs
// REQ-0089: maintenance tool. The pg `profiles` table is shared by the
// live deployment AND every pg-mode test run (server `test:pg`, plus any
// api server booted from a throwaway HOME). storage.cjs namespaces each
// row's player_id with sha256(REPO_ROOT)[:16] for test isolation, so test
// runs accrete rows under NON-live namespaces that were never cleaned up
// (observed at REQ-0089 time: ~1085 rows across ~181 namespaces, only one
// of which -- the live deployment's -- is real). This tool deletes every
// profiles row whose namespace is NOT the current live deployment's,
// leaving the live namespace's rows fully intact.
//
// SAFE BY DEFAULT: dry-run (report only) unless --apply is passed.
//   node server/tool_prune_pg_profiles.cjs            # dry run
//   node server/tool_prune_pg_profiles.cjs --apply    # actually delete
// Requires DATABASE_URL. Run as the deploy user from the LIVE repo root so
// os.homedir() yields the live namespace to KEEP.
'use strict';
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const REPO_ROOT = path.join(os.homedir(), 'backpack_ragnarok');
const LIVE_NS = crypto.createHash('sha256').update(REPO_ROOT).digest('hex').slice(0, 16);
const APPLY = process.argv.includes('--apply');

(async () => {
  const cs = process.env.DATABASE_URL;
  if (!cs) { console.error('DATABASE_URL is required'); process.exit(2); }
  const pool = new Pool({ connectionString: cs, max: 2 });
  try {
    console.log('live namespace (KEEP):', LIVE_NS, ' repo root:', REPO_ROOT);
    const total = (await pool.query('select count(*)::int n from profiles')).rows[0].n;
    const live = (await pool.query('select count(*)::int n from profiles where player_id like $1', [LIVE_NS + ':%'])).rows[0].n;
    const nsCount = (await pool.query('select count(distinct split_part(player_id, $1, 1))::int n from profiles', [':'])).rows[0].n;
    console.log('profiles total=' + total + '  live=' + live + '  to-prune=' + (total - live) + '  distinct-namespaces=' + nsCount);
    if (!APPLY) { console.log('DRY RUN -- pass --apply to delete the ' + (total - live) + ' non-live rows.'); return; }
    const res = await pool.query('delete from profiles where player_id not like $1', [LIVE_NS + ':%']);
    const after = (await pool.query('select count(*)::int n from profiles')).rows[0].n;
    const liveAfter = (await pool.query('select count(*)::int n from profiles where player_id like $1', [LIVE_NS + ':%'])).rows[0].n;
    console.log('DELETED ' + res.rowCount + ' rows. profiles now=' + after + ' (live=' + liveAfter + ', live-unchanged=' + (live === liveAfter) + ').');
  } catch (e) {
    console.error('prune failed:', e.message); process.exit(1);
  } finally { await pool.end(); }
})();
