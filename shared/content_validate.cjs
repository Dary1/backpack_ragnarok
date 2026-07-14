'use strict';
// shared/content_validate.cjs -- REQ-0047 (b): THE content-edit validator.
// Moved VERBATIM from server/admin.cjs (REQ-0038 era) -- this module is
// the single executable source of truth for what an admin PUT may
// contain. Dependency-free. Throws descriptive Errors; never coerces.
// Consumed by: server/admin.cjs (HTTP 400 surface). Vocab is passed in
// by the caller (content/vocab.json) -- this module does no file I/O.

// REQ-0038: formal i18n adoption. `i18n` (a map keyed by locale, e.g.
// {ja: {name, flavor}}) is now the primary editable locale-content field;
// name_ja/flavor_ja stay in the allowlist too (back-compat -- content/
// live/*.json itself no longer has them post-migration, but an old
// client/script/test PUTting the flat shape is still accepted and still
// round-trips through server/api.cjs's withBackCompatI18n() on the next
// GET /api/content, so nothing regresses for stale callers).
const SUPPORTED_LOCALES = new Set(['ja']);
const ITEM_ALLOWED_KEYS = new Set([
  'name', 'name_ja', 'flavor', 'flavor_ja', 'i18n', 'rarity', 'tags', 'effects', 'sockets', 'stretch',
]);
const SI_ALLOWED_KEYS = new Set([
  'name', 'name_ja', 'flavor', 'flavor_ja', 'i18n', 'rarity', 'effects',
]);
// REQ-0170: unit/1 (docs/llm_managed/unit_icon_pipeline.md section 4.2, RATIFIED
// 2026-07-14). Deliberately ABSENT: `charge` and `effects` (the grammar is frozen but
// the engine has no charge AST -- a def field nothing evaluates is fiction), and
// `sockets` (REMOVED by user ruling; demoted to REQ-0163, unratified). Adding either
// to this allowlist without the code that honours it is the failure mode this REQ
// exists to end.
const UNIT_ALLOWED_KEYS = new Set([
  'name', 'name_ja', 'flavor', 'flavor_ja', 'i18n', 'rarity', 'connection_shape',
  'unit_skin', // REQ-0180: default unit_skin/1 SET key
]);

function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Validates a [lo,hi] numeric range: must be a 2-element array of finite
 * numbers, lo <= hi, both > 0. Used for both trigger.s (seconds) and
 * verb.n (any ranged verb param), per vocab.json's ranged_verb_params. */
function isValidRange(v) {
  if (!Array.isArray(v) || v.length !== 2) return false;
  const [lo, hi] = v;
  if (!isFiniteNum(lo) || !isFiniteNum(hi)) return false;
  if (lo <= 0 || hi <= 0) return false;
  if (lo > hi) return false;
  return true;
}

/** Validates one effect object against vocab.json's closed vocabulary +
 * range rules. Throws a descriptive Error (message surfaced to the
 * client as the 400 body) on any violation -- never silently coerces. */
function validateEffect(eff, vocab, ctx) {
  if (!eff || typeof eff !== 'object') throw new Error(ctx + ': effect must be an object');
  const trig = eff.trigger;
  if (!trig || typeof trig !== 'object' || typeof trig.t !== 'string') {
    throw new Error(ctx + ': effect.trigger.t is required');
  }
  if (!vocab.triggers.includes(trig.t)) {
    throw new Error(ctx + ': unknown trigger type "' + trig.t + '"');
  }
  if (trig.t === 'every_secs') {
    if (!isValidRange(trig.s)) {
      throw new Error(ctx + ': trigger.s must be a [lo,hi] range with 0 < lo <= hi');
    }
  }
  // REQ-0121: on_hp_below carries hp_frac -- a strict fraction of hpMax,
  // must be a finite number in the OPEN interval (0, 1). 0 could never
  // fire (hp/hpMax < 0 is impossible for a living actor) and 1 would fire
  // on the first scratch -- both are authoring mistakes, rejected here.
  if (trig.t === 'on_hp_below') {
    if (!isFiniteNum(trig.hp_frac) || trig.hp_frac <= 0 || trig.hp_frac >= 1) {
      throw new Error(ctx + ': trigger.hp_frac must be a number in (0, 1)');
    }
  }
  const verb = eff.verb;
  if (!verb || typeof verb !== 'object' || typeof verb.t !== 'string') {
    throw new Error(ctx + ': effect.verb.t is required');
  }
  if (!vocab.verbs.includes(verb.t)) {
    throw new Error(ctx + ': unknown verb type "' + verb.t + '"');
  }
  if (verb.n !== undefined) {
    if (!isValidRange(verb.n)) {
      throw new Error(ctx + ': verb.n must be a [lo,hi] range with 0 < lo <= hi');
    }
  }
  if (verb.status !== undefined && !vocab.statuses.includes(verb.status)) {
    throw new Error(ctx + ': unknown status "' + verb.status + '"');
  }
  if (eff.cond !== undefined && eff.cond !== 'assembled') {
    throw new Error(ctx + ': unknown effect.cond "' + eff.cond + '"');
  }
}

