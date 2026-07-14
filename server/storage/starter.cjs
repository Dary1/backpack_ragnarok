"use strict";
// server/storage/starter.cjs -- REQ-0051: starter-job claim ledger.
// One doc per player: { schemaVersion, playerId, claims:{<jobId>:n}, updated_at }
// where n counts how many times that job has been (re)granted via the
// POST /api/starter/claim endpoint (the initial 4-job grant is a client-side
// fresh-profile boot seed, REQ-0042 pattern, and is NOT recorded here). Same
// one-doc-per-player shape as dismantle.cjs. Root:
// data/starter_claims/<playerId>.json | pg: starter_claims.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { backendMode, namespacedId, STARTER_CLAIMS_DIR } = require("./lib.cjs");

function starterClaimsPath(playerId) { return path.join(STARTER_CLAIMS_DIR, playerId + ".json"); }

function readStarterClaimsFiles(playerId) {
  const p = starterClaimsPath(playerId);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; }
}
function writeStarterClaimsFiles(playerId, doc) {
  fs.mkdirSync(STARTER_CLAIMS_DIR, { recursive: true });
  const tmpName = "." + playerId + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
  const tmpPath = path.join(STARTER_CLAIMS_DIR, tmpName);
  fs.writeFileSync(tmpPath, JSON.stringify(doc, null, 1), "utf8");
  fs.renameSync(tmpPath, starterClaimsPath(playerId));
  return doc;
}
function readStarterClaimsPg(playerId) {
  const { querySync } = require("../pg_sync.cjs");
  const res = querySync("SELECT doc FROM starter_claims WHERE player_id = $1", [namespacedId(playerId)]);
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeStarterClaimsPg(playerId, doc) {
  const { querySync } = require("../pg_sync.cjs");
  querySync(
    "INSERT INTO starter_claims (player_id, doc, updated_at) VALUES ($1, $2::jsonb, now()) " +
    "ON CONFLICT (player_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at",
    [namespacedId(playerId), JSON.stringify(doc)]
  );
  return doc;
}
// readStarterClaims: null when the player has never used the claim endpoint
// (callers treat null the same as {claims:{}}).
function readStarterClaims(playerId) {
  return backendMode() === "pg" ? readStarterClaimsPg(playerId) : readStarterClaimsFiles(playerId);
}
function writeStarterClaims(playerId, doc) {
  return backendMode() === "pg" ? writeStarterClaimsPg(playerId, doc) : writeStarterClaimsFiles(playerId, doc);
}
module.exports = { starterClaimsPath, readStarterClaims, writeStarterClaims };
