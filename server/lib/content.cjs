'use strict';
// server/lib/content.cjs -- REQ-0047 (c): /api/content payload assembly +
// the mtime-checked content cache. Moved VERBATIM from server/api.cjs.
// contentCache stays module-private; admin writes call
// invalidateContentCache() (previously a direct `contentCache = null`).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { render } = require('../../tools/eff_render.cjs');

const REPO_ROOT = path.join(os.homedir(), 'backpack_ragnarok');
const CONTENT_DIR = path.join(REPO_ROOT, 'content');
const LIVE_DIR = path.join(CONTENT_DIR, 'live');
const VOCAB_PATH = path.join(CONTENT_DIR, 'vocab.json');
const ITEMS_PATH = path.join(LIVE_DIR, 'live_items.json');
const SIS_PATH = path.join(LIVE_DIR, 'live_sis.json');
const TMS_PATH = path.join(LIVE_DIR, 'live_tms.json'); // REQ-0042: Transmutator content defs
const SCENARIO_PATH = path.join(LIVE_DIR, 'scenario.json');
const REGISTRY_PATH = path.join(CONTENT_DIR, 'registry.json');

// ---- content cache (mtime-checked; re-read only when a source file changes) ----
let contentCache = null; // { mtimes: {vocab,items,sis,scenario}, payload }

function statMtimeMs(p) {
  try { return fs.statSync(p).mtimeMs; } catch (e) { return null; }
}

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

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
  const scenario = loadJSON(SCENARIO_PATH);
  // REQ-0035: batch-level provenance for the Dex's "provenance" section.
  // Optional -- an absent/unreadable registry.json degrades to `null`,
  // never a 500 (this file is metadata, not required for the board to
  // function).
  let registry = null;
  try { registry = loadJSON(REGISTRY_PATH); } catch (e) { registry = null; }

  const itemEntries = items.entries || [];
  const siEntries = sis.entries || [];
  const tmEntries = tms.entries || []; // REQ-0042

  const ITEMS = {};
  for (const e of itemEntries) {
    ITEMS[e.id] = withBackCompatI18n(Object.assign({}, e, {
      eff_en: renderEffJoined(e.effects, 'en'),
      eff_ja: renderEffJoined(e.effects, 'ja'),
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
    trees: trees,
    scenario: scenario,
    layout: scenario.layout || null,
    registry: registry,
    vocab: vocabLists,
  };
}

function getContent() {
  const mtimes = {
    vocab: statMtimeMs(VOCAB_PATH),
    items: statMtimeMs(ITEMS_PATH),
    sis: statMtimeMs(SIS_PATH),
    tms: statMtimeMs(TMS_PATH), // REQ-0042
    scenario: statMtimeMs(SCENARIO_PATH),
    registry: statMtimeMs(REGISTRY_PATH),
  };
  const stale = !contentCache ||
    mtimes.vocab !== contentCache.mtimes.vocab ||
    mtimes.items !== contentCache.mtimes.items ||
    mtimes.sis !== contentCache.mtimes.sis ||
    mtimes.tms !== contentCache.mtimes.tms || // REQ-0042
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
  REPO_ROOT, CONTENT_DIR, LIVE_DIR, VOCAB_PATH, ITEMS_PATH, SIS_PATH, TMS_PATH, SCENARIO_PATH, REGISTRY_PATH,
  statMtimeMs, loadJSON, renderEffJoined, withBackCompatI18n,
  buildContentPayload, getContent, invalidateContentCache,
};
