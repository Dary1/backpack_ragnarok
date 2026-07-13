#!/usr/bin/env node
'use strict';
// tools/backfill_registry.cjs -- REQ-0151 ruling 3 (BACKFILL). Written in a
// follow-up session under the 2026-07-14 orchestrator ruling: "do not fabricate
// adoption, but do fill the ledger."
//
// Imports the REQ-0150-era (flux2) batch art under content/batches/ into the
// artwork registry: one `artworks` row per subject/key, and one `renders` row
// per CANDIDATE (seed as recorded in the manifest / candidate filename). Image
// bytes are loaded into the DB (renders.image BYTEA) ONLY through storage.cjs --
// the project's single persistence chokepoint; this tool opens no DB itself.
//
// ADOPTION POLICY (never fabricate a picked seed):
//   A render is marked adopted ONLY where the repo PROVES which candidate was
//   used --
//   (a) bpskin-frames-0150/frame_report.json records skins[].composed=true with
//       the exact frame file the compose step consumed (a manifest-recorded
//       selection, not a guess) -> that frame's seed is adopted.
//   (b) a live/adopted reference asset (content/live/**.png or a batch
//       */selected/**.png) whose bytes (sha256) exactly match a candidate ->
//       adopted, with the matching path as evidence.
//   Everything else stays candidate-only; the user adopts in the admin. The
//   evidence string is stored in params.backfill_adoption_evidence.
//
// IDEMPOTENT + re-runnable: artworks keyed by system_name, renders by
// (artwork, seed). Re-running skips rows that already exist and only fills gaps
// (and re-applies a provable adoption if it is missing).
//
// PARAMS mirror the live render shape (server/services/art_jobs.cjs):
// steps/cfg/sampler/size/models{unet,clip,vae}. Where a manifest lacks a
// generation param the CURRENT art_route constants are snapshotted and
// params.backfilled_approx=true. Model hashes are the CURRENT model-file content
// hashes (STREAMED, so multi-GB weights never load into memory) with
// params.hash_backfilled=true (ruling 4 / spec Backfill section).
//
// Run (on the server, with the pg env the api uses):
//   set -a; . ~/backpack_ragnarok/server/.env; set +a
//   node tools/backfill_registry.cjs             # apply to the DB
//   node tools/backfill_registry.cjs --dry-run   # inventory only, no DB writes
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const { deriveSize } = require(path.join(REPO_ROOT, 'server', 'services', 'art_sizing.cjs'));
const { resolveModelPath } = require(path.join(REPO_ROOT, 'server', 'services', 'model_hash.cjs'));

// manifest kind -> registry kind (artwork_kind ENUM: po|si|unit|monster|bpskin)
const KIND_MAP = { item: 'po', monster: 'monster', unit: 'unit', texture: 'bpskin' };
// candidate label -> seed, as encoded in units/items candidate filenames
// (<id>_c<N>_s<seed>.png). The s-number IS the recorded seed.
const CAND_SEEDS = { c1: 101, c2: 202, c3: 303, c4: 404 };

// ---- shape helpers ----
function emptyMask() { return Array.from({ length: 5 }, () => Array(5).fill(false)); }
function maskFromWH(w, h) { const m = emptyMask(); for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) m[r][c] = true; return m; }
function maskFromCellPairs(pairs) { const m = emptyMask(); for (const pr of pairs) m[pr[0]][pr[1]] = true; return m; }
function shapeForKind(kind, opts) {
  opts = opts || {};
  if (kind === 'po') return { mask: opts.mask };
  if (kind === 'monster') return { w: opts.w, h: opts.h };
  return null; // si/unit/bpskin carry no shape
}

