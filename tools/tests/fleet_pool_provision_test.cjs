'use strict';
// tools/tests/fleet_pool_provision_test.cjs -- REQ-0329 seed-logic gate.
//
// Proves the provisioning tool's SEED (buildStarterUnitsState ->
// engine.migrateState) produces a canvas that (a) satisfies checkUidInvariant
// and (b) has a DEPLOYABLE squad 0 -- the two acceptance invariants -- against
// the REAL content/live defs, with NO network (local file reads only, the same
// posture as shared/tests/player_actions.cjs G4(e)). Also covers the idempotent
// name selection (never re-uses an already-provisioned name; never bot_NN).
const fs = require('fs');
const path = require('path');
const Engine = require('../../shared/engine.js');
const tool = require('../fleet_pool_provision.cjs');

let fails = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { console.error('FAIL:', msg); fails++; } else { console.log('ok  :', msg); }
}

const ROOT = path.join(__dirname, '..', '..');
const LIVE = path.join(ROOT, 'content', 'live');
function loadEntries(file) {
  const doc = JSON.parse(fs.readFileSync(path.join(LIVE, file), 'utf8'));
  const map = {};
  for (const e of doc.entries || []) map[e.id] = e;
  return map;
}
function fixtureGameData() {
  const vocab = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'vocab.json'), 'utf8'));
  return {
    // Starter POs are live_items + starter_items ids -- migrateState needs the
    // real ITEMS map to home them, exactly as boot.ts does with served GameData.
    ITEMS: Object.assign({}, loadEntries('live_items.json'), loadEntries('starter_items.json')),
    SI_DEFS: loadEntries('live_sis.json'),
    UNITS: loadEntries('live_units.json'),
    LAYOUT: { ROWS: 8, COLS: 8 },
    TREES: { po: vocab.po_tags || {}, socket: vocab.socket_tags || {} },
    CONN_SHAPES: vocab.connection_shapes || {},
    starterUnits: JSON.parse(fs.readFileSync(path.join(LIVE, 'starter_units.json'), 'utf8')),
  };
}

async function main() {
  const gd = fixtureGameData();

  for (const locale of ['en', 'ja']) {
    const state = await tool.buildSeededCanvas(gd, locale);
    // Re-check independently with a fresh engine -- don't trust the tool's own
    // internal throw; the gate must observe the invariants on the RETURNED state.
    const E = Engine.create(gd.ITEMS, gd.SI_DEFS, gd.LAYOUT, gd.TREES, gd.UNITS, gd.CONN_SHAPES);
    ok(E.checkUidInvariant(state).ok, '[' + locale + '] seeded canvas satisfies checkUidInvariant');
    ok(E.isSquadDeployable(state, 0) === true, '[' + locale + '] squad 0 is deployable (isSquadDeployable)');
    ok(state.inv && Array.isArray(state.inv.pages) && state.inv.pages.length === E.PAGE_COUNT,
      '[' + locale + '] gains a full inventory through migrateState');
    ok(state.presets && Array.isArray(state.presets.store) && state.presets.store.length >= 4,
      '[' + locale + '] carries the starter squad slots');
    ok(Array.isArray(state.bps) && state.bps.length >= 1,
      '[' + locale + '] squad 0 canvas carries at least one starter BP');
  }

  // Content with no starterUnits must FAIL loudly (never seed an empty canvas).
  let threw = false;
  try { await tool.buildSeededCanvas(Object.assign({}, gd, { starterUnits: null }), 'en'); }
  catch (e) { threw = true; }
  ok(threw, 'no starterUnits -> buildSeededCanvas throws (never seeds an undeployable canvas)');

  // Idempotent, human-plausible name selection.
  const pool = tool.namePool();
  ok(pool.length >= 200, 'name pool has ample unique names for top-up (got ' + pool.length + ')');
  ok(new Set(pool).size === pool.length, 'name pool entries are all distinct');
  ok(!pool.some((n) => /bot[_ ]?\d/i.test(n)), 'no bot_NN style names (human-equivalent, per item 2)');
  const alreadyUsed = pool.slice(0, 10);
  const chosen = tool.chooseNames(15, alreadyUsed);
  ok(chosen.length === 15, 'chooseNames returns exactly the requested count');
  ok(chosen.every((n) => !alreadyUsed.includes(n)), 'chooseNames never re-uses an already-provisioned name');
  ok(new Set(chosen).size === chosen.length, 'chooseNames returns distinct names');

  console.log(fails
    ? ('\nfleet_pool_provision: ' + fails + '/' + checks + ' FAILED')
    : ('\nfleet_pool_provision: all green (' + checks + ' checks)'));
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
