// client/src/auth/client.ts -- REQ-0118c: builds the real supabase-js
// client from Vite build-time env. The URL + anon key are PUBLIC client
// values, but per the project secret policy they are NOT committed --
// provide them via a gitignored client/.env.local (see client/.env.example)
// or the build environment. When absent, this returns null and the sign-in
// UI degrades to "not configured" (the REQ-0037 invite/guest path stays).
import { createClient } from '@supabase/supabase-js';
import type { SupabaseAuthLike } from './session';

function readEnv(name: string): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env ? env[name] : undefined;
}

export function createSupabaseClient(): SupabaseAuthLike | null {
  const url = readEnv('VITE_SUPABASE_URL');
  const anonKey = readEnv('VITE_SUPABASE_ANON_KEY');
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  }) as unknown as SupabaseAuthLike;
}
