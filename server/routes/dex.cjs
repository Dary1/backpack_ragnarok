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
// Auth: NONE. Card content is public/non-secret, same posture as GET
// /api/content (no X-Auth-Token gate) -- matches the REQ's "first public-
// API-shaped surface" stance (pure JSON, token auth NOT required, no
// CSRF, a versioned DTO via the `v` field from day one).
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
// -- its shape/linker/hpMax are per-instance, minted at roll time and
// living inside a player's OWN canvas/warehouse row, never in
// content/live/*. Serving one through an id-keyed public GET would need
// either a different (auth'd, instance-scoped) route shape or embedding
// the full instance in the request -- genuinely a separate design, not a
// same-shape allowlist add. Flagged here rather than silently absent so
// the gap is visible at the call site, not just in the REQ doc.
const { sendJSON } = require('../lib/http_util.cjs');
const { getContent } = require('../lib/content.cjs');

const DEX_CARD_RE = /^\/api\/dex\/card\/([^/]+)\/([^/]+)$/;

// Maps a card `kind` to its key in the /api/content payload (lib/
// content.cjs's buildContentPayload() return shape: {items, sis, tms,
// ...}). Absent here => unknown kind => 404 (see below), not a 500 --
// this doubles as the v1 kind allowlist.
const KIND_TO_CONTENT_KEY = { item: 'items', si: 'sis', tm: 'tms' };

// Builds the render-ready DTO for one entry. `entry` is already a
// getContent()-resolved record, i.e. it already carries eff_en/eff_ja
// (items/sis; tms have none, no use-effect exists yet per REQ-0042) and
// the back-compat name_ja/flavor_ja fields (see lib/content.cjs's
// withBackCompatI18n) alongside the formal `i18n` map -- this function
// does no rendering of its own, only reshapes/slices fields already
// computed once at content-load time (same mtime-cache GET /api/content
// itself reads, via the same getContent() call -- no separate cache,
// no double effect-rendering work).
function buildCardDto(kind, id, entry) {
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
  sendJSON(res, 200, { ok: true, card: buildCardDto(kind, id, entry) });
}

module.exports = { tryDexRoutes };
