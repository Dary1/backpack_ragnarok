'use strict';
// server/tests/api/harness.cjs -- REQ-0145a (sf): THE api_test harness.
// Everything the suite files share: the T/AT runners + pass/fail
// counters, the executed-assertion parity counter, the tmpHome epoch
// (players/storage unit-test sandbox), the storage-subtree eviction
// seam, boot() (the synthetic fakeRepoHome content fixture + api module
// boot + fixture players + mock req/res helpers), and summary().
// Cut VERBATIM from server/tests/api_test.cjs origin lines 1-42 and
// 131-338 @ commit 46cd881 (only require paths adjusted).
//
// PARITY GATE (REQ-0145a sf): every assert.* call is counted; the
// summary prints the total. The pre-split monolith executed 1213
// assertions per backend -- the split suite must match exactly.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// REQ-0145a (sf): executed-assertion parity instrumentation. The assert
// MODULE OBJECT is patched in place, so every suite file's own
// require('assert') returns the counting wrapper -- one shared tally.
let assertsExecuted = 0;
for (const k of ['fail', 'ok', 'equal', 'notEqual', 'deepEqual', 'notDeepEqual',
  'strictEqual', 'notStrictEqual', 'deepStrictEqual', 'notDeepStrictEqual',
  'throws', 'doesNotThrow', 'rejects', 'doesNotReject', 'match', 'doesNotMatch', 'ifError']) {
  const orig = assert[k];
  if (typeof orig !== 'function') continue;
  assert[k] = function (...args) { assertsExecuted += 1; return orig.apply(this, args); };
}

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + ' — ' + e.message); fail++; }
}
async function AT(name, fn) {
  try { await fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + ' — ' + e.message); fail++; }
}

// ---- storage.cjs / players.cjs tests: redirect os.homedir() before first require ----
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-api-test-'));
const realHomedir = os.homedir;
os.homedir = () => tmpHome;
const players = require('../../players.cjs');
const storage = require('../../storage.cjs');

// REQ-0145a (sb): server/storage.cjs is becoming a facade over server/storage/*.
// The homedir-remap tests below evict + re-require the storage layer to rebind
// its homedir-derived paths/namespace; that eviction must cover the WHOLE
// storage subtree (evicting the facade alone would leave stale entity modules
// bound to the previous homedir in require.cache).
function evictStorageAndPlayers() {
  for (const m of ['../../players.cjs', '../../storage.cjs']) delete require.cache[require.resolve(m)];
  for (const k of Object.keys(require.cache)) {
    if (k.includes(path.sep + 'server' + path.sep + 'storage' + path.sep)) delete require.cache[k];
  }
}


