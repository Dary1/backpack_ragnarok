#!/usr/bin/env node
// client/scripts/check_auth.mjs -- REQ-0118c gate. Exercises the REAL
// production auth wiring (client/src/auth/session.ts + the Bearer-header
// assembly in client/src/api/http.ts) in plain Node via the same
// vite-ssrLoadModule rig as check_link_trace.mjs -- no browser, no live
// Supabase. Covers: OAuth redirect-URL construction, the
// X-Auth-Token+Bearer header matrix, session persistence via an injected
// fake client (getSession + onAuthStateChange), and that the guest /
// discord / link / sign-out handlers dispatch to the right supabase call.
import { createServer } from 'vite';
import path from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '..');

// localStorage shim so http.ts's invite-token store works under Node.
const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => { ls.set(k, String(v)); },
  removeItem: (k) => { ls.delete(k); },
};

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log('  ok   ', name); }
  else { failures++; console.log('  FAIL ', name, detail ? `-- ${detail}` : ''); }
}

const server = await createServer({
  configFile: false, root: CLIENT_ROOT, server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
});
let session, http;
try {
  session = await server.ssrLoadModule('/src/auth/session.ts');
  http = await server.ssrLoadModule('/src/api/http.ts');
} finally {
  // keep server open until after tests below run
}

console.log('redirect-target construction');
check('strips a trailing slash and keeps origin+path',
  session.oauthRedirectTarget({ origin: 'https://backpack-dev.qtie.jp', pathname: '/app/' }) === 'https://backpack-dev.qtie.jp/app');
check('bare root path yields just the origin',
  session.oauthRedirectTarget({ origin: 'https://x.example', pathname: '/' }) === 'https://x.example');

console.log('unconfigured defaults');
check('isAuthConfigured() is false before any client is wired', session.isAuthConfigured() === false);
check('getAccessToken() is null with no session', session.getAccessToken() === null);
check('authHeaders() is empty with no token + no session', Object.keys(http.authHeaders()).length === 0);

console.log('X-Auth-Token (REQ-0037) path still works');
http.setStoredToken('inv-tok-123');
check('authHeaders() carries X-Auth-Token', http.authHeaders()['X-Auth-Token'] === 'inv-tok-123');
check('...and no Authorization yet', http.authHeaders()['Authorization'] === undefined);

