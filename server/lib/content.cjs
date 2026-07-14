'use strict';
// server/lib/content.cjs -- REQ-0047 (c): /api/content payload assembly +
// the mtime-checked content cache. Moved VERBATIM from server/api.cjs.
// contentCache stays module-private; admin writes call
// invalidateContentCache() (previously a direct `contentCache = null`).
const path = require('path');
const { render } = require('../../tools/eff_render.cjs');
// REQ-0145a (sc): all content paths resolve through the ONE content-file
// loader (CONTENT_ROOT env override honored; default byte-equivalent to
// the old os.homedir() anchoring). statMtimeMs/loadJSON come from the
// loader too and are re-exported below unchanged.
const { CONTENT_ROOT, contentPath, statMtimeMs, loadJSON } = require('./content_files.cjs');

const REPO_ROOT = path.dirname(CONTENT_ROOT); // kept for export-surface compatibility
const CONTENT_DIR = CONTENT_ROOT;
const LIVE_DIR = contentPath('live');
const VOCAB_PATH = contentPath('vocab.json');
const ITEMS_PATH = contentPath('live', 'live_items.json');
const SIS_PATH = contentPath('live', 'live_sis.json');
const TMS_PATH = contentPath('live', 'live_tms.json'); // REQ-0042: Transmutator content defs
const UNITS_PATH = contentPath('live', 'live_units.json'); // REQ-0170: unit/1 defs
const BPSKINS_PATH = contentPath('live', 'live_bpskins.json'); // REQ-0126: bpskin/1 cosmetic asset defs
const PACKS_PATH = contentPath('live', 'live_packs.json'); // REQ-0170: gacha_pack/1 defs
const SCENARIO_PATH = contentPath('live', 'scenario.json');
const REGISTRY_PATH = contentPath('registry.json');

const STARTER_ITEMS_PATH = contentPath("live", "starter_items.json"); // REQ-0051
const STARTER_UNITS_PATH = contentPath("live", "starter_units.json"); // REQ-0051

// ---- content cache (mtime-checked; re-read only when a source file changes) ----
let contentCache = null; // { mtimes: {vocab,items,sis,scenario}, payload }

// Joins all effect renderings (in the given locale) with a single space.
// Mirrors tools/tool_gen_data.cjs's renderEffJoined exactly, so live-served
// eff_en/eff_ja match the baked mock-src/data.js strings byte-for-byte.
function renderEffJoined(effects, locale) {
  return (effects || []).map(function (e) { return render(e, locale); }).join(' ');
}

// REQ-0038: formal i18n content shape. content/live/*.json entries now
// carry an `i18n` map (e.g. i18n.ja.{name,flavor}) instead of flat
// name_ja/flavor_ja fields (see tools/migrate_i18n.cjs). Chosen served
// shape (per the REQ-0038 design decision -- "pick ONE approach and apply
// it consistently"): serve the new `i18n` map AS WELL AS computed back-
// compat top-level name_ja/flavor_ja fields, mirrored from
// i18n.ja.name/i18n.ja.flavor. This keeps every EXISTING consumer of the
// wire shape working unchanged (client/src/api.ts's ApiItemEntry/
// ApiSIEntry, client/src/ItemPanel.tsx's localized(), mock-src/ui.js's
// gameDataFromApiContent(), tools/tool_gen_data.cjs's baked data.js)
// while the Dex v2 UI (client/src/dex/*) and the admin edit form read the
// formal i18n map directly. Only the SERVER'S OWN computation is new;
// the on-disk file no longer has the flat fields at all post-migration.
function withBackCompatI18n(entry) {
  const ja = entry.i18n && entry.i18n.ja;
  if (!ja) return entry;
  const out = Object.assign({}, entry);
  if (out.name_ja === undefined && typeof ja.name === 'string') out.name_ja = ja.name;
  if (out.flavor_ja === undefined && typeof ja.flavor === 'string') out.flavor_ja = ja.flavor;
  return out;
}