// ---- current art_route constants (snapshotted where a manifest is silent) ----
function readRouteConstants() {
  try {
    const out = execFileSync('python3', ['-c',
      "import sys,json;sys.path.insert(0,'tools');import art_route as R;print(json.dumps({'steps':R.STEPS,'cfg':R.CFG,'sampler':R.SAMPLER,'seed':R.SEED,'cell_px':R.CELL_PX,'unet':R.FLUX['unet'],'clip':R.FLUX['clip'],'vae':R.FLUX['vae']}))"],
      { cwd: REPO_ROOT }).toString();
    return JSON.parse(out);
  } catch (e) {
    // Fallback to the ratified constants (kept in sync with tools/art_route.py);
    // used only if the python import is unavailable.
    return { steps: 30, cfg: 1.0, sampler: 'euler', seed: 1, cell_px: 128,
      unet: 'flux-2-klein-4b-Q8_0.gguf', clip: 'qwen_3_4b.safetensors', vae: 'flux2-vae.safetensors' };
  }
}

// ---- model-file content hashes (streamed; cached; ruling 4) ----
function sha256Stream(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('error', reject);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
  });
}
async function hashModelCurrent(filename) {
  const p = resolveModelPath(filename);
  if (!p) return { file: filename, sha256: crypto.createHash('sha256').update('missing:' + filename).digest('hex'), hash_source: 'missing_file_fallback' };
  return { file: filename, sha256: await sha256Stream(p), hash_source: 'content' };
}

// ---- adoption evidence: byte index over live/adopted reference PNGs ----
function walkPng(dir) {
  let out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walkPng(p));
    else if (e.name.endsWith('.png')) out.push(p);
  }
  return out;
}
// sha256 -> repo-relative path, over the assets that PROVE adoption:
// content/live/** and any batch */selected/** (a recorded selection).
function buildLiveShaIndex(repoRoot) {
  const roots = [path.join(repoRoot, 'content', 'live')];
  const batchesDir = path.join(repoRoot, 'content', 'batches');
  if (fs.existsSync(batchesDir)) {
    for (const b of fs.readdirSync(batchesDir)) {
      const sel = path.join(batchesDir, b, 'selected');
      if (fs.existsSync(sel)) roots.push(sel);
    }
  }
  const idx = new Map();
  for (const root of roots) {
    for (const p of walkPng(root)) {
      const sha = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      if (!idx.has(sha)) idx.set(sha, path.relative(repoRoot, p));
    }
  }
  return idx;
}

// ---- per-batch pure mappers (manifest json -> entries) ----
// An entry: {slug,key,system_name,kind,shapeOpts,seed,main_object,final_prompt,
//            final_prompt_source,backfilled_approx,image_rel,tiling,
//            edge_padding?,frame_gate?,spike_verdict?,tiling_leg?,route_override?,adopt?}

function entriesParity(manifest, fixups, framing, slug) {
  const out = [];
  const push = (o) => out.push(Object.assign({ slug, system_name: slug + ':' + o.key, tiling: o.kind === 'bpskin' }, o));
  for (const a of (manifest.assets || [])) {
    const kind = KIND_MAP[a.kind] || a.kind;
    let shapeOpts = null;
    if (kind === 'po') shapeOpts = { mask: maskFromWH(a.cells[0], a.cells[1]) };
    else if (kind === 'monster') shapeOpts = { w: a.cells[0], h: a.cells[1] };
    push({ key: a.id, kind, shapeOpts, seed: manifest.seed || 1,
      main_object: a.subject || a.id, final_prompt: a.prompt_weighted || a.subject || '',
      final_prompt_source: 'manifest_prompt_weighted', backfilled_approx: false,
      image_rel: a.id + '.png' });
  }
  for (const f of ((fixups && fixups.fills) || [])) {
    push({ key: f.id, kind: 'bpskin', shapeOpts: null, seed: f.seed,
      main_object: 'leather texture fill', final_prompt: f.prompt || '',
      final_prompt_source: 'manifest_prompt', backfilled_approx: false, image_rel: f.id + '.png' });
  }
  const thieves = ((fixups && fixups.thieves) || []).concat(framing || []);
  for (const t of thieves) {
    push({ key: t.id, kind: 'unit', shapeOpts: null, seed: manifest.seed || 1,
      main_object: t.subject || t.id, final_prompt: t.prompt || '',
      final_prompt_source: 'manifest_prompt', backfilled_approx: false, image_rel: t.id + '.png' });
  }
  return out;
}

