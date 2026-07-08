// backpack_ragnarok — server/tests/fixtures/pg_sync_fake_worker.cjs
// REQ-0094: a Postgres-free stand-in for pg_sync_worker.cjs, selected via
// PG_SYNC_WORKER_PATH. It speaks the exact SharedArrayBuffer reply protocol
// querySync() expects (status word at bytes 0-3, JSON length at bytes 4-7,
// UTF-8 JSON body from byte 8), so pg_sync.cjs cannot tell it from the real
// worker. Behaviour is keyed off the query text, letting
// server/tests/pg_sync_test.cjs drive crash-recovery bookkeeping with no DB:
//   HANG             -> never reply (caller must hit its Atomics.wait timeout)
//   REPLY_THEN_EXIT  -> reply, then exit(0)        (respawn after 'exit')
//   REPLY_THEN_ERROR -> reply, then throw uncaught (respawn after 'error')
//   anything else    -> reply { rows: [{ ok: 1, echo: <text> }] }
'use strict';
const { parentPort } = require('worker_threads');

function writeReply(sab, payload) {
  const status = new Int32Array(sab, 0, 1);
  const lenView = new Int32Array(sab, 4, 1);
  const view = new Uint8Array(sab, 4);
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  lenView[0] = json.length;
  view.set(json, 4);
  Atomics.store(status, 0, 1);
  Atomics.notify(status, 0);
}

parentPort.on('message', (msg) => {
  const { text, sab } = msg;
  if (text === 'HANG') return;
  if (text === 'REPLY_THEN_EXIT') { writeReply(sab, { result: { rows: [{ ok: 1 }] } }); process.exit(0); }
  if (text === 'REPLY_THEN_ERROR') { writeReply(sab, { result: { rows: [{ ok: 1 }] } }); setImmediate(() => { throw new Error('simulated worker error'); }); return; }
  writeReply(sab, { result: { rows: [{ ok: 1, echo: text }] } });
});
