'use strict';
// sim/tests/goldens.cjs -- REQ-0047 (a): replay-log determinism goldens.
//
// The determinism guarantee (same snapshot+defs+seed -> byte-identical
// replay JSONL) is the sim's most important external contract. This file
// freezes it: a matrix of dungeon runs is hashed and compared against
// sim/tests/goldens/replay_hashes.json on every CI run. Any internal
// refactor of combat.cjs/dungen.cjs MUST keep every hash identical.
//
//   node sim/tests/goldens.cjs        # check mode (CI) -- exit 1 on drift
//   node sim/tests/goldens.cjs gen    # regenerate the golden file
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const combat = require(path.join(__dirname, '..', 'combat.cjs'));
const dungen = require(path.join(__dirname, '..', 'dungen.cjs'));

const REPO_ROOT = path.join(__dirname, '..', '..');
const GOLDEN_FILE = path.join(__dirname, 'goldens', 'replay_hashes.json');

// Fixtures: identical loading discipline to sim/tests/run.cjs.
const scenario = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'content', 'live', 'scenario.json'), 'utf8'));
const liveItemsRaw = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'content', 'live', 'live_items.json'), 'utf8'));
const itemDefsById = {};
for (const e of liveItemsRaw.entries) itemDefsById[e.id] = e;
const BATCH_DIR = path.join(REPO_ROOT, 'content', 'batches', 'batch-002-dungeon-pilot');
const enemiesRaw = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, 'enemies.json'), 'utf8'));
const skillsRaw = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, 'skills.json'), 'utf8'));
const dungeonRaw = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, 'dungeon.json'), 'utf8'));
// REQ-0184: monster_pack/1 defs -- dungeon.json's encounters name packs from here.
const packsRaw = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, 'packs.json'), 'utf8'));
const monsterPackDefsById = {};
for (const e of packsRaw.entries) monsterPackDefsById[e.id] = e;
const enemyDefsById = {};
for (const e of enemiesRaw.entries) enemyDefsById[e.id] = e;
const skillDefsById = {};
for (const s of skillsRaw.entries) {
  skillDefsById[s.id] = { trigger: s.trigger, verb: s.verb, attack_profile: s.attack_profile, modes: s.modes };
}

