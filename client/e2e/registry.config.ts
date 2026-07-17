// client/e2e/registry.config.ts -- REQ-0221 registry-first serving coverage.
// No globalSetup/webServer: api + proxy are started by
// tools/registry_first_e2e.sh against an isolated pg namespace SEEDED with
// one adopted def, so the registry-guard tests in dex-admin.spec.ts (the
// REQ-0182b 409 on a registry-served id) actually RUN instead of skipping --
// the files-backed default fleet can never exercise them (REQ-0234 F1), and
// the harness fails the stage if anything skips.
import { defineConfig, devices } from '@playwright/test';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:2212';
export default defineConfig({
  testDir: '.',
  testMatch: '**/dex-admin.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    // REQ-0214: e2e traffic self-identifies even on an isolated namespace.
    extraHTTPHeaders: { 'x-bpk-e2e-profile': 'ci' },
    headless: true,
    viewport: { width: 2000, height: 1400 },
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 2000, height: 1400 } } }],
});
