// client/e2e/artadmin.config.ts -- REQ-0151 G4 isolated run config.
// No globalSetup/teardown (does NOT touch the live profile/content/api),
// no webServer (the api + static + proxy are started manually against an
// isolated pg-namespaced instance of THIS worktree). baseURL = the local
// proxy. Run via tools/e2e_run.sh --config=e2e/artadmin.config.ts (box lock).
import { defineConfig, devices } from '@playwright/test';
import { scaled } from './load-seam'; // REQ-0222: widen timeouts on a loaded box
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8903';
export default defineConfig({
  testDir: '.',
  testMatch: '**/artadmin.spec.ts',
  timeout: scaled(150_000), // REQ-0222
  expect: { timeout: scaled(10_000) },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1400, height: 1000 },
    actionTimeout: scaled(15_000),
    navigationTimeout: scaled(20_000),
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 1000 } } }],
});
