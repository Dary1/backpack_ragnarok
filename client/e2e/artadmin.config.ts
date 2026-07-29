// client/e2e/artadmin.config.ts -- REQ-0151 G4 isolated run config.
// No fleet globalSetup/teardown (does NOT touch the live profile/content/api),
// no webServer (the api + static + proxy are started manually against an
// isolated pg-namespaced instance of THIS worktree). baseURL = the local
// proxy. Run via tools/e2e_run.sh --config=e2e/artadmin.config.ts (box lock).
// REQ-0344: it now has ONE globalSetup, e2e/gpu-setup.ts, which asserts the
// WebGL renderer and nothing else -- no fleet, no state, no lock. The
// isolation claim above is unchanged.
import { defineConfig, devices } from '@playwright/test';
import { GPU_ARGS, GPU_HEADLESS } from './gpu';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:6562';
export default defineConfig({
  testDir: '.',
  testMatch: '**/artadmin.spec.ts',
  timeout: 150_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  // REQ-0344: assert the GPU flags below actually reached the NVIDIA GPU.
  // This is the ONLY globalSetup these configs have -- it boots no fleet,
  // clears no state and takes no lock (see e2e/gpu-setup.ts).
  globalSetup: './gpu-setup.ts',
  use: {
    baseURL: BASE_URL,
    // REQ-0344: was `headless: true` -- i.e. chrome-headless-shell on
    // SwiftShader -- from this config's first day, and REQ-0342's
    // GPU-by-default never reached it because this file does not import
    // playwright.config.ts. App.tsx's REQ-0034 rule keeps both PixiJS
    // Applications mounted on EVERY route, so even a DOM-only admin
    // console drove two WebGL scenes in software: the chromium
    // --type=gpu-process measured 500-660% CPU of 8 cores while the RTX
    // 2080 idled. See e2e/gpu.ts for the numbers.
    headless: GPU_HEADLESS,
    launchOptions: { args: GPU_ARGS },
    viewport: { width: 1400, height: 1000 },
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 1000 } } }],
});
