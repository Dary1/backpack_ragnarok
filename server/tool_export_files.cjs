#!/usr/bin/env node
// backpack_ragnarok — server/tool_export_files.cjs
// REQ-0040: dumps every profile row in Postgres back out to
// <outDir>/profiles/<id>.json, using the SAME JSON.stringify formatting
// storage.cjs's files backend has always used (JSON.stringify(doc, null,
// 1) -- see storage.cjs's writeProfileFiles()).
//
// IMPORTANT (jsonb key-order caveat): Postgres's `jsonb` column type is a
// decomposed BINARY representation, not text-preserving -- top-level and
// nested object keys come back out in jsonb's own canonical (alphabetical)
// order, regardless of the order the original JSON file had them in. This
// is standard, documented Postgres behavior (see "jsonb ... does not
// preserve ... the order of object keys" in the Postgres manual), not a
// bug in this script or in storage.cjs's writeProfilePg(). Practically:
// a re-exported file will NOT be byte-identical to the original at the
// text level (key order differs), but IS semantically/data identical --
// verify with a parsed deep-equality check (`assert.deepStrictEqual(
// JSON.parse(original), JSON.parse(exported))`), not a raw `diff`/sha256
// of file bytes. See server/README.md's "Postgres backend" section for
// the exact verification command this REQ's migration used.
//
// Also serves as the backup-parity path the REQ calls for: run this any
// time to get a plain-JSON-files snapshot of whatever is currently in
// Postgres, independent of pg's own backup/WAL story.
//
// Usage:
//   DATABASE_URL=postgresql://backpack:...@127.0.0.1:6543/postgres \
//     node server/tool_export_files.cjs <outDir>
// <outDir>/profiles/ is created if missing. Existing files in it are
// overwritten; nothing else in <outDir> is touched or deleted.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Client } = require('pg');

const REPO_ROOT = path.join(os.homedir(), 'backpack_ragnarok');
const NAMESPACE = crypto.createHash('sha256').update(REPO_ROOT).digest('hex').slice(0, 16);
const PREFIX = NAMESPACE + ':';

async function main() {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error('Usage: node server/tool_export_files.cjs <outDir>');
    process.exit(1);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (see server/.env.example)');
    process.exit(1);
  }

  const profilesOutDir = path.join(outDir, 'profiles');
  fs.mkdirSync(profilesOutDir, { recursive: true });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  let count = 0;
  try {
    const res = await client.query('SELECT player_id, doc FROM profiles WHERE player_id LIKE $1', [PREFIX + '%']);
    for (const row of res.rows) {
      const id = row.player_id.slice(PREFIX.length);
      const json = JSON.stringify(row.doc, null, 1);
      fs.writeFileSync(path.join(profilesOutDir, id + '.json'), json, 'utf8');
      count++;
      console.log('  exported: ' + id);
    }
  } finally {
    await client.end();
  }

  console.log('Done. Exported ' + count + ' profile(s) to ' + profilesOutDir);
}

main().catch((e) => {
  console.error('Export failed: ' + e.message);
  process.exit(1);
});
