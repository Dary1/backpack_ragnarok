'use strict';
// tools/backfill_sprite_art.cjs -- REQ-0177 (sprite-svg-art-backfill).
//
// Lifts every LIVE po/si/tm entity's legacy sprite icon (`icon-<id>` <symbol>
// in content/sprite_all_v12.svg) INTO the artwork registry as a REAL render,
// adopts it where nothing is adopted, and links the owning content def via
// artwork_ref where that is unset -- so the registry tier of the REQ-0133
// registry-first chain covers 100% of live items and the sprite becomes a
// safety net rather than the source of truth.
//
// INSERT-ONLY + IDEMPOTENT: every write is gated (see decideActions) so a
// second run performs zero writes and no explicit operator selection (an
// adopted render, an explicit artwork_ref like blade->a chosen batch) is ever
// overwritten. content/sprite_all_v12.svg is READ, never modified.
//
// All persistence goes through the storage chokepoint (server/storage.cjs).
// Rasterization reuses the e2e-provisioned Playwright chromium in
// client/node_modules (no new installs): the client's parseSymbols/
// standaloneSvgString logic (client/src/board/sprites.ts) is ported here in
// Node (@xmldom for the DOM pair, same as client/scripts/check_sprites.mjs),
// and each standalone symbol SVG is drawn to a canvas in a headless page --
// exactly the client's rasterize() path -- to produce the render PNG.
//
// Usage (orchestrator, at deploy, against the LIVE namespace):
//   set -a; source server/.env; set +a
//   node tools/backfill_sprite_art.cjs --dry-run     # prints the full plan, writes nothing
//   node tools/backfill_sprite_art.cjs               # applies (INSERT-only)
// DO NOT run against the live namespace from a feature branch: tests use an
// isolated pg namespace (TMPHOME remap), the orchestrator owns the live run.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const SPRITE_SVG = path.join(REPO_ROOT, 'content', 'sprite_all_v12.svg');
const { deriveSize } = require(path.join(REPO_ROOT, 'server', 'services', 'art_sizing.cjs'));

// Sprite-backfill render seed = int4 max = "imported from an unknown
// environment / not reproducible by the gen pipeline" (user ruling, binding
// project-wide). storage_art.createRender's auto-seed EXCLUDES this sentinel
// (REQ-0177 guard) so a later real render never overflows int4.
const SENTINEL_SEED = 2147483647;

// The live po/si/tm corpus the game SERVES -- the same source files REQ-0157c's
// content backfill used for po_def/si_def/tm_def. content/live/starter_items.json
// is DELIBERATELY EXCLUDED: its entries carry placeholder icon ids
// (icon-placeholder-*) that have NO <symbol> in the sprite sheet, so there is no
// legacy sprite art to lift (they are foreign to this backfill by construction).
const SOURCES = [
  { kind: 'po', file: 'content/live/live_items.json' },
  { kind: 'si', file: 'content/live/live_sis.json' },
  { kind: 'tm', file: 'content/live/live_tms.json' },
];

// tm has NO artwork kind of its own -- the registry's KINDS are
// po|si|unit|monster|bpskin (server/services/art_sizing.cjs). A TM is a 1x1,
// shape-less, stackable inventory icon, so it maps to the CLOSEST existing
// artwork kind: 'si' (the shape-less, locked-256x256 icon kind). Documented as
// the tm-kind mapping decision in the REQ-0177 implementation log.
const KIND_MAP = { po: 'po', si: 'si', tm: 'si' };

// ---- symbol parsing (faithful port of client/src/board/sprites.ts) ----

/** Parse the multi-root sprite sheet into one record per <symbol>. Wraps the
 * concatenated <svg> root blocks in a synthetic single root first (the sheet
 * is not well-formed single-document XML), exactly as the client does. */
