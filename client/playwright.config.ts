// Playwright E2E config — REQ-0031 Phase A.
//
// baseURL is the PUBLIC Cloudflare tunnel hostname, NOT the local static
// port (8801). This is deliberate, not an oversight: backpack-web.service
// (8801) serves /app/ as plain static files with NO local proxy to
// backpack-api.service (8802) -- hitting http://127.0.0.1:8801/api/content
// 404s (confirmed via curl during rig setup). The ONLY place `/api/*`
// resolves to the API service is the tunnel hostname's Cloudflare ingress
// rule (see server/README.md's "Cloudflare tunnel ingress" section:
// `backpack-dev.qtie.jp path=/api/* -> :8802`, `backpack-dev.qtie.jp ->
// :8801` for everything else). client/src/api.ts does relative fetches
// (`fetch('/api/content')`) that only resolve correctly when the page
// itself was loaded from a host where that ingress split applies -- so
// every E2E test that boots the real app MUST navigate to a page under
// this baseURL, never localhost:8801 directly.
//
// Tests run ON the same box the app is served from (this is a
// server-side headless-Chromium rig, not a developer-machine rig) --
// globalSetup/globalTeardown below touch the live filesystem directly
// (~/backpack_ragnarok/data/profiles/default.json) to back up and restore
// the live profile around the whole run, since several tests PUT canvas
// state to the real API (there is no separate test/staging profile).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'https://backpack-dev.qtie.jp',
    headless: true,
    viewport: { width: 1400, height: 1000 },
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
