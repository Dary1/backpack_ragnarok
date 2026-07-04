#!/usr/bin/env node
// backpack_ragnarok — server/tool_migrate_to_pg.cjs
// REQ-0040: imports existing data/profiles/*.json + data/players/*.json
// into Postgres's `profiles` table (players.cjs itself stays on the
// files backend -- see server/README.md's "Postgres backend" scope
// note -- so this script's players.cjs step is a READ-ONLY sanity pass:
// it confirms every profile's owning player still resolves, it does NOT
// write a players table row, since none of this repo's code reads
// players from pg today).
//
// Idempotent: uses the exact same upsert (INSERT ... ON CONFLICT ... DO
// UPDATE) storage.cjs's writeProfilePg() uses, so re-running this script
// against already-migrated data simply re-writes the same rows (safe,
// no duplicate-key errors, no drift if run twice).
//
// Usage:
//   DATABASE_URL=postgresql://backpack:...@127.0.0.1:6543/postgres \
//     node server/tool_migrate_to_pg.cjs
//
// Uses the real (un-remapped) os.homedir() -- this script is meant to be
// run by hand against the real ~/backpack_ragnarok/data tree, not a test
// fixture.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Client } = require('pg');

const REPO_ROOT = path.join(os.homedir(), 'backpack_ragnarok');
const PROFILES_DIR = path.join(REPO_ROOT, 'data', 'profiles');
const PLAYERS_DIR = path.join(REPO_ROOT, 'data', 'players');

// Same namespacing scheme as storage.cjs's NAMESPACE constant -- a hash
// of the repo root path -- so rows this script writes land under the
// EXACT same keys the real running server (STORAGE_BACKEND=pg, same
// real homedir) will look up.
const NAMESPACE = crypto.createHash('sha256').update(REPO_ROOT).digest('hex').slice(0, 16);
function namespacedId(id) {
  return NAMESPACE + ':' + id;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (see server/.env.example)');
    process.exit(1);
  }

  if (!fs.existsSync(PROFILES_DIR)) {
    console.log('No data/profiles/ directory found -- nothing to migrate.');
    return;
  }

  const playerIds = new Set();
  if (fs.existsSync(PLAYERS_DIR)) {
    for (const f of fs.readdirSync(PLAYERS_DIR)) {
      if (f.endsWith('.json') && !f.startsWith('.')) playerIds.add(f.replace(/\.json$/, ''));
    }
  }

  const files = fs.readdirSync(PROFILES_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  console.log('Found ' + files.length + ' profile file(s) in ' + PROFILES_DIR);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  let migrated = 0;
  let skippedLegacyDefault = 0;
  try {
    for (const f of files) {
      const id = f.replace(/\.json$/, '');
      // data/profiles/default.json is the pre-REQ-0037 legacy file, not
      // a real player id (storage.cjs's readProfile() only ever falls
      // back to reading it for the 'dev' player -- see storage.cjs). It
      // has no corresponding player registry entry, so it is not a
      // migratable profile row on its own; skip it here (the 'dev'
      // profile itself, if data/profiles/dev.json already exists, is
      // migrated normally below like any other profile).
      if (id === 'default') {
        skippedLegacyDefault++;
        continue;
      }
      if (!playerIds.has(id)) {
        console.warn('WARNING: profile "' + id + '" has no matching data/players/' + id + '.json registry entry -- migrating anyway (storage.cjs would reject writes to it via the API, but the row is preserved for the record).');
      }
      const raw = fs.readFileSync(path.join(PROFILES_DIR, f), 'utf8');
      const doc = JSON.parse(raw);
      await client.query(
        'INSERT INTO profiles (player_id, doc, updated_at) VALUES ($1, $2::jsonb, now()) ' +
        'ON CONFLICT (player_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at',
        [namespacedId(id), JSON.stringify(doc)]
      );
      migrated++;
      console.log('  migrated: ' + id);
    }
  } finally {
    await client.end();
  }

  console.log('Done. Migrated ' + migrated + ' profile(s), skipped ' + skippedLegacyDefault + ' legacy default.json.');
}

main().catch((e) => {
  console.error('Migration failed: ' + e.message);
  process.exit(1);
});
