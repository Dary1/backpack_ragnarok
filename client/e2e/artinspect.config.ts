// client/e2e/artinspect.config.ts -- REQ-0152 G4 isolated run config.
// Mirrors artadmin.config.ts (no globalSetup/teardown, no webServer -> the
// live profile/content/api are never touched). The api + static + proxy are
// started manually against an isolated (HOME-namespaced) pg instance of THIS
// worktree by tools/art_inspect_e2e.sh. baseURL = the local proxy.
import { defineConfig, devices } from '@playwright/test';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8913';
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
