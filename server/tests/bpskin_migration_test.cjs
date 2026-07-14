'use strict';
// server/tests/bpskin_migration_test.cjs -- REQ-0126. Proves the storage
// migration on a COPIED profile fixture (the REQ gate) -- DB-free, files only,
// so it runs in ci's files-backend section. Verifies enumeration across canvas
// + squad presets + inventory pages, explicit-neutral seeding, and idempotence.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mig = require('../../tools/migrations/req0126_seed_bpskin_neutral.cjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk0126-'));
const profilesDir = path.join(tmp, 'profiles');
const bpskinDir = path.join(tmp, 'bpskin');
fs.mkdirSync(profilesDir, { recursive: true });
const profile = { schema_version: 1, profile_id: 'p1', canvas: { bps: [{ id: 'bp-A', shape: [[0, 0]] }, { id: 'bp-B' }], presets: { store: [{ bps: [{ id: 'bp-C' }] }] }, pages: [{ bps: [{ id: 'bp-D' }] }] } };
fs.writeFileSync(path.join(profilesDir, 'p1.json'), JSON.stringify(profile));
let failed = 0;
function check(n, fn) { try { fn(); console.log('ok  :', n); } catch (e) { failed++; console.error('FAIL:', n, '-', e.message); } }
check('collectBpIds finds canvas + preset + page BPs', () => { const s = new Set(); mig.collectBpIds(profile, s); assert.deepStrictEqual([...s].sort(), ['bp-A', 'bp-B', 'bp-C', 'bp-D']); });
check('dry run seeds nothing on disk', () => { const r = mig.run({ apply: false, profilesDir, bpskinDir }); assert.strictEqual(r.totalBps, 4); assert.strictEqual(r.seeded, 4); assert.ok(!fs.existsSync(path.join(bpskinDir, 'bp-A.json'))); });
check('--apply seeds explicit neutral slots', () => { const r = mig.run({ apply: true, profilesDir, bpskinDir }); assert.strictEqual(r.seeded, 4); for (const id of ['bp-A', 'bp-B', 'bp-C', 'bp-D']) { const p = path.join(bpskinDir, id + '.json'); assert.ok(fs.existsSync(p), 'slot ' + id); const d = JSON.parse(fs.readFileSync(p, 'utf8')); assert.strictEqual(d.skin_id, null); assert.strictEqual(d.bp_uid, id); assert.strictEqual(d.seeded_by, 'req0126'); } });
check('idempotent: second apply seeds 0', () => { const r = mig.run({ apply: true, profilesDir, bpskinDir }); assert.strictEqual(r.seeded, 0); assert.strictEqual(r.existing, 4); });
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
console.log(`\nbpskin_migration_test: ${failed ? failed + ' FAILED' : 'ALL GREEN'}`);
process.exit(failed ? 1 : 0);
