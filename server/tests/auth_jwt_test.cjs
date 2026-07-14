'use strict';
// server/tests/auth_jwt_test.cjs -- REQ-0118c gate. Covers:
//  (1) Supabase JWT verification (HS256; tamper/expiry/aud/alg/unset-secret),
//  (2) auth.users.id -> player mapping + idempotent auto-provisioning,
//  (3) the fallback matrix (X-Auth-Token path, dev_mode fallback,
//      invalid-JWT hard-fail, JWT-path-disabled-when-unconfigured),
//  (4) Discord/guest LINKING preserves the player's profile with no data
//      loss -- asserted against the REAL storage seam so it runs under BOTH
//      STORAGE_BACKEND=files and =pg (files+pg parity gate).
// Test JWTs are minted with a TEST secret set only in this process env
// (never the real secret; never written to disk; never committed).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_SECRET = 'req0118c-test-jwt-secret-not-the-real-one';
process.env.SUPABASE_JWT_SECRET = TEST_SECRET;

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-auth-test-'));
os.homedir = () => tmpHome;

const supabaseAuth = require('../lib/supabase_auth.cjs');
const players = require('../players.cjs');
const admin = require('../admin.cjs');
const storage = require('../storage.cjs');

const BACKEND = process.env.STORAGE_BACKEND === 'pg' ? 'pg' : 'files';
let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('PASS  ' + name); pass++; }
  catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; }
}
function mintJwt(claims, secret) {
  const now = Math.floor(Date.now() / 1000);
  const full = Object.assign({ aud: 'authenticated', exp: now + 3600, iat: now, iss: 'https://auth.qtie.jp/auth/v1' }, claims);
  return supabaseAuth.signHs256(full, secret || TEST_SECRET);
}
function bearerReq(jwt, extra) { return { headers: Object.assign({ authorization: 'Bearer ' + jwt }, extra || {}) }; }
function xtokenReq(token) { return { headers: token ? { 'x-auth-token': token } : {} }; }

// ---- (1) JWT verification ----
T('valid HS256 token verifies + exposes claims.sub', () => {
  const v = supabaseAuth.verifySupabaseJwt(mintJwt({ sub: 'auth-user-verify' }));
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.claims.sub, 'auth-user-verify');
});
T('a tampered signature is rejected', () => {
  const jwt = mintJwt({ sub: 'x' });
  const bad = jwt.slice(0, -3) + (jwt.slice(-3) === 'AAA' ? 'BBB' : 'AAA');
  assert.strictEqual(supabaseAuth.verifySupabaseJwt(bad).ok, false);
});
T('a token signed with the WRONG secret is rejected (bad_signature)', () => {
  const v = supabaseAuth.verifySupabaseJwt(mintJwt({ sub: 'x' }, 'some-other-secret'));
  assert.strictEqual(v.reason, 'bad_signature');
});
T('an expired token is rejected', () => {
  const now = Math.floor(Date.now() / 1000);
  const jwt = supabaseAuth.signHs256({ sub: 'x', aud: 'authenticated', exp: now - 100 }, TEST_SECRET);
  assert.strictEqual(supabaseAuth.verifySupabaseJwt(jwt).reason, 'expired');
});
T('a wrong audience is rejected', () => {
  const now = Math.floor(Date.now() / 1000);
  const jwt = supabaseAuth.signHs256({ sub: 'x', aud: 'nope', exp: now + 100 }, TEST_SECRET);
  assert.strictEqual(supabaseAuth.verifySupabaseJwt(jwt).reason, 'bad_audience');
});
T('a non-HS256 alg header is rejected (no alg confusion)', () => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const forged = enc({ alg: 'none', typ: 'JWT' }) + '.' + enc({ sub: 'x', aud: 'authenticated' }) + '.';
  assert.strictEqual(supabaseAuth.verifySupabaseJwt(forged).reason, 'bad_alg');
});
T('verification is DISABLED when the secret is unset (not_configured)', () => {
  const saved = process.env.SUPABASE_JWT_SECRET;
  delete process.env.SUPABASE_JWT_SECRET;
  try {
    assert.strictEqual(supabaseAuth.isConfigured(), false);
    assert.strictEqual(supabaseAuth.verifySupabaseJwt('a.b.c').reason, 'not_configured');
  } finally { process.env.SUPABASE_JWT_SECRET = saved; }
});