// boot(): the fakeRepoHome fixture tree + api module boot + fixture
// players + mock req/res helpers -- origin lines 131-338, verbatim. Runs
// ONCE, after the tmpHome-epoch unit tests (profile.runStorageUnit),
// exactly where this code sat in the monolith's own top-to-bottom flow.
let booted = false;
function boot() {
  if (booted) throw new Error('harness.boot() must run exactly once');
  booted = true;
// api.cjs resolves content paths from os.homedir() at call time (inside
// buildContentPayload), so we point homedir at a synthetic repo tree with
// minimal content/live + vocab fixtures before loading api.cjs.
const fakeRepoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-api-repo-'));
const repoRoot = path.join(fakeRepoHome, 'backpack_ragnarok');
const contentDir = path.join(repoRoot, 'content');
const liveDir = path.join(contentDir, 'live');
fs.mkdirSync(liveDir, { recursive: true });
fs.writeFileSync(path.join(contentDir, 'vocab.json'), JSON.stringify({
  version: 1,
  po_tags: { Weapon: null, WeaponPart: 'Weapon', Metal: null },
  socket_tags: { gem: null, edge: null, Metal: null },
  triggers: ['every_secs', 'battle_start', 'adjacent', 'passive', 'host_on_hit', 'on_hit', 'on_bp_damaged'],
  verbs: ['strike', 'multi_strike', 'block', 'heal_bp', 'apply_status', 'add_on_hit_status', 'amp_status', 'buff_host'],
  statuses: ['Burn', 'Poison', 'Chill', 'Regen', 'Spikes', 'Stun', 'Weakness', 'Haste'],
  rarities: ['Common', 'Uncommon', 'Rare', 'Relic'],
  // REQ-0170: the ratified connection_shapes table (the subset the fixtures use).
  // Shapes are what a Unit's rays ARE now, so a fixture vocab without them would
  // make every fixture BP link-less -- and the workshop tests below assert on a
  // rolled unit's shape.
  connection_shapes: {
    queen: { ja: 'クイーン', kind: 'ray', dirs: [0, 1, 2, 3, 4, 5, 6, 7], range: null, pierce: false },
    rook: { ja: '飛車', kind: 'ray', dirs: [0, 2, 4, 6], range: null, pierce: false },
    none: { ja: '接続なし', kind: 'none', dirs: [], range: 0, pierce: false },
    chess_knight_move: { ja: 'チェス・ナイトの動き', kind: 'offset', offsets: [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]] },
  },
}));
fs.writeFileSync(path.join(liveDir, 'live_items.json'), JSON.stringify({
  schema: 'po/2',
  entries: [
    { id: 'blade', name: 'Blade', tags: ['Weapon'], shape: [[0, 0]] },
    { id: 'fx_dagger', name: 'FX Dagger', tags: ['Weapon'], shape: [[0, 0]],
      effects: [{ trigger: { t: 'battle_start' }, verb: { t: 'strike', n: [5, 9] } }] },
    // REQ-0036 P1-B: an actively-attacking PO (every_secs + attack_profile)
    // for the schedule test dungeon fixture above -- guarantees a fast,
    // deterministic kill of the 1hp weak_slime fixture enemy, so test runs
    // have a small, predictable durationSecs.
    { id: 'test_sword', name: 'Test Sword', tags: ['Weapon'], shape: [[0, 0]],
      effects: [{ trigger: { t: 'every_secs', s: [1.0, 1.0] }, verb: { t: 'strike', n: [50, 50] },
        attack_profile: { edge: ['top'], direction: 'front', penetration: 0, aoe: 0, aoe_statuses: false } }] },
  ],
}));
fs.writeFileSync(path.join(liveDir, 'live_sis.json'), JSON.stringify({
  schema: 'si/2',
  entries: [
    { id: 'acc_gem', name: 'Gem', slot: 'gem', reqTags: [] },
    { id: 'fx_ring', name: 'FX Ring', slot: 'gem', reqTags: [],
      effects: [{ trigger: { t: 'passive' }, verb: { t: 'buff_host', n: [2, 4], stat: 'damage' } }] },
  ],
}));
// REQ-0042: TM (Transmutator) content fixture -- api.cjs's
// buildContentPayload() now unconditionally loads live_tms.json alongside
// live_items.json/live_sis.json, so the synthetic fixture tree needs one
// too (else GET /api/content 500s with ENOENT, exactly like it would if
// live_items.json/live_sis.json were ever missing here).
fs.writeFileSync(path.join(liveDir, 'live_tms.json'), JSON.stringify({
  schema: 'tm/1',
  entries: [
    { id: 'lrdst', name: 'UnitRandomDirectionShuffleTransmutator', short: 'LRDST',
      rarity: 'Common', icon: 'icon-lrdst', stackable: true },
  ],
}));
// REQ-0170: unit/1 defs + the gacha pack. buildContentPayload() and
// getScheduleContent() both load these unconditionally, exactly as they do
// live_items/live_sis/live_tms -- so the synthetic tree needs them or every
// content read 500s with ENOENT. The pool is deliberately three units with three
// DIFFERENT shape kinds (ray-8 / ray-4 / offset / none), so a workshop roll test
// can assert the rolled unit is a real def and its shape a real vocab key.
fs.writeFileSync(path.join(liveDir, 'live_units.json'), JSON.stringify({
  schema: 'unit/1',
  entries: [
    { id: 'test_queen', name: 'Test Queen', rarity: 'Common', icon: 'art:test_queen', connection_shape: 'queen', i18n: { ja: { name: 'テストクイーン' } } },
    { id: 'test_rook', name: 'Test Rook', rarity: 'Common', icon: 'art:test_rook', connection_shape: 'rook', i18n: { ja: { name: 'テストルーク' } } },
    { id: 'test_loner', name: 'Test Loner', rarity: 'Common', icon: 'art:test_loner', connection_shape: 'none', i18n: { ja: { name: 'テストロナー' } } },
  ],
}));
fs.writeFileSync(path.join(liveDir, 'live_packs.json'), JSON.stringify({
  schema: 'gacha_pack/1',
  entries: [
    { id: 'common_bp', name: 'Common Backpack', cost: 10, cost_tm: 'lrdst', cells: [6, 8], hp_per_cell: 15,
      pool: [{ unit: 'test_queen', weight: 1 }, { unit: 'test_rook', weight: 1 }, { unit: 'test_loner', weight: 1 }] },
  ],
}));
fs.writeFileSync(path.join(liveDir, 'scenario.json'), JSON.stringify({
  layout: { ROWS: 6, COLS: 6 }, linked: true, bps: [], pos: [], sis: [],
}));