// Builds the /api/content payload fresh from content/live + vocab.
// Shape mirrors mock-src/data.js (GameData): { items, sis, trees, scenario }.
// This is intentionally a straight, un-cached-at-source read of content/live —
// content/live is the single source of truth (per REQ-0024 architecture note).
function buildContentPayload() {
  const vocab = loadJSON(VOCAB_PATH);
  const items = loadJSON(ITEMS_PATH);
  const sis = loadJSON(SIS_PATH);
  const tms = loadJSON(TMS_PATH); // REQ-0042
  const units = loadJSON(UNITS_PATH); // REQ-0170
  const packs = loadJSON(PACKS_PATH); // REQ-0170
  let bpskinsDoc = null; try { bpskinsDoc = loadJSON(BPSKINS_PATH); } catch (e) { bpskinsDoc = null; } // REQ-0126
  const scenario = loadJSON(SCENARIO_PATH);
  // REQ-0035: batch-level provenance for the Dex's "provenance" section.
  // Optional -- an absent/unreadable registry.json degrades to `null`,
  // never a 500 (this file is metadata, not required for the board to
  // function).
  let registry = null;
  try { registry = loadJSON(REGISTRY_PATH); } catch (e) { registry = null; }
  // REQ-0051: starter-unit squad definitions (the grant + regrant seed
  // source, consumed by the client boot seed and POST /api/starter/claim).
  let starterUnits = null;
  try { starterUnits = loadJSON(STARTER_UNITS_PATH); } catch (e) { starterUnits = null; }

  const itemEntries = items.entries || [];
  const siEntries = sis.entries || [];
  const tmEntries = tms.entries || []; // REQ-0042
  const unitEntries = units.entries || []; // REQ-0170
  const packEntries = packs.entries || []; // REQ-0170

  const ITEMS = {};
  for (const e of itemEntries) {
    ITEMS[e.id] = withBackCompatI18n(Object.assign({}, e, {
      eff_en: renderEffJoined(e.effects, 'en'),
      eff_ja: renderEffJoined(e.effects, 'ja'),
    }));
  }
  // REQ-0051: starter-unit kit items live in content/live/starter_items.json
  // (isolated from live_items.json so the REQ-0160 registry count-gate and
  // dex numbering stay untouched). Merge them into the served ITEMS map so
  // the client engine can render/place starter POs. An absent file degrades
  // to none (the api_test synthetic content fixture ships no starter_items).
  let starterItemEntries = [];
  try { starterItemEntries = loadJSON(STARTER_ITEMS_PATH).entries || []; } catch (e) { starterItemEntries = []; }
  for (const e of starterItemEntries) {
    ITEMS[e.id] = withBackCompatI18n(Object.assign({}, e, {
      eff_en: renderEffJoined(e.effects, "en"),
      eff_ja: renderEffJoined(e.effects, "ja"),
    }));
  }
  const SIS = {};
  for (const e of siEntries) {
    SIS[e.id] = withBackCompatI18n(Object.assign({}, e, {
      eff_en: renderEffJoined(e.effects, 'en'),
      eff_ja: renderEffJoined(e.effects, 'ja'),
    }));
  }
  // REQ-0042: TM (Transmutator) defs -- no  field today (no
  // use-effect v1, per the REQ doc), so no eff_en/eff_ja rendering is
  // needed, but withBackCompatI18n is still applied for i18n consistency
  // with items/sis (name_ja/flavor_ja compat fields derived from i18n.ja).
  const TMS = {};
  for (const e of tmEntries) {
    TMS[e.id] = withBackCompatI18n(Object.assign({}, e));
  }
  // REQ-0170: Unit defs (unit/1). Served id-keyed, exactly like ITEMS/SIS/TMS, with
  // the same withBackCompatI18n() treatment so name_ja is available to every client
  // surface that already reads that field. No eff_en/eff_ja rendering: a unit def
  // carries no `effects` (the charge grammar is frozen but the engine has no AST for
  // it -- REQ-0170 section 2.3), and rendering an absent field would fabricate one.
  const UNITS = {};
  for (const e of unitEntries) {
    UNITS[e.id] = withBackCompatI18n(Object.assign({}, e));
  }
  // REQ-0170: gacha packs (gacha_pack/1) -- the emission pools. Served so the client
  // can show a pack's cost/odds from the same table the server rolls against, instead
  // of a display constant that can silently drift from the roll.
  const PACKS = {};
  for (const e of packEntries) {
    PACKS[e.id] = withBackCompatI18n(Object.assign({}, e));
  }
  const trees = { po: vocab.po_tags || {}, socket: vocab.socket_tags || {} };
  // REQ-0035: closed-vocabulary lists for the Dex admin edit form's
  // dropdowns (trigger types, verb types, statuses, rarities). Server-side
  // validation (admin.cjs) is the actual source of truth/enforcement --
  // this is purely so the client can render matching dropdown options
  // without duplicating vocab.json's lists by hand.
  const vocabLists = {
    triggers: vocab.triggers || [],
    verbs: vocab.verbs || [],
    statuses: vocab.statuses || [],
    rarities: vocab.rarities || [],
  };

  return {
    items: ITEMS,
    sis: SIS,
    tms: TMS, // REQ-0042
    units: UNITS, // REQ-0170
    packs: PACKS, // REQ-0170
    // REQ-0126: bpskin/1 registry ({entries:[...]}), the client's skin-def
    // source (loadSkinDefs()). Absent/unreadable file -> empty registry.
    bpskins: (bpskinsDoc && Array.isArray(bpskinsDoc.entries)) ? bpskinsDoc : { entries: [] },
    // REQ-0170/REQ-0128b: the ratified connection-shape table. Shipped WITH the
    // defs (rather than left for the client to re-derive) because the engine
    // resolves rays through it -- one table, one truth, board and sim agreeing by
    // construction.
    connection_shapes: vocab.connection_shapes || {},
    trees: trees,
    scenario: scenario,
    layout: scenario.layout || null,
    registry: registry,
    vocab: vocabLists,
    starterUnits: starterUnits, // REQ-0051
  };
}

