// backpack_ragnarok — server/tests/api_test.cjs
// REQ-0024: storage round-trip + content endpoint shape + profile PUT/GET + oversized body.
// REQ-0035: /api/me + admin item-edit endpoint (validation, 403 guard, real-repo round-trip).
// REQ-0037: token-based auth (player registry, /api/me resolution, profile
// ownership guard, admin guard migrated off X-Player-Id, dev_mode fallback).
// Runs against synthetic temp HOME dirs so it never touches the real
// ~/backpack_ragnarok/data/ or content/ trees.
//
// REQ-0145a (sf): this file is now the thin ENTRY POINT over the split
// suite (server/tests/api/*.cjs) -- `node server/tests/api_test.cjs`
// and tools/ci.sh stay valid verbatim. The require order below IS the
// monolith's own top-to-bottom execution order and must never be
// reordered: later groups assert against server state earlier groups
// created, and the homedir/module-generation epochs (tmpHome unit
// tests -> fakeRepoHome boot -> real-homedir admin test -> dz* re-swap)
// are position-dependent. Suite headers carry their origin line ranges
// (all @ commit 46cd881).
//
// PARITY GATE: harness counts every executed assertion; the pre-split
// monolith executed 1213 per backend (files AND pg). summary() prints
// the tally -- compare when touching the suite.
'use strict';
const h = require('./api/harness.cjs'); // tmpHome epoch + T/AT + parity counter

require('./api/profile.cjs').runStorageUnit(h); // origin 43-129: players/storage unit tests (tmpHome epoch)
h.boot(); // origin 131-338: fakeRepoHome fixture + api boot + mock helpers
require('./api/public.cjs').runSync(h); // origin 341-398: health + content shape
require('./api/admin.cjs').runSync(h); // origin 400-647: me/resolveAuth/applyAdminEdit/migrate_i18n

async function main() {
  await require('./api/profile.cjs').run(h); // origin 650-790: /api/profile routes
  await require('./api/admin.cjs').run(h); // origin 792-1015: /api/admin routes (item edit + grant)
  await require('./api/schedule.cjs').run(h); // origin 1016-1482: P1-B core + shared fixtures
  await require('./api/seal.cjs').run(h); // REQ-0058: sealed seed share -- runs on the pristine fixture dungeon (before schedule_ops autogen mutates content/live/dungeon)
  await require('./api/warehouse.cjs').run(h); // origin 1483-1665: rewards/cap/two-phase claim
  await require('./api/workshop.cjs').run(h); // origin 1666-1834: gacha
  await require('./api/schedule_ops.cjs').run(h); // origin 1835-2445: normalization/policies/P1-C/dev seams/autogen
  await require('./api/market.cjs').run(h); // origin 2446-2927: market
  await require('./api/ragnarok.cjs').run(h); // origin 2928-3603: ragnarok + REAL-repo admin test
  await require('./api/dismantle.cjs').run(h); // origin 3604-3913: dismantle (dz* epoch)
  await require('./api/dex.cjs').run(h); // origin 3914-4014: dex cards
  await require('./api/starter.cjs').run(h); // REQ-0051: starter-unit claim endpoint
  h.summary();
}

main();
