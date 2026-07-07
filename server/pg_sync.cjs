// backpack_ragnarok — server/pg_sync.cjs
// REQ-0040: synchronous Postgres query bridge.
//
// storage.cjs's public API (readProfile/writeProfile) has always been
// fully synchronous -- it throws synchronously on error and returns its
// result directly (no Promise), and server/tests/api_test.cjs's existing
// (frozen, must-not-change) test suite calls it that way in several
// places (e.g. `assert.throws(() => storage.readProfile(...), ...)` and
// `const doc = storage.writeProfile(...); assert.strictEqual(doc.schema_version, ...)`
// with no `await`). The `pg` driver itself is async-only (it talks to
// Postgres over a real socket) -- there is no maintained synchronous
// libpq binding for modern Node. This module bridges the two: it runs
// the actual pg.Pool + queries on a persistent background Worker thread,
// and blocks the CALLING thread with Atomics.wait() on a SharedArrayBuffer
// until that worker reports the result back -- the same low-level
// technique the (now-unmaintained) `deasync`-style packages use, built
// directly on node:worker_threads so no extra runtime dependency beyond
// `pg` itself is needed.
//
// This is a deliberate, narrow trade-off: synchronous pg access has real
// costs (one query at a time per call, blocks the event loop for the
// call's duration, no connection reuse across calls beyond the worker's
// own pool) -- acceptable here because storage.cjs's profile reads/
// writes are low-frequency, small-payload operations (64KB cap), not a
// high-throughput hot path, and preserving the EXACT existing call
// contract (so the test suite and every existing caller need zero
// changes) was the explicit REQ-0040 requirement.
//
// REQ-0089: crash-recovery hardening. Previously the worker thread had NO
// 'error'/'exit' handler and its module-level reference was never
// cleared, so a SINGLE worker crash (e.g. an unhandled pg Pool 'error' on
// a dropped idle connection -- routine with Supabase/Supavisor; see
// pg_sync_worker.cjs) wedged EVERY subsequent profile read/write: each
// querySync() posted into a dead thread that never replied, blocking the
// caller -- and the whole event loop -- for the full 15s Atomics.wait
// timeout, on every call, until the process was manually restarted. Now:
// (1) the worker is (re)spawned lazily and its reference dropped on
// 'error'/'exit', so the NEXT querySync() transparently starts a fresh
// worker; (2) a timed-out query terminates the wedged worker so it is
// likewise respawned rather than piling further queries onto a stuck
// thread. Together with pg_sync_worker.cjs's new pool 'error' handler, a
// transient DB connection drop now self-heals instead of needing a restart.
'use strict';
const { Worker } = require('worker_threads');
const path = require('path');

let worker = null;
let nextId = 1;

function spawnWorker() {
  const w = new Worker(path.join(__dirname, 'pg_sync_worker.cjs'));
  w.unref(); // never keeps the process alive on its own
  // Drop the reference on crash/exit so ensureWorker() respawns a healthy
  // worker on the next call instead of posting into a dead thread forever.
  // These handlers run on the main thread's event loop, so they only fire
  // once the current Atomics.wait() has returned -- which is exactly when
  // `worker` needs to be clear for the NEXT querySync().
  w.on('error', (err) => {
    console.error('[pg_sync] worker error (will respawn on next query):', err && err.message ? err.message : err);
    if (worker === w) worker = null;
  });
  w.on('exit', (code) => {
    if (code !== 0) console.error('[pg_sync] worker exited (code ' + code + '); will respawn on next query');
    if (worker === w) worker = null;
  });
  return w;
}

function ensureWorker() {
  if (!worker) worker = spawnWorker();
  return worker;
}

/** Runs `text`/`params` as a Postgres query and returns { rows } exactly
 * like pg.Pool#query's resolved value, OR throws synchronously with the
 * database error's message if the query failed. Blocks the calling
 * thread (via Atomics.wait) until the worker thread's pg.Pool call
 * settles -- see the file header for why this exists. */
function querySync(text, params) {
  const w = ensureWorker();
  const sab = new SharedArrayBuffer(4 + 4 * 1024 * 1024); // 4MB result buffer
  const status = new Int32Array(sab, 0, 1); // 0 = pending, 1 = done
  const id = nextId++;

  w.postMessage({ id, text, params, sab });

  // Block until the worker flips status[0] to 1 (or the wait times out).
  const WAIT_MS = 15000;
  const res = Atomics.wait(status, 0, 0, WAIT_MS);
  if (res === 'timed-out') {
    // No reply within the window: the worker is wedged (a stuck query, a
    // lost connection, or a crash whose 'exit' we could not process while
    // blocked here). Terminate + drop it so the NEXT querySync() spawns a
    // fresh worker rather than piling onto a stuck thread (which,
    // pre-REQ-0089, required a full process restart to clear).
    if (worker === w) worker = null;
    try { w.terminate(); } catch (e) { /* already gone */ }
    throw new Error('pg_sync: query timed out after ' + WAIT_MS + 'ms');
  }

  const view = new Uint8Array(sab, 4);
  // Length-prefixed (4 bytes, little-endian) UTF-8 JSON payload written
  // by the worker right before it flips status[0].
  const lenView = new Int32Array(sab, 4, 1);
  const len = lenView[0];
  const jsonBytes = view.slice(4, 4 + len);
  const json = Buffer.from(jsonBytes).toString('utf8');
  const payload = JSON.parse(json);
  if (payload.error) {
    const err = new Error(payload.error);
    if (payload.code) err.code = payload.code;
    throw err;
  }
  return payload.result;
}

/** Explicitly terminates the worker thread (used by tool scripts that
 * need the process to exit promptly after their last query). */
async function closeSync() {
  if (worker) {
    const w = worker;
    worker = null;
    await w.terminate();
  }
}

module.exports = { querySync, closeSync };