function ensureFilePayload() {
  const mtimes = {
    vocab: statMtimeMs(VOCAB_PATH),
    items: statMtimeMs(ITEMS_PATH),
    sis: statMtimeMs(SIS_PATH),
    tms: statMtimeMs(TMS_PATH), // REQ-0042
    units: statMtimeMs(UNITS_PATH), // REQ-0170
    bpskins: statMtimeMs(BPSKINS_PATH), // REQ-0126
    packs: statMtimeMs(PACKS_PATH), // REQ-0170
    scenario: statMtimeMs(SCENARIO_PATH),
    registry: statMtimeMs(REGISTRY_PATH),
  };
  const stale = !contentCache ||
    mtimes.vocab !== contentCache.mtimes.vocab ||
    mtimes.items !== contentCache.mtimes.items ||
    mtimes.sis !== contentCache.mtimes.sis ||
    mtimes.tms !== contentCache.mtimes.tms || // REQ-0042
    mtimes.units !== contentCache.mtimes.units || // REQ-0170
    mtimes.bpskins !== contentCache.mtimes.bpskins || // REQ-0126
    mtimes.packs !== contentCache.mtimes.packs || // REQ-0170
    mtimes.scenario !== contentCache.mtimes.scenario ||
    mtimes.registry !== contentCache.mtimes.registry;
  if (stale) {
    contentCache = { mtimes: mtimes, payload: buildContentPayload() };
  }
  return contentCache.payload;
}

// ---- REQ-0133: registry-first art_url resolution (warm cache) ----
// Per served item (po/si/tm) the game needs the RESOLVED adopted-render URL
// (chain: def.artwork_ref adopted -> exact-name adopted -> sprite fallback, the
// last tier being the client's). Unlike the rest of the payload this is DB-
// derived (adopted renders), not file-derived, so it can change without any
// content file changing -- it lives in its OWN warm cache, refreshed off a TTL +
// explicitly on adopt / artwork_ref change (refreshArtUrls). getContent()
// attaches the CURRENT map SYNCHRONOUSLY as an additive `art_urls` field, so
// /api/content stays one synchronous, cacheable fetch and every existing
// (synchronous) caller/test is unaffected. Resolution itself is computed at the
// storage chokepoint (storage.resolveItemArtNames) -- no client-side cross-
// registry join for the game path. The registry is pg-only: under the files
// backend (or with no DATABASE_URL) the map is empty and the client falls back
// to the SVG sprite for every item (which, post the REQ-0177 backfill, is the
// same pixel anyway).
let artUrls = {};
let artUrlsAt = 0;
const ART_URLS_TTL_MS = 15000;

async function computeArtUrls() {
  if (process.env.STORAGE_BACKEND !== 'pg') return {}; // the artwork registry is pg-only
  const payload = ensureFilePayload();
  const names = [].concat(
    Object.keys(payload.items || {}),
    Object.keys(payload.sis || {}),
    Object.keys(payload.tms || {})
  );
  const storage = require('../storage.cjs');
  const resolved = await storage.resolveItemArtNames(names); // { id -> resolved artwork bare name }
  const map = {};
  for (const id of Object.keys(resolved)) {
    if (resolved[id]) map[id] = '/api/art/' + encodeURIComponent(resolved[id]) + '.png';
  }
  return map;
}