// REQ-0036 P1-B: minimal batch-002-dungeon-pilot-SHAPED fixture content
// (schedule.cjs's getScheduleContent() reads these exact paths). A tiny,
// fast, deterministic dungeon: one pack encounter (a single very-weak
// enemy so a real squad reliably wins in well under a second of sim-time,
// keeping durationSecs small) + one boss (also weak, same reason),
// mirroring the shape of the real content/batches/batch-002-dungeon-pilot
// fixtures exactly (same schema fields) but scaled down for test speed.
// rewardItems reference 'blade'/'fx_dagger' DIRECTLY (already defined
// above in live_items.json) rather than a reward-roll id -- exercises
// resolveRewardItemId()'s identity-fallback path (an id absent from
// REWARD_ROLL_TO_ITEM_ID passes through unchanged), which is exactly
// what a real content batch will do once batch-002 goes live with real
// item ids instead of placeholder roll ids.
const batchDir = path.join(contentDir, 'batches', 'batch-002-dungeon-pilot');
fs.mkdirSync(batchDir, { recursive: true });
fs.writeFileSync(path.join(batchDir, 'dungeon.json'), JSON.stringify({
  schema: 'dungeon/1', id: 'test_dungeon', name: 'Test Dungeon',
  encounters: [
    { id: 'enc_pack_1', type: 'pack', mode: 'battle', enemyPack: { enemyIds: ['weak_slime'] }, deadline_secs: 30, rewardItems: ['blade'] },
    { id: 'enc_boss', type: 'boss', mode: 'battle', enemyPack: { enemyIds: ['weak_slime'] }, deadline_secs: 30, rewardItems: ['fx_dagger'] },
  ],
}));
fs.writeFileSync(path.join(batchDir, 'enemies.json'), JSON.stringify({
  schema: 'enemy/1',
  entries: [
    { id: 'weak_slime', name: 'Weak Slime', hp: [1, 1], footprint: [1, 1], skills: ['slime_bite'], rarity: 'common', pack_role: 'line' },
  ],
}));
fs.writeFileSync(path.join(batchDir, 'skills.json'), JSON.stringify({
  schema: 'skill/1',
  entries: [
    { id: 'slime_bite', name_en: 'Slime Bite',
      trigger: { t: 'every_secs', s: [5.0, 5.0] }, verb: { t: 'strike', n: [1, 1] },
      attack_profile: { edge: ['top'], direction: 'front', penetration: 0, aoe: 0, aoe_statuses: false },
      modes: ['battle'] },
  ],
}));
fs.writeFileSync(path.join(batchDir, 'items.json'), JSON.stringify({ schema: 'po/2', entries: [] }));
// REQ-0036 P1-C: formations.json fixture (schedule.cjs's
// getScheduleContent() now unconditionally loads this path for the new
// GET /api/schedule/dungeons route) -- mirrors the real batch-002
// content's 4-entry shape, trimmed to 2 entries (enough to exercise "a
// formations list exists / has entries" without duplicating the full
// real content).
fs.writeFileSync(path.join(batchDir, 'formations.json'), JSON.stringify({
  schema: 'formation/1',
  entries: [
    { id: 'formation1', i18n: { en: { name: 'Standard Line' }, ja: { name: '標準陣形' } }, canvases: { unit1: 'F2:M9', unit2: 'N2:U9', unit3: 'B10:I17', unit4: 'R10:Y17' } },
    { id: 'formation2', i18n: { en: { name: 'Tank Vanguard' }, ja: { name: 'タンク先鋒' } }, canvases: { unit1: 'J2:Q9', unit2: 'B6:I13', unit3: 'R6:Y13', unit4: 'J10:Q17' } },
  ],
}));
// REQ-0043: sim/dungen.cjs's generator reads entities.json (trap/door/
// chest templates) from this SAME batch dir -- mirrors the real
// content/batches/batch-002-dungeon-pilot/entities.json shape exactly
// (schema/fields), trimmed to just the trap (no door/chest needed for
// this fixture's own tests, which only exercise the 'default' generator
// at low levels where a trap is the most likely extra encounter to
// roll; dungen.cjs itself defensively no-ops any entity type whose
// count rolls 0, so the door/chest templates being ABSENT here is only
// exercised if a low-probability roll needs them -- documented risk,
// acceptable for this fixture's narrow scope; a KeyError from a missing
// template would surface as an obvious test failure, not a silent bug).
fs.writeFileSync(path.join(batchDir, 'entities.json'), JSON.stringify({
  schema: 'entity/1',
  entries: [
    { id: 'trap_frost_deadfall', name: 'Frost Deadfall', type: 'trap', mode: 'detection', hp: 1, footprint: [1, 1], masked: true, timeout_secs: 18, skills: [] },
    { id: 'door_rimefast_stage1', name: 'Rimefast Door (hidden)', type: 'door_stage1', mode: 'detection', hp: 1, footprint: [1, 1], masked: true, timeout_secs: 20, skills: [] },
    { id: 'door_rimefast_stage2', name: 'Rimefast Door', type: 'door_stage2', mode: 'unlock', hp: 60, footprint: [2, 2], masked: false, timeout_secs: 25, skills: [] },
    { id: 'chest_frostbound_cache', name: 'Frostbound Cache', type: 'chest', mode: 'unlock', hp: 40, footprint: [2, 2], masked: false, timeout_secs: 22, skills: [] },
  ],
}));

