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

await server.close();
console.log('');
if (failures) { console.log(`check_auth: ${failures} FAILURE(S)`); process.exit(1); }
console.log('check_auth: all assertions pass');
