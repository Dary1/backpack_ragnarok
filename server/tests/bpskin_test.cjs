'use strict';
// server/tests/bpskin_test.cjs -- REQ-0126. The cosmetic-skin-slot store, driven
// through storage.cjs (THE chokepoint). ci.sh runs this file under BOTH the
// files backend and STORAGE_BACKEND=pg, so a green run under each IS the
// files+pg parity proof (identical public behaviour on both backends). Mirrors
// server/tests/bio_test.cjs's shape. Self-cleaning (unique uid + delete).
const assert = require('assert');
const storage = require('../storage.cjs');
const backend = process.env.STORAGE_BACKEND === 'pg' ? 'pg' : 'files';
const uid = 'test-req0126-' + process.pid + '-' + Date.now();
let failed = 0;
function check(name, fn) { try { fn(); console.log('ok  :', name); } catch (e) { failed++; console.error('FAIL:', name, '-', e.message); } }
check('unknown uid resolves to null (= neutral)', () => {
  assert.strictEqual(storage.getBpSkinId(uid + '-none'), null);
  assert.strictEqual(storage.readSkinSlot(uid + '-none'), null);
});
check('setBpSkin then getBpSkinId round-trips', () => {
  storage.setBpSkin(uid, 'devornate');
  assert.strictEqual(storage.getBpSkinId(uid), 'devornate');
  const d = storage.readSkinSlot(uid);
  assert.strictEqual(d.bp_uid, uid);
  assert.strictEqual(d.skin_id, 'devornate');
  assert.ok(typeof d.updated_at === 'string');
});
check('overwrite (swap skin) persists new value', () => { storage.setBpSkin(uid, 'neutral'); assert.strictEqual(storage.getBpSkinId(uid), 'neutral'); });
check('clear (skinId null) yields null = neutral', () => { storage.setBpSkin(uid, null); assert.strictEqual(storage.getBpSkinId(uid), null); });
check('listSkinSlots includes our uid', () => { storage.setBpSkin(uid, 'devornate'); assert.ok(storage.listSkinSlots().map((s) => s.bp_uid).includes(uid)); });
check('deleteSkinSlot removes it', () => { storage.deleteSkinSlot(uid); assert.strictEqual(storage.readSkinSlot(uid), null); });
try { storage.deleteSkinSlot(uid); } catch (e) { /* ignore */ }
console.log(`\nbpskin_test (${backend} backend): ${failed ? failed + ' FAILED' : 'ALL GREEN'}`);
process.exit(failed ? 1 : 0);
