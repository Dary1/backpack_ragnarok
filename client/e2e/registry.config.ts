// client/e2e/registry.config.ts -- REQ-0221 registry-first serving coverage.
// No globalSetup/webServer: api + proxy are started by
// tools/registry_first_e2e.sh against an isolated pg namespace SEEDED with
// one adopted def, so the registry-guard tests in dex-admin.spec.ts (the
// REQ-0182b 409 on a registry-served id) actually RUN instead of skipping --
// the files-backed default fleet can never exercise them (REQ-0234 F1), and
// the harness fails the stage if anything skips.
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
    'PLAYWRIGHT_BASE_URL is not set. This config is driven by tools/registry_first_e2e.sh, which leases a ' +
    'port block (tools/e2e_ports.sh) and passes the proxy URL in. Run the harness -- ' +
    'a bare `playwright test --config=...` has no port to talk to (REQ-0323).');
}
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
