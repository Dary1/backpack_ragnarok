'use strict';
// server/routes/dex.cjs -- REQ-0052: Dex Card API.
//   GET /api/dex/card/:kind/:id   (kind in {item, si, tm})
// Returns a render-ready JSON card DTO: the def + resolved effect text
// (via tools/eff_render.cjs, the SAME renderer GET /api/content already
// runs every entry through -- see lib/content.cjs's buildContentPayload)
// + shape/ports/sockets geometry + icon ref + i18n block + rarity --
// exactly the inputs ItemDetailCard/DexDiagram consume today, sliced per
// entity. No HTML; the client owns presentation.
//
// Auth: NONE required. Card content is public/non-secret, same posture
// as GET /api/content (no X-Auth-Token gate) -- matches the REQ's "first
// public-API-shaped surface" stance (pure JSON, token auth NOT required,
// no CSRF, a versioned DTO via the `v` field from day one).
//
// 404s: unknown `kind` (not in the v1 allowlist below) and unknown `id`
// (no matching entry in live content) are BOTH a plain 404 -- content is
// public, so there is no existence-oracle concern here (unlike e.g.
// market listing ids, which 404 specifically to avoid leaking which ids
// exist to a non-owner).
//
// v1 kinds: item, si, tm. `kind:'bp'` (rolled Blueprint INSTANCES, e.g.
// a Workshop-gacha result, REQ-0042) is DEFERRED, not merely unwired: a
// BP has no static content def to key off of the way an item/si/tm does
// -- its shape/unit/hpMax are per-instance, minted at roll time and
// living inside a player's OWN canvas/warehouse row, never in
// content/live/*. Serving one through an id-keyed public GET would need
// either a different (auth'd, instance-scoped) route shape or embedding
// the full instance in the request -- genuinely a separate design, not a
// same-shape allowlist add. Flagged here rather than silently absent so
// the gap is visible at the call site, not just in the REQ doc.
//
// REQ-0063 (§1): the card OPTIONALLY carries the CALLER's own personal
// 分解値 (dismantle count) + current mechanical suppression for this id,
// for kind:'item'|'si' only (kind:'tm' can never be dismantled, see
// services/dismantle.cjs's kind:'po'|'si' allowlist). This does NOT turn
// the route auth-required: admin.resolveAuth() is attempted opportunis-
// tically (same function every other route uses, including its dev_mode
// no-token fallback), and the `dismantle` field is simply OMITTED --
// never a 401 -- when it fails to resolve (missing/invalid token in a
// non-dev_mode deployment). This keeps the base card fully public
// (REQ-0052's own posture, unchanged for anonymous/no-context callers)
// while the common case -- fetched from inside the logged-in app --
// gets the personal overlay for free, via a direct in-process call into
// the dismantle facade rather than a second HTTP round-trip (the
// dismantle ledger route, routes/dismantle.cjs, remains the one AUTH-
// REQUIRED, full-ledger surface for the Workshop panel).
const { sendJSON, getAuthToken } = require('../lib/http_util.cjs');
const { getContent } = require('../lib/content.cjs');
const admin = require('../admin.cjs');
const storage = require('../storage.cjs');
const dismantle = require('../dismantle.cjs');

const DEX_CARD_RE = /^\/api\/dex\/card\/([^/]+)\/([^/]+)$/;

// Maps a card `kind` to its key in the /api/content payload (lib/
// content.cjs's buildContentPayload() return shape: {items, sis, tms,
// ...}). Absent here => unknown kind => 404 (see below), not a 500 --
// this doubles as the v1 kind allowlist.
const KIND_TO_CONTENT_KEY = { item: 'items', si: 'sis', tm: 'tms' };

// REQ-0063: kinds the Dismantle system can ever touch (dismantleItem's
// own kind:'po'|'si' allowlist, expressed here in dex-card kind terms --
// 'po' instances are keyed by the same content id as dex kind 'item').
const DISMANTLABLE_KINDS = new Set(['item', 'si']);

/** REQ-0063: resolves the caller (if any) and returns their own
 * {count, suppression} for this (kind, id), or undefined when no caller
 * could be resolved (bad/missing token outside dev_mode) or when `kind`
 * is not dismantlable (kind:'tm'). Never throws -- a lookup failure here
 * must never turn a public card fetch into an error. */
function tryReadDismantleInfo(req, kind, id) {
  if (!DISMANTLABLE_KINDS.has(kind)) return undefined;
  const resolved = admin.resolveAuth(getAuthToken(req));
  if (!resolved.ok) return undefined;
  const doc = storage.readDismantleLedger(resolved.player.playerId);
  const count = (doc && doc.counts && doc.counts[id]) || 0;
  return { count, suppression: dismantle.suppressionFloor(count) };
}

// Builds the render-ready DTO for one entry. `entry` is already a
// getContent()-resolved record, i.e. it already carries eff_en/eff_ja
// (items/sis; tms have none, no use-effect exists yet per REQ-0042) and
// the back-compat name_ja/flavor_ja fields (see lib/content.cjs's
// withBackCompatI18n) alongside the formal `i18n` map -- this function
// does no rendering of its own, only reshapes/slices fields already
// computed once at content-load time (same mtime-cache GET /api/content
// itself reads, via the same getContent() call -- no separate cache,
// no double effect-rendering work). `dismantleInfo` is REQ-0063's
// optional personal overlay (see tryReadDismantleInfo above); omitted
// from the DTO entirely (not even `dismantle: undefined`) when absent,
// via JSON.stringify's own undefined-key-drop behavior.
function buildCardDto(kind, id, entry, dismantleInfo) {
  const dto = {
    v: 1,
    kind: kind,
    id: id,
    name: entry.name,
    name_ja: entry.name_ja,
    i18n: entry.i18n,
    rarity: entry.rarity,
    icon: entry.icon,
    flavor: entry.flavor,
    flavor_ja: entry.flavor_ja,
    eff_en: entry.eff_en,
    eff_ja: entry.eff_ja,
  };
  if (kind === 'item') {
    dto.tags = entry.tags;
    dto.shape = entry.shape;
    dto.sockets = entry.sockets;
    dto.ports = entry.ports;
    dto.stretch = entry.stretch;
    dto.part = entry.part;
  } else if (kind === 'si') {
    dto.slot = entry.slot;
    dto.reqTags = entry.reqTags;
    dto.ports = entry.ports;
  } else if (kind === 'tm') {
    dto.short = entry.short;
    dto.stackable = entry.stackable;
  }
  if (dismantleInfo) dto.dismantle = dismantleInfo;
  return dto;
}

function tryDexRoutes(req, res, url, p) {
  const m = p.match(DEX_CARD_RE);
  if (!m) return false;
  if (req.method !== 'GET') {
    sendJSON(res, 404, { ok: false, error: 'not found' });
    return;
  }
  const kind = m[1];
  const id = decodeURIComponent(m[2]);
  const contentKey = KIND_TO_CONTENT_KEY[kind];
  if (!contentKey) {
    sendJSON(res, 404, { ok: false, error: 'unknown dex card kind: ' + kind });
    return;
  }
  const content = getContent();
  const entry = (content[contentKey] || {})[id];
  if (!entry) {
    sendJSON(res, 404, { ok: false, error: 'unknown ' + kind + ' id: ' + id });
    return;
  }
  const dismantleInfo = tryReadDismantleInfo(req, kind, id);
  sendJSON(res, 200, { ok: true, card: buildCardDto(kind, id, entry, dismantleInfo) });
}

module.exports = { tryDexRoutes };