/** Validates the i18n map: must be a plain object whose keys are all in
 * SUPPORTED_LOCALES (today just {"ja"} -- REQ-0038: "whitelist i18n map
 * keys to a fixed locale set {ja} for now"). Each locale's value must
 * itself be a plain object with only name/flavor keys, each a string
 * when present -- same per-field type rule the base name/flavor fields
 * already get. Throws a descriptive Error on any violation. */
function validateI18n(i18n, ctx) {
  if (!i18n || typeof i18n !== 'object' || Array.isArray(i18n)) {
    throw new Error(ctx + ': i18n must be an object');
  }
  for (const locale of Object.keys(i18n)) {
    if (!SUPPORTED_LOCALES.has(locale)) {
      throw new Error(ctx + ': unknown i18n locale "' + locale + '" (supported: ' + Array.from(SUPPORTED_LOCALES).join(', ') + ')');
    }
    const entry = i18n[locale];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(ctx + ': i18n.' + locale + ' must be an object');
    }
    for (const key of Object.keys(entry)) {
      if (key !== 'name' && key !== 'flavor') {
        throw new Error(ctx + ': unknown field "' + key + '" in i18n.' + locale + ' (only name/flavor are editable)');
      }
    }
    if (entry.name !== undefined && typeof entry.name !== 'string') {
      throw new Error(ctx + ': i18n.' + locale + '.name must be a string');
    }
    if (entry.flavor !== undefined && typeof entry.flavor !== 'string') {
      throw new Error(ctx + ': i18n.' + locale + '.flavor must be a string');
    }
  }
}

/** Validates one socket object (PO only) against vocab.json's socket_tags
 * tree. */
function validateSocket(sock, vocab, ctx) {
  if (!sock || typeof sock !== 'object' || typeof sock.t !== 'string') {
    throw new Error(ctx + ': socket.t is required');
  }
  if (!(sock.t in vocab.socket_tags)) {
    throw new Error(ctx + ': unknown socket type "' + sock.t + '"');
  }
  if (sock.tags !== undefined) {
    if (!Array.isArray(sock.tags)) throw new Error(ctx + ': socket.tags must be an array');
    for (const t of sock.tags) {
      if (!(t in vocab.socket_tags)) throw new Error(ctx + ': unknown socket tag "' + t + '"');
    }
  }
  if (sock.ax !== undefined && !isFiniteNum(sock.ax)) throw new Error(ctx + ': socket.ax must be a finite number');
  if (sock.ay !== undefined && !isFiniteNum(sock.ay)) throw new Error(ctx + ': socket.ay must be a finite number');
}

/** Validates the full PUT body against the schema allowlist for `kind`
 * ('item' or 'si') plus every closed-vocabulary/range rule. Throws on the
 * first violation found (message becomes the 400 response body's
 * `error`). Never mutates `body`. */