/** Recompute the art_urls map now. AWAITED by adopt / artwork_ref-change so the
 * next /api/content is fresh (this is what makes the wiring e2e deterministic);
 * also fired opportunistically (fire-and-forget) by getContent on a TTL. Never
 * throws: a registry read failure keeps the last map (empty at worst) so
 * /api/content never 500s on a transient DB hiccup. */
async function refreshArtUrls() {
  try { artUrls = await computeArtUrls(); artUrlsAt = Date.now(); }
  catch (e) { /* keep last map; /api/content must not fail on a registry read */ }
  return artUrls;
}

// ---- REQ-0178: registry-first CONTENT serving (Phase 1: po/si/tm) ----
// The data-side mirror of the REQ-0133 art_url warm cache above. For each
// served entity of a covered kind the game needs the RESOLVED data: the
// ADOPTED registry variant when one exists, else the live-file entry
// (fallback). Like art_urls this is DB-derived (adopted variants), so it can
// change with no content file changing -- it lives in its OWN warm cache,
// refreshed off a TTL + explicitly on adopt/edit/delete/patch
// (refreshRegistryData, awaited by those handlers for e2e determinism).
// getContent() OVERLAYS the current snapshot SYNCHRONOUSLY, so /api/content
// stays one synchronous fetch. Resolution is computed at the storage
// chokepoint (storage.resolveAdoptedContentData) -- no client-side cross-
// registry join. The registry is pg-only: under the files backend (or with no
// DATABASE_URL) the snapshot is EMPTY and the payload is byte-identical to the
// pre-REQ file payload (fallback covers everything). Kinds beyond po/si/tm are
// deliberately Phase-1b (see the REQ log): unit/pack have a second, still-file
// consumer (the gacha roll), and monster/skill/formation are served through a
// different module (services/core.cjs getScheduleContent), not this one.
const REGISTRY_KIND_BY_SECTION = { items: 'po_def', sis: 'si_def', tms: 'tm_def' };
let registryData = { po_def: {}, si_def: {}, tm_def: {} }; // { kind -> { bare -> adopted DATA (raw entry) } }
let registryAt = 0;
const REGISTRY_TTL_MS = 15000; // mirror ART_URLS_TTL_MS

async function computeRegistryData() {
  const empty = { po_def: {}, si_def: {}, tm_def: {} };
  if (process.env.STORAGE_BACKEND !== 'pg') return empty; // the content registry is pg-only
  const payload = ensureFilePayload();
  const storage = require('../storage.cjs');
  return {
    po_def: await storage.resolveAdoptedContentData('po_def', Object.keys(payload.items || {})),
    si_def: await storage.resolveAdoptedContentData('si_def', Object.keys(payload.sis || {})),
    tm_def: await storage.resolveAdoptedContentData('tm_def', Object.keys(payload.tms || {})),
  };
}

/** Recompute the registry snapshot now. AWAITED by the adopt/edit/delete/patch
 * handlers so the next /api/content reflects the change (the wiring e2e
 * determinism contract); also fired opportunistically on a TTL by getContent.
 * Never throws: a registry read failure keeps the last snapshot (empty at
 * worst) so /api/content never 500s on a transient DB hiccup. */
async function refreshRegistryData() {
  try { registryData = await computeRegistryData(); registryAt = Date.now(); }
  catch (e) { /* keep last snapshot; /api/content must not fail on a registry read */ }
  return registryData;
}

function registryIsEmpty(reg) {
  return !reg || (Object.keys(reg.po_def).length + Object.keys(reg.si_def).length + Object.keys(reg.tm_def).length) === 0;
}
// A registry-sourced po/si entry is served through the EXACT transform the
// file path applies (eff_en/eff_ja render + i18n back-compat), so a verbatim
// backfilled variant produces byte-identical output; the data itself is
// served verbatim (its own persisted fields untouched). Keyed by the served
// id (the lookup name), so the payload key set is unchanged.
function servedEffEntry(raw) {
  return withBackCompatI18n(Object.assign({}, raw, {
    eff_en: renderEffJoined(raw.effects, 'en'),
    eff_ja: renderEffJoined(raw.effects, 'ja'),
  }));
}
function servedTmEntry(raw) { return withBackCompatI18n(Object.assign({}, raw)); } // tms carry no effects
function overlaySection(base, regEntries, transform) {
  const out = Object.assign({}, base);
  for (const name of Object.keys(regEntries)) out[name] = transform(regEntries[name]);
  return out;
}
let servedCache = null; // { fp, reg, payload } -- identity-keyed on the file payload + registry snapshot
function applyRegistryOverlay(filePayload) {
  const reg = registryData;
  if (registryIsEmpty(reg)) return filePayload; // byte-identical to the pre-REQ payload (files backend / empty registry)
  if (servedCache && servedCache.fp === filePayload && servedCache.reg === reg) return servedCache.payload;
  const payload = Object.assign({}, filePayload, {
    items: overlaySection(filePayload.items, reg.po_def, servedEffEntry),
    sis: overlaySection(filePayload.sis, reg.si_def, servedEffEntry),
    tms: overlaySection(filePayload.tms, reg.tm_def, servedTmEntry),
  });
  servedCache = { fp: filePayload, reg: reg, payload: payload };
  return payload;
}

