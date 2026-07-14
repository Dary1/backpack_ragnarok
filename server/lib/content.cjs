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

function getContent() {
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

// ---- HTTP helpers ----

function invalidateContentCache() { contentCache = null; }

module.exports = {
  REPO_ROOT, CONTENT_DIR, LIVE_DIR, VOCAB_PATH, ITEMS_PATH, SIS_PATH, TMS_PATH, UNITS_PATH, PACKS_PATH, SCENARIO_PATH, REGISTRY_PATH,
  statMtimeMs, loadJSON, renderEffJoined, withBackCompatI18n,
  buildContentPayload, getContent, invalidateContentCache,
};
