// client/e2e/contentadmin.config.ts -- REQ-0155 G4 isolated run config.
// No globalSetup/teardown (does NOT touch the live profile/content/api), no
// webServer (api + static + proxy started manually against an isolated
// pg-namespaced instance of THIS worktree). baseURL = the local proxy. Run
// via tools/content_admin_e2e.sh (which invokes tools/e2e_run.sh + box lock).
import { defineConfig, devices } from '@playwright/test';
import { scaled } from './load-seam'; // REQ-0222: widen timeouts on a loaded box
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8923';
export default defineConfig({
  testDir: '.',
  testMatch: '**/contentadmin.spec.ts',
  timeout: scaled(120_000), // REQ-0222
  expect: { timeout: scaled(30_000) },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    // REQ-0157: the workflow strip's one-click copy uses navigator.clipboard
    permissions: ['clipboard-read', 'clipboard-write'],
    viewport: { width: 1400, height: 1000 },
    actionTimeout: scaled(20_000),
    navigationTimeout: scaled(25_000),
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 1000 } } }],
});
