// client/e2e/contentadmin.config.ts -- REQ-0155 G4 isolated run config.
// No globalSetup/teardown (does NOT touch the live profile/content/api), no
// webServer (api + static + proxy started manually against an isolated
// pg-namespaced instance of THIS worktree). baseURL = the local proxy. Run
// via tools/content_admin_e2e.sh (which invokes tools/e2e_run.sh + box lock).
import { defineConfig, devices } from '@playwright/test';
// REQ-0323: the proxy port is LEASED at run time from a pool, so there is no
// correct default to write here. The old literal was a DEFAULT that rotted --
// every one of these configs still carried its pre-REQ-0172 hand-picked port
// years after the harnesses had moved (REQ-0251), harmless only because the
// harness always passed PLAYWRIGHT_BASE_URL. A fallback now would be worse than
// stale: pool ports are reused, so it could point at ANOTHER run's proxy. Fail
// instead.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL;
if (!BASE_URL) {
  throw new Error(
    'PLAYWRIGHT_BASE_URL is not set. This config is driven by tools/content_admin_e2e.sh, which leases a ' +
    'port block (tools/e2e_ports.sh) and passes the proxy URL in. Run the harness -- ' +
    'a bare `playwright test --config=...` has no port to talk to (REQ-0323).');
}
export default defineConfig({
  testDir: '.',
  testMatch: '**/contentadmin.spec.ts',
  timeout: 120_000,
  expect: { timeout: 30_000 },
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
    actionTimeout: 20_000,
    navigationTimeout: 25_000,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 1000 } } }],
});