function parseSymbols(svgSource, domParser, xmlSerializer) {
  const wrapped = '<svg-root xmlns="http://www.w3.org/2000/svg">' + svgSource + '</svg-root>';
  const doc = domParser.parseFromString(wrapped, 'image/svg+xml');
  const symbols = Array.from(doc.getElementsByTagName('symbol'));
  return symbols.map((sym) => {
    const id = sym.getAttribute('id') || '';
    const viewBox = sym.getAttribute('viewBox') || '0 0 64 64';
    const parts = viewBox.split(/\s+/).map(Number);
    const w = parts[2], h = parts[3];
    const preserveAspectRatio = sym.getAttribute('preserveAspectRatio');
    const innerMarkup = Array.from(sym.childNodes)
      .map((child) => xmlSerializer.serializeToString(child)).join('');
    return { id, viewBox, width: w || 64, height: h || 64, preserveAspectRatio, innerMarkup };
  });
}

/** Load + parse the sprite sheet from disk using @xmldom (client deps). */
function loadSheetSymbols(svgText) {
  const xmldom = require(path.join(REPO_ROOT, 'client', 'node_modules', '@xmldom', 'xmldom'));
  return parseSymbols(svgText, new xmldom.DOMParser(), new xmldom.XMLSerializer());
}

/** A standalone SVG document for one symbol at an explicit output size
 * (carries the symbol's own preserveAspectRatio -- several item symbols set
 * preserveAspectRatio="none" and rely on it, see the client module comment).
 * Byte-faithful to the client's standaloneSvgString apart from the size. */
function standaloneSvgStringSized(sym, outW, outH) {
  const parAttr = sym.preserveAspectRatio ? ' preserveAspectRatio="' + sym.preserveAspectRatio + '"' : '';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + sym.viewBox + '" ' +
    'width="' + outW + '" height="' + outH + '"' + parAttr + '>' + sym.innerMarkup + '</svg>';
}

/** Registry raster size for a symbol: contain-fit so the LONGER viewBox edge
 * becomes 256px, aspect preserved. 256 is the item pipeline's per-cell canon
 * (item_content_pipeline.md), and holding the sprite's native aspect is what
 * makes the registry render draw the SAME shape the sprite route draws today
 * (the game contain-fits by aspect, not absolute px). */
function rasterSizeFor(sym) {
  const long = Math.max(sym.width, sym.height) || 64;
  const scale = 256 / long;
  return { w: Math.max(1, Math.round(sym.width * scale)), h: Math.max(1, Math.round(sym.height * scale)) };
}

// ---- pure inventory + planning ----

function loadEntries(file) {
  const doc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
  return Array.isArray(doc.entries) ? doc.entries : [];
}

/** 5x5 boolean mask (row-major) for a 'po' artwork, from an item's shape
 * offsets ([[r,c],...]) normalized to the bounding-box top-left. Throws if the
 * footprint does not fit 5x5 (no live item does; a loud failure beats a
 * silently clipped mask). Returns null for an empty shape. */
function maskFromShape(shape) {
  const cells = Array.isArray(shape) ? shape.filter((c) => Array.isArray(c) && c.length >= 2) : [];
  if (cells.length === 0) return null;
  const rows = cells.map((c) => c[0]);
  const cols = cells.map((c) => c[1]);
  const minR = Math.min.apply(null, rows), minC = Math.min.apply(null, cols);
  const h = Math.max.apply(null, rows) - minR + 1, w = Math.max.apply(null, cols) - minC + 1;
  if (h > 5 || w > 5) throw new Error('shape does not fit 5x5: ' + JSON.stringify(shape));
  const mask = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => false));
  for (const c of cells) mask[c[0] - minR][c[1] - minC] = true;
  return mask;
}

/** The artwork row an entry maps to: system_name=bare id, kind mapped, shape +
 * derived size (po from its footprint; si/tm shape-less 256x256). Pure. */
function artworkPlanFor(entry, srcKind) {
  const kind = KIND_MAP[srcKind];
  if (kind === 'po') {
    const mask = maskFromShape(entry.shape);
    if (!mask) throw new Error('po entry ' + entry.id + ' has no shape');
    const size = deriveSize('po', { mask });
    return { system_name: entry.id, kind: 'po', shape: { mask }, gen_width: size.width, gen_height: size.height };
  }
  return { system_name: entry.id, kind: 'si', shape: null, gen_width: 256, gen_height: 256 };
}

/** Full inventory across SOURCES. `symbolIds` is the Set of icon ids present in
 * the sheet; an entry whose icon is absent is flagged foreign (hasSymbol=false)
 * and skipped loudly by the runner. Pure (given the on-disk files). */
