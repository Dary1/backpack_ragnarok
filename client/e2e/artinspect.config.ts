// client/e2e/artinspect.config.ts -- REQ-0152 G4 isolated run config.
// Mirrors artadmin.config.ts (no globalSetup/teardown, no webServer -> the
// live profile/content/api are never touched). The api + static + proxy are
// started manually against an isolated (HOME-namespaced) pg instance of THIS
// worktree by tools/art_inspect_e2e.sh. baseURL = the local proxy.
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
    'PLAYWRIGHT_BASE_URL is not set. This config is driven by tools/art_inspect_e2e.sh, which leases a ' +
    'port block (tools/e2e_ports.sh) and passes the proxy URL in. Run the harness -- ' +
    'a bare `playwright test --config=...` has no port to talk to (REQ-0323).');
}
export default defineConfig({
  testDir: '.',
  testMatch: '**/artinspect.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1400, height: 1000 },
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 1000 } } }],
});
