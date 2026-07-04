// backpack_ragnarok — server/admin.cjs
// REQ-0035: dev-user identity (/api/me) + admin item-edit write path
// (PUT /api/admin/item/:id). Separated from api.cjs/storage.cjs (which own
// canvas-profile persistence) since this module owns a DIFFERENT
// persistence root (content/live/*.json, the same files /api/content
// reads) plus a THIRD root (data/config/dev_user.json, gitignored like
// data/profiles/).
//
// **Dev-grade auth, intentionally**: the X-Player-Id header is trusted at
// face value (matched against dev_user.json's own playerId + roles) with
// no signature/session/token of any kind. This is the same posture
// server/README.md already documents for the profile-PUT endpoint
// ("accepted dev risk... revisit at the account/auth phase"). Real
// hardening (sessions, tokens, real user records) is explicitly deferred
// to that later phase -- do not mistake this for production auth.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { render } = require('../tools/eff_render.cjs');

const REPO_ROOT = path.join(os.homedir(), 'backpack_ragnarok');
const CONTENT_DIR = path.join(REPO_ROOT, 'content');
const LIVE_DIR = path.join(CONTENT_DIR, 'live');
const VOCAB_PATH = path.join(CONTENT_DIR, 'vocab.json');
const ITEMS_PATH = path.join(LIVE_DIR, 'live_items.json');
const SIS_PATH = path.join(LIVE_DIR, 'live_sis.json');

const CONFIG_DIR = path.join(REPO_ROOT, 'data', 'config');
const DEV_USER_PATH = path.join(CONFIG_DIR, 'dev_user.json');

const DEFAULT_DEV_USER = { playerId: 'dev', name: 'Developer', roles: ['item_admin'] };

// ---- data/config/dev_user.json ----

/** Ensures data/config/dev_user.json exists (creates it with
 * DEFAULT_DEV_USER if missing), then returns its parsed contents. Called
 * both at server boot (so the file is guaranteed to exist before any
 * request arrives) and lazily by every /api/me or admin-auth check (so
 * this stays correct even if the file is deleted/edited by hand between
 * requests -- e.g. an E2E test swapping in a roles:[] variant). */
function ensureDevUser() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(DEV_USER_PATH)) {
    fs.writeFileSync(DEV_USER_PATH, JSON.stringify(DEFAULT_DEV_USER, null, 1), 'utf8');
  }
}

function readDevUser() {
  ensureDevUser();
  return JSON.parse(fs.readFileSync(DEV_USER_PATH, 'utf8'));
}

/** GET /api/me: returns the dev_user.json contents (creating the default
 * file first if this is a fresh box). Today's file models exactly one
 * user; this function just returns it, no wrapping. */
function getMe() {
  return readDevUser();
}

/** Looks up whether `playerId` (as supplied via the X-Player-Id header) is
 * a known user with the `item_admin` role. Written as a general
 * lookup-by-id (not a hardcoded single-value compare) so it keeps working
 * unchanged if dev_user.json ever grows into a list of users -- today it
 * is a single object, so this checks that object's own playerId/roles. */
function isItemAdmin(playerId) {
  if (!playerId) return false;
  const user = readDevUser();
  return user.playerId === playerId && Array.isArray(user.roles) && user.roles.includes('item_admin');
}

// ---- content/live read helpers ----

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Locates `id` in content/live/live_items.json or live_sis.json. Returns
 * {kind:'item'|'si', doc, entries, index} or null if not found in either
 * (this is also how "draft/staging items are not editable" is enforced --
 * there is no content/staging directory in this repo today, so anything
 * not in one of these two live files is simply unknown to this endpoint,
 * see docs/REQ/REQ-0035-item-encyclopedia.md). */
function findLiveEntry(id) {
  const itemsDoc = loadJSON(ITEMS_PATH);
  const itemIdx = (itemsDoc.entries || []).findIndex((e) => e.id === id);
  if (itemIdx !== -1) {
    return { kind: 'item', path: ITEMS_PATH, doc: itemsDoc, index: itemIdx };
  }
  const sisDoc = loadJSON(SIS_PATH);
  const siIdx = (sisDoc.entries || []).findIndex((e) => e.id === id);
  if (siIdx !== -1) {
    return { kind: 'si', path: SIS_PATH, doc: sisDoc, index: siIdx };
  }
  return null;
}

// ---- validation ----

const ITEM_ALLOWED_KEYS = new Set([
  'name', 'name_ja', 'flavor', 'flavor_ja', 'rarity', 'tags', 'effects', 'sockets', 'stretch',
]);
const SI_ALLOWED_KEYS = new Set([
  'name', 'name_ja', 'flavor', 'flavor_ja', 'rarity', 'effects',
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
}

// ---- write path ----

/** Applies a validated PUT body to the live content file for `id`,
 * atomically (tmp file + rename, same pattern as server/storage.cjs's
 * writeProfile). Throws (and writes NOTHING) if:
 *   - id is not found in live_items.json or live_sis.json,
 *   - the body fails schema/vocab/range validation,
 *   - the merged entry's effects fail to re-render via eff_render.cjs.
 * On success returns the merged entry (post-edit, as persisted).
 * Re-render happens on a clone BEFORE the file write, so a render failure
 * never leaves a partially-written file (task requirement: "reject the
 * whole write... do not partially persist"). */
function applyAdminEdit(id, body) {
  const found = findLiveEntry(id);
  if (!found) {
    const err = new Error('unknown item id "' + id + '" (not found in live_items.json or live_sis.json)');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const vocab = loadJSON(VOCAB_PATH);
  validateBody(body, found.kind, vocab);

  const entries = found.doc.entries;
  const original = entries[found.index];
  const merged = Object.assign({}, original, body);

  // Re-render effects (both locales) as a pre-commit gate -- if this
  // throws, nothing below runs and nothing is written.
  for (const eff of merged.effects || []) {
    render(eff, 'en');
    render(eff, 'ja');
  }

  const nextEntries = entries.slice();
  nextEntries[found.index] = merged;
  const nextDoc = Object.assign({}, found.doc, { entries: nextEntries });
  const json = JSON.stringify(nextDoc, null, 1);

  const dir = path.dirname(found.path);
  const tmpName = '.' + path.basename(found.path) + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  const tmpPath = path.join(dir, tmpName);
  // Preserve the original file's mode bits across the atomic replace (some
  // content files in this repo carry non-default permissions) -- rename()
  // replaces the destination's inode entirely, so without this the
  // replaced file would silently pick up the tmp file's default mode.
  let originalMode = null;
  try { originalMode = fs.statSync(found.path).mode; } catch (e) { /* file must exist -- found it above */ }
  fs.writeFileSync(tmpPath, json, 'utf8');
  if (originalMode !== null) fs.chmodSync(tmpPath, originalMode);
  fs.renameSync(tmpPath, found.path); // rename updates mtime -> /api/content cache invalidates naturally

  return merged;
}

module.exports = {
  DEV_USER_PATH,
  DEFAULT_DEV_USER,
  ensureDevUser,
  readDevUser,
  getMe,
  isItemAdmin,
  findLiveEntry,
  validateBody,
  applyAdminEdit,
};
