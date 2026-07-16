'use strict';
// tools/derive_def_geometry.cjs -- REQ-0188 (art-authoritative cell geometry).
//
// THE MIRROR GENERATOR. Under REQ-0188, an artwork's shape is the AUTHORITY for
// a thing's cell geometry; the def-side geometry the sim reads from the content
// files (enemy/1 `footprint`, po/2 `shape`) is a GENERATED MIRROR of it, never an
// independent fact. This tool regenerates that mirror: for every served
// monster_def/po_def it resolves the linked artwork REF-FIRST (REQ-0174 canon)
// and rewrites the def geometry from the art. Same shape as
// promote_dungeon_batch.cjs / REQ-0171's derived percentages: generated, honest,
// never hand-edited.
//
// THE TRANSPOSE (REQ-0029 was a transposition bug):
//   monster art {w,h}          -> footprint [fh,fw] = [h, w]
//   po art {mask:5x5 [row][col]} -> shape [[r,c]...] (active cells, top-left norm)
//
// NO-OP BY CONSTRUCTION: an entity whose def already AGREES with its art is left
// BYTE-UNTOUCHED (the change decision is checkArtworkGeometry itself -- derive
// rewrites exactly what the guard flags). On content that is already in sync this
// writes nothing, so `git diff` is empty -- that empty diff is REQ-0188 gate G3.
//
// SAFE BY DEFAULT: runs in --check (report-only) mode unless given --write. The
// live --write run is a DEPLOY step the orchestrator performs after merge; a
// feature branch only ever --checks (it reads the live artwork registry
// read-only and reports what a --write would change).
//
// Usage:
//   set -a; source server/.env; set +a
//   node tools/derive_def_geometry.cjs            # --check: report, write nothing
//   node tools/derive_def_geometry.cjs --write    # regenerate the mirror in place
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const cc = require(path.join(REPO_ROOT, 'server', 'services', 'content_checks.cjs'));

// The served corpus + which def kind each file holds (shared with the guard).
const CORPUS = cc.ART_GEOM_CORPUS;
const FIELD = { monster_def: 'footprint', po_def: 'shape' };

// ---- pure derivation (artwork shape -> def geometry) --------------------

/** monster art {w,h} -> footprint [fh,fw] = [h,w] (the TRANSPOSE). null when
 * the shape is not a usable {w,h}. */
function footprintFromMonsterShape(shape) {
  const w = shape && shape.w, h = shape && shape.h;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) return null;
  return [h, w];
}

/** po art 5x5 mask ([row][col]) -> shape [[r,c]...]: the active cells in
 * ROW-MAJOR order, normalized so the bounding-box top-left is (0,0) -- the exact
 * spelling po/2 `shape` uses. null for an empty/absent mask. */
function poCellsFromMask(mask) {
  if (!Array.isArray(mask)) return null;
  const cells = [];
  let minR = Infinity, minC = Infinity;
  for (let r = 0; r < mask.length; r++) {
    const row = mask[r] || [];
    for (let c = 0; c < row.length; c++) if (row[c]) { cells.push([r, c]); if (r < minR) minR = r; if (c < minC) minC = c; }
  }
  if (cells.length === 0) return null;
  return cells.map((rc) => [rc[0] - minR, rc[1] - minC]);
}

/** The def geometry a kind derives from its artwork shape. */
function defGeomFromArtwork(kind, artShape) {
  if (kind === 'monster_def') return footprintFromMonsterShape(artShape);
  if (kind === 'po_def') return artShape && Array.isArray(artShape.mask) ? poCellsFromMask(artShape.mask) : null;
  return null;
}

/** Compact-but-spaced JSON for a geometry value, matching the in-file style
 * (`[1, 1]`, `[[0, 0], [1, 0]]`). */
function serializeGeom(kind, geom) {
  if (kind === 'monster_def') return '[' + geom.join(', ') + ']';
  return '[' + geom.map((c) => '[' + c.join(', ') + ']').join(', ') + ']';
}

// ---- surgical in-place field replacement (preserve all other bytes) -----

/** Byte span [start,end) of the balanced `[...]` value of a top-level `field`
 * inside the entity object identified by `"id": "<id>"`. Geometry arrays hold
 * only numbers (no strings/brackets-in-strings), so a simple depth counter is
 * exact. null when not found. */
function findGeomSpan(raw, id, field) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const idm = new RegExp('"id"\\s*:\\s*"' + esc + '"');
  const im = idm.exec(raw);
  if (!im) return null;
  const fm = new RegExp('"' + field + '"\\s*:\\s*').exec(raw.slice(im.index));
  if (!fm) return null;
  const valStart = im.index + fm.index + fm[0].length;
  if (raw[valStart] !== '[') return null;
  let depth = 0, i = valStart;
  for (; i < raw.length; i++) {
    if (raw[i] === '[') depth++;
    else if (raw[i] === ']') { depth--; if (depth === 0) { i++; break; } }
  }
  if (depth !== 0) return null;
  return { start: valStart, end: i };
}

