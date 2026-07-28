'use strict';
// Client: the allowlist is enforced on EVERY request (denied paths never open a
// socket), and the shared limiter paces requests by at least the floor.
const { assert, test, atest, summary } = require('./_tinytest.cjs');
const { makeClient, makeLimiter } = require('../lib/client.cjs');

async function run() {
  // apiBase points at a closed port so an ALLOWED request fails at the network,
  // not at the allowlist -- letting us tell "denied" from "allowed but no server".
  const client = makeClient({ apiBase: 'http://127.0.0.1:1', token: 'never-logged', playerId: 'p_test' });

  await atest('client REFUSES to host a troop (allowlist, no socket)', async () => {
    await assert.rejects(client.post('/api/schedule/troops', { level: 1, squadIndex: 0 }), /allowlist REFUSED/);
  });
  await atest('client REFUSES to buy a listing (sell-only)', async () => {
    await assert.rejects(client.post('/api/market/listings/mkt_1/buy', {}), /allowlist REFUSED/);
  });
  await atest('client REFUSES /api/admin and /dev/', async () => {
    await assert.rejects(client.get('/api/admin/warehouse/grant'), /allowlist REFUSED/);
    await assert.rejects(client.post('/api/warehouse/dev/clear-debris', {}), /allowlist REFUSED/);
  });
  await atest('an ALLOWED request passes the allowlist (fails only at the network)', async () => {
    let err;
    try { await client.get('/api/warehouse'); } catch (e) { err = e; }
    assert.ok(err, 'expected a network error against the closed port');
    assert.ok(!/allowlist/.test(err.message), 'the failure must be network, not allowlist: ' + err.message);
  });

  await atest('limiter paces two calls by at least the floor', async () => {
    const gate = makeLimiter(120, 0);
    const t0 = Date.now();
    await gate(); await gate();
    const elapsed = Date.now() - t0;
    assert.ok(elapsed >= 110, 'two gated calls spaced ' + elapsed + 'ms (>=~120)');
  });
}

module.exports = { run };
if (require.main === module) run().then(() => process.exit(summary('client_test') > 0 ? 1 : 0));
