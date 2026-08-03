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

/** The exact id batch computeArtUrls() resolves, as a PURE function of the
 * served payload. Split out so the wiring is inspectable without a database:
 * WHICH ids join the map is the whole of REQ-0266 D-A (and of REQ-0208/0211/0185
 * before it), while WHETHER a given id resolves is the pg resolver's business
 * and is gated separately. A test can therefore prove the join in files mode. */
function artUrlNameBatch() {
  const payload = ensureFilePayload();
  const names = [].concat(
    Object.keys(payload.items || {}),
    Object.keys(payload.sis || {}),
    Object.keys(payload.tms || {}),
    // REQ-0208: monster ids join the resolved map for the Dex's monster
    // catalog. resolveItemArtNames is kind-generic (def.artwork_ref adopted ->
    // exact-name adopted -> omitted) and monster artworks follow the exact-name
    // convention (artwork system_name == enemy id -- REQ-0184/0188), so no new
    // resolver is needed. Units are deliberately ABSENT: a unit def's `icon` IS
    // its artwork reference (REQ-0170's free reference), resolved client-side
    // via board/unitIcon unitArtUrl().
    Object.keys(monstersFromCore().monsters || {}),
    // REQ-0211: gimic ids join the resolved map for the Dex's gimic catalog.
    // gimic artworks follow the same exact-name convention as monster art.
    Object.keys(gimicsFromCore().gimics || {}),
    // REQ-0185: dungeon def ids join the resolved map so the sortie UI can show
    // each dungeon's `custom` key art (1024x576, design D4). Same exact-name / ref-first
    // convention as monster/gimic art (artwork system_name == def id).
    Object.keys((require('../services/core.cjs').getScheduleContent().dungeonDefsById) || {}),
    // REQ-0266 (D-A): unit_skin ids join the batch, keyed by the SKIN's own id --
    // never by unit id and never by <unit>@<skin>. /api/content is public,
    // unauthenticated and warm-cached, so it CANNOT carry per-player state; a skin
    // def is GLOBAL content and its art resolves exactly like every other kind
    // (def.artwork_ref adopted -> exact-name adopted -> omitted). The per-player part
    // is only WHICH skin id is active, and that is served on an authenticated route.
    // Units themselves stay ABSENT from the map -- REQ-0226 is a different change.
    Object.keys(unitSkinsFromCore().unit_skins || {})
  );
  return names;
}

