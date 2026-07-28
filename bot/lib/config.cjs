'use strict';
// bot/lib/config.cjs -- REQ-0330: the reactive fleet's compiled-in defaults,
// all env-overridable. NO confidential value lives here (tokens are read at
// runtime from the vault, never from env/config, never logged). Every cadence
// number the owner spec pins (the 30s join interval, the >=400ms rate floor) is
// a named constant here so the daemon has ONE source of truth.
const os = require('os');
const path = require('path');

function intEnv(name, dflt) {
  const raw = process.env[name];
  if (raw == null || raw === '') return dflt;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : dflt;
}
function strEnv(name, dflt) {
  const raw = process.env[name];
  return (raw == null || raw === '') ? dflt : raw;
}

const config = {
  // Base URL of the live backpack-api (server/api.cjs). Default is the live
  // dev API on this box; the hermetic canary points this at its throwaway port.
  apiBase: strEnv('BOT_API_BASE', 'http://127.0.0.1:8802'),

  // The REQ-0329 pool token vault: one dir per account, each holding a 0600
  // `token` file ({playerId, token, name}). Read at runtime, NEVER logged.
  vaultRoot: strEnv('BOT_VAULT_ROOT', path.join(os.homedir(), 'backpack_fleet', 'agents')),

  // Owner spec item 2, LITERAL: while a troop recruits, join ONE account every
  // 30s. Never burst-fill -- one join per tick, leaving room for a human.
  joinIntervalMs: intEnv('BOT_JOIN_INTERVAL_MS', 30000),

  // How often the watcher re-polls the recruiting-troops browse for a target.
  watchIntervalMs: intEnv('BOT_WATCH_INTERVAL_MS', 5000),

  // How often each committed account polls its own notification feed for a
  // troop_disbanded event (the auto-seller trigger).
  notifyIntervalMs: intEnv('BOT_NOTIFY_INTERVAL_MS', 15000),

  // Safety: a hard floor of >=400ms between ANY two HTTP requests from one
  // client, plus up to `rateJitterMs` of random jitter (spec: rate>=400ms,
  // jittered). Enforced inside lib/client.cjs for every request.
  rateMinMs: intEnv('BOT_RATE_MIN_MS', 400),
  rateJitterMs: intEnv('BOT_RATE_JITTER_MS', 150),

  // Per-request network timeout.
  requestTimeoutMs: intEnv('BOT_REQUEST_TIMEOUT_MS', 10000),

  // The squad the fleet joins with -- owner spec item 2: "the FIRST squad".
  joinSquadIndex: 0,
};

module.exports = { config, intEnv, strEnv };
