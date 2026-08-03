'use strict';
// server/tests/e2e_profile_redirect_test.cjs -- REQ-0214 gate: e2e profile
// isolation. The dev_mode NO-token fallback, when the request carries
// x-bpk-e2e-profile, must resolve to a DEDICATED e2e_<suffix> profile
// (never the dev player's own rows), with the dev token stripped; every
// authenticated path (X-Auth-Token, Bearer JWT) must ignore the header
// entirely; with dev_mode=false the header is inert. Also pins the
// viaDevFallback annotation route gates now key off (route_auth.cjs,
// routes/market.cjs, routes/ragnarok.cjs, routes/profile.cjs alias).
// Same tmpHome + fake-req rig as auth_jwt_test.cjs (DB-free, no server).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_SECRET = 'req0214-test-jwt-secret-not-the-real-one';
process.env.SUPABASE_JWT_SECRET = TEST_SECRET;

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-e2eprof-test-'));
os.homedir = () => tmpHome;

const supabaseAuth = require('../lib/supabase_auth.cjs');
const admin = require('../admin.cjs');

let pass = 0, fail = 0;
function T(name, fn) { const __t0 = Date.now();
  try { fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; }
  catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; }
}
const req = (headers) => ({ headers: headers || {} });

const devUser = admin.readDevUser(); // ensures dev_user.json (dev_mode true default)
const devPlayer = admin.ensureDevPlayer();

T('no token, no header -> dev fallback, annotated viaDevFallback', () => {
  const r = admin.resolveAuthFromRequest(req());
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.player.playerId, devUser.playerId);
  assert.strictEqual(r.viaDevFallback, true);
});
T('no token + x-bpk-e2e-profile -> e2e_<suffix>, still viaDevFallback, roles preserved', () => {
  const r = admin.resolveAuthFromRequest(req({ 'x-bpk-e2e-profile': 'ci' }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.player.playerId, 'e2e_ci');
  assert.strictEqual(r.viaDevFallback, true);
  assert.deepStrictEqual(r.player.roles, devPlayer.roles);
});
T('the redirected identity NEVER carries the dev token', () => {
  const r = admin.resolveAuthFromRequest(req({ 'x-bpk-e2e-profile': 'ci' }));
  assert.strictEqual(r.player.token, undefined);
});
T('suffix is sanitized to [A-Za-z0-9_-]', () => {
  const r = admin.resolveAuthFromRequest(req({ 'x-bpk-e2e-profile': '../ev il!!' }));
  assert.strictEqual(r.player.playerId, 'e2e_evil');
});
T('an all-junk suffix falls back to e2e_default', () => {
  const r = admin.resolveAuthFromRequest(req({ 'x-bpk-e2e-profile': '##$$!!' }));
  assert.strictEqual(r.player.playerId, 'e2e_default');
});
T('an over-long suffix truncates to 32 chars', () => {
  const r = admin.resolveAuthFromRequest(req({ 'x-bpk-e2e-profile': 'a'.repeat(64) }));
  assert.strictEqual(r.player.playerId, 'e2e_' + 'a'.repeat(32));
});
T('a REAL X-Auth-Token caller is never redirected (header ignored)', () => {
  // read the dev player's real token straight from the registry the same
  // way players.cjs wrote it (the resolved fallback object strips it).
  const reg = JSON.parse(fs.readFileSync(
    path.join(tmpHome, 'backpack_ragnarok', 'data', 'players', devUser.playerId + '.json'), 'utf8'));
  const r = admin.resolveAuthFromRequest(req({ 'x-auth-token': reg.token, 'x-bpk-e2e-profile': 'ci' }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.player.playerId, devUser.playerId);
  assert.ok(!r.viaDevFallback, 'token path must not be annotated as fallback');
});
T('a Bearer-JWT caller is never redirected (header ignored)', () => {
  const now = Math.floor(Date.now() / 1000);
  const jwt = supabaseAuth.signHs256(
    { sub: 'auth-user-req0214', aud: 'authenticated', exp: now + 3600, iat: now, iss: 'https://auth.qtie.jp/auth/v1' },
    TEST_SECRET);
  const r = admin.resolveAuthFromRequest({ headers: { authorization: 'Bearer ' + jwt, 'x-bpk-e2e-profile': 'ci' } });
  assert.strictEqual(r.ok, true);
  assert.ok(!String(r.player.playerId).startsWith('e2e_'), 'JWT identity must win over the header');
  assert.ok(!r.viaDevFallback);
});
T('dev_mode=false: the header is inert (no fallback happens at all)', () => {
  const p = admin.DEV_USER_PATH;
  const raw = fs.readFileSync(p, 'utf8');
  const doc = JSON.parse(raw);
  fs.writeFileSync(p, JSON.stringify(Object.assign({}, doc, { dev_mode: false })));
  try {
    const r = admin.resolveAuthFromRequest(req({ 'x-bpk-e2e-profile': 'ci' }));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no_token');
  } finally { fs.writeFileSync(p, raw); }
});

console.log('----------------------------------');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);


// ---- REQ-0334: per-test timing ----------------------------------------
// Hoisted on purpose: these suites call their T()/AT() at module scope, so a
// `const` binding declared down here would be in the temporal dead zone when
// the first tests run. `var` + `function` hoist to the top of the module, and
// the require is deferred to the first call so it never runs ahead of a
// harness's own os.homedir()/env setup. See tools/lib/test_clock.cjs.
var __clock;
function clk(name, t0) {
  return (__clock || (__clock = require('../../tools/lib/test_clock.cjs')(__filename))).clk(name, t0);
}