function entriesRoster(defs, kind, slug) {
  const out = [];
  for (const e of (defs.entries || [])) {
    let shapeOpts = null;
    if (kind === 'po') {
      const gr = e.gen_render || {};
      shapeOpts = { mask: maskFromCellPairs(gr.mask_cells || gr.cells || [[0, 0]]) };
    }
    for (const cN of Object.keys(CAND_SEEDS)) {
      const seed = CAND_SEEDS[cN];
      out.push({ slug, key: e.id + '_' + cN + '_s' + seed, system_name: slug + ':' + e.id,
        kind, shapeOpts, seed, main_object: e.name || e.id, final_prompt: e.gen_prompt || '',
        final_prompt_source: 'manifest_subject_only', backfilled_approx: true,
        image_rel: 'candidates/' + e.id + '_' + cN + '_s' + seed + '.png', tiling: false });
    }
  }
  return out;
}

function entriesMonsters(jobs, slug) {
  const out = [];
  for (const j of jobs) {
    const m = j.name.match(/^(.*)_s(\d+)$/);
    const subj = m ? m[1] : j.name;
    const cw = j.cells_hint && j.cells_hint[0];
    const ch = j.cells_hint && j.cells_hint[1];
    out.push({ slug, key: j.name, system_name: slug + ':' + subj, kind: 'monster',
      shapeOpts: { w: cw, h: ch }, seed: j.seed, main_object: j.positive,
      final_prompt: j.positive, final_prompt_source: 'manifest_positive',
      backfilled_approx: true, image_rel: 'candidates/' + j.name + '.png', tiling: false });
  }
  return out;
}

function frameReportAdoptions(fr) {
  const out = [];
  for (const s of (fr.skins || [])) {
    if (s.composed === true && s.frame) {
      const m = s.frame.match(/_s(\d+)\.png$/);
      out.push({ material: s.material, seed: m ? parseInt(m[1], 10) : null, frame: s.frame });
    }
  }
  return out;
}

function entriesFrames(frameReport, slug) {
  const out = [];
  const adopt = frameReportAdoptions(frameReport);
  const seen = new Set();
  for (const c of (frameReport.checks || [])) {
    const m = c.file.match(/^([a-z]+)_frame_s(\d+)\.png$/);
    if (!m) continue;
    const material = m[1]; const seed = parseInt(m[2], 10);
    const k = material + '_s' + seed;
    if (seen.has(k)) continue; seen.add(k);
    const ev = adopt.find((a) => a.material === material && a.seed === seed);
    out.push({ slug, key: c.file.replace(/\.png$/, ''), system_name: slug + ':' + material,
      kind: 'bpskin', shapeOpts: null, seed, main_object: material + ' backpack skin frame',
      final_prompt: '', final_prompt_source: 'not_recorded', backfilled_approx: true,
      image_rel: c.file, tiling: false, edge_padding: frameReport.band || null,
      frame_gate: { PASS: c.PASS, band: frameReport.band },
      adopt: ev ? { evidence: slug + '/frame_report.json: skins[].composed=true, frame=' + ev.frame } : null });
  }
  return out;
}

function entriesBpskinFindings(findings, slug) {
  const out = [];
  const motifs = []; const seeds = [];
  for (const leg of (findings.legs || [])) {
    if (motifs.indexOf(leg.motif) < 0) motifs.push(leg.motif);
    if (seeds.indexOf(leg.seed) < 0) seeds.push(leg.seed);
  }
  for (const motif of motifs) {
    for (const seed of seeds) {
      out.push({ slug, key: motif + '_s' + seed, system_name: slug + ':' + motif, kind: 'bpskin',
        shapeOpts: null, seed, main_object: motif + ' seamless texture (tiling spike)',
        final_prompt: '', final_prompt_source: 'not_recorded', backfilled_approx: true,
        image_rel: motif + '_s' + seed + '_seamless.png', tiling: true,
        spike_verdict: (findings.verdict && findings.verdict.seamless) || 'FAIL', tiling_leg: 'seamless',
        route_override: { steps: findings.steps, cfg: findings.cfg } });
    }
  }
  return out;
}

