#!/usr/bin/env node
'use strict';
// tools/seed_registry_e2e.cjs -- REQ-0221. Seed ONE adopted content def into
// THIS process's pg namespace so a registry-first e2e harness has a
// registry-served item to assert against. The CALLER owns the HOME remap
// (storage.cjs keys its namespace off os.homedir()); this script never
// touches the live namespace by construction. Mirrors the rig of
// server/tests/content_serving_test.cjs, minus the homedir monkey-patch.
if (!process.env.DATABASE_URL) { console.error('[seed-registry] DATABASE_URL required'); process.exit(1); }
process.env.STORAGE_BACKEND = 'pg';
const fs = require('node:fs');
const path = require('node:path');
const WT = path.join(__dirname, '..');
const storage = require(path.join(WT, 'server', 'storage.cjs'));
const liveItems = JSON.parse(fs.readFileSync(path.join(WT, 'content', 'live', 'live_items.json'), 'utf8'));
const PO = liveItems.entries.find((e) => e.effects && e.effects.length) || liveItems.entries[0];

async function main() {
  // Namespace-scoped wipe: reruns against a reused namespace (the HOME remap
  // symlinks back to the worktree, so the hash can repeat across runs) must
  // be deterministic -- exactly one def, adopted.
  await storage.clearAllContent();
  const def = await storage.createContentDef({
    system_name: PO.id, kind: 'po_def',
    brief: 'REQ-0221 registry-first e2e seed', schema_ref: 'po/2',
  });
  const data = JSON.parse(JSON.stringify(PO));
  data.name = PO.name + ' [REGISTRY]';
  const v = await storage.createVariant(def.id, {
    data,
    provenance: { source: 'llm', model: 'seed', model_version: 'req-0221', prompt: 'registry-first e2e seed', params: {}, seed_if_any: null },
  });
  await storage.adoptVariant(PO.id, v.variant_no);
  console.log('[seed-registry] adopted ' + PO.id + ' variant ' + v.variant_no + ' (kind po_def)');
  process.exit(0);
}
main().catch((e) => { console.error('[seed-registry] FAILED:', e); process.exit(1); });