// Per-section source accounting {registry, fallback_file, file_only_names[]}.
// Exposed on the dev/meta endpoint (GET /api/content/dev/sources), NOT folded
// into /api/content itself -- that keeps the served payload byte-identical to
// today under the files backend (the spec's byte-parity contract).
function sourceAccountingFor(section, regEntries) {
  const keys = Object.keys(section || {});
  const reg = regEntries || {};
  const fileOnly = keys.filter((k) => !Object.prototype.hasOwnProperty.call(reg, k)).sort();
  return { registry: keys.length - fileOnly.length, fallback_file: fileOnly.length, file_only_names: fileOnly };
}
function getContentSources() {
  const fp = ensureFilePayload();
  const reg = registryData;
  return {
    backend: process.env.STORAGE_BACKEND === 'pg' ? 'pg' : 'files',
    covered_kinds: REGISTRY_KIND_BY_SECTION,
    items: sourceAccountingFor(fp.items, reg.po_def),
    sis: sourceAccountingFor(fp.sis, reg.si_def),
    tms: sourceAccountingFor(fp.tms, reg.tm_def),
  };
}

let registryFallbackLogged = false;
// One warn line per boot when the serving backend falls back to a file entry
// for any covered id (drift observability). Suppressed under the files backend,
// where an empty registry tier is BY DESIGN (the spec) rather than drift.
function logRegistryFallbackOnce() {
  if (registryFallbackLogged) return;
  registryFallbackLogged = true;
  if (process.env.STORAGE_BACKEND !== 'pg') return;
  const s = getContentSources();
  const fb = s.items.fallback_file + s.sis.fallback_file + s.tms.fallback_file;
  const reg = s.items.registry + s.sis.registry + s.tms.registry;
  if (fb > 0) {
    console.warn('[content] REQ-0178 registry-first serving: ' + reg + ' entities from registry, ' + fb +
      ' from file fallback (items=' + s.items.fallback_file + ' sis=' + s.sis.fallback_file + ' tms=' + s.tms.fallback_file + ')');
  }
}

function getContent() {
  const filePayload = ensureFilePayload();
  const payload = applyRegistryOverlay(filePayload); // registry-first overlay (no-op under an empty registry)
  payload.art_urls = artUrls; // additive registry-first art map (REQ-0133; see the warm-cache note above)
  if (Date.now() - artUrlsAt > ART_URLS_TTL_MS) { refreshArtUrls().catch(() => {}); }
  if (Date.now() - registryAt > REGISTRY_TTL_MS) { refreshRegistryData().catch(() => {}); }
  return payload;
}

// Warm both maps shortly after boot so the FIRST client already sees registry
// content + art (never blocks require; a no-op under the files backend). The
// registry warm also emits the single boot fallback-warn line.
setImmediate(() => { refreshArtUrls().catch(() => {}); });
setImmediate(() => { refreshRegistryData().then(logRegistryFallbackOnce).catch(() => {}); });

// ---- HTTP helpers ----

function invalidateContentCache() { contentCache = null; }

module.exports = {
  REPO_ROOT, CONTENT_DIR, LIVE_DIR, VOCAB_PATH, ITEMS_PATH, SIS_PATH, TMS_PATH, UNITS_PATH, PACKS_PATH, SCENARIO_PATH, REGISTRY_PATH,
  statMtimeMs, loadJSON, renderEffJoined, withBackCompatI18n,
  buildContentPayload, getContent, invalidateContentCache, refreshArtUrls,
  refreshRegistryData, getContentSources,
};