console.log('inject a fake supabase client (guest session)');
let authCb = null;
const calls = [];
const fake = {
  auth: {
    async getSession() { return { data: { session: { access_token: 'jwt-guest', user: { is_anonymous: true, user_metadata: {} } } } }; },
    onAuthStateChange(cb) { authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
    async signInAnonymously() { calls.push(['anon']); return { data: {}, error: null }; },
    async signInWithOAuth(opts) { calls.push(['oauth', opts]); return { data: {}, error: null }; },
    async linkIdentity(opts) { calls.push(['link', opts]); return { data: {}, error: null }; },
    async signOut() { calls.push(['signout']); return { error: null }; },
  },
};
await session.initSupabaseAuth(fake);
check('configured after init', session.isAuthConfigured() === true);
check('initial session token restored from getSession()', session.getAccessToken() === 'jwt-guest');
check('guest session reports status=anonymous', session.getAuthState().status === 'anonymous');
check('authHeaders() now sends BOTH Bearer + X-Auth-Token',
  http.authHeaders()['Authorization'] === 'Bearer jwt-guest' && http.authHeaders()['X-Auth-Token'] === 'inv-tok-123');

console.log('session persistence via onAuthStateChange');
authCb('SIGNED_IN', { access_token: 'jwt-discord', user: { app_metadata: { provider: 'discord' }, user_metadata: { full_name: 'Ada L' } } });
check('token updates from the auth-state callback', session.getAccessToken() === 'jwt-discord');
check('discord session reports status=discord + name', session.getAuthState().status === 'discord' && session.getAuthState().name === 'Ada L');

console.log('handler dispatch');
await session.signInWithDiscord({ origin: 'https://backpack-dev.qtie.jp', pathname: '/app' });
const oauth = calls.find((c) => c[0] === 'oauth');
check('signInWithDiscord -> signInWithOAuth(provider=discord, redirectTo=app URL)',
  !!oauth && oauth[1].provider === 'discord' && oauth[1].options.redirectTo === 'https://backpack-dev.qtie.jp/app');
await session.signInAsGuest();
check('signInAsGuest -> signInAnonymously', calls.some((c) => c[0] === 'anon'));
await session.linkDiscord({ origin: 'https://backpack-dev.qtie.jp', pathname: '/app' });
const link = calls.find((c) => c[0] === 'link');
check('linkDiscord -> linkIdentity(provider=discord, redirectTo=app URL)',
  !!link && link[1].provider === 'discord' && link[1].options.redirectTo === 'https://backpack-dev.qtie.jp/app');

console.log('sign-out clears the session token');
await session.signOutSupabase();
check('signOutSupabase -> signOut called + token cleared',
  calls.some((c) => c[0] === 'signout') && session.getAccessToken() === null && session.getAuthState().status === 'signed_out');

// ---------------------------------------------------------------------
// REQ-0341: the public Supabase config now arrives at RUNTIME from GET
// /api/config instead of being inlined by Vite. These cases run the REAL
// client/src/auth/client.ts against a stubbed fetch, so the claim the whole
// REQ exists for -- "a bundle with no build-time env still reaches a
// CONFIGURED client, given a configured server" -- is executed here rather
// than asserted about.
// ---------------------------------------------------------------------
console.log('REQ-0341 runtime public config');
const authClient = await server.ssrLoadModule('/src/auth/client.ts');
const realFetch = globalThis.fetch;
const okConfig = { supabaseUrl: 'https://auth.test.invalid', supabaseAnonKey: 'test-anon-key' };

authClient.resetPublicConfigForTests();
let requestedPath = null;
globalThis.fetch = async (url) => { requestedPath = String(url); return { ok: true, json: async () => okConfig }; };
const supa = await authClient.createSupabaseClient();
check('createSupabaseClient() fetches /api/config', requestedPath === '/api/config', String(requestedPath));
check('...and builds a real client from the SERVER-provided values (no build-time env in play)',
  !!supa && !!supa.auth && typeof supa.auth.getSession === 'function' && typeof supa.auth.signInWithOAuth === 'function');

authClient.resetPublicConfigForTests();
globalThis.fetch = async () => ({ ok: true, json: async () => ({ supabaseUrl: null, supabaseAnonKey: null }) });
check('an UNCONFIGURED server yields null (degrade to "not configured", no throw)',
  (await authClient.createSupabaseClient()) === null);

authClient.resetPublicConfigForTests();
globalThis.fetch = async () => ({ ok: true, json: async () => ({ supabaseUrl: 'https://auth.test.invalid', supabaseAnonKey: '' }) });
check('a HALF-configured server (blank key) yields null rather than a broken client',
  (await authClient.createSupabaseClient()) === null);

authClient.resetPublicConfigForTests();
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
check('a 404 from /api/config (older server) yields null, no throw',
  (await authClient.createSupabaseClient()) === null);

authClient.resetPublicConfigForTests();
globalThis.fetch = async () => { throw new Error('network down'); };
check('a rejected fetch yields null, no throw -- boot() must never be wedged by this',
  (await authClient.createSupabaseClient()) === null);

// REQ-0344: the artadmin poll override rides the SAME runtime channel. Proved
// here through the real parser rather than asserted about, because the whole
// point of the seam is that a production build cannot reach it: absent key ->
// null -> the console keeps its own 2000 ms.
authClient.resetPublicConfigForTests();
globalThis.fetch = async () => ({ ok: true, json: async () => ({ ...okConfig, artAdminPollMs: 250 }) });
check('REQ-0344: a server that carries artAdminPollMs surfaces it',
  (await authClient.loadPublicConfig()).artAdminPollMs === 250);

authClient.resetPublicConfigForTests();
globalThis.fetch = async () => ({ ok: true, json: async () => okConfig });
check('REQ-0344: a server WITHOUT it yields null, so the console keeps its production poll',
  (await authClient.loadPublicConfig()).artAdminPollMs === null);

authClient.resetPublicConfigForTests();
globalThis.fetch = async () => ({ ok: true, json: async () => ({ ...okConfig, artAdminPollMs: -5 }) });
check('REQ-0344: a non-positive artAdminPollMs is rejected, not honoured',
  (await authClient.loadPublicConfig()).artAdminPollMs === null);

authClient.resetPublicConfigForTests();
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; return { ok: true, json: async () => okConfig }; };
await Promise.all([authClient.loadPublicConfig(), authClient.loadPublicConfig(), authClient.createSupabaseClient()]);
check('the config request is memoised -- one fetch for N callers', fetchCalls === 1, 'calls=' + fetchCalls);
globalThis.fetch = realFetch;

// The tripwire that REPLACES tools/check_bundle_env.sh (REQ-0278/0340).
// Its subject is now the SOURCE, not the output: while no client source file
// reads a VITE_SUPABASE_* value, web/app cannot vary with client/.env.local,
// and neither provisioning nor a bundle-inspection gate is needed. Note this
// exact grep was USELESS as a gate before REQ-0341 -- client.ts called
// readEnv('VITE_SUPABASE_URL'), so the literal was present either way (see
// REQ-0340 section 3). Deleting that read is what makes it meaningful.
function tsFilesUnder(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) tsFilesUnder(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}
const bakedEnvReaders = tsFilesUnder(path.join(CLIENT_ROOT, 'src'))
  .filter((p) => readFileSync(p, 'utf8').includes('VITE_SUPABASE'))
  .map((p) => path.relative(CLIENT_ROOT, p));
check('no client/src file reads a VITE_SUPABASE_* build-time value (REQ-0341: web/app must not depend on client/.env.local)',
  bakedEnvReaders.length === 0, bakedEnvReaders.join(', '));

await server.close();
console.log('');
if (failures) { console.log(`check_auth: ${failures} FAILURE(S)`); process.exit(1); }
console.log('check_auth: all assertions pass');
// supabase-js starts an auto-refresh interval on construction, which keeps
// the event loop alive after every assertion has run. Exit explicitly.
process.exit(0);
