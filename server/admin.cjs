// backpack_ragnarok — server/admin.cjs
// REQ-0035: dev-user identity (/api/me) + admin item-edit write path
// (PUT /api/admin/item/:id). Separated from api.cjs/storage.cjs (which own
// canvas-profile persistence) since this module owns a DIFFERENT
// persistence root (content/live/*.json, the same files /api/content
// reads) plus a THIRD root (data/config/dev_user.json, gitignored like
// data/profiles/).
//
// REQ-0037 update: the old "X-Player-Id header trusted at face value"
// mechanism is GONE. Auth now resolves a real, server-generated,
// unguessable token (server/players.cjs's registry) via resolveAuth()
// below, used by /api/me, the profile routes (server/api.cjs), and the
// admin guard (isItemAdminToken() below). data/config/dev_user.json is
// still the SOURCE for the dev player's identity/roles (and now also
// carries the dev_mode flag), but the dev player also gets a token, kept
// in sync via server/players.cjs's ensureFixedPlayer(). See
// docs/REQ/REQ-0037-guest-auth.md for the full design.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { render } = require('../tools/eff_render.cjs');
const players = require('./players.cjs');
const supabaseAuth = require('./lib/supabase_auth.cjs'); // REQ-0118c

// REQ-0145a (sc): CONTENT paths resolve through the ONE content-file
// loader (lib/content_files.cjs; CONTENT_ROOT env override honored,
// default byte-equivalent) -- the admin item-edit WRITES must land in
// the exact tree lib/content.cjs and the services read from. REPO_ROOT
// stays os.homedir()-anchored: it feeds DATA paths (data/config), a
// storage concern, not a content one.
const { contentPath } = require('./lib/content_files.cjs');
const REPO_ROOT = path.join(os.homedir(), 'backpack_ragnarok');
const CONTENT_DIR = contentPath();
const LIVE_DIR = contentPath('live');
const VOCAB_PATH = contentPath('vocab.json');
const ITEMS_PATH = contentPath('live', 'live_items.json');
const SIS_PATH = contentPath('live', 'live_sis.json');

const CONFIG_DIR = path.join(REPO_ROOT, 'data', 'config');
const DEV_USER_PATH = path.join(CONFIG_DIR, 'dev_user.json');

// REQ-0037: dev_mode defaults to true (see docs/REQ/REQ-0037-guest-auth.md
// -- "meant to be flipped to false by hand... once real guest tokens are
// the only intended entry path"). DEFAULT_DEV_USER keeps its REQ-0035
// shape plus this one new field.
const DEFAULT_DEV_USER = { playerId: 'dev', name: 'Developer', roles: ['item_admin'], dev_mode: true };

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
  const raw = JSON.parse(fs.readFileSync(DEV_USER_PATH, 'utf8'));
  // Defensive default for pre-REQ-0037 files that predate dev_mode (an
  // existing dev_user.json on a box upgraded from REQ-0035 won't have
  // this key yet) -- absent means "not yet turned off", i.e. true.
  if (typeof raw.dev_mode !== 'boolean') raw.dev_mode = true;
  return raw;
}

/** REQ-0037: ensures the dev player has a registry entry under
 * data/players/dev.json (token, createdAt), created from dev_user.json's
 * current name/roles the FIRST time this runs, and left with its token
 * UNCHANGED on every subsequent boot (idempotent -- see
 * server/players.cjs's ensureFixedPlayer doc comment). Prints the dev
 * token to stdout/journal exactly once, only on first creation, NEVER in
 * any HTTP response body. Call once at server boot (main()) -- also safe
 * to call lazily/repeatedly (e.g. from tests), since it only logs on the
 * single transition from "no data/players/dev.json" to "created one".
 */
function ensureDevPlayer() {
  const devUser = readDevUser();
  const result = players.ensureFixedPlayer(devUser.playerId, devUser.name, devUser.roles);
  if (result.created) {
    // eslint-disable-next-line no-console
    console.log(
      '[backpack-api] created dev player "' + result.player.playerId + '" -- ' +
      'invite URL: https://backpack-dev.qtie.jp/app/#/invite/' + result.player.token
    );
  }
  return result.player;
}

