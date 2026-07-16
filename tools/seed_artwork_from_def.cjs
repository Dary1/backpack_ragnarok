'use strict';
// tools/seed_artwork_from_def.cjs -- REQ-0188 (art-authoritative cell geometry).
//
// ONE-SHOT COVERAGE SEED. REQ-0188 makes the artwork the AUTHORITY for a thing's
// cell geometry -- but a monster_def/po_def with NO artwork row has no authority
// to point at. This tool creates that missing row FROM the def's current
// geometry: a ONE-TIME flip of the direction of truth (def -> art). After it, the
// direction is art -> def forever (tools/derive_def_geometry.cjs regenerates the
// def-side mirror; content_checks.cjs guards the two from drifting).
//
// THE TRANSPOSE (three spellings of one fact; REQ-0029 was a transposition bug):
//   monster footprint [fh,fw] -> artwork shape {w:fw, h:fh}
//   po shape [[r,c]...]        -> artwork shape {mask:5x5 [row][col]}
//
// WHAT IT DOES (and refuses to do), per REQ-0188 s"The seed":
//   * ROWS ONLY. It creates the artwork ROW (kind, shape from the def geometry,
//     gen size from the REQ-0151 sizing law, main_object from the def name). It
//     does NOT fabricate a render: the 7 image-less monsters have no image, and
//     inventing one would be the dishonesty REQ-0160 refuses. The seed=2147483647
//     "unknown-environment" sentinel is a RENDER convention (REQ-0177), owned by
//     the sprite backfill where an actual image is imported -- not used here.
//   * INSERT-ONLY + already-covered-aware. An entity that ALREADY resolves to an
//     artwork (ref-first: explicit artwork_ref, or an exact-name row) is SKIPPED
//     -- it is already covered, and a duplicate row would be noise. So a second
//     run is a pure no-op, and an operator's explicit link is never disturbed.
//
// This is a DEPLOY tool: the orchestrator runs it against the LIVE namespace
// AFTER merge. A feature branch NEVER runs it against live -- unit tests exercise
// it in an isolated pg namespace; --dry-run against live only PREVIEWS the plan.
//
// Usage (orchestrator, at deploy):
//   set -a; source server/.env; set +a
//   node tools/seed_artwork_from_def.cjs --dry-run   # prints the plan, writes nothing
//   node tools/seed_artwork_from_def.cjs             # creates the missing rows (INSERT-only)
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const cc = require(path.join(REPO_ROOT, 'server', 'services', 'content_checks.cjs'));
const { deriveSize } = require(path.join(REPO_ROOT, 'server', 'services', 'art_sizing.cjs'));
// Reuse the SAME po mask builder the sprite backfill uses -- two copies of
// "shape -> 5x5 mask" would drift (the REQ-0171 lesson).
const { maskFromShape } = require(path.join(REPO_ROOT, 'tools', 'backfill_sprite_art.cjs'));

const CORPUS = cc.ART_GEOM_CORPUS; // shared with the guard + derive

// ---- pure: def geometry -> artwork row plan -----------------------------

/** The artwork ROW a def seeds. monster: {w,h} transposed from footprint; po:
 * {mask} from shape. Throws on unusable geometry (a loud failure beats a silent
 * bad row). NO render is planned -- rows only. */
function artworkRowFromDef(kind, entry) {
  const mainObject = (entry && (entry.name || entry.id)) || '';
  const prompt = (entry && entry.gen_prompt) || '';
  if (kind === 'monster_def') {
    const fp = entry && entry.footprint;
    if (!Array.isArray(fp) || !Number.isInteger(fp[0]) || !Number.isInteger(fp[1]) || fp[0] < 1 || fp[1] < 1) {
      throw new Error('monster ' + (entry && entry.id) + ' has no usable footprint [fh,fw]: ' + JSON.stringify(fp));
    }
    const shape = { w: fp[1], h: fp[0] }; // TRANSPOSE: footprint [fh,fw] -> {w:fw, h:fh}
    const size = deriveSize('monster', shape);
    return { system_name: entry.id, kind: 'monster', shape, gen_width: size.width, gen_height: size.height, main_object: mainObject, prompt_template: prompt };
  }
  if (kind === 'po_def') {
    const mask = maskFromShape(entry && entry.shape);
    if (!mask) throw new Error('po ' + (entry && entry.id) + ' has no usable shape [[r,c]...]: ' + JSON.stringify(entry && entry.shape));
    const shape = { mask };
    const size = deriveSize('po', shape);
    return { system_name: entry.id, kind: 'po', shape, gen_width: size.width, gen_height: size.height, main_object: mainObject, prompt_template: prompt };
  }
  throw new Error('seed does not handle kind ' + kind);
}