function buildInventory(symbolIds) {
  const inv = [];
  for (const src of SOURCES) {
    for (const entry of loadEntries(src.file)) {
      const icon = typeof entry.icon === 'string' ? entry.icon : '';
      const hasSymbol = !!icon && symbolIds.has(icon);
      let plan = null, planErr = null;
      try { plan = artworkPlanFor(entry, src.kind); } catch (e) { planErr = e.message; }
      inv.push({ id: entry.id, icon: icon, srcKind: src.kind, file: src.file, hasSymbol: hasSymbol, plan: plan, planErr: planErr });
    }
  }
  return inv;
}

/** Given the CURRENT DB state for one entity, decide which INSERT-only actions
 * this run takes. Each gate makes a re-run a no-op and preserves operator
 * selections:
 *   createArtwork: only if no artwork row exists for this name
 *   createRender : only if no sentinel (seed 2147483647) render exists
 *   adopt        : only if the artwork has NO adopted render (never re-adopts
 *                  over an explicit selection)
 *   linkDef      : only if a content_def exists AND its artwork_ref is NULL
 *                  (never overwrites an explicit artwork_ref)
 * Pure. */
function decideActions(state) {
  return {
    createArtwork: !state.artworkExists,
    createRender: !state.sentinelRenderExists,
    adopt: !state.adopted,
    linkDef: !!state.defExists && !state.artworkRefSet,
  };
}

// ---- rasterization (Playwright chromium; the client rasterize() path) ----

/** Default rasterizer: draw each symbol's standalone SVG to a canvas in a
 * headless chromium page and return its PNG bytes. `symbols` -> Map(icon ->
 * {buffer, sha256, width, height}). Uses the client's Playwright (no installs). */
async function defaultRasterize(symbols) {
  const { chromium } = require(path.join(REPO_ROOT, 'client', 'node_modules', 'playwright'));
  const jobs = symbols.map((sym) => {
    const sz = rasterSizeFor(sym);
    return { id: sym.id, svg: standaloneSvgStringSized(sym, sz.w, sz.h), w: sz.w, h: sz.h };
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const out = await page.evaluate(async (items) => {
      const results = [];
      for (const it of items) {
        const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(it.svg);
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = it.w; canvas.height = it.h;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, it.w, it.h);
        ctx.drawImage(img, 0, 0, it.w, it.h);
        results.push({ id: it.id, png: canvas.toDataURL('image/png'), w: it.w, h: it.h });
      }
      return results;
    }, jobs);
    const map = new Map();
    for (const r of out) {
      const b64 = r.png.split(',')[1] || '';
      const buffer = Buffer.from(b64, 'base64');
      map.set(r.id, { buffer, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), width: r.w, height: r.h });
    }
    return map;
  } finally {
    await browser.close();
  }
}

// ---- orchestration ----

/** Run the backfill. opts = { dryRun, storage, rasterize, log }. Returns the
 * count summary. INSERT-only; every write gated by decideActions. */
