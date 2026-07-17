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
  'dungeons.json', // REQ-0185: the authored dungeon/1 defs (weighted refs to packs+gimics) -- the serving path rolls a dive from these
  'enemies.json',
  'packs.json', // REQ-0184: monster_pack/1 -- dungeon.json names packs from it, so a promotion without it ships a dungeon whose encounters cannot resolve
  'skills.json',
  'gimics.json', // REQ-0211: trap/treasure/hidden-door interactables, now the gimic content kind (renamed from entities.json)
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

// REQ-0203: ADDITIVE promotion. batch-005 is a CONTENT-ADDITIVE dungeon batch: it
// adds a monster roster + skills + packs and MUST NOT replace the wholesale live
// dungeon domain (that would delete batch-002's enemies/skills and REQ-0184's packs).
// So it ships only these three files and MERGES them into live by APPENDING entries.
// Every pre-existing entry survives BYTE-FOR-BYTE: the merge splices the new entries
// into the file TEXT after the last existing entry and never re-serialises the old
// ones. The other four dungeon files (dungeon.json, gimics.json, formations.json,
// items.json) are left untouched. An id that already exists live is REFUSED --
// content_defs.system_name is UNIQUE across kinds and overwriting live content is
// exactly what this must never do.
const ADDITIVE_FILES = ['enemies.json', 'skills.json', 'packs.json'];

// Locate the top-level `entries` array in a JSON document's TEXT: returns the index
// of its opening '[' and matching ']' via a string/escape-aware bracket scan. Byte-
// preserving append needs TEXT positions, not a re-serialised tree.
function findEntriesArray(text) {
  const key = '"entries"';
  const keyIdx = text.indexOf(key);
  if (keyIdx < 0) throw new Error('additive promote: no "entries" array in target file');
  let i = keyIdx + key.length;
  while (i < text.length && text[i] !== '[') i++;
  if (i >= text.length) throw new Error('additive promote: malformed "entries" (no opening [)');
  const openIdx = i;
  let depth = 0, inStr = false, esc = false;
  for (let j = openIdx; j < text.length; j++) {
    const ch = text[j];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) return { openIdx: openIdx, closeIdx: j }; }
  }
  throw new Error('additive promote: unterminated "entries" array');
}

// Append newEntries into an entries-array JSON file's TEXT, preserving every existing
// byte (existing entries are never re-serialised). Returns the new text.
function appendEntriesPreservingBytes(text, newEntries) {
  const loc = findEntriesArray(text);
  const openIdx = loc.openIdx, closeIdx = loc.closeIdx;
  let insertPoint = closeIdx;
  while (insertPoint > openIdx && /\s/.test(text[insertPoint - 1])) insertPoint--;
  const isEmpty = (insertPoint === openIdx + 1);
  const lineStart = text.lastIndexOf('\n', closeIdx);
  const closeIndent = text.slice(lineStart + 1, closeIdx).match(/^\s*/)[0];
  const entryIndent = closeIndent + '  ';
  const block = newEntries.map(function (e) {
    return JSON.stringify(e, null, 2).split('\n').map(function (ln) { return entryIndent + ln; }).join('\n');
  }).join(',\n');
  if (isEmpty) {
    return text.slice(0, insertPoint) + '\n' + block + '\n' + closeIndent + text.slice(closeIdx);
  }
  return text.slice(0, insertPoint) + ',\n' + block + text.slice(insertPoint);
}