/** Build the dedup'd work list from the served corpus (one row per unique id;
 * a shared id like lockpick/spyglass is planned once). Pure (given the files).
 * Returns [{ id, kind, file, plan|planErr }]. */
function buildPlan(root) {
  const out = [];
  const seen = new Set();
  for (const src of CORPUS) {
    let entries;
    try { entries = (JSON.parse(fs.readFileSync(path.join(root, src.file), 'utf8')).entries) || []; } catch (_) { entries = []; }
    for (const entry of entries) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      let plan = null, planErr = null;
      try { plan = artworkRowFromDef(src.kind, entry); } catch (e) { planErr = e.message; }
      out.push({ id: entry.id, kind: src.kind, file: src.file, plan, planErr });
    }
  }
  return out;
}

// ---- orchestration (INSERT-only, already-covered-aware) -----------------

/** Run the seed. opts = { dryRun, storage, root, log }. For each planned entity,
 * SKIP if it already resolves to an artwork (ref-first) or an exact-name row
 * exists; otherwise createArtwork(row). Returns the count summary. */
async function runSeed(opts) {
  opts = opts || {};
  const dryRun = !!opts.dryRun;
  const root = opts.root || REPO_ROOT;
  const storage = opts.storage;
  if (!storage) throw new Error('runSeed requires opts.storage (STORAGE_BACKEND=pg)');
  const log = opts.log || function () {};

  const plan = buildPlan(root);
  const counts = { scanned: plan.length, created: 0, skippedCovered: 0, skippedError: 0 };
  for (const rec of plan) {
    if (rec.planErr) { log('SKIP plan-error (' + rec.planErr + ') -> ' + rec.id); counts.skippedError++; continue; }
    // Already covered? ref-first resolution, then a bare exact-name row.
    const def = await storage.getContentDefByName(rec.id);
    let resolved = def ? await storage.resolveArtworkFacetName(def) : null;
    if (!resolved) { const a = await storage.getArtworkByName(rec.id); if (a) resolved = rec.id; }
    if (resolved) { log('skip (already covered by artwork ' + resolved + ') -> ' + rec.kind + ' ' + rec.id); counts.skippedCovered++; continue; }
    const p = rec.plan;
    const desc = rec.kind + ' ' + rec.id + ' kind=' + p.kind + ' shape=' + JSON.stringify(p.shape) + ' gen=' + p.gen_width + 'x' + p.gen_height;
    if (dryRun) { log('PLAN create artwork ' + desc); counts.created++; continue; }
    await storage.createArtwork(p);
    log('created artwork ' + desc); counts.created++;
  }
  log('--- ' + (dryRun ? '[DRY-RUN] ' : '') + 'seed: scanned=' + counts.scanned + ' created=' + counts.created + ' skipped_covered=' + counts.skippedCovered + ' skipped_error=' + counts.skippedError);
  return counts;
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  (async () => {
    process.env.STORAGE_BACKEND = 'pg';
    if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required (STORAGE_BACKEND=pg; source server/.env).'); process.exit(2); }
    const storage = require(path.join(REPO_ROOT, 'server', 'storage.cjs'));
    try { await runSeed({ dryRun, storage, root: REPO_ROOT, log: (...a) => console.log(...a) }); }
    finally { if (storage.closeArtPool) await storage.closeArtPool(); if (storage.closeContentPool) await storage.closeContentPool(); }
    process.exit(0);
  })().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
}

module.exports = { CORPUS, artworkRowFromDef, buildPlan, runSeed };