async function runBackfill(opts) {
  opts = opts || {};
  const dryRun = !!opts.dryRun;
  const storage = opts.storage || require(path.join(REPO_ROOT, 'server', 'storage.cjs'));
  const rasterize = opts.rasterize || defaultRasterize;
  const log = opts.log || function () { console.log.apply(console, arguments); };

  const symbols = loadSheetSymbols(fs.readFileSync(SPRITE_SVG, 'utf8'));
  const symbolIds = new Set(symbols.map((s) => s.id));
  const inv = buildInventory(symbolIds);

  const counts = { entities: inv.length, artworks: 0, renders: 0, adoptions: 0, defsLinked: 0, skippedForeign: 0 };
  const plan = [];
  const iconsNeeded = new Set();
  for (const rec of inv) {
    if (!rec.hasSymbol) { log('SKIP foreign (no <symbol> ' + JSON.stringify(rec.icon) + ' in sheet) -> ' + rec.id); counts.skippedForeign++; continue; }
    if (rec.planErr) { log('SKIP plan-error (' + rec.planErr + ') -> ' + rec.id); counts.skippedForeign++; continue; }
    const artwork = await storage.getArtworkByName(rec.id);
    let sentinelRenderExists = false, adopted = false;
    if (artwork) {
      adopted = artwork.adopted_render_id != null;
      const renders = await storage.listRenders(artwork.id);
      sentinelRenderExists = renders.some((r) => r.seed === SENTINEL_SEED);
    }
    const def = await storage.getContentDefByName(rec.id);
    const actions = decideActions({
      artworkExists: !!artwork, sentinelRenderExists: sentinelRenderExists, adopted: adopted,
      defExists: !!def, artworkRefSet: !!(def && def.artwork_ref),
    });
    if (actions.createRender) iconsNeeded.add(rec.icon);
    plan.push({ rec: rec, artwork: artwork, actions: actions });
  }

  let rasters = new Map();
  if (!dryRun && iconsNeeded.size > 0) {
    rasters = await rasterize(symbols.filter((s) => iconsNeeded.has(s.id)));
  }

  for (const item of plan) {
    const rec = item.rec, actions = item.actions;
    const line = 'id=' + rec.id + ' icon=' + rec.icon + ' kind=' + rec.plan.kind +
      ' [' + (actions.createArtwork ? 'ARTWORK ' : '') + (actions.createRender ? 'RENDER ' : '') +
      (actions.adopt ? 'ADOPT ' : '') + (actions.linkDef ? 'LINKDEF' : '') + ']';
    if (dryRun) { log('PLAN ' + line); continue; }
    if (!actions.createArtwork && !actions.createRender && !actions.adopt && !actions.linkDef) { log('noop ' + rec.id); continue; }
    let art = item.artwork;
    if (actions.createArtwork) { art = await storage.createArtwork(rec.plan); counts.artworks++; log('created artwork ' + rec.id + ' (' + rec.plan.kind + ')'); }
    if (actions.createRender) {
      const raster = rasters.get(rec.icon);
      if (!raster || !raster.buffer || raster.buffer.length === 0) { log('SKIP rasterize-empty -> ' + rec.id + ' (' + rec.icon + ')'); counts.skippedForeign++; continue; }
      const r = await storage.createRender(art.id, SENTINEL_SEED, 'ok');
      await storage.updateRenderResult(r.id, {
        status: 'ok', image: raster.buffer, image_sha256: raster.sha256, final_prompt: null,
        params: { source: 'sprite-backfill', origin: 'content/sprite_all_v12.svg#' + rec.icon, imported_at: new Date().toISOString(), raster_w: raster.width, raster_h: raster.height },
        error: null,
      });
      counts.renders++; log('inserted render ' + rec.id + ' seed ' + SENTINEL_SEED + ' (' + raster.buffer.length + ' bytes)');
    }
    if (actions.adopt) { await storage.adoptRender(rec.id, SENTINEL_SEED); counts.adoptions++; log('adopted ' + rec.id + ' seed ' + SENTINEL_SEED); }
    if (actions.linkDef) { await storage.updateContentDef(rec.id, { artwork_ref: rec.id }); counts.defsLinked++; log('linked def ' + rec.id + '.artwork_ref -> ' + rec.id); }
  }

  log('---');
  log((dryRun ? '[DRY-RUN] ' : '') + 'entities=' + counts.entities +
    ' artworks_created=' + counts.artworks + ' renders_inserted=' + counts.renders +
    ' adoptions=' + counts.adoptions + ' defs_linked=' + counts.defsLinked +
    ' skipped_foreign=' + counts.skippedForeign);
  return counts;
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  (async () => {
    if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required (STORAGE_BACKEND=pg); source server/.env first.'); process.exit(2); }
    process.env.STORAGE_BACKEND = 'pg';
    const storage = require(path.join(REPO_ROOT, 'server', 'storage.cjs'));
    try {
      await runBackfill({ dryRun: dryRun, storage: storage });
    } finally {
      if (storage.closeArtPool) await storage.closeArtPool();
      if (storage.closeContentPool) await storage.closeContentPool();
    }
    process.exit(0);
  })().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
}

module.exports = {
  SOURCES, KIND_MAP, SENTINEL_SEED,
  parseSymbols, loadSheetSymbols, standaloneSvgStringSized, rasterSizeFor,
  loadEntries, maskFromShape, artworkPlanFor, buildInventory, decideActions,
  defaultRasterize, runBackfill,
};
