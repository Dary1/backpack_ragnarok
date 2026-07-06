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
  const allowed = kind === 'item' ? ITEM_ALLOWED_KEYS : SI_ALLOWED_KEYS;
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
}


module.exports = {
  SUPPORTED_LOCALES, ITEM_ALLOWED_KEYS, SI_ALLOWED_KEYS,
  isFiniteNum, isValidRange, validateEffect, validateI18n, validateSocket, validateBody,
};