// ---- (2) auth.users.id -> player mapping ----
T('a first-seen Discord JWT auto-provisions a player (authId, name, roles:[])', () => {
  const jwt = mintJwt({ sub: 'discord-abc', app_metadata: { provider: 'discord' }, user_metadata: { full_name: 'Ada L' } });
  const r = admin.resolveAuthFromRequest(bearerReq(jwt));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.player.authId, 'discord-abc');
  assert.strictEqual(r.player.name, 'Ada L');
  assert.deepStrictEqual(r.player.roles, []);
});
T('the SAME auth id resolves to the SAME player (idempotent, no duplicate)', () => {
  const a = admin.resolveAuthFromRequest(bearerReq(mintJwt({ sub: 'discord-idem', user_metadata: { user_name: 'dup' } }))).player;
  const b = admin.resolveAuthFromRequest(bearerReq(mintJwt({ sub: 'discord-idem' }))).player;
  assert.strictEqual(a.playerId, b.playerId);
  assert.strictEqual(players.listPlayers().filter((pp) => pp.authId === 'discord-idem').length, 1);
});
T('an anonymous JWT provisions a guest-named, anonymous player', () => {
  const r = admin.resolveAuthFromRequest(bearerReq(mintJwt({ sub: 'anon-1', is_anonymous: true })));
  assert.strictEqual(r.player.name, 'Guest');
  assert.strictEqual(r.player.isAnonymous, true);
  assert.strictEqual(r.player.authId, 'anon-1');
});

// ---- (3) fallback matrix ----
T('no JWT + a valid X-Auth-Token resolves the REQ-0037 player', () => {
  const guest = players.createPlayer('FallbackGuest', []);
  const r = admin.resolveAuthFromRequest(xtokenReq(guest.token));
  assert.strictEqual(r.player.playerId, guest.playerId);
});
T('no credentials + dev_mode falls back to the dev player', () => {
  const r = admin.resolveAuthFromRequest(xtokenReq(null));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.player.playerId, admin.readDevUser().playerId);
});
T('a present-but-INVALID JWT is a hard failure (no dev-mode bypass)', () => {
  const r = admin.resolveAuthFromRequest(bearerReq(mintJwt({ sub: 'x' }, 'wrong-secret')));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'invalid_jwt');
});
T('a JWT present while the secret is UNSET is ignored (JWT path disabled)', () => {
  const saved = process.env.SUPABASE_JWT_SECRET;
  const jwt = mintJwt({ sub: 'ignored' }, saved);
  delete process.env.SUPABASE_JWT_SECRET;
  try {
    const r = admin.resolveAuthFromRequest(bearerReq(jwt));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.player.playerId, admin.readDevUser().playerId);
  } finally { process.env.SUPABASE_JWT_SECRET = saved; }
});

// ---- (4) linking preserves the profile (files+pg parity) ----
T('[' + BACKEND + '] linking Discord to an invite player preserves the profile (no data loss)', () => {
  const inv = players.createPlayer('InviteVeteran', []);
  const canvas = { linked: true, bps: [{ id: 'bp_keep' }], pos: [{ uid: 'po_keep' }], sis: [], marker: 'REQ0118C-' + BACKEND };
  storage.writeProfile(inv.playerId, canvas);
  const before = storage.readProfile(inv.playerId);
  assert.ok(before && before.canvas && before.canvas.marker === canvas.marker);
  const linked = players.linkAuthId(inv.playerId, 'discord-link-' + BACKEND);
  assert.strictEqual(linked.playerId, inv.playerId);
  assert.strictEqual(linked.authId, 'discord-link-' + BACKEND);
  const r = admin.resolveAuthFromRequest(bearerReq(mintJwt({ sub: 'discord-link-' + BACKEND, app_metadata: { provider: 'discord' } })));
  assert.strictEqual(r.player.playerId, inv.playerId);
  const after = storage.readProfile(inv.playerId);
  assert.deepStrictEqual(after.canvas, before.canvas);
});
T('linking is idempotent and refuses cross-account conflicts', () => {
  const a = players.createPlayer('LinkA', []);
  const b = players.createPlayer('LinkB', []);
  players.linkAuthId(a.playerId, 'sub-shared');
  assert.strictEqual(players.linkAuthId(a.playerId, 'sub-shared').playerId, a.playerId);
  assert.throws(() => players.linkAuthId(b.playerId, 'sub-shared'), (e) => e.code === 'CONFLICT' && e.reason === 'authid_taken');
  assert.throws(() => players.linkAuthId(a.playerId, 'sub-other'), (e) => e.code === 'CONFLICT' && e.reason === 'already_linked');
});

console.log('---');
console.log('[' + BACKEND + '] ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