async function computeArtUrls() {
  if (process.env.STORAGE_BACKEND !== 'pg') return {}; // the artwork registry is pg-only
  const names = artUrlNameBatch();
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
// pre-REQ file payload (fallback covers everything).
//
// REQ-0176 (Phase-1b) adds units/packs here. REQ-0178 held them back because
// they had a SECOND, still-file consumer -- the authoritative gacha roll via
// services/core.cjs getScheduleContent() -- and feeding display from the
// registry while the roll stayed on files would have re-introduced exactly the
// display-vs-roll drift REQ-0170 existed to kill. REQ-0176 makes that module
// registry-first in the SAME change, so the two now flip together and the
// objection is retired. monster/skill are still resolved ONLY through
// core.cjs -- REQ-0208 serves the Dex's monsters/monster_skills sections FROM
// that same core path (see monstersFromCore below), so neither kind ever joins
// this module's own overlay; formations is not a registry kind.
const REGISTRY_KIND_BY_SECTION = { items: 'po_def', sis: 'si_def', tms: 'tm_def', units: 'unit_def', packs: 'gacha_pack' };

// REQ-0348: the snapshot itself is NO LONGER MAINTAINED HERE. Until this REQ
// this module privately owned registryData / registryAt / REGISTRY_TTL_MS /
// computeRegistryData / refreshRegistryData / a boot setImmediate warm -- an
// exact second copy of services/core.cjs's, under the same names, kept in step
// by hand and cross-referenced in both files' comments ("mirror lib/content.cjs
// REGISTRY_TTL_MS" there, and this module's own mirror notes here).
//
// The copies had already drifted, and the drift was a LIVE DEFECT. REQ-0211
// added per-kind try/catch isolation to core's computeRegistryData -- so one
// kind whose pg enum value is not yet migrated degrades ALONE -- and never
// applied it here. This module's version awaited five kinds in a single object
// literal, so one throwing kind rejected the whole promise and
// refreshRegistryData's outer catch then served a stale (or empty) overlay for
// ALL FIVE: the game path kept 9 of its 10 kinds while /api/content quietly lost
// every one. Deleting this copy fixes that by construction rather than by
// patching the same bug a second time.
//
// What is NOT shared is the overlay APPLICATION below. That genuinely differs:
// core's base map itemDefsById also carries the pilot dungeon/items.json
// entries, which /api/content must NOT serve, and the per-kind transforms
// differ too (eff_en/eff_ja rendering here, skill_def's double reshape there).
// So each consumer keeps its own applyRegistryOverlay over the one shared
// snapshot. Sharing more than the snapshot would change the served payload.
function coreRegistrySnapshot() {
  // Lazy require for the same reason monstersFromCore / gimicsFromCore /
  // unitSkinsFromCore below already use one: it keeps standalone tool imports of
  // this module light. NOT a cycle-breaker -- services/core.cjs does not require
  // this module at all (it requires lib/content_files.cjs, a different module).
  return require('../services/core.cjs').getRegistrySnapshot();
}

/** Recompute the registry snapshot now. AWAITED by the adopt/edit/delete/patch
 * handlers so the next /api/content reflects the change (the wiring e2e
 * determinism contract). REQ-0348: delegates to the ONE snapshot owner. Kept
 * exported because both server/tests/content_serving_test.cjs and
 * routes/content.cjs's invalidateServedContent() name it. Never throws -- that
 * is core's contract now, unchanged. */
function refreshRegistryData() {
  return require('../services/core.cjs').refreshRegistryData();
}

function registryIsEmpty(reg) {
  if (!reg) return true;
  // Only the FIVE kinds THIS module overlays. The shared snapshot carries ten,
  // so a registry holding nothing but (say) an adopted `dungeon` must still
  // short-circuit here and hand back the file payload object UNCHANGED -- that
  // byte-parity shortcut is what keeps the files-backend e2e fleet a true
  // no-regression baseline.
  return (Object.keys(reg.po_def || {}).length + Object.keys(reg.si_def || {}).length + Object.keys(reg.tm_def || {}).length
    + Object.keys(reg.unit_def || {}).length + Object.keys(reg.gacha_pack || {}).length) === 0; // REQ-0176
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
  const reg = coreRegistrySnapshot();
  if (registryIsEmpty(reg)) return filePayload; // byte-identical to the pre-REQ payload (files backend / empty registry)
  if (servedCache && servedCache.fp === filePayload && servedCache.reg === reg) return servedCache.payload;
  const payload = Object.assign({}, filePayload, {
    items: overlaySection(filePayload.items, reg.po_def, servedEffEntry),
    sis: overlaySection(filePayload.sis, reg.si_def, servedEffEntry),
    tms: overlaySection(filePayload.tms, reg.tm_def, servedTmEntry),
    // REQ-0176: units/packs carry no `effects` (REQ-0170 s2.3), so they take the
    // same withBackCompatI18n-only transform the file path applies to them --
    // servedTmEntry is exactly that, reused rather than duplicated.
    units: overlaySection(filePayload.units, reg.unit_def, servedTmEntry),
    packs: overlaySection(filePayload.packs, reg.gacha_pack, servedTmEntry),
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
  const reg = coreRegistrySnapshot();
  return {
    backend: process.env.STORAGE_BACKEND === 'pg' ? 'pg' : 'files',
    covered_kinds: REGISTRY_KIND_BY_SECTION,
    items: sourceAccountingFor(fp.items, reg.po_def),
    sis: sourceAccountingFor(fp.sis, reg.si_def),
    tms: sourceAccountingFor(fp.tms, reg.tm_def),
    units: sourceAccountingFor(fp.units, reg.unit_def), // REQ-0176
    packs: sourceAccountingFor(fp.packs, reg.gacha_pack), // REQ-0176
  };
}

// REQ-0182b: is `id` currently SERVED from the registry -- i.e. does it have an
// adopted variant of a covered kind? The legacy Dex-Edit PUT writes live FILES;
// for such an id that write can no longer be observed anywhere (REQ-0178 took the
// display, REQ-0176 took the roll and the sim), so the route must refuse rather
// than silently succeed. Answered from the WARM SNAPSHOT: no DB round trip, and
// it is the same snapshot /api/content is served from, so the refusal can never
// disagree with what the operator is looking at. Returns the kind or null.
// po/si only, because applyAdminEdit only ever covered live_items/live_sis.
function registryServedKindFor(id) {
  const reg = coreRegistrySnapshot();
  if (!reg || !id) return null;
  if (reg.po_def && Object.prototype.hasOwnProperty.call(reg.po_def, id)) return 'po_def';
  if (reg.si_def && Object.prototype.hasOwnProperty.call(reg.si_def, id)) return 'si_def';
  return null;
}

let registryFallbackLogged = false;
// One warn line per boot when the serving backend falls back to a file entry
// for any covered id (drift observability). Suppressed under the files backend,
// where an empty registry tier is BY DESIGN (the spec) rather than drift.
function logRegistryFallbackOnce() {
  if (registryFallbackLogged) return;
  registryFallbackLogged = true;
  if (process.env.STORAGE_BACKEND !== 'pg') return;
  // REQ-0176: units/packs joined the covered set, so they must be counted here
  // too -- a section covered by the overlay but absent from the warn line would
  // make fallback invisible for exactly the kinds this REQ just wired up.
  const s = getContentSources();
  const SECTIONS = ['items', 'sis', 'tms', 'units', 'packs'];
  const fb = SECTIONS.reduce((n, k) => n + s[k].fallback_file, 0);
  const reg = SECTIONS.reduce((n, k) => n + s[k].registry, 0);
  if (fb > 0) {
    console.warn('[content] REQ-0178/0176 registry-first serving: ' + reg + ' entities from registry, ' + fb +
      ' from file fallback (' + SECTIONS.map((k) => k + '=' + s[k].fallback_file).join(' ') + ')');
  }
}

// ---- REQ-0208: monsters + skill names for the Dex (display slice) ----
// monster_def / skill_def are NOT resolved in this module: both sections are
// derived from services/core.cjs getScheduleContent() -- the authority path
// the roll and the sim already serve registry-first (REQ-0176). One
// resolution path means the Dex can never show a monster the sim would not
// fight (the REQ-0170/0176 anti-drift argument). The derived maps are
// identity-memoized on core's served payload object, so a /api/content call
// rebuilds them ONLY when the underlying content/registry actually changed.
// withBackCompatI18n is applied at this seam (the display convention every
// other section already gets); skill names are reshaped to {name, name_ja}
// and LIMITED to skills referenced by served monsters (a Dex lookup, not a
// full skill dump).
let monstersCache = null; // { src, monsters, skills } -- identity-keyed on core's payload
function monstersFromCore() {
  const core = require('../services/core.cjs'); // lazy: keeps standalone tool imports of this module light
  const src = core.getScheduleContent();
  if (monstersCache && monstersCache.src === src) return monstersCache;
  const monsters = {};
  for (const id of Object.keys(src.enemyDefsById || {})) {
    monsters[id] = withBackCompatI18n(Object.assign({}, src.enemyDefsById[id]));
  }
  const skills = {};
  for (const id of Object.keys(monsters)) {
    for (const sk of (monsters[id].skills || [])) {
      if (Object.prototype.hasOwnProperty.call(skills, sk)) continue;
      const nm = (src.skillNamesById || {})[sk];
      if (nm) skills[sk] = { name: (nm.en && nm.en.name) || sk, name_ja: nm.ja && nm.ja.name };
    }
  }
  monstersCache = { src: src, monsters: monsters, skills: skills };
  return monstersCache;
}

// ---- REQ-0211: gimics + their skill names for the Dex (display slice) ----
// Same doctrine as monstersFromCore above: the gimic catalog is derived from
// services/core.cjs getScheduleContent() (the registry-first authority path),
// so the Dex can never show a gimic the dungeon generator would not place.
// withBackCompatI18n at the seam; gimic skill names (trap volley / door keeper)
// are reshaped to {name, name_ja} and LIMITED to skills referenced by served
// gimics (a Dex lookup, not a full skill dump).
let gimicsCache = null; // { src, gimics, skills } -- identity-keyed on core's payload
function gimicsFromCore() {
  const core = require('../services/core.cjs'); // lazy: keeps standalone tool imports light
  const src = core.getScheduleContent();
  if (gimicsCache && gimicsCache.src === src) return gimicsCache;
  const gimics = {};
  for (const id of Object.keys(src.gimicDefsById || {})) {
    gimics[id] = withBackCompatI18n(Object.assign({}, src.gimicDefsById[id]));
  }
  const skills = {};
  for (const id of Object.keys(gimics)) {
    for (const sk of (gimics[id].skills || [])) {
      if (Object.prototype.hasOwnProperty.call(skills, sk)) continue;
      const nm = (src.skillNamesById || {})[sk];
      if (nm) skills[sk] = { name: (nm.en && nm.en.name) || sk, name_ja: nm.ja && nm.ja.name };
    }
  }
  gimicsCache = { src: src, gimics: gimics, skills: skills };
  return gimicsCache;
}

// ---- REQ-0266: unit skins for the display path (display slice) ----
// Same doctrine as monstersFromCore/gimicsFromCore above: the skin catalog is
// derived from services/core.cjs getScheduleContent() -- the registry-first
// authority path -- so /api/content can never advertise a skin the resolution
// chains would not resolve. withBackCompatI18n at the seam (the display
// convention every other section already gets), identity-memoized on core's
// served payload so a call rebuilds only when content/registry actually changed.
let unitSkinsCache = null; // { src, unit_skins } -- identity-keyed on core's payload
function unitSkinsFromCore() {
  const core = require('../services/core.cjs'); // lazy: keeps standalone tool imports light
  const src = core.getScheduleContent();
  if (unitSkinsCache && unitSkinsCache.src === src) return unitSkinsCache;
  const unit_skins = {};
  for (const id of Object.keys(src.unitSkinDefsById || {})) {
    unit_skins[id] = withBackCompatI18n(Object.assign({}, src.unitSkinDefsById[id]));
  }
  unitSkinsCache = { src: src, unit_skins: unit_skins };
  return unitSkinsCache;
}

function getContent() {
  const filePayload = ensureFilePayload();
  const payload = applyRegistryOverlay(filePayload); // registry-first overlay (no-op under an empty registry)
  payload.art_urls = artUrls; // additive registry-first art map (REQ-0133; see the warm-cache note above)
  // REQ-0208: additive Dex sections, derived from the authority path (see
  // monstersFromCore above). Attached per call like art_urls, so core's own
  // mtime/registry caches remain the single freshness authority for them.
  const mons = monstersFromCore();
  payload.monsters = mons.monsters;
  payload.monster_skills = mons.skills;
  // REQ-0211: additive Dex gimic section, same authority-derived posture.
  const gims = gimicsFromCore();
  payload.gimics = gims.gimics;
  payload.gimic_skills = gims.skills;
  // REQ-0266: additive unit_skin section, same authority-derived posture. The
  // client's three resolution chains (unit portrait / BP / the DOM adapter) read
  // this section plus art_urls, and NOTHING per-player: the pick itself arrives
  // separately from GET /api/profile/:id/skins.
  payload.unit_skins = unitSkinsFromCore().unit_skins;
  if (Date.now() - artUrlsAt > ART_URLS_TTL_MS) { refreshArtUrls().catch(() => {}); }
  // REQ-0348: the registry's own TTL refresh moved INTO the snapshot owner
  // (services/core.cjs getRegistrySnapshot), which every read above goes
  // through -- one timer policy instead of two that had to be kept equal by
  // hand. art_urls keeps its own; it is a different DB-derived cache that
  // merely happened to share the interval.
  return payload;
}

// Warm both maps shortly after boot so the FIRST client already sees registry
// content + art (never blocks require; a no-op under the files backend). The
// registry warm also emits the single boot fallback-warn line.
setImmediate(() => { refreshArtUrls().catch(() => {}); });
// REQ-0348: this no longer warms a snapshot of its own -- refreshRegistryData()
// now delegates to the single owner, which also warms itself at boot. The call
// is kept because the DISPLAY-path fallback warn line hangs off it, and it must
// run after a refresh so the counts it reports are real.
setImmediate(() => { refreshRegistryData().then(logRegistryFallbackOnce).catch(() => {}); });

// ---- HTTP helpers ----

function invalidateContentCache() { contentCache = null; }

module.exports = {
  REPO_ROOT, CONTENT_DIR, LIVE_DIR, VOCAB_PATH, ITEMS_PATH, SIS_PATH, TMS_PATH, UNITS_PATH, PACKS_PATH, SCENARIO_PATH, REGISTRY_PATH,
  statMtimeMs, loadJSON, renderEffJoined, withBackCompatI18n,
  buildContentPayload, getContent, invalidateContentCache, refreshArtUrls,
  unitSkinsFromCore, // REQ-0266: the /api/content display slice (derived from the authority path)
  artUrlNameBatch, // REQ-0266: the pure id batch behind art_urls (D-A wiring, inspectable DB-free)
  refreshRegistryData, getContentSources,
  REGISTRY_KIND_BY_SECTION, // REQ-0352: the display kind list, for the kind-list agreement gate
  registryServedKindFor, // REQ-0182b
};