function validateBody(body, kind, vocab) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('body must be a JSON object');
  }
  const allowed = kind === 'item' ? ITEM_ALLOWED_KEYS
    : kind === 'unit' ? UNIT_ALLOWED_KEYS
    : SI_ALLOWED_KEYS;
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new Error('unknown field "' + key + '" is not editable via this endpoint');
    }
  }
  if (body.rarity !== undefined) {
    if (!vocab.rarities.includes(body.rarity)) {
      throw new Error('unknown rarity "' + body.rarity + '"');
    }
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length === 0) {
      throw new Error('tags must be a non-empty array');
    }
    for (const t of body.tags) {
      if (!(t in vocab.po_tags)) throw new Error('unknown tag "' + t + '"');
    }
    // tags[0] is explicitly the type root (project convention -- every
    // live item entry's tags[0] is a po_tag with a null parent).
    if (vocab.po_tags[body.tags[0]] !== null) {
      throw new Error('tags[0] ("' + body.tags[0] + '") must be a root tag (null parent in vocab.po_tags)');
    }
  }
  if (body.effects !== undefined) {
    if (!Array.isArray(body.effects)) throw new Error('effects must be an array');
    body.effects.forEach((eff, i) => validateEffect(eff, vocab, 'effects[' + i + ']'));
  }
  if (body.sockets !== undefined) {
    if (!Array.isArray(body.sockets)) throw new Error('sockets must be an array');
    body.sockets.forEach((s, i) => validateSocket(s, vocab, 'sockets[' + i + ']'));
  }
  if (body.stretch !== undefined && typeof body.stretch !== 'boolean') {
    throw new Error('stretch must be a boolean');
  }
  for (const k of ['name', 'name_ja', 'flavor', 'flavor_ja']) {
    if (body[k] !== undefined && typeof body[k] !== 'string') {
      throw new Error(k + ' must be a string');
    }
  }
  if (body.i18n !== undefined) {
    validateI18n(body.i18n, 'i18n');
  }
  // REQ-0170: a unit's connection_shape must be a key of the RATIFIED table. This is
  // the closed-vocabulary rule that makes `connection_shape` mean something: an
  // unknown key would resolve to null at walk time and the Unit would silently form
  // no links -- a def that lies quietly instead of failing loudly.
  if (body.connection_shape !== undefined) {
    const shapes = vocab.connection_shapes || {};
    if (typeof body.connection_shape !== 'string' || !(body.connection_shape in shapes)) {
      throw new Error('unknown connection_shape "' + body.connection_shape + '" (must be a key of vocab.connection_shapes)');
    }
  }
  // REQ-0180: a unit's DEFAULT unit_skin/1 SET key. Optional; the cross-reference
  // (must name a LIVE set, whose bpskin must be a LIVE def) is enforced by
  // tools/check_units.cjs, which holds the set + bpskin lists. Here: shape only.
  if (body.unit_skin !== undefined && (typeof body.unit_skin !== 'string' || !body.unit_skin)) {
    throw new Error('unit_skin must be a non-empty string (a unit_skin/1 set key)');
  }
}

/** REQ-0170: validates ONE whole `unit/1` entry as it appears in
 * content/live/live_units.json -- i.e. including the fields validateBody() does not
 * cover because an admin PUT may not edit them (`id`, `icon`). `icon` is a FREE
 * reference to an artwork system_name: it is NOT derived from `id` (two defs share
 * one artwork -- REQ-0149 G14), so the one thing this must never do is assert
 * icon === 'icon-' + id. Throws on the first violation. */
function validateUnitEntry(entry, vocab) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('unit entry must be an object');
  if (typeof entry.id !== 'string' || !entry.id) throw new Error('unit entry: id is required');
  const ctx = 'unit "' + entry.id + '"';
  if (typeof entry.name !== 'string' || !entry.name) throw new Error(ctx + ': name is required');
  if (typeof entry.icon !== 'string' || !entry.icon) throw new Error(ctx + ': icon is required (an artwork system_name; illustration-first)');
  if (typeof entry.connection_shape !== 'string') throw new Error(ctx + ': connection_shape is required');
  if (!entry.i18n || !entry.i18n.ja || typeof entry.i18n.ja.name !== 'string') {
    throw new Error(ctx + ': i18n.ja.name is MANDATORY on every entry (pipeline rule)');
  }
  const body = {};
  for (const k of Object.keys(entry)) {
    if (k === 'id' || k === 'icon') continue; // not editable via the admin surface; checked above
    body[k] = entry[k];
  }
  validateBody(body, 'unit', vocab);
}

/** REQ-0170: validates ONE `gacha_pack/1` entry (content/live/live_packs.json).
 * `unitIds` is the set of ids that actually exist in live_units.json -- a pool row
 * naming a unit that does not exist is the single most dangerous thing a pack can
 * contain, because the roll would either crash or silently skip it. */