// REQ-0122: the runtime reads the dungeon domain from content/live/dungeon
// (the promoted copy), not the batch dir -- mirror the fixture batch there,
// exactly what tools/promote_dungeon_batch.cjs does to the real repo.
const fixtureLiveDungeonDir = path.join(contentDir, 'live', 'dungeon');
fs.mkdirSync(fixtureLiveDungeonDir, { recursive: true });
for (const f of ['dungeon.json', 'enemies.json', 'skills.json', 'entities.json', 'formations.json', 'items.json']) {
  fs.copyFileSync(path.join(batchDir, f), path.join(fixtureLiveDungeonDir, f));
}

os.homedir = () => fakeRepoHome;
// REQ-0145a (sc): content reads now resolve through lib/content_files.cjs,
// whose root honors the CONTENT_ROOT env var (default = the homedir-derived
// path). Inject it explicitly, pointed at the SAME synthetic content tree,
// so the env seam itself is exercised on every content-driven test below.
process.env.CONTENT_ROOT = contentDir;
// REQ-0047 (c): the server is a module TREE now (api.cjs -> router.cjs ->
// routes/* -> lib/*) -- evicting only the four legacy files would leave
// routes/ modules holding stale (old-homedir-bound) admin/storage refs.
// Evict every first-party server/ module (never node_modules, never this
// test file) so a re-require rebinds the whole tree at once.
function evictServerModuleTree() {
  const path = require('path');
  for (const k of Object.keys(require.cache)) {
    if (!k.includes(path.sep + 'server' + path.sep)) continue;
    if (k.includes('node_modules')) continue;
    if (k.includes(path.sep + 'tests' + path.sep)) continue;
    delete require.cache[k];
  }
}
evictServerModuleTree();
const api = require('../../api.cjs');
const admin = require('../../admin.cjs');
const playersFixture = require('../../players.cjs');

// dev_user.json fixture (REQ-0035, extended REQ-0037 with dev_mode): a
// normal admin user, for /api/me and admin-auth happy-path tests below.
// A role-less variant / dev_mode:false variant is written on-demand
// inside the specific tests that need it, then restored.
const configDir = path.join(repoRoot, 'data', 'config');
fs.mkdirSync(configDir, { recursive: true });
const devUserPath = path.join(configDir, 'dev_user.json');
fs.writeFileSync(devUserPath, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'], dev_mode: true }));

// Boot-time dev player creation (mirrors api.cjs's main() -- but main()
// itself is not called here since we drive api.handle() directly against
// a mock http.Server; the dev player registry entry must exist before any
// test relies on the dev_mode fallback or the "default" alias).
const devPlayer = admin.ensureDevPlayer();

// A second, non-admin guest player -- used for profile-isolation and
// admin-guard-lacks-role tests.
const guestA = playersFixture.createPlayer('GuestA', []);
const guestB = playersFixture.createPlayer('GuestB', []);
const adminGuest = playersFixture.createPlayer('AdminGuest', ['item_admin']);

function mockReq(method, url, body, headers) {
  const { EventEmitter } = require('events');
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers || {};
  req.destroy = () => {};
  process.nextTick(() => {
    if (body !== undefined) req.emit('data', Buffer.from(body));
    req.emit('end');
  });
  return req;
}
function mockRes(onEnd) {
  const res = {
    statusCode: null, headers: null, body: null,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(body) { this.body = body; if (onEnd) onEnd(body); },
  };
  return res;
}

function authHeaders(token) {
  return token ? { 'x-auth-token': token } : {};
}

  Object.assign(h, {
    api, admin, playersFixture, devPlayer, guestA, guestB, adminGuest,
    mockReq, mockRes, authHeaders, evictServerModuleTree,
    fakeRepoHome, repoRoot, contentDir, liveDir, batchDir,
    fixtureLiveDungeonDir, configDir, devUserPath,
  });
}

// summary(): the monolith's own tail (origin lines 4016-4018) + the
// parity-gate tally line.
function summary() {
  console.log('---');
  console.log(pass + ' passed, ' + fail + ' failed');
  console.log('executed assertions: ' + assertsExecuted + ' (REQ-0145a sf parity gate)');
  process.exit(fail ? 1 : 0);
}

const h = {
  T, AT, boot, summary,
  players, storage, tmpHome, realHomedir, evictStorageAndPlayers,
};
module.exports = h;
