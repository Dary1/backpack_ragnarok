'use strict';
// bot/lib/fleet.cjs -- REQ-0330 the reactive fleet DAEMON. Wires the pure cores
// (watcher/joiner/pool/seller/identity) to real per-account clients and runs two
// cooperative loops:
//
//   joinLoop  -- a SCOUT account browses recruiting troops; when one appears the
//                fleet drips ONE not-yet-used pool account into it every
//                joinIntervalMs (never a burst) until it is full/gone. One target
//                at a time: "the fleet is joining for THAT troop."
//   sellLoop  -- every committed account polls its own notification feed; on a
//                troop_disbanded it lists EVERY sellable warehouse drop onto the
//                market (from-warehouse) and acks, then frees itself back to the
//                pool.
//
// Every account passes the identity guard (GET /api/me; refuse dev/roled, fail
// closed) BEFORE the fleet acts for it. All egress is the allowlisted, rate-
// limited client -- the daemon cannot host, cancel, or buy.
const { config } = require('./config.cjs');
const { loadAccounts, redact } = require('./vault.cjs');
const { makeClient } = require('./client.cjs');
const { assertHumanEquivalent, isForbiddenIdentity } = require('./identity.cjs');
const { selectFirstAvailable } = require('./pool.cjs');
const { pickTarget } = require('./watcher.cjs');
const { driveDripJoin } = require('./joiner.cjs');
const { sellAll } = require('./seller.cjs');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// buildFleet(opts) -> { start(), stop(), state }. opts overrides (apiBase,
// intervals, accounts, log) are for the daemon entry and the canary/tests.
function buildFleet(opts) {
  const o = opts || {};
  const apiBase = o.apiBase || config.apiBase;
  const joinIntervalMs = o.joinIntervalMs != null ? o.joinIntervalMs : config.joinIntervalMs;
  const watchIntervalMs = o.watchIntervalMs != null ? o.watchIntervalMs : config.watchIntervalMs;
  const notifyIntervalMs = o.notifyIntervalMs != null ? o.notifyIntervalMs : config.notifyIntervalMs;
  const log = o.log || ((...a) => console.log('[fleet]', ...a));

  const rawAccounts = o.accounts || loadAccounts(o.vaultRoot);
  // Per-account client + mutable runtime state.
  const accounts = rawAccounts.map((a) => ({
    playerId: a.playerId,
    name: a.name,
    client: makeClient({ apiBase, token: a.token, playerId: a.playerId, name: a.name, limiter: o.limiter }),
    ok: null,          // identity-guard result (null=unknown, true=cleared, false=refused)
    busyRoomId: null,  // the troop this account is committed to, if any
    cursor: null,      // notification high-water id
  }));
  const byId = new Map(accounts.map((a) => [a.playerId, a]));

  let running = false;
  const handledTargets = new Set(); // rooms the fleet has finished driving

  // --- identity guard: clear each account once, fail closed -------------------
  async function clearIdentity(acc) {
    if (acc.ok !== null) return acc.ok;
    try {
      const res = await acc.client.get('/api/me');
      const me = res && res.body ? res.body : {};
      if (res.status !== 200 || isForbiddenIdentity(me)) {
        acc.ok = false;
        log('identity guard REFUSED account ' + acc.name + ' (' + acc.playerId + ') -- not acting for it');
        return false;
      }
      assertHumanEquivalent(me); // belt-and-braces; throws on forbidden
      acc.ok = true;
      return true;
    } catch (e) {
      acc.ok = false;
      log('identity guard error for ' + acc.name + ': ' + e.message + ' -- failing closed');
      return false;
    }
  }

  function clearedIds() { return accounts.filter((a) => a.ok === true).map((a) => a.playerId); }
  function availableIds() {
    // cleared, not currently committed to a troop.
    return accounts.filter((a) => a.ok === true && a.busyRoomId == null).map((a) => a.playerId);
  }

  // --- scout: browse recruiting troops ---------------------------------------
  async function browse(scout) {
    const res = await scout.client.get('/api/schedule/troops?state=recruiting');
    if (res.status !== 200 || !res.body || !Array.isArray(res.body.troops)) return [];
    return res.body.troops;
  }

  // --- drip a single target troop to full (or until it vanishes) -------------
  async function driveTarget(roomId, scout) {
    log('target acquired: troop ' + roomId + ' -- drip-joining one account / ' + joinIntervalMs + 'ms');
    const committedThisRun = [];
    const result = await driveDripJoin({
      now: () => Date.now(),
      sleep,
      intervalMs: joinIntervalMs,
      pollMs: Math.min(watchIntervalMs, joinIntervalMs),
      readTroop: async () => {
        // Re-browse: a recruiting troop with a free seat is still present; once
        // full/departed it drops out of the recruiting browse.
        const troops = await browse(scout);
        const row = troops.find((t) => t.roomId === roomId);
        if (!row) return null; // gone from recruiting -> full/departed/disbanded
        return { recruiting: true, full: false };
      },
      pickAccount: () => selectFirstAvailable(availableIds(), []),
      join: async (accountId) => {
        const acc = byId.get(accountId);
        const res = await acc.client.post(
          '/api/schedule/troops/' + encodeURIComponent(roomId) + '/join',
          { squadIndex: config.joinSquadIndex });
        if (res.status === 200) {
          acc.busyRoomId = roomId;
          committedThisRun.push(accountId);
        } else {
          // A 409 (full/late/deploy-gate) is a benign race: do not commit the
          // account, let the loop re-evaluate on the next tick.
          log('join ' + acc.name + ' -> ' + res.status + ' ' +
            (res.body && res.body.reason ? res.body.reason : (res.body && res.body.error) || '') );
        }
        return res.body || {};
      },
      log,
    });
    handledTargets.add(roomId);
    log('target ' + roomId + ' done: ' + result.stopReason + ' (fleet filled ' + result.joins.length + ' seat(s))');
    return result;
  }

  async function joinLoop(scout) {
    while (running) {
      try {
        const troops = await browse(scout);
        const target = pickTarget(troops, { excludeRoomIds: [] });
        if (target && availableIds().length > 0) {
          await driveTarget(target.roomId, scout);
        } else {
          await sleep(watchIntervalMs);
        }
      } catch (e) {
        log('joinLoop error: ' + e.message);
        await sleep(watchIntervalMs);
      }
    }
  }

  // --- seller: committed accounts watch for disband, then dump drops ---------
  async function pollAndSell(acc) {
    const since = acc.cursor != null ? '?since=' + acc.cursor : '';
    const res = await acc.client.get('/api/notifications' + since);
    if (res.status !== 200 || !res.body) return;
    if (res.body.cursor != null) acc.cursor = res.body.cursor;
    const entries = Array.isArray(res.body.notifications) ? res.body.notifications : [];
    const disbands = entries.filter((e) => e && e.kind === 'troop_disbanded');
    if (disbands.length === 0) return;
    log('account ' + acc.name + ': ' + disbands.length + ' disband event(s) -- selling all drops');
    const sold = await sellAll({
      listWarehouse: async () => (await acc.client.get('/api/warehouse')).body || { items: [] },
      createListingFromWarehouse: async (body, idemKey) => {
        const r = await acc.client.post('/api/market/listings/from-warehouse', body, idemKey);
        if (r.status !== 200) { const err = new Error((r.body && r.body.error) || ('status ' + r.status)); err.reason = r.body && r.body.reason; throw err; }
        return r.body;
      },
      log,
    });
    // Ack the disband notifications so they are not reprocessed.
    await acc.client.post('/api/notifications/ack', { ids: disbands.map((d) => d.id) });
    log('account ' + acc.name + ': listed ' + sold.listed.length + ', skipped ' + sold.skipped.length);
    // Freed: the account's troop is gone, return it to the pool.
    acc.busyRoomId = null;
  }

  async function sellLoop() {
    while (running) {
      const committed = accounts.filter((a) => a.ok === true && a.busyRoomId != null);
      for (const acc of committed) {
        if (!running) break;
        try { await pollAndSell(acc); } catch (e) { log('sell error ' + acc.name + ': ' + e.message); }
      }
      await sleep(notifyIntervalMs);
    }
  }

  async function start() {
    running = true;
    log('starting reactive fleet: ' + accounts.length + ' pool accounts, apiBase=' + apiBase);
    // Clear identities up front (fail closed for dev/roled accounts).
    for (const acc of accounts) await clearIdentity(acc);
    const cleared = clearedIds();
    log('identity guard: ' + cleared.length + '/' + accounts.length + ' accounts cleared to act');
    if (cleared.length === 0) { log('no human-equivalent accounts -- nothing to do'); running = false; return; }
    const scout = byId.get(cleared[0]);
    await Promise.all([joinLoop(scout), sellLoop()]);
  }

  function stop() { running = false; }

  return { start, stop, state: { accounts, byId, availableIds, clearedIds, driveTarget, pollAndSell, clearIdentity, browse } };
}

module.exports = { buildFleet, sleep };