// promoteAdditive(srcDir, opts) -- opts.liveDir / opts.registryPath are the same test
// injection / worktree-trap seams promote() has. NEVER run this from a worktree without
// an explicit liveDir: os.homedir()-relative defaults point at the MAIN checkout.
function promoteAdditive(srcDir, opts) {
  opts = opts || {};
  const repo = path.join(os.homedir(), 'backpack_ragnarok');
  const liveDir = opts.liveDir || path.join(repo, 'content', 'live', 'dungeon');
  const registryPath = opts.registryPath || path.join(repo, 'content', 'registry.json');
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    throw new Error('additive promote refused: source is not a directory: ' + srcDir);
  }
  const missing = ADDITIVE_FILES.filter(function (f) { return !fs.existsSync(path.join(srcDir, f)); });
  if (missing.length) {
    throw new Error('additive promote refused: batch is missing required file(s): ' + missing.join(', ') +
      ' -- an additive dungeon batch ships exactly: ' + ADDITIVE_FILES.join(', '));
  }
  const added = {};
  const files = {};
  const plan = [];
  for (const f of ADDITIVE_FILES) {
    const livePath = path.join(liveDir, f);
    if (!fs.existsSync(livePath)) {
      throw new Error('additive promote refused: live target missing: ' + livePath +
        ' -- additive promotion MERGES into an existing live domain; run the wholesale promote first');
    }
    const liveText = fs.readFileSync(livePath, 'utf8');
    const liveDoc = JSON.parse(liveText);
    const batchDoc = JSON.parse(fs.readFileSync(path.join(srcDir, f), 'utf8'));
    const liveIds = new Set((liveDoc.entries || []).map(function (e) { return e.id; }));
    const newEntries = batchDoc.entries || [];
    const seen = new Set();
    for (const e of newEntries) {
      if (!e || typeof e.id !== 'string' || !e.id) throw new Error('additive promote refused: ' + f + ' has an entry with no id');
      if (seen.has(e.id)) throw new Error('additive promote refused: ' + f + ' batch names id "' + e.id + '" twice');
      seen.add(e.id);
      if (liveIds.has(e.id)) throw new Error('additive promote refused: ' + f + ' id "' + e.id + '" already exists live -- additive promotion never overwrites (content ids are unique across kinds)');
    }
    const mergedText = appendEntriesPreservingBytes(liveText, newEntries);
    const mergedDoc = JSON.parse(mergedText);
    if (mergedDoc.entries.length !== (liveDoc.entries || []).length + newEntries.length) {
      throw new Error('additive promote refused: ' + f + ' merged entry count mismatch');
    }
    for (let k = 0; k < (liveDoc.entries || []).length; k++) {
      if (JSON.stringify(mergedDoc.entries[k]) !== JSON.stringify(liveDoc.entries[k])) {
        throw new Error('additive promote refused: ' + f + ' existing entry ' + k + ' changed -- byte-preserving append violated');
      }
    }
    plan.push({ livePath: livePath, mergedText: mergedText });
    added[f] = newEntries.map(function (e) { return e.id; });
  }
  for (const pl of plan) {
    const buf = Buffer.from(pl.mergedText, 'utf8');
    atomicWrite(pl.livePath, buf);
    files[path.basename(pl.livePath)] = sha256(buf);
  }
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  registry.live_dungeon_additive = (registry.live_dungeon_additive || []).concat([{
    promoted_from: path.basename(path.resolve(srcDir)),
    date: new Date().toISOString().slice(0, 10),
    added: added,
    files: files,
  }]);
  atomicWrite(registryPath, JSON.stringify(registry, null, 1) + '\n');
  return { liveDir: liveDir, registryPath: registryPath, added: added, files: files };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const additive = args.includes('--additive');
  const srcDir = args.filter(function (a) { return a !== '--additive'; })[0];
  if (!srcDir) {
    console.error('usage: node tools/promote_dungeon_batch.cjs [--additive] content/batches/<batch-dir>');
    process.exit(2);
  }
  try {
    if (additive) {
      const r = promoteAdditive(path.resolve(srcDir));
      console.log('additively promoted ' + srcDir + ' -> ' + r.liveDir);
      for (const f of ADDITIVE_FILES) console.log('  ' + f + '  +' + (r.added[f] || []).length + ' entries  sha256=' + (r.files[f] || '').slice(0, 12) + '…');
      console.log('provenance recorded in ' + r.registryPath + ' (live_dungeon_additive)');
    } else {
      const r = promote(path.resolve(srcDir));
      console.log('promoted ' + srcDir + ' -> ' + r.liveDir);
      for (const f of REQUIRED_FILES) console.log('  ' + f + '  sha256=' + r.files[f].slice(0, 12) + '…');
      console.log('provenance recorded in ' + r.registryPath + ' (live_dungeon)');
    }
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }
}

module.exports = { promote, promoteAdditive, REQUIRED_FILES, ADDITIVE_FILES };