// REQ-0207 (found-in-flight): PIN the dungen generators to a FIXED batch-002 roster.
// dungen.generate('default'/'test_fixed') resolves the live roster via os.homedir()
// (repoRoot() -> ~/backpack_ragnarok/content/live/dungeon), so these DETERMINISM goldens
// were silently coupled to whatever is deployed live. The batch-005 additive deploy
// (dc80295) grew that roster 7 -> 15 and DRIFTED all 8 dungen/default goldens (proven:
// pinning the roster back to batch-002 reproduces every stored hash byte-for-byte).
// Determinism goldens must freeze the ENGINE, not track live content, so we redirect
// dungen's homedir-relative live reads to a batch-002 fixture -- the same os.homedir()
// fake the sim's other harnesses use. TEST-ONLY: no dungen/engine change; the goldens
// stay UNMOVED and are now deploy-stable (a later content deploy can no longer drift them).
const os = require('os');
const GOLDEN_ROSTER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'goldens-batch002-'));
{
  const fixDungeon = path.join(GOLDEN_ROSTER_HOME, 'backpack_ragnarok', 'content', 'live', 'dungeon');
  fs.mkdirSync(fixDungeon, { recursive: true });
  const b002 = path.join(REPO_ROOT, 'content', 'batches', 'batch-002-dungeon-pilot');
  for (const f of fs.readdirSync(b002)) if (f.endsWith('.json')) fs.copyFileSync(path.join(b002, f), path.join(fixDungeon, f));
  os.homedir = () => GOLDEN_ROSTER_HOME; // dungen.cjs repoRoot() reads the live roster through this
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
// REQ-0256 s13.1 step 2 / AC3: every emitted t must be an EXACT multiple of
// TICK_SECS -- the single best one-line proof that the tick loop is the clock.
// (Exact float equality is correct here: every t is produced as k * TICK_SECS,
// and k * TICK_SECS reconstructs bit-for-bit from Math.round(t / TICK_SECS).)
const TICK = combat.TUNABLES.TICK_SECS;
function assertTickMultiples(events, label) {
  for (const e of events) {
    if (typeof e.t !== 'number' || e.t !== Math.round(e.t / TICK) * TICK) {
      throw new Error('REQ-0256 AC3: non-tick-multiple t=' + e.t + ' (ev ' + (e.ev || e.kind) + ') in ' + label);
    }
  }
}
const squads = () => [scenario, scenario, scenario, scenario];
const baseOpts = { squadSnapshots: squads(), itemDefsById, enemyDefsById, skillDefsById, monsterPackDefsById, formationId: 'formation1', participants: ['pA', 'pB'] };

// The golden matrix. Keys are stable identifiers; each entry produces
// { def_sha256 (dungen cases only), jsonl_sha256, events } .
const cases = {};

// 1) Hand-authored batch-002 dungeon, three seeds.
for (const seed of ['golden-A', 'golden-B', 'golden-C']) {
  cases['batch002/' + seed] = () => {
    const r = combat.runDungeon(Object.assign({}, baseOpts, { masterSeed: seed, dungeonDef: dungeonRaw, level: 3 }));
    assertTickMultiples(r.events, 'batch002/' + seed);
    const jsonl = combat.toJSONL(r.events);
    return { jsonl_sha256: sha(jsonl), events: r.events.length };
  };
}
// 2) Generated dungeons: dungen 'default' across levels x seeds.
for (const level of [1, 3, 5, 8]) {
  for (const gseed of ['dg-11', 'dg-22']) {
    cases['dungen/default/L' + level + '/' + gseed] = () => {
      const def = dungen.generate('default', level, gseed);
      const r = combat.runDungeon(Object.assign({}, baseOpts, { masterSeed: 'run-' + gseed, dungeonDef: def, level }));
      assertTickMultiples(r.events, 'dungen/default/L' + level + '/' + gseed);
      const jsonl = combat.toJSONL(r.events);
      return { def_sha256: sha(JSON.stringify(def)), jsonl_sha256: sha(jsonl), events: r.events.length };
    };
  }
}
// 3) test_fixed passthrough (generator-independent of level/seed).
cases['dungen/test_fixed'] = () => {
  const def = dungen.generate('test_fixed', 1, 'whatever');
  const r = combat.runDungeon(Object.assign({}, baseOpts, { masterSeed: 'run-fixed', dungeonDef: def, level: 1 }));
  assertTickMultiples(r.events, 'dungen/test_fixed');
  const jsonl = combat.toJSONL(r.events);
  return { def_sha256: sha(JSON.stringify(def)), jsonl_sha256: sha(jsonl), events: r.events.length };
};

function computeAll() {
  const out = {};
  for (const k of Object.keys(cases).sort()) out[k] = cases[k]();
  return out;
}

const mode = process.argv[2] === 'gen' ? 'gen' : 'check';
const computed = computeAll();
fs.rmSync(GOLDEN_ROSTER_HOME, { recursive: true, force: true }); // REQ-0207: drop the pinned-roster fixture once the matrix is computed
if (mode === 'gen') {
  fs.writeFileSync(GOLDEN_FILE, JSON.stringify(computed, null, 2) + '\n');
  console.log('wrote ' + Object.keys(computed).length + ' goldens -> ' + path.relative(REPO_ROOT, GOLDEN_FILE));
} else {
  const golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));
  let bad = 0;
  for (const k of Object.keys(golden)) {
    const g = JSON.stringify(golden[k]), c = JSON.stringify(computed[k] || null);
    if (g !== c) { bad++; console.log('DRIFT ' + k + '\n  golden   ' + g + '\n  computed ' + c); }
  }
  for (const k of Object.keys(computed)) if (!golden[k]) { bad++; console.log('MISSING GOLDEN ' + k + ' (run gen?)'); }
  if (bad) { console.log(bad + ' golden(s) drifted -- determinism contract broken'); process.exit(1); }
  console.log('goldens OK (' + Object.keys(golden).length + ' cases, replay determinism intact)');
}
