// client/src/auth/client.ts -- REQ-0118c: builds the real supabase-js client.
// REQ-0341: its two inputs (URL + anon key) now arrive at RUNTIME from the
// API (GET /api/config) instead of being inlined by Vite at build time.
//
// WHY. web/app is a TRACKED build artifact, and `import.meta.env.VITE_*`
// inlining made its bytes depend on client/.env.local -- a GITIGNORED,
// main-checkout-only input. A build in any other tree therefore baked an
// env-LESS bundle and sign-in silently degraded to "not configured". That
// shipped to production TWICE (REQ-0266 -> 42238f8; REQ-0337 -> 2517c83,
// hotfixed by e8f2b77) and grew three pieces of compensating machinery
// (REQ-0278's provision_worktree_env.sh + check_bundle_env.sh, and the
// ci.sh [6.1/7] stage that ran it). Both values are PUBLIC client
// credentials -- the anon key is designed to sit in a browser -- so serving
// them from the API exposes nothing that a downloaded bundle did not.
//
// There is deliberately NO import.meta.env fallback. A fallback would keep
// the coupling alive: web/app's bytes would still vary with an untracked
// file, and the "env-less bundle works" property could not be asserted
// without knowing which tree built it. Nothing is lost by dropping it --
// client/vite.config.ts declares no dev-server /api proxy, so `pnpm run dev`
// cannot reach any backend anyway and was never a working auth path.
//
// When the server carries no config (or the fetch fails/times out) this
// returns null and the sign-in UI degrades to "not configured" exactly as
// before; the REQ-0037 invite/guest path is untouched.
import { createClient } from '@supabase/supabase-js';
import type { SupabaseAuthLike } from './session';

export interface PublicConfig {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  /** REQ-0344: e2e-only override for the artadmin console's poll interval, in
   * ms. ALWAYS null in production -- server/routes/public.cjs omits the key
   * unless ART_ADMIN_POLL_MS is set in the api process's environment, which
   * only tools/artadmin_e2e.sh does. This endpoint is the app's one runtime
   * config channel, so a second consumer belongs here rather than in a second
   * fetch; the supabase values remain its reason for existing. */
  artAdminPollMs: number | null;
}

const CONFIG_PATH = '/api/config';

// Bounded on purpose. store/boot.ts awaits this before its first /api/me, so
// an unbounded wait on a hung or black-holed API would wedge boot() forever
// -- the REQ-0336 "eternal spinner with nobody underneath it" failure shape.
// A timeout degrades to "not configured"; it never throws.
const CONFIG_TIMEOUT_MS = 8000;

const EMPTY: PublicConfig = { supabaseUrl: null, supabaseAnonKey: null, artAdminPollMs: null };

function nonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// REQ-0344: an absent key, a null, a string, 0 or a negative all mean "no
// override" -- the caller then keeps its own production default. Nothing here
// can turn a malformed server response into a pathological poll rate.
function positiveNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

async function fetchPublicConfig(): Promise<PublicConfig> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CONFIG_TIMEOUT_MS);
  try {
    const res = await fetch(CONFIG_PATH, { signal: ctl.signal });
    if (!res.ok) return EMPTY;
    const body = (await res.json()) as Record<string, unknown>;
    return {
      supabaseUrl: nonEmptyString(body.supabaseUrl),
      supabaseAnonKey: nonEmptyString(body.supabaseAnonKey),
      artAdminPollMs: positiveNumber(body.artAdminPollMs),
    };
  } catch {
    // Offline, aborted, non-JSON body, no such route on an older server --
    // all of them mean the same thing to the caller: not configured.
    return EMPTY;
  } finally {
    clearTimeout(timer);
  }
}

let configPromise: Promise<PublicConfig> | null = null;

/** Memoised: N callers share ONE request for the lifetime of the page. */
export function loadPublicConfig(): Promise<PublicConfig> {
  if (!configPromise) configPromise = fetchPublicConfig();
  return configPromise;
}

/** Test seam (client/scripts/check_auth.mjs) -- drops the memoised config so
 * one gate run can drive several server responses through the real code
 * path. Never called by app code. */
export function resetPublicConfigForTests(): void {
  configPromise = null;
}

/** Builds the supabase-js client from the server-served public config, or
 * null when the server has none. ASYNC as of REQ-0341 -- see store/boot.ts
 * for why awaiting it there is safe with respect to the PKCE redirect. */
export async function createSupabaseClient(): Promise<SupabaseAuthLike | null> {
  const cfg = await loadPublicConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return null;
  return createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  }) as unknown as SupabaseAuthLike;
}
