// client/src/auth/session.ts -- REQ-0118c: Supabase auth session glue.
// DELIBERATELY free of a static @supabase/supabase-js import so it can be
// unit-tested in plain Node (scripts/check_auth.mjs) with an injected fake
// client. The real client is built in ./client.ts and handed in via
// initSupabaseAuth(). This module owns the SINGLE synchronous access-token
// accessor that api/http.ts's authHeaders() reads on every request.

export type AuthStatus = 'signed_out' | 'anonymous' | 'discord' | 'other';

export interface AuthState {
  configured: boolean;
  status: AuthStatus;
  accessToken: string | null;
  name: string | null;
}

export interface SupaSession {
  access_token: string;
  user?: {
    is_anonymous?: boolean;
    app_metadata?: { provider?: string };
    user_metadata?: Record<string, unknown>;
  };
}

// The minimal structural surface of supabase-js's auth client we use.
export interface SupabaseAuthLike {
  auth: {
    getSession(): Promise<{ data: { session: SupaSession | null } }>;
    onAuthStateChange(cb: (event: string, session: SupaSession | null) => void): { data: { subscription: { unsubscribe(): void } } };
    signInAnonymously(): Promise<{ data: unknown; error: unknown }>;
    signInWithOAuth(opts: { provider: string; options?: { redirectTo?: string } }): Promise<{ data: unknown; error: unknown }>;
    linkIdentity(opts: { provider: string; options?: { redirectTo?: string } }): Promise<{ data: unknown; error: unknown }>;
    signOut(): Promise<{ error: unknown }>;
  };
}

let client: SupabaseAuthLike | null = null;
let currentSession: SupaSession | null = null;
const listeners = new Set<() => void>();
function notify(): void { for (const l of listeners) l(); }

/** Subscribe to auth-state changes. Returns an unsubscribe fn. */
export function subscribeAuth(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Synchronous access-token accessor -- read by api/http.ts on every
 * request. Null when there is no Supabase session. */
export function getAccessToken(): string | null {
  return currentSession ? currentSession.access_token : null;
}

export function isAuthConfigured(): boolean { return client !== null; }

function statusOf(session: SupaSession | null): AuthStatus {
  if (!session) return 'signed_out';
  const u = session.user;
  if (u && u.is_anonymous) return 'anonymous';
  if (u && u.app_metadata && u.app_metadata.provider === 'discord') return 'discord';
  return 'other';
}
function nameOf(session: SupaSession | null): string | null {
  const m = (session && session.user && session.user.user_metadata) || {};
  return (m.full_name as string) || (m.name as string) || (m.user_name as string) || null;
}

export function getAuthState(): AuthState {
  return { configured: client !== null, status: statusOf(currentSession), accessToken: getAccessToken(), name: nameOf(currentSession) };
}

/** Updates the current session (called by the auth-state subscription and,
 * in tests, directly). */
export function setSession(session: SupaSession | null): void {
  currentSession = session;
  notify();
}

/** Wires a (real or fake) supabase client: subscribes to future changes and
 * awaits the INITIAL session (so boot() can attach the right token to its
 * first /api/me). A no-op that leaves configured=false when supa is null. */
export async function initSupabaseAuth(supa: SupabaseAuthLike | null): Promise<void> {
  client = supa;
  if (!supa) { notify(); return; }
  supa.auth.onAuthStateChange((_event, session) => { setSession(session); });
  try {
    const res = await supa.auth.getSession();
    setSession(res.data.session);
  } catch (e) {
    setSession(null);
  }
}

/** The OAuth redirect target Supabase returns the round-trip to -- the
 * app's own origin+path (the SITE_URL / allow-list configured in
 * REQ-0118a). Pure + parameterised so it is unit-testable. */
export function oauthRedirectTarget(loc?: { origin: string; pathname: string }): string {
  const l = loc || (typeof window !== 'undefined' ? window.location : undefined);
  if (!l) return '';
  const pathname = l.pathname.replace(/\/+$/, '');
  return l.origin + pathname;
}

export async function signInAsGuest(): Promise<{ error: unknown } | void> {
  if (!client) return { error: new Error('auth not configured') };
  const r = await client.auth.signInAnonymously();
  return { error: (r as { error?: unknown }).error };
}
export async function signInWithDiscord(loc?: { origin: string; pathname: string }): Promise<{ error: unknown } | void> {
  if (!client) return { error: new Error('auth not configured') };
  const r = await client.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: oauthRedirectTarget(loc) } });
  return { error: (r as { error?: unknown }).error };
}
export async function linkDiscord(loc?: { origin: string; pathname: string }): Promise<{ error: unknown } | void> {
  if (!client) return { error: new Error('auth not configured') };
  const r = await client.auth.linkIdentity({ provider: 'discord', options: { redirectTo: oauthRedirectTarget(loc) } });
  return { error: (r as { error?: unknown }).error };
}
export async function signOutSupabase(): Promise<void> {
  if (!client) return;
  await client.auth.signOut();
  setSession(null);
}
