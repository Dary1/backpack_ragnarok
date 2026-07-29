// client/e2e/runtime-config.spec.ts -- REQ-0341.
//
// The regression this file exists for: web/app is a TRACKED artifact that
// used to be built from a GITIGNORED input (client/.env.local), so a build
// in any tree that lacked that file shipped dead sign-in. It happened twice
// (REQ-0266, REQ-0337). The fix is to serve the two PUBLIC values from the
// API at runtime, and the claim to prove is exactly:
//
//     a bundle built WITHOUT client/.env.local still reaches a CONFIGURED
//     Supabase client, provided the SERVER is configured.
//
// Both halves are checkable here without depending on which tree ran the
// build: the bundle half is asserted against the served JS, and the server
// half against the per-worker fleet backend.
import { test, expect } from '@playwright/test';
import { bootApp } from './helpers';

// tools/e2e_fleet.cjs hands every fleet backend THESE values, unconditionally
// -- never the real ones, so no live credential is ever inside an e2e
// process and the run stays hermetic (REQ-0217). The synthetic host is also
// what makes the bundle assertion meaningful: no build could have baked it.
const FLEET_SUPABASE_URL = 'https://e2e-supabase.invalid';
const FLEET_SUPABASE_ANON_KEY = 'e2e-fleet-anon-key';

test('GET /api/config serves the server-side public Supabase config, uncached', async ({ request }) => {
  const res = await request.get('/api/config');
  expect(res.status()).toBe(200);
  // no-store matters: the whole point of moving this to runtime is that an
  // anon-key rotation takes effect without a client rebuild, which a cached
  // response would quietly defeat.
  expect(res.headers()['cache-control']).toBe('no-store');
  expect(await res.json()).toEqual({
    supabaseUrl: FLEET_SUPABASE_URL,
    supabaseAnonKey: FLEET_SUPABASE_ANON_KEY,
  });
});

test('an env-less bundle still reaches a CONFIGURED Supabase client via /api/config', async ({ page }) => {
  const configRequests: string[] = [];
  page.on('request', (r) => {
    try { if (new URL(r.url()).pathname === '/api/config') configRequests.push(r.url()); } catch { /* opaque URL */ }
  });
  await bootApp(page);

  // (1) The served bundle carries NO build-time Supabase env.
  //
  // A plain substring check on VITE_SUPABASE is a real gate now and was NOT
  // one before this REQ: client.ts used to call readEnv('VITE_SUPABASE_URL'),
  // so the literal survived into an env-LESS bundle as a function argument
  // and any such grep passed either way (REQ-0340 section 3 records that
  // trap). With every import.meta.env read deleted, the literal can only
  // reappear if someone reintroduces the coupling -- which is precisely what
  // this assertion is here to catch.
  const scripts: string[] = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.endsWith('.js')));
  expect(scripts.length, 'the app must have loaded at least one JS chunk').toBeGreaterThan(0);
  for (const url of scripts) {
    const body = await (await page.request.get(url)).text();
    expect(body, url + ' must not carry build-time Supabase env').not.toContain('VITE_SUPABASE');
  }

  // (2) The app actually asked the server for its config during boot.
  expect(configRequests.length, 'boot must fetch /api/config').toBeGreaterThan(0);

  // (3) And it ended up CONFIGURED: the REQ-0118c sign-in block offers the
  //     real actions instead of the "not configured" note. That note is the
  //     exact symptom REQ-0266/REQ-0337 shipped, so its absence here IS the
  //     regression test.
  await page.locator('.nav-link', { hasText: 'Settings' }).click();
  await expect(page.getByTestId('settings-signin')).toBeVisible();
  await expect(page.getByTestId('settings-continue-discord')).toBeVisible();
  await expect(page.getByTestId('settings-play-guest')).toBeVisible();
  await expect(page.getByTestId('settings-signin-unconfigured')).toHaveCount(0);
});
