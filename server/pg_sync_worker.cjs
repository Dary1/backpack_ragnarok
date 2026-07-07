// backpack_ragnarok — server/pg_sync_worker.cjs
// REQ-0040: worker-thread side of pg_sync.cjs's synchronous bridge.
// Owns the actual pg.Pool (created lazily, once, on first message) and
// runs every query it's asked for, writing the JSON-encoded result (or
// error) into the SharedArrayBuffer the calling thread is blocked on,
// then flipping that buffer's status word so Atomics.wait() wakes up.
//
// REQ-0089 hardening:
//  (1) Attach a pool 'error' handler. Without it, an error emitted by an
//      IDLE pooled client (the pooler/Postgres closing an idle connection,
//      a network blip, a Postgres restart -- all routine with
//      Supabase/Supavisor) is an UNHANDLED 'error' event, i.e. an uncaught
//      exception that kills this worker thread and wedges pg_sync until the
//      process restarts. pg's Pool documents this handler as REQUIRED. The
//      pool self-heals (it discards the broken client; the next query
//      lazily reconnects), so the handler only needs to log-and-swallow.
//  (2) Make the reply path total: ALWAYS write a payload and flip the
//      status word (writeReply), even if something unexpected throws
//      between the query and the buffer write, so a caller blocked in
//      Atomics.wait() is never left to hit the full 15s timeout for a
//      reason other than a genuinely hung query.
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
  // REQ-0089: REQUIRED per pg's Pool docs -- an idle client's 'error'
  // (dropped connection etc.) is otherwise an uncaught exception that
  // crashes this worker. Log and swallow; pg.Pool already removes the
  // broken client and reconnects lazily on the next query.
  pool.on('error', (err) => {
    console.error('[pg_sync_worker] idle pool client error (handled; pool self-heals):',
      err && err.message ? err.message : err);
  });
  return pool;
}

/** Writes `payload` (result or error) into the shared buffer and wakes the
 * blocked caller. Total: on an oversized payload it substitutes a short
 * error so the caller still gets a reply instead of timing out. */
function writeReply(sab, payload) {
  const status = new Int32Array(sab, 0, 1);
  const lenView = new Int32Array(sab, 4, 1);
  const view = new Uint8Array(sab, 4);
  let json = Buffer.from(JSON.stringify(payload), 'utf8');
  const maxLen = view.byteLength - 4;
  if (json.length > maxLen) {
    json = Buffer.from(JSON.stringify({ error: 'pg_sync: result too large for the shared buffer (' + json.length + ' bytes)' }), 'utf8');
  }
  lenView[0] = json.length;
  view.set(json, 4);
  Atomics.store(status, 0, 1);
  Atomics.notify(status, 0);
}

parentPort.on('message', async (msg) => {
  const { text, params, sab } = msg;
  let payload;
  try {
    const p = getPool();
    const res = await p.query(text, params);
    payload = { result: { rows: res.rows } };
  } catch (e) {
    payload = { error: e.message, code: e.code };
  }
  try {
    writeReply(sab, payload);
  } catch (e) {
    // Last-ditch: even the reply write failed -- try once more with a bare
    // error so the caller doesn't hang for the full 15s Atomics.wait window.
    try { writeReply(sab, { error: 'pg_sync_worker: reply write failed: ' + (e && e.message ? e.message : e) }); } catch (e2) { /* give up; caller will time out */ }
  }
});