function validatePackEntry(pack, unitIds, contentIds) {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw new Error('pack entry must be an object');
  if (typeof pack.id !== 'string' || !pack.id) throw new Error('pack entry: id is required');
  const ctx = 'pack "' + pack.id + '"';
  if (!Number.isFinite(pack.cost) || pack.cost < 0) throw new Error(ctx + ': cost must be a non-negative number');
  if (pack.cells !== undefined) {
    if (!Array.isArray(pack.cells) || pack.cells.length !== 2 ||
        !Number.isInteger(pack.cells[0]) || !Number.isInteger(pack.cells[1]) ||
        pack.cells[0] < 1 || pack.cells[1] < pack.cells[0]) {
      throw new Error(ctx + ': cells must be [min,max] integers with 1 <= min <= max');
    }
  }
  if (pack.hp_per_cell !== undefined && (!Number.isFinite(pack.hp_per_cell) || pack.hp_per_cell <= 0)) {
    throw new Error(ctx + ': hp_per_cell must be a positive number');
  }
  if (!Array.isArray(pack.pool) || pack.pool.length === 0) throw new Error(ctx + ': pool must be a non-empty array');
  let total = 0;
  for (const row of pack.pool) {
    if (!row || typeof row.unit !== 'string') throw new Error(ctx + ': every pool row needs a unit id');
    if (!unitIds.has(row.unit)) throw new Error(ctx + ': pool names unit "' + row.unit + '", which has no live def');
    if (!Number.isFinite(row.weight) || row.weight <= 0) throw new Error(ctx + ': pool row "' + row.unit + '" needs a positive weight');
    total += row.weight;
  }
  if (!(total > 0)) throw new Error(ctx + ': pool weights must sum to a positive number');
  // REQ-0062: bonus slots (0..2). Each slot draws ONE weighted entry from its own
  // table (a PO / SI lens / TM stack) -- the "synergy bundle" atop the guaranteed BP.
  // The tables are TRANSPARENT ODDS (surfaced on the pack's Dex card + Workshop odds
  // view), so this gate is what keeps a listed table honest: every id must reference
  // REAL live content (when contentIds is supplied), or the roll advertises something
  // that can never drop.
  if (pack.bonus !== undefined) {
    if (!Array.isArray(pack.bonus) || pack.bonus.length > 2) {
      throw new Error(ctx + ': bonus must be an array of 0..2 slots');
    }
    const POOLS = { po: 'po', si: 'si', tm: 'tm' };
    pack.bonus.forEach((slot, bi) => {
      const sctx = ctx + ' bonus[' + bi + ']';
      if (!slot || typeof slot !== 'object' || Array.isArray(slot)) throw new Error(sctx + ': must be an object');
      if (!POOLS[slot.pool]) throw new Error(sctx + ': pool must be one of po|si|tm, got ' + JSON.stringify(slot.pool));
      if (!Array.isArray(slot.table) || slot.table.length === 0) throw new Error(sctx + ': table must be a non-empty array');
      let btotal = 0;
      for (const row of slot.table) {
        if (!row || typeof row.id !== 'string' || !row.id) throw new Error(sctx + ': every table row needs an id');
        if (!Number.isFinite(row.weight) || row.weight <= 0) throw new Error(sctx + ': table row "' + row.id + '" needs a positive weight');
        if (row.qty !== undefined) {
          if (!Number.isInteger(row.qty) || row.qty <= 0) throw new Error(sctx + ': table row "' + row.id + '" qty must be a positive integer');
          if (slot.pool !== 'tm' && row.qty !== 1) throw new Error(sctx + ': only tm rows may carry qty > 1 (po/si draw one instance)');
        }
        if (contentIds) {
          const known = contentIds[slot.pool];
          if (known && !known.has(row.id)) throw new Error(sctx + ': references ' + slot.pool + ' "' + row.id + '", which has no live content def');
        }
        btotal += row.weight;
      }
      if (!(btotal > 0)) throw new Error(sctx + ': table weights must sum to a positive number');
    });
  }
}


module.exports = {
  SUPPORTED_LOCALES, ITEM_ALLOWED_KEYS, SI_ALLOWED_KEYS, UNIT_ALLOWED_KEYS,
  validateUnitEntry, validatePackEntry,
  isFiniteNum, isValidRange, validateEffect, validateI18n, validateSocket, validateBody,
};
