// backpack_ragnarok — server/players.cjs
// REQ-0037: player registry (data/players/<playerId>.json) + token
// resolution. Sibling to storage.cjs (which owns canvas-profile
// persistence) -- this module owns a DIFFERENT persistence root
// (data/players/) plus token generation/lookup, matching the existing
// "one persistence root per module" convention (storage.cjs =
// data/profiles/, admin.cjs = content/live/* + data/config/dev_user.json,
// this file = data/players/).
//
// Every player record: { playerId, name, roles, token, createdAt }.
// Writes are atomic (tmp file in the same directory + fs.renameSync),
// same pattern as storage.cjs/admin.cjs. Tokens are server-generated,
// long, random (crypto.randomBytes), never sequential/guessable, and
// never regenerated once minted (a player's token is stable for the
// life of their registry file).
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const REPO_ROOT = path.join(os.homedir(), 'backpack_ragnarok');
const PLAYERS_DIR = path.join(REPO_ROOT, 'data', 'players');

function ensurePlayersDir() {
  fs.mkdirSync(PLAYERS_DIR, { recursive: true });
}

function playerPath(playerId) {
  return path.join(PLAYERS_DIR, playerId + '.json');
}

/** Generates a fresh, unguessable, non-sequential token. */
function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

/** Generates a fresh playerId. Not required to be secret (unlike the
 * token) -- just needs to be unique and filesystem-safe. Uses a short
 * random hex id prefixed 'p_' so it reads clearly as a generated id (vs.
 * the special, hand-chosen 'dev' id). */
function generatePlayerId() {
  return 'p_' + crypto.randomBytes(6).toString('hex');
}

/** Atomically writes a player record to data/players/<playerId>.json. */
function writePlayer(player) {
  ensurePlayersDir();
  const json = JSON.stringify(player, null, 1) + '\n';
  const tmpName = '.' + player.playerId + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  const tmpPath = path.join(PLAYERS_DIR, tmpName);
  fs.writeFileSync(tmpPath, json, 'utf8');
  fs.renameSync(tmpPath, playerPath(player.playerId));
  return player;
}

/** Reads one player record by playerId. Returns null if not found. */
function readPlayer(playerId) {
  const p = playerPath(playerId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

/** Lists every player record currently on disk. Small-scale registry --
 * a full directory scan on every lookup is acceptable at this size (no
 * index file needed, per docs/REQ/REQ-0037-guest-auth.md). */
function listPlayers() {
  ensurePlayersDir();
  const files = fs.readdirSync(PLAYERS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  const players = [];
  for (const f of files) {
    try {
      players.push(JSON.parse(fs.readFileSync(path.join(PLAYERS_DIR, f), 'utf8')));
    } catch (e) {
      // Skip unreadable/corrupt files rather than failing the whole lookup.
    }
  }
  return players;
}

/** Resolves a player record by its token. Returns null if no player has
 * this token (an unknown/garbage token). This is the hot path every
 * authenticated request needs -- see admin.cjs's resolveAuth(). */
function findPlayerByToken(token) {
  if (!token) return null;
  const players = listPlayers();
  return players.find((p) => p.token === token) || null;
}

/** Creates a brand-new player (fresh playerId + token), persists it, and
 * returns the record. Used by server/cli_invite.cjs. `roles` defaults to
 * an empty array (safe default -- see REQ-0037: "an operator must
 * explicitly grant item_admin etc."). */
function createPlayer(name, roles) {
  const player = {
    playerId: generatePlayerId(),
    name: name,
    roles: Array.isArray(roles) ? roles : [],
    token: generateToken(),
    createdAt: new Date().toISOString(),
  };
  return writePlayer(player);
}

/** Creates (or returns the existing) player record for a KNOWN, FIXED
 * playerId -- used only for the dev player, whose id ('dev', from
 * data/config/dev_user.json) is not server-generated. If a record
 * already exists at data/players/<playerId>.json, its token is reused
 * UNCHANGED (never regenerated on restart -- REQ-0037's "idempotent
 * boot" requirement) and only `name`/`roles` are refreshed from the
 * supplied values (so editing dev_user.json's name/roles by hand and
 * restarting picks up the change, without disturbing the token or
 * createdAt). Returns { player, created: boolean } so the caller
 * (admin.cjs's ensureDevUser) can decide whether to log the token (only
 * on first creation, never on every boot).
 */
function ensureFixedPlayer(playerId, name, roles) {
  const existing = readPlayer(playerId);
  if (existing) {
    const refreshed = Object.assign({}, existing, {
      name: name,
      roles: Array.isArray(roles) ? roles : [],
    });
    if (refreshed.name !== existing.name || JSON.stringify(refreshed.roles) !== JSON.stringify(existing.roles)) {
      writePlayer(refreshed);
    }
    return { player: refreshed, created: false };
  }
  const player = {
    playerId: playerId,
    name: name,
    roles: Array.isArray(roles) ? roles : [],
    token: generateToken(),
    createdAt: new Date().toISOString(),
  };
  writePlayer(player);
  return { player: player, created: true };
}

module.exports = {
  PLAYERS_DIR,
  ensurePlayersDir,
  playerPath,
  generateToken,
  generatePlayerId,
  writePlayer,
  readPlayer,
  listPlayers,
  findPlayerByToken,
  createPlayer,
  ensureFixedPlayer,
};