// ---- params snapshot (mirrors server/services/art_jobs.cjs shape) ----
function buildParams(entry, route, modelHashes, sizeWH) {
  const ov = entry.route_override || {};
  const p = {
    steps: ov.steps != null ? ov.steps : route.steps,
    cfg: ov.cfg != null ? ov.cfg : route.cfg,
    sampler: route.sampler, // never recorded per-render in any manifest -> constant
    seed: entry.seed,
    size: sizeWH,
    tiling: !!entry.tiling,
    seed_default: route.seed,
    cell_px: route.cell_px,
    models: modelHashes,
    backfill: true,
    backfill_batch: entry.slug,
    backfill_key: entry.key,
    backfill_image: entry.slug + '/' + entry.image_rel,
    backfilled_approx: !!entry.backfilled_approx,
    hash_backfilled: true,
    final_prompt_source: entry.final_prompt_source,
  };
  if (entry.frame_gate) p.bpskin_frame_report = { source: 'frame_report.json', PASS: entry.frame_gate.PASS, band: entry.frame_gate.band, advisory: true };
  if (entry.spike_verdict) p.spike_verdict = entry.spike_verdict;
  if (entry.tiling_leg) p.tiling_leg = entry.tiling_leg;
  if (entry.adopt) p.backfill_adoption_evidence = entry.adopt.evidence;
  return p;
}

// ---- collect every flux2-era batch entry from disk ----
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function collectAllEntries(batchesRoot) {
  const B = (s) => path.join(batchesRoot, s);
  const all = [];
  const parity = 'flux2-parity-0150';
  if (fs.existsSync(B(parity))) {
    const manifest = readJson(path.join(B(parity), 'manifest.json'));
    const fixups = fs.existsSync(path.join(B(parity), 'fixups.json')) ? readJson(path.join(B(parity), 'fixups.json')) : {};
    const framing = fs.existsSync(path.join(B(parity), 'thief_framing.json')) ? readJson(path.join(B(parity), 'thief_framing.json')) : [];
    all.push.apply(all, entriesParity(manifest, fixups, framing, parity));
  }
  const units = 'units-002-roster-flux2';
  if (fs.existsSync(path.join(B(units), 'unit_defs.json'))) all.push.apply(all, entriesRoster(readJson(path.join(B(units), 'unit_defs.json')), 'unit', units));
  const items = 'batch-004-item-icons-flux2';
  if (fs.existsSync(path.join(B(items), 'item_defs.json'))) all.push.apply(all, entriesRoster(readJson(path.join(B(items), 'item_defs.json')), 'po', items));
  const monsters = 'monsters-003-flux2';
  if (fs.existsSync(path.join(B(monsters), 'jobs.json'))) all.push.apply(all, entriesMonsters(readJson(path.join(B(monsters), 'jobs.json')), monsters));
  const frames = 'bpskin-frames-0150';
  if (fs.existsSync(path.join(B(frames), 'frame_report.json'))) all.push.apply(all, entriesFrames(readJson(path.join(B(frames), 'frame_report.json')), frames));
  const bpspike = 'bpskin-flux2-0150';
  if (fs.existsSync(path.join(B(bpspike), 'findings.json'))) all.push.apply(all, entriesBpskinFindings(readJson(path.join(B(bpspike), 'findings.json')), bpspike));
  return all;
}