/** Replace the geometry field of `id` in `raw` with the serialized `geom`.
 * Returns { text, ok }. */
function replaceGeomField(raw, id, field, kind, geom) {
  const span = findGeomSpan(raw, id, field);
  if (!span) return { text: raw, ok: false };
  return { text: raw.slice(0, span.start) + serializeGeom(kind, geom) + raw.slice(span.end), ok: true };
}

// ---- orchestration ------------------------------------------------------

/** Run the mirror generation. opts = { write, storage, root, log }. READS the
 * artwork registry (ref-first) and, for every DRIFTING entity (guard flags it),
 * rewrites its def geometry from the art. Agreeing entities are byte-untouched.
 * Returns { changed:[{file,id,kind,from,to}], scanned, files:{...} }. */
async function runDerive(opts) {
  opts = opts || {};
  const write = !!opts.write;
  const root = opts.root || REPO_ROOT;
  const storage = opts.storage;
  if (!storage) throw new Error('runDerive requires opts.storage (STORAGE_BACKEND=pg)');
  const log = opts.log || function () {};

  const perFile = {};
  const changed = [];
  let scanned = 0;
  const seen = new Set();
  for (const src of CORPUS) {
    const field = FIELD[src.kind];
    const abs = path.join(root, src.file);
    let raw;
    try { raw = fs.readFileSync(abs, 'utf8'); } catch (_) { continue; }
    let doc;
    try { doc = JSON.parse(raw); } catch (_) { continue; }
    let text = perFile[src.file] !== undefined ? perFile[src.file] : raw;
    for (const entry of (doc.entries || [])) {
      const key = src.kind + ':' + entry.id;
      if (seen.has(key)) continue; // one file's definition wins (dedup shared ids)
      seen.add(key);
      scanned++;
      const def = await storage.getContentDefByName(entry.id);
      let artName = def ? await storage.resolveArtworkFacetName(def) : null;
      if (!artName) { const a = await storage.getArtworkByName(entry.id); if (a) artName = entry.id; }
      const artwork = artName ? await storage.getArtworkByName(artName) : null;
      // The change decision IS the guard: rewrite exactly what it flags.
      const verdict = cc.checkArtworkGeometry(src.kind, entry, artwork);
      if (!verdict.applicable || verdict.ok) continue; // n/a or already in sync -> untouched
      const geom = defGeomFromArtwork(src.kind, artwork.shape);
      if (!geom) { log('SKIP (art shape unusable) ' + src.kind + ' ' + entry.id); continue; }
      const from = JSON.stringify(entry[field]);
      const to = serializeGeom(src.kind, geom);
      changed.push({ file: src.file, id: entry.id, kind: src.kind, from, to, artwork: artName });
      log('DERIVE ' + src.kind + ' ' + entry.id + ' ' + field + ': ' + from + ' -> ' + to + ' (from ' + artName + ')');
      if (write) {
        const rep = replaceGeomField(text, entry.id, field, src.kind, geom);
        if (!rep.ok) { log('ERROR could not locate ' + field + ' span for ' + entry.id + ' in ' + src.file); continue; }
        text = rep.text;
        perFile[src.file] = text;
      }
    }
  }
  if (write) {
    for (const f of Object.keys(perFile)) {
      fs.writeFileSync(path.join(root, f), perFile[f]);
      log('wrote ' + f);
    }
  }
  log('--- derive: scanned=' + scanned + ' drifting=' + changed.length + ' mode=' + (write ? 'WRITE' : 'CHECK'));
  return { changed, scanned, files: perFile };
}

if (require.main === module) {
  const write = process.argv.includes('--write');
  (async () => {
    process.env.STORAGE_BACKEND = 'pg';
    if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required (STORAGE_BACKEND=pg; source server/.env). Derive READS the artwork registry.'); process.exit(2); }
    const storage = require(path.join(REPO_ROOT, 'server', 'storage.cjs'));
    let res;
    try { res = await runDerive({ write, storage, root: REPO_ROOT, log: (...a) => console.log(...a) }); }
    finally { if (storage.closeArtPool) await storage.closeArtPool(); if (storage.closeContentPool) await storage.closeContentPool(); }
    // --check exits 0 always (report only). --write exits 0.
    process.exit(0);
  })().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
}

module.exports = {
  CORPUS, FIELD,
  footprintFromMonsterShape, poCellsFromMask, defGeomFromArtwork, serializeGeom,
  findGeomSpan, replaceGeomField, runDerive,
};