/** GET /api/me: returns the dev_user.json contents (creating the default
 * file first if this is a fresh box). Today's file models exactly one
 * FIXED user (the dev player); guest players live entirely in
 * server/players.cjs's registry and never touch this file. Kept for
 * back-compat / the dev_mode flag's home, per REQ-0037. */
function getMe() {
  return readDevUser();
}

/** REQ-0037 auth resolution -- the SINGLE function used by /api/me, the
 * profile routes, and the admin guard. Given an X-Auth-Token header
 * value (may be undefined/empty), returns:
 *   { ok: true, player } on success (valid token, or no-token+dev_mode
 *     fallback to the dev player)
 *   { ok: false, reason: 'invalid_token' } for a present-but-unknown token
 *   { ok: false, reason: 'no_token' } for an absent token with
 *     dev_mode:false
 * Never throws -- every caller maps `reason` to the HTTP status it wants
 * (401 for /api/me and the profile routes; the admin guard's 403 wraps
 * BOTH failure reasons uniformly, see isItemAdminToken() below and
 * server/api.cjs's admin route handler).
 */
function resolveAuth(token) {
  if (token) {
    const player = players.findPlayerByToken(token);
    if (player) return { ok: true, player: player };
    return { ok: false, reason: 'invalid_token' };
  }
  const devUser = readDevUser();
  if (devUser.dev_mode) {
    const devPlayer = ensureDevPlayer();
    return { ok: true, player: devPlayer };
  }
  return { ok: false, reason: 'no_token' };
}

/** REQ-0037 admin guard: resolves `token` via resolveAuth() then checks
 * the resolved player's roles include item_admin. Returns true/false
 * only -- every failure mode (invalid token, no token, resolved player
 * lacking the role) collapses to `false`, matching the existing 403
 * status-code convention for this endpoint (see
 * docs/REQ/REQ-0037-guest-auth.md's admin-guard section: no information
 * leak distinguishing "no token" from "bad role"). */
function isItemAdminToken(token) {
  const resolved = resolveAuth(token);
  if (!resolved.ok) return false;
  const roles = resolved.player.roles;
  return Array.isArray(roles) && roles.includes('item_admin');
}

// ---- content/live read helpers ----

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Locates `id` in content/live/live_items.json or live_sis.json. Returns
 * {kind:'item'|'si', doc, entries, index} or null if not found in either
 * (this is also how "draft/staging items are not editable" is enforced --
 * there is no content/staging directory in this repo today, see
 * docs/REQ/REQ-0035-item-encyclopedia.md). */
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
// REQ-0047 (b): validation moved verbatim to shared/content_validate.cjs
// (single source of truth). Same names, same behavior, same 400 messages.
const {
  SUPPORTED_LOCALES, ITEM_ALLOWED_KEYS, SI_ALLOWED_KEYS,
  isFiniteNum, isValidRange, validateEffect, validateI18n, validateSocket, validateBody,
} = require('../shared/content_validate.cjs');
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
  // REQ-0038: `i18n` is a map-of-maps (locale -> {name,flavor}) -- a
  // shallow Object.assign above would REPLACE the whole i18n map with
  // whatever the PUT body sent, silently dropping any locale/field the
  // client didn't include (e.g. a JA-only edit form sending only
  // i18n.ja.name would wipe out an existing i18n.ja.flavor). Merge one
  // level deeper instead: each locale in body.i18n is merged into the
  // corresponding locale in the original entry's i18n (if any), so a
  // partial edit only ever touches the fields it actually sent.
  if (body.i18n !== undefined) {
    const mergedI18n = Object.assign({}, original.i18n || {});
    for (const locale of Object.keys(body.i18n)) {
      mergedI18n[locale] = Object.assign({}, (original.i18n && original.i18n[locale]) || {}, body.i18n[locale]);
    }
    merged.i18n = mergedI18n;
  }

  // Re-render effects (both locales) as a pre-commit gate -- if this
  // throws, nothing below runs and nothing is written.
  for (const eff of merged.effects || []) {
    render(eff, 'en');
    render(eff, 'ja');
  }

  const nextEntries = entries.slice();
  nextEntries[found.index] = merged;
  const nextDoc = Object.assign({}, found.doc, { entries: nextEntries });
  // Preserve the original file's trailing-newline convention (every
  // content/live/*.json file in this repo ends with a single trailing
  // newline) -- JSON.stringify never adds one, so without this the
  // rewritten file would silently lose it on every admin edit.
  const originalText = fs.readFileSync(found.path, 'utf8');
  const hadTrailingNewline = originalText.endsWith('\n');
  const json = JSON.stringify(nextDoc, null, 1) + (hadTrailingNewline ? '\n' : '');

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

