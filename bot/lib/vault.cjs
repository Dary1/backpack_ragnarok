'use strict';
// bot/lib/vault.cjs -- REQ-0330 reads the REQ-0329 pool token vault:
// <vaultRoot>/<playerId>/token, a 0600 JSON { playerId, token, name }, one dir
// per account. Returns the accounts in a STABLE order (dir name ascending) --
// the fixed "pool order" the drip-joiner walks. Tokens are held in memory only
// and NEVER logged; loadAccounts() returns them, but every log/inspect helper in
// the fleet references an account by name/playerId, never token.
const fs = require('fs');
const path = require('path');
const { config } = require('./config.cjs');

// loadAccounts(vaultRoot?) -> [{ playerId, token, name }] in vault order.
// Skips any malformed/incomplete entry (logged by count, not content).
function loadAccounts(vaultRoot) {
  const root = vaultRoot || config.vaultRoot;
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch (e) {
    const err = new Error('fleet vault not found or unreadable: ' + root + ' (' + e.message + ')');
    err.code = 'VAULT_MISSING';
    throw err;
  }
  const accounts = [];
  for (const name of dirs) {
    const tokenPath = path.join(root, name, 'token');
    let raw;
    try { raw = fs.readFileSync(tokenPath, 'utf8'); } catch (e) { continue; }
    let rec;
    try { rec = JSON.parse(raw); } catch (e) { continue; }
    if (!rec || typeof rec.token !== 'string' || !rec.token) continue;
    accounts.push({ playerId: rec.playerId || name, token: rec.token, name: rec.name || rec.playerId || name });
  }
  return accounts;
}

// redact(account) -> a token-free view safe to log.
function redact(account) {
  return { playerId: account.playerId, name: account.name };
}

module.exports = { loadAccounts, redact };
