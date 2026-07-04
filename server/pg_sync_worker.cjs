// backpack_ragnarok — server/pg_sync_worker.cjs
// REQ-0040: worker-thread side of pg_sync.cjs's synchronous bridge.
// Owns the actual pg.Pool (created lazily, once, on first message) and
// runs every query it's asked for, writing the JSON-encoded result (or
// error) into the SharedArrayBuffer the calling thread is blocked on,
// then flipping that buffer's status word so Atomics.wait() wakes up.
'use strict';
const { parentPort } = require('worker_threads');

let pool = null;

function getPool() {
  if (pool) return pool;
  const { Pool } = require('pg');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required when STORAGE_BACKEND=pg (see server/.env.example)');
  }
  pool = new Pool({ connectionString, max: 5 });
  return pool;
}

parentPort.on('message', async (msg) => {
  const { text, params, sab } = msg;
  const status = new Int32Array(sab, 0, 1);
  const lenView = new Int32Array(sab, 4, 1);
  const view = new Uint8Array(sab, 4);

  let payload;
  try {
    const p = getPool();
    const res = await p.query(text, params);
    payload = { result: { rows: res.rows } };
  } catch (e) {
    payload = { error: e.message, code: e.code };
  }

  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const maxLen = view.byteLength - 4;
  if (json.length > maxLen) {
    const overflow = Buffer.from(JSON.stringify({ error: 'pg_sync: result too large for the shared buffer (' + json.length + ' bytes)' }), 'utf8');
    lenView[0] = overflow.length;
    view.set(overflow, 4);
  } else {
    lenView[0] = json.length;
    view.set(json, 4);
  }

  Atomics.store(status, 0, 1);
  Atomics.notify(status, 0);
});
