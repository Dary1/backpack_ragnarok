'use strict';
// server/lib/supabase_auth.cjs -- REQ-0118c: Supabase (self-hosted GoTrue)
// JWT verification, HS256, with NO new dependency -- HMAC via node:crypto.
//
// The shared secret comes ONLY from the SUPABASE_JWT_SECRET env var. It is
// never committed and never logged: the live box provisions it through the
// backpack-api service env; the test suite sets a throwaway TEST secret in
// its own process env. When the secret is NOT configured, verification is
// DISABLED (returns { ok:false, reason:'not_configured' }) so a box without
// it behaves exactly like the pre-REQ-0118c X-Auth-Token-only world.
const crypto = require('crypto');

function b64urlToBuf(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeJSON(seg) {
  try { return JSON.parse(b64urlToBuf(seg).toString('utf8')); } catch (e) { return null; }
}
function getSecret() {
  const s = process.env.SUPABASE_JWT_SECRET;
  return typeof s === 'string' && s.length > 0 ? s : null;
}
function isConfigured() { return getSecret() !== null; }

/**
 * Verifies a Supabase access token. Returns { ok:true, claims } or
 * { ok:false, reason } where reason is one of: not_configured, malformed,
 * bad_alg, bad_signature, expired, not_yet_valid, bad_audience.
 * opts: { secret, audience, clockSkewSec }.
 */
function verifySupabaseJwt(token, opts) {
  const secret = (opts && opts.secret) || getSecret();
  if (!secret) return { ok: false, reason: 'not_configured' };
  if (typeof token !== 'string' || !token) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const header = decodeJSON(parts[0]);
  if (!header || header.alg !== 'HS256') return { ok: false, reason: 'bad_alg' };
  const expected = crypto.createHmac('sha256', secret).update(parts[0] + '.' + parts[1]).digest();
  const got = b64urlToBuf(parts[2]);
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) {
    return { ok: false, reason: 'bad_signature' };
  }
  const claims = decodeJSON(parts[1]);
  if (!claims || typeof claims !== 'object') return { ok: false, reason: 'malformed' };
  const now = Math.floor(Date.now() / 1000);
  const skew = opts && typeof opts.clockSkewSec === 'number' ? opts.clockSkewSec : 5;
  if (typeof claims.exp === 'number' && now > claims.exp + skew) return { ok: false, reason: 'expired' };
  if (typeof claims.nbf === 'number' && now + skew < claims.nbf) return { ok: false, reason: 'not_yet_valid' };
  const expectedAud = (opts && opts.audience) || 'authenticated';
  if (claims.aud !== undefined) {
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(expectedAud)) return { ok: false, reason: 'bad_audience' };
  }
  return { ok: true, claims: claims };
}

/** TEST-ONLY helper: mints an HS256 JWT for the given claims + secret.
 * Used by server/tests/auth_jwt_test.cjs to exercise verify/mapping with a
 * throwaway secret -- NEVER used to mint anything in production. */
function signHs256(claims, secret) {
  const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64urlEncode(JSON.stringify(claims));
  const sig = b64urlEncode(crypto.createHmac('sha256', secret).update(header + '.' + payload).digest());
  return header + '.' + payload + '.' + sig;
}

module.exports = { verifySupabaseJwt, signHs256, isConfigured };