function groupBySystemName(all) {
  const m = new Map();
  for (const e of all) { if (!m.has(e.system_name)) m.set(e.system_name, []); m.get(e.system_name).push(e); }
  return m;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.indexOf('--dry-run') >= 0;
  const rootIdx = args.indexOf('--batches-root');
  const batchesRoot = rootIdx >= 0 ? args[rootIdx + 1] : path.join(REPO_ROOT, 'content', 'batches');

  const route = readRouteConstants();
  const all = collectAllEntries(batchesRoot);
  const bySys = groupBySystemName(all);
  const liveIndex = buildLiveShaIndex(REPO_ROOT);

  // per-batch inventory
  const perBatch = {};
  for (const e of all) { perBatch[e.slug] = perBatch[e.slug] || { artworks: new Set(), renders: 0 }; perBatch[e.slug].artworks.add(e.system_name); perBatch[e.slug].renders++; }
  console.log('== flux2-era backfill inventory (batchesRoot=' + batchesRoot + ') ==');
  for (const slug of Object.keys(perBatch)) console.log('  ' + slug + ': ' + perBatch[slug].artworks.size + ' artworks, ' + perBatch[slug].renders + ' renders');
  console.log('  TOTAL: ' + bySys.size + ' artworks, ' + all.length + ' renders');
  console.log('  live/adopted reference PNGs indexed for byte-match: ' + liveIndex.size);

  if (dryRun) { console.log('DRY-RUN: no DB writes.'); return; }

  const modelHashes = { unet: await hashModelCurrent(route.unet), clip: await hashModelCurrent(route.clip), vae: await hashModelCurrent(route.vae) };
  for (const k of ['unet', 'clip', 'vae']) console.log('  model ' + k + ': ' + modelHashes[k].file + ' [' + modelHashes[k].hash_source + '] ' + modelHashes[k].sha256.slice(0, 12) + '...');

  const storage = require(path.join(REPO_ROOT, 'server', 'storage.cjs'));
  let awNew = 0, awExist = 0, rNew = 0, rSkip = 0, adopted = 0, missing = 0;
  try {
    for (const sys of bySys.keys()) {
      const ents = bySys.get(sys);
      const first = ents[0];
      const shape = shapeForKind(first.kind, first.shapeOpts || {});
      const size = deriveSize(first.kind, shape);
      let art = await storage.getArtworkByName(sys);
      if (!art) {
        art = await storage.createArtwork({ system_name: sys, kind: first.kind, shape,
          gen_width: size.width, gen_height: size.height, main_object: first.main_object,
          prompt_template: '', style_override: null,
          edge_padding: first.edge_padding != null ? first.edge_padding : null });
        awNew++;
      } else { awExist++; }
      const existing = await storage.listRenders(art.id);
      const bySeed = new Map(existing.map((r) => [r.seed, r]));
      for (const e of ents) {
        const imgPath = path.join(batchesRoot, e.slug, e.image_rel);
        if (!fs.existsSync(imgPath)) { console.warn('  MISSING IMAGE: ' + imgPath); missing++; continue; }
        const buf = fs.readFileSync(imgPath);
        const sha = crypto.createHash('sha256').update(buf).digest('hex');
        // byte-match adoption (in addition to any frame_report adoption already set)
        if (!e.adopt && liveIndex.has(sha)) e.adopt = { evidence: liveIndex.get(sha) };
        if (bySeed.has(e.seed)) {
          rSkip++;
          if (e.adopt) {
            const cur = await storage.getArtworkByName(sys);
            const rid = bySeed.get(e.seed).id;
            if (String(cur.adopted_render_id) !== String(rid)) { await storage.adoptRender(sys, e.seed); adopted++; }
          }
          continue;
        }
        const size2 = deriveSize(e.kind, shapeForKind(e.kind, e.shapeOpts || {}));
        const params = buildParams(e, route, modelHashes, size2);
        const r = await storage.createRender(art.id, e.seed, 'queued');
        await storage.updateRenderResult(r.id, { status: 'ok', image: buf, image_sha256: sha, final_prompt: e.final_prompt, params, error: null });
        rNew++;
        if (e.adopt) { await storage.adoptRender(sys, e.seed); adopted++; }
      }
    }
    console.log('\n== backfill applied ==');
    console.log('  artworks: ' + awNew + ' created, ' + awExist + ' already existed');
    console.log('  renders : ' + rNew + ' created, ' + rSkip + ' already existed, ' + missing + ' missing-image skipped');
    console.log('  adopted-with-evidence this run: ' + adopted);
  } finally {
    await storage.closeArtPool();
  }
}

module.exports = {
  KIND_MAP, CAND_SEEDS, maskFromWH, maskFromCellPairs, shapeForKind,
  entriesParity, entriesRoster, entriesMonsters, entriesFrames, entriesBpskinFindings,
  frameReportAdoptions, buildParams, buildLiveShaIndex, collectAllEntries, groupBySystemName,
};

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
}