// REQ-0118c: request-level auth resolution that adds the Supabase JWT path
// on TOP of REQ-0037's resolveAuth(). This is the single chokepoint every
// authenticated route now calls (see routes/me.cjs, routes/profile.cjs,
// lib/route_auth.cjs). Precedence:
//   1. A VALID `Authorization: Bearer <supabase jwt>` -> the player mapped
//      to its auth.users.id (auto-provisioned on first sight).
//   2. Otherwise the REQ-0037 X-Auth-Token path (+ dev_mode fallback).
// A PRESENT-but-INVALID JWT (with a configured secret) is a hard failure --
// it is NEVER silently downgraded to the dev fallback (that would be an
// auth bypass). A JWT present while the secret is NOT configured is ignored
// (the whole JWT path is off), so a box without the secret is unchanged.

function pickAuthName(claims) {
  const m = (claims && claims.user_metadata) || {};
  return m.full_name || m.name || m.user_name || m.preferred_username ||
    (claims && claims.is_anonymous ? 'Guest' : 'Player');
}

/** Maps a VERIFIED Supabase claim set to a player, provisioning a fresh
 * record the first time an auth.users.id is seen. Never grants roles. */
function resolvePlayerForClaims(claims) {
  const authId = claims && claims.sub;
  if (!authId) return { ok: false, reason: 'invalid_jwt' };
  let player = players.findPlayerByAuthId(authId);
  if (!player) {
    player = players.createAuthPlayer({
      authId: authId,
      name: pickAuthName(claims),
      roles: [],
      provider: (claims.app_metadata && claims.app_metadata.provider) || (claims.is_anonymous ? 'anonymous' : null),
      isAnonymous: !!claims.is_anonymous,
    });
  }
  return { ok: true, player: player };
}

function bearerFromRequest(req) {
  const raw = req && req.headers && req.headers['authorization'];
  if (typeof raw !== 'string') return undefined;
  const m = /^\s*Bearer\s+(.+?)\s*$/i.exec(raw);
  return m ? m[1] : undefined;
}
function xAuthTokenFromRequest(req) {
  const raw = req && req.headers && req.headers['x-auth-token'];
  return typeof raw === 'string' && raw ? raw : undefined;
}

function resolveAuthFromRequest(req) {
  const bearer = bearerFromRequest(req);
  if (bearer) {
    const v = supabaseAuth.verifySupabaseJwt(bearer);
    if (v.ok) return resolvePlayerForClaims(v.claims);
    if (v.reason !== 'not_configured') return { ok: false, reason: 'invalid_jwt' };
    // secret not configured -> JWT path disabled; fall through to X-Auth-Token.
  }
  return resolveAuth(xAuthTokenFromRequest(req));
}

module.exports = {
  DEV_USER_PATH,
  DEFAULT_DEV_USER,
  ensureDevUser,
  readDevUser,
  ensureDevPlayer,
  getMe,
  resolveAuth,
  isItemAdminToken,
  findLiveEntry,
  validateBody,
  applyAdminEdit,
  resolveAuthFromRequest,
  resolvePlayerForClaims,
};
