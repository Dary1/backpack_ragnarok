'use strict';
// tools/promote_dungeon_batch.cjs -- REQ-0122: THE dungeon-domain promotion
// tool. Retires the batch-002 hardcode by making `content/live/dungeon/`
// the ONE live source for the dungeon domain (enemy roster, skills,
// dungeon layout, entity templates, formations, and the pilot item
// overlay), populated ONLY by explicitly promoting a reviewed batch --
// the same promote-by-copy posture item content already has (approved
// entries are copied into content/live/live_items.json at S8; batches
// stay behind as the historical record).
//
// Anti-downgrade guard (the REQ-0077/batch-004 lesson this REQ exists
// for): a batch missing ANY required file is REFUSED outright. Swapping
// the live dungeon to a batch that only ships an enemy roster would
// silently delete the live game's traps/doors/chests/rewards and item
// overlay -- the exact mistake caught mid-REQ-0077; this tool makes it
// structurally impossible rather than a thing to remember. There is
// deliberately NO --force/--allow-missing flag: a future batch that
// legitimately wants partial promotion earns that flag (and its
// semantics) in its own REQ.
//
// Usage:  node tools/promote_dungeon_batch.cjs content/batches/<batch-dir>
//
// Effects: byte-copies the 6 files into content/live/dungeon/ (atomic
// tmp+rename per file) and records provenance in content/registry.json
// under `live_dungeon` (promoted_from, date, per-file sha256) -- the
// invariant sim/tests/run.cjs's REQ-0122 tests pin.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REQUIRED_FILES = [
  'dungeon.json',
  'enemies.json',
  'packs.json', // REQ-0184: monster_pack/1 -- dungeon.json names packs from it, so a promotion without it ships a dungeon whose encounters cannot resolve
  'skills.json',
  'entities.json',
  'formations.json',
  'items.json',
];

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function atomicWrite(destPath, buf) {
  const dir = path.dirname(destPath);
  const tmp = path.join(dir, '.' + path.basename(destPath) + '.' + crypto.randomBytes(6).toString('hex') + '.tmp');
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, destPath);
}

// promote(srcDir, opts) -- opts.liveDir / opts.registryPath are test
// injection seams (sim/tests/run.cjs promotes into a temp dir); real
// callers pass neither and get the repo's own live locations.
function promote(srcDir, opts) {
  opts = opts || {};
  const repo = path.join(os.homedir(), 'backpack_ragnarok');
  const liveDir = opts.liveDir || path.join(repo, 'content', 'live', 'dungeon');
  const registryPath = opts.registryPath || path.join(repo, 'content', 'registry.json');

  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    throw new Error('promote refused: source is not a directory: ' + srcDir);
  }
  const missing = REQUIRED_FILES.filter((f) => !fs.existsSync(path.join(srcDir, f)));
  if (missing.length) {
    throw new Error(
      'promote refused: batch is missing required file(s): ' + missing.join(', ') +
      ' -- a partial batch would downgrade the live game (REQ-0122 anti-downgrade guard). ' +
      'Every promotion ships the COMPLETE dungeon domain: ' + REQUIRED_FILES.join(', '));
  }
  // Parse-validate every file BEFORE the first write (all-or-nothing).
  const bufs = {};
  for (const f of REQUIRED_FILES) {
    const buf = fs.readFileSync(path.join(srcDir, f));
    try {
      JSON.parse(buf.toString('utf8'));
    } catch (e) {
      throw new Error('promote refused: ' + f + ' is not valid JSON: ' + e.message);
    }
    bufs[f] = buf;
  }

  fs.mkdirSync(liveDir, { recursive: true });
  const files = {};
  for (const f of REQUIRED_FILES) {
    atomicWrite(path.join(liveDir, f), bufs[f]);
    files[f] = sha256(bufs[f]);
  }

  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  registry.live_dungeon = {
    promoted_from: path.basename(path.resolve(srcDir)),
    date: new Date().toISOString().slice(0, 10),
    files,
  };
  atomicWrite(registryPath, JSON.stringify(registry, null, 1) + '\n');
  return { liveDir, registryPath, files };
}

if (require.main === module) {
  const srcDir = process.argv[2];
  if (!srcDir) {
    console.error('usage: node tools/promote_dungeon_batch.cjs content/batches/<batch-dir>');
    process.exit(2);
  }
  try {
    const r = promote(path.resolve(srcDir));
    console.log('promoted ' + srcDir + ' -> ' + r.liveDir);
    for (const f of REQUIRED_FILES) console.log('  ' + f + '  sha256=' + r.files[f].slice(0, 12) + '…');
    console.log('provenance recorded in ' + r.registryPath + ' (live_dungeon)');
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }
}

module.exports = { promote, REQUIRED_FILES };
