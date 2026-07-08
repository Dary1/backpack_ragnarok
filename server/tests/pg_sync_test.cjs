// backpack_ragnarok — server/tests/pg_sync_test.cjs
// REQ-0094 (b): DB-free unit coverage for pg_sync.cjs worker crash-recovery
// (the logic REQ-0089 added). The pg-backend api_test that otherwise touches
// this path is SKIP_PG-gated (needs a live Postgres), so in default/test:quick
// runs the recovery bookkeeping had ZERO coverage. Here we swap the real worker
// for a pg-free fake (PG_SYNC_WORKER_PATH) and shorten the wait
// (PG_SYNC_WAIT_MS) to assert: (1) a normal round-trip, (2) respawn after the
// worker exits, (3) respawn after an uncaught worker error, (4) a wedged worker
// times out, is terminated, and the next query respawns.
'use strict';
const assert = require('assert');
const path = require('path');

process.env.PG_SYNC_WORKER_PATH = path.join(__dirname, 'fixtures', 'pg_sync_fake_worker.cjs');
process.env.PG_SYNC_WAIT_MS = '400';

const { querySync, closeSync } = require('../pg_sync.cjs');

let pass = 0, fail = 0;
function T(name, fn) { try { fn(); console.log('PASS  ' + name); pass++; } catch (e) { console.log('FAIL  ' + name + ' — ' + e.message); fail++; } }
async function AT(name, fn) { try { await fn(); console.log('PASS  ' + name); pass++; } catch (e) { console.log('FAIL  ' + name + ' — ' + e.message); fail++; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  T('querySync: round-trips a query through the worker and returns rows (DB-free)', () => {
    const r = querySync('SELECT 1', []);
    assert.deepStrictEqual(r.rows, [{ ok: 1, echo: 'SELECT 1' }]);
  });

  await AT('recovery: a worker that exits(0) after replying is respawned on the next query', async () => {
    const r1 = querySync('REPLY_THEN_EXIT', []);
    assert.deepStrictEqual(r1.rows, [{ ok: 1 }]);
    await sleep(120);
    const r2 = querySync('SELECT 2', []);
    assert.deepStrictEqual(r2.rows, [{ ok: 1, echo: 'SELECT 2' }]);
  });

  await AT('recovery: an uncaught worker error clears the ref and the next query respawns', async () => {
    const r1 = querySync('REPLY_THEN_ERROR', []);
    assert.deepStrictEqual(r1.rows, [{ ok: 1 }]);
    await sleep(120);
    const r2 = querySync('SELECT 3', []);
    assert.deepStrictEqual(r2.rows, [{ ok: 1, echo: 'SELECT 3' }]);
  });

  await AT('recovery: a wedged (no-reply) worker times out, is terminated, and the next query respawns', async () => {
    assert.throws(() => querySync('HANG', []), /timed out/);
    const r = querySync('SELECT 4', []);
    assert.deepStrictEqual(r.rows, [{ ok: 1, echo: 'SELECT 4' }]);
  });

  await closeSync();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
